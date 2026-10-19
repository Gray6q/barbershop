(function () {
  var TIMEZONE = 'Europe/Chisinau';
  var SAFETY_POLL_MS = 60000;
  var LABELS = { pending: 'Waiting', confirmed: 'Confirmed', completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled' };
  var DAYS = [['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday'], ['0', 'Sunday']];

  var listEl = document.getElementById('bookings');
  var bannerEl = document.getElementById('banner');
  var bannerText = document.getElementById('banner-text');
  var liveEl = document.getElementById('live-status');
  var soundButton = document.getElementById('sound-toggle');
  var searchEl = document.getElementById('search');
  var tabs = document.querySelectorAll('[data-view]');

  var view = 'upcoming';
  var upcomingData = null;
  var configData = null;
  var settingsData = null;
  var knownIds = null;      // ids already seen (null until the first load)
  var unseenIds = {};       // new bookings nobody acknowledged yet
  var history = { items: [], hasMore: false, query: '', loading: false };
  var historyLoaded = false;
  var historyRequest = 0;
  var streamOpen = false;
  var connectionLost = false;
  var noAccess = false;
  var lastUpdated = '';
  var soundOn = false;
  var audioContext = null;
  var source = null;
  var pollTimer = null;
  var searchTimer = null;
  var baseTitle = document.title;

  /* ---------- Helpers ---------- */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, className, onClick) {
    var node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function control(tag, className, attrs) {
    var node = document.createElement(tag);
    node.className = className || '';
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function field(label, node) {
    var wrap = el('div', 'form__field');
    wrap.appendChild(el('label', 'form__label', label));
    wrap.appendChild(node);
    return wrap;
  }

  function checkbox(label, checked) {
    var wrap = el('label', 'admin__check');
    var box = control('input', '', { type: 'checkbox' });
    box.checked = checked;
    wrap.appendChild(box);
    wrap.appendChild(document.createTextNode(label));
    return { wrap: wrap, box: box };
  }

  function setOptions(select, options) {
    select.innerHTML = '';
    options.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item[0];
      option.textContent = item[1];
      select.appendChild(option);
    });
  }

  function pad(number) {
    return (number < 10 ? '0' : '') + number;
  }

  function toMinutes(time) {
    var parts = time.split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function toTime(minutes) {
    return pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
  }

  function addDays(dateStr, days) {
    var p = dateStr.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function dayLabel(dateStr, today) {
    var p = dateStr.split('-').map(Number);
    var text = new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    });
    if (today && dateStr === today) return 'Today · ' + text;
    if (today && dateStr === addDays(today, 1)) return 'Tomorrow · ' + text;
    return text;
  }

  // The database stores UTC time; show it in Chisinau time
  function formatStamp(stamp) {
    if (!stamp) return '';
    var date = new Date(stamp.replace(' ', 'T') + 'Z');
    return date.toLocaleString('en-GB', {
      timeZone: TIMEZONE, day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function updateLive() {
    var text;
    if (connectionLost) {
      text = 'Connection lost – retrying...';
    } else {
      text = (streamOpen ? 'Live' : 'Checking every minute') + (lastUpdated ? ' · updated ' + lastUpdated : '');
    }
    liveEl.textContent = text;
    liveEl.classList.toggle('admin__live--error', connectionLost || !streamOpen);
  }

  function clearMessage(node) {
    node.textContent = '';
    node.className = 'form__message';
  }

  function showFormError(node, error) {
    if (error.message === 'redirect') return;
    node.textContent = error.message === 'forbidden' ? 'No access.' : error.message;
    node.classList.add('form__message--error');
  }

  /* ---------- Sound ---------- */
  function beep() {
    if (!soundOn || !audioContext) return;
    try {
      [0, 0.3].forEach(function (delay) {
        var oscillator = audioContext.createOscillator();
        var gain = audioContext.createGain();
        var start = audioContext.currentTime + delay;
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.25);
      });
    } catch (error) {}
  }

  // Browsers allow sound only after a click, so the barber turns it on once
  soundButton.addEventListener('click', function () {
    soundOn = !soundOn;
    if (soundOn) {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.resume) audioContext.resume();
      beep();
    }
    soundButton.textContent = soundOn ? 'Sound on' : 'Turn sound on';
    soundButton.classList.toggle('admin__button--on', soundOn);
  });

  /* ---------- Server ---------- */
  function request(method, url, body) {
    var options = { method: method, headers: {} };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    return fetch(url, options).then(function (response) {
      if (response.status === 401) {
        window.location.href = 'login.html';
        throw new Error('redirect');
      }
      if (response.status === 403) throw new Error('forbidden');

      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || 'Something went wrong.');
        return data;
      });
    });
  }

  function handleError(error) {
    if (error.message === 'redirect') return;

    if (error.message === 'forbidden') {
      noAccess = true;
      if (source) source.close();
      clearInterval(pollTimer);
      listEl.innerHTML = '';
      listEl.appendChild(el('p', 'admin__error', 'This account is not an administrator.'));
      liveEl.textContent = 'No access';
      liveEl.classList.add('admin__live--error');
      return;
    }

    connectionLost = true;
    updateLive();
  }

  function withConfig(done) {
    if (configData) { done(); return; }
    request('GET', '/api/config')
      .then(function (data) { configData = data; done(); })
      .catch(handleError);
  }

  function withSettings(done) {
    if (settingsData) { done(); return; }
    request('GET', '/api/admin/settings')
      .then(function (data) { settingsData = data; done(); })
      .catch(handleError);
  }

  /* ---------- Booking cards ---------- */
  function hasStarted(booking) {
    if (!upcomingData) return false;
    return booking.date < upcomingData.today ||
      (booking.date === upcomingData.today && toMinutes(booking.time) <= upcomingData.nowMinutes);
  }

  function card(booking, mode) {
    var isNew = mode === 'upcoming' && Boolean(unseenIds[booking.id]);
    var node = el('article', 'booking-card booking-card--' + booking.status + (isNew ? ' booking-card--new' : ''));

    var time = el('div', 'booking-card__time', booking.time);
    time.appendChild(el('span', 'booking-card__until', 'until ' + toTime(toMinutes(booking.time) + booking.duration)));
    node.appendChild(time);

    var label = (mode === 'history' && booking.status === 'pending') ? 'Not confirmed' : (LABELS[booking.status] || booking.status);
    var main = el('div', 'booking-card__main');
    var service = el('div', 'booking-card__service', booking.service);
    service.appendChild(el('span', 'booking-card__badge', label));
    main.appendChild(service);

    var client = el('div', 'booking-card__client', booking.name);
    if (booking.phone && booking.phone !== '-') {
      client.appendChild(document.createTextNode(' · '));
      var phone = el('a', 'booking-card__phone', booking.phone);
      phone.href = 'tel:' + booking.phone.replace(/[^0-9+]/g, '');
      client.appendChild(phone);
    }
    main.appendChild(client);

    if (booking.comment) {
      main.appendChild(el('div', 'booking-card__comment', '“' + booking.comment + '”'));
    }

    var meta = 'Booked ' + formatStamp(booking.created_at) + (booking.source === 'manual' ? ' · added by hand' : '');
    if (booking.status_changed_at && booking.status !== 'pending') {
      meta += ' · ' + (LABELS[booking.status] || booking.status).toLowerCase() + ' ' + formatStamp(booking.status_changed_at);
    }
    main.appendChild(el('div', 'booking-card__meta', meta));
    node.appendChild(main);

    var actions = el('div', 'booking-card__actions');
    if (mode === 'upcoming') {
      var status = booking.status;
      var active = status === 'pending' || status === 'confirmed';

      if (status === 'pending') {
        actions.appendChild(button('Confirm', 'btn btn--primary btn--small booking-card__button', function () {
          setStatus(booking, 'confirmed');
        }));
      }
      if (active && hasStarted(booking)) {
        actions.appendChild(button('Done', 'btn btn--primary btn--small booking-card__button', function () {
          setStatus(booking, 'completed');
        }));
        actions.appendChild(button('No-show', 'btn btn--danger btn--small booking-card__button', function () {
          setStatus(booking, 'no_show');
        }));
      }
      if (active) {
        actions.appendChild(button('Cancel', 'btn btn--danger btn--small booking-card__button', function () {
          if (window.confirm('Cancel the booking of ' + booking.name + ' at ' + booking.time + '?')) {
            setStatus(booking, 'cancelled');
          }
        }));
      }
      if (status === 'completed' || status === 'no_show') {
        actions.appendChild(button('Undo', 'btn btn--outline btn--small booking-card__button', function () {
          setStatus(booking, 'confirmed');
        }));
      }
    }
    node.appendChild(actions);

    return node;
  }

  function setStatus(booking, status) {
    delete unseenIds[booking.id];

    request('PATCH', '/api/admin/bookings/' + booking.id, { status: status })
      .then(loadUpcoming)
      .catch(function (error) {
        if (error.message === 'redirect') return;
        window.alert(error.message === 'forbidden' ? 'No access.' : error.message);
      });
  }

  /* ---------- Views ---------- */
  function renderList(bookings, today, mode) {
    var currentDate = null;
    bookings.forEach(function (booking) {
      if (booking.date !== currentDate) {
        currentDate = booking.date;
        listEl.appendChild(el('h2', 'admin__day-title', dayLabel(booking.date, today)));
      }
      listEl.appendChild(card(booking, mode));
    });
  }

  function renderUpcoming() {
    if (!upcomingData) {
      listEl.appendChild(el('p', 'admin__empty', 'Loading...'));
    } else if (!upcomingData.bookings.length) {
      listEl.appendChild(el('p', 'admin__empty', 'No bookings yet. New ones will appear here by themselves.'));
    } else {
      renderList(upcomingData.bookings, upcomingData.today, 'upcoming');
    }
  }

  function renderHistory() {
    if (!history.items.length && !history.loading) {
      listEl.appendChild(el('p', 'admin__empty', history.query ? 'Nothing found.' : 'No bookings from past days yet.'));
      return;
    }

    renderList(history.items, upcomingData ? upcomingData.today : null, 'history');

    if (history.loading) {
      listEl.appendChild(el('p', 'admin__empty', 'Loading...'));
    } else if (history.hasMore) {
      listEl.appendChild(button('Load more', 'admin__button admin__more', function () {
        loadHistory(false);
      }));
    }
  }

  /* ----- New booking (added by hand) ----- */
  function renderNew() {
    if (!configData) {
      listEl.appendChild(el('p', 'admin__empty', 'Loading...'));
      return;
    }

    var form = el('form', 'admin__panel');
    form.noValidate = true;

    var name = control('input', 'form__input', { type: 'text', maxlength: '80', autocomplete: 'off' });
    var phone = control('input', 'form__input', { type: 'tel', autocomplete: 'off', placeholder: 'Optional' });
    var service = control('select', 'form__input');
    var date = control('input', 'form__input', { type: 'date' });
    var time = control('select', 'form__input');
    var comment = control('textarea', 'form__input form__input--textarea', { rows: '2', maxlength: '300' });
    var message = el('p', 'form__message');
    var lastRequest = 0;

    if (upcomingData) date.min = upcomingData.today;

    setOptions(service, [['', 'Choose a service']].concat(configData.services.map(function (item) {
      return [item.name, item.name + ' · ' + item.duration + ' min'];
    })));
    setOptions(time, [['', 'Choose a service and a date first']]);
    time.disabled = true;

    function loadTimes() {
      if (!date.value || !service.value) {
        setOptions(time, [['', 'Choose a service and a date first']]);
        time.disabled = true;
        return;
      }

      var id = ++lastRequest;
      setOptions(time, [['', 'Loading...']]);
      time.disabled = true;

      request('GET', '/api/availability?date=' + encodeURIComponent(date.value) +
                     '&service=' + encodeURIComponent(service.value))
        .then(function (data) {
          if (id !== lastRequest) return;
          if (!data.times.length) {
            setOptions(time, [['', 'No free times on this day']]);
            return;
          }
          setOptions(time, [['', 'Choose a time']].concat(data.times.map(function (t) { return [t, t]; })));
          time.disabled = false;
        })
        .catch(function () {
          if (id === lastRequest) setOptions(time, [['', 'Could not load times']]);
        });
    }

    service.addEventListener('change', loadTimes);
    date.addEventListener('change', loadTimes);

    var row = el('div', 'form__row');
    row.appendChild(field('Date', date));
    row.appendChild(field('Time', time));

    form.appendChild(field('Client name', name));
    form.appendChild(field('Phone', phone));
    form.appendChild(field('Service', service));
    form.appendChild(row);
    form.appendChild(field('Comment (optional)', comment));
    form.appendChild(button('Add booking', 'btn btn--primary form__submit', function () {
      form.requestSubmit();
    }));
    form.appendChild(message);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearMessage(message);

      request('POST', '/api/admin/bookings', {
        name: name.value, phone: phone.value, service: service.value,
        date: date.value, time: time.value, comment: comment.value
      })
        .then(function () {
          return loadUpcoming();
        })
        .then(function () {
          setView('upcoming');
        })
        .catch(function (error) {
          showFormError(message, error);
          if (date.value && service.value) loadTimes();
        });
    });

    listEl.appendChild(form);
  }

  /* ----- Time off ----- */
  function blockRow(block, reload) {
    var row = el('div', 'admin__block');
    var text = dayLabel(block.date, upcomingData ? upcomingData.today : null) + ' · ' +
      (block.start_time ? block.start_time + ' – ' + block.end_time : 'Whole day') +
      (block.reason ? ' · ' + block.reason : '');

    row.appendChild(el('span', 'admin__block-text', text));
    row.appendChild(button('Remove', 'btn btn--outline btn--small', function () {
      request('DELETE', '/api/admin/blocks/' + block.id)
        .then(reload)
        .catch(function (error) {
          if (error.message !== 'redirect') window.alert(error.message);
        });
    }));
    return row;
  }

  function renderBlocks() {
    var form = el('form', 'admin__panel');
    form.noValidate = true;

    var from = control('input', 'form__input', { type: 'date' });
    var to = control('input', 'form__input', { type: 'date' });
    var start = control('input', 'form__input', { type: 'time' });
    var end = control('input', 'form__input', { type: 'time' });
    var reason = control('input', 'form__input', { type: 'text', maxlength: '100', placeholder: 'Optional, for example: vacation' });
    var whole = checkbox(' Whole day (or several days)', true);
    var message = el('p', 'form__message');
    var listBox = el('div');

    if (upcomingData) {
      from.min = upcomingData.today;
      to.min = upcomingData.today;
    }

    var datesRow = el('div', 'form__row');
    datesRow.appendChild(field('First day', from));
    datesRow.appendChild(field('Last day (optional)', to));

    var timesRow = el('div', 'form__row');
    timesRow.appendChild(field('From', start));
    timesRow.appendChild(field('To', end));
    timesRow.hidden = true;

    whole.box.addEventListener('change', function () {
      timesRow.hidden = whole.box.checked;
      to.disabled = !whole.box.checked;
    });

    form.appendChild(el('h2', 'admin__heading', 'Block time off'));
    form.appendChild(datesRow);
    form.appendChild(whole.wrap);
    form.appendChild(timesRow);
    form.appendChild(field('Reason', reason));
    form.appendChild(button('Block', 'btn btn--primary form__submit', function () {
      form.requestSubmit();
    }));
    form.appendChild(message);

    function loadBlocks() {
      request('GET', '/api/admin/blocks')
        .then(function (data) {
          listBox.innerHTML = '';
          if (!data.blocks.length) {
            listBox.appendChild(el('p', 'admin__empty', 'Nothing planned.'));
            return;
          }
          data.blocks.forEach(function (block) {
            listBox.appendChild(blockRow(block, loadBlocks));
          });
        })
        .catch(handleError);
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearMessage(message);

      var body = { date: from.value, reason: reason.value };
      if (whole.box.checked) {
        if (to.value) body.dateTo = to.value;
      } else {
        body.startTime = start.value;
        body.endTime = end.value;
      }

      request('POST', '/api/admin/blocks', body)
        .then(function (data) {
          message.textContent = 'Blocked.';
          if (data.conflicts.length) {
            window.alert('These bookings are already inside the blocked time. Cancel or move them:\n\n' +
              data.conflicts.map(function (c) {
                return c.date + ' ' + c.time + ' · ' + c.name + ' · ' + c.service;
              }).join('\n'));
          }
          loadBlocks();
        })
        .catch(function (error) {
          showFormError(message, error);
        });
    });

    listEl.appendChild(form);
    listEl.appendChild(el('h2', 'admin__day-title', 'Planned time off'));
    listEl.appendChild(listBox);
    loadBlocks();
  }

  /* ----- Settings: opening hours and services ----- */
  function renderSettings() {
    if (!settingsData) {
      listEl.appendChild(el('p', 'admin__empty', 'Loading...'));
      return;
    }

    var form = el('form', 'admin__panel');
    form.noValidate = true;
    var message = el('p', 'form__message');
    var hoursRows = {};
    var servicesBox = el('div');

    form.appendChild(el('h2', 'admin__heading', 'Opening hours'));
    form.appendChild(el('p', 'admin__hint', 'Times are Chisinau time.'));

    DAYS.forEach(function (day) {
      var value = settingsData.hours[day[0]];
      var row = el('div', 'admin__hours-row');
      var closed = checkbox(' Closed', !value);
      var open = control('input', 'form__input', { type: 'time' });
      var close = control('input', 'form__input', { type: 'time' });

      open.value = value ? value[0] : '09:00';
      close.value = value ? value[1] : '18:00';

      function sync() {
        open.disabled = closed.box.checked;
        close.disabled = closed.box.checked;
      }
      closed.box.addEventListener('change', sync);
      sync();

      row.appendChild(el('span', 'admin__hours-day', day[1]));
      row.appendChild(closed.wrap);
      row.appendChild(open);
      row.appendChild(close);
      form.appendChild(row);

      hoursRows[day[0]] = { closed: closed.box, open: open, close: close };
    });

    form.appendChild(el('h2', 'admin__heading', 'Services and prices'));
    form.appendChild(el('p', 'admin__hint', 'Changes appear on the website right after you save. Existing bookings are not changed.'));

    function serviceRow(service) {
      var row = el('div', 'admin__service');
      var name = control('input', 'form__input', { type: 'text', maxlength: '60' });
      var duration = control('input', 'form__input', { type: 'number', min: '10', max: '480', step: '5' });
      var price = control('input', 'form__input', { type: 'number', min: '0', step: '1' });
      var description = control('input', 'form__input', { type: 'text', maxlength: '200' });
      var featured = checkbox(' Most popular', Boolean(service.featured));

      name.value = service.name;
      duration.value = service.duration;
      price.value = service.price;
      description.value = service.description || '';

      row.appendChild(field('Name', name));
      row.appendChild(field('Minutes', duration));
      row.appendChild(field('Price (MDL)', price));
      row.appendChild(field('Description', description));
      row.appendChild(featured.wrap);
      row.appendChild(button('Remove', 'btn btn--danger btn--small', function () {
        row.remove();
      }));

      row.readValues = function () {
        return {
          name: name.value,
          duration: Number(duration.value),
          price: Number(price.value),
          description: description.value,
          featured: featured.box.checked
        };
      };
      return row;
    }

    settingsData.services.forEach(function (service) {
      servicesBox.appendChild(serviceRow(service));
    });
    form.appendChild(servicesBox);

    var actions = el('div', 'admin__service-actions');
    actions.appendChild(button('+ Add service', 'btn btn--outline btn--small', function () {
      servicesBox.appendChild(serviceRow({ name: '', duration: 30, price: 0, description: '', featured: false }));
    }));
    form.appendChild(actions);

    form.appendChild(button('Save changes', 'btn btn--primary form__submit', function () {
      form.requestSubmit();
    }));
    form.appendChild(message);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearMessage(message);

      var hours = {};
      Object.keys(hoursRows).forEach(function (key) {
        var r = hoursRows[key];
        hours[key] = r.closed.checked ? null : [r.open.value, r.close.value];
      });

      var services = Array.prototype.map.call(servicesBox.children, function (row) {
        return row.readValues();
      });

      request('PUT', '/api/admin/settings', { hours: hours, services: services })
        .then(function (data) {
          settingsData = data;
          configData = null;
          message.textContent = 'Saved. The website is updated.';
        })
        .catch(function (error) {
          showFormError(message, error);
        });
    });

    listEl.appendChild(form);
  }

  function render() {
    if (noAccess) return;
    listEl.innerHTML = '';

    if (view === 'upcoming') renderUpcoming();
    else if (view === 'history') renderHistory();
    else if (view === 'new') renderNew();
    else if (view === 'blocks') renderBlocks();
    else if (view === 'settings') renderSettings();
  }

  function setView(next) {
    view = next;
    tabs.forEach(function (tab) {
      tab.classList.toggle('admin__tab--active', tab.getAttribute('data-view') === next);
    });
    searchEl.hidden = next !== 'history';

    if (next === 'history' && !historyLoaded) {
      historyLoaded = true;
      loadHistory(true);
      return;
    }

    render();

    if (next === 'new' && !configData) {
      withConfig(function () { if (view === 'new') render(); });
    }
    if (next === 'settings' && !settingsData) {
      withSettings(function () { if (view === 'settings') render(); });
    }
    // the form may need fresh service names after settings were saved
    if (next === 'settings' && settingsData) {
      settingsData = null;
      withSettings(function () { if (view === 'settings') render(); });
    }
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      setView(tab.getAttribute('data-view'));
    });
  });

  searchEl.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      history.query = searchEl.value.trim().toLowerCase();
      loadHistory(true);
    }, 300);
  });

  /* ---------- Alerts ---------- */
  function showNotice(text) {
    bannerText.textContent = text;
    bannerEl.classList.add('admin__banner--visible');
    beep();
  }

  function showBanner(lastBooking) {
    var count = Object.keys(unseenIds).length;
    bannerText.textContent = count === 1
      ? 'New booking: ' + lastBooking.date + ' ' + lastBooking.time + ' · ' + lastBooking.service + ' · ' + lastBooking.name
      : count + ' new bookings waiting';
    bannerEl.classList.add('admin__banner--visible');
    document.title = '(' + count + ') ' + baseTitle;
  }

  function handleNew(bookings) {
    var first = knownIds === null;
    if (first) knownIds = {};

    var fresh = [];
    bookings.forEach(function (booking) {
      if (!knownIds[booking.id]) {
        knownIds[booking.id] = true;
        if (!first && booking.status === 'pending' && booking.source !== 'manual') fresh.push(booking);
      }
    });

    if (!fresh.length) return;

    fresh.forEach(function (booking) {
      unseenIds[booking.id] = true;
    });
    showBanner(fresh[fresh.length - 1]);
    beep();
  }

  document.getElementById('banner-dismiss').addEventListener('click', function () {
    unseenIds = {};
    bannerEl.classList.remove('admin__banner--visible');
    document.title = baseTitle;
    setView('upcoming');
  });

  /* ---------- Loading data ---------- */
  function loadUpcoming() {
    return request('GET', '/api/admin/bookings')
      .then(function (data) {
        connectionLost = false;
        upcomingData = data;
        handleNew(data.bookings);
        lastUpdated = new Date().toLocaleTimeString('en-GB', { timeZone: TIMEZONE });
        updateLive();
        if (view === 'upcoming') render();
      })
      .catch(handleError);
  }

  function loadHistory(reset) {
    if (reset) {
      history.items = [];
      history.hasMore = false;
    }

    var id = ++historyRequest;
    history.loading = true;
    render();

    var url = '/api/admin/history?offset=' + history.items.length + '&q=' + encodeURIComponent(history.query);

    request('GET', url)
      .then(function (data) {
        if (id !== historyRequest) return;
        history.items = history.items.concat(data.bookings);
        history.hasMore = data.hasMore;
        history.loading = false;
        if (view === 'history') render();
      })
      .catch(function (error) {
        if (id === historyRequest) {
          history.loading = false;
          if (view === 'history') render();
        }
        handleError(error);
      });
  }

  /* ---------- Instant notifications ---------- */
  function connectStream() {
    if (!window.EventSource) return;

    source = new EventSource('/api/admin/stream');

    source.addEventListener('booking', function () {
      loadUpcoming();
    });

    source.addEventListener('cancelled', function (event) {
      var info = {};
      try { info = JSON.parse(event.data); } catch (error) {}
      showNotice('Cancelled by the client: ' + (info.date || '') + ' ' + (info.time || '') +
        ' · ' + (info.service || '') + ' · ' + (info.name || ''));
      loadUpcoming();
    });

    source.onopen = function () {
      var wasDown = !streamOpen;
      streamOpen = true;
      updateLive();
      if (wasDown) loadUpcoming(); // catch up on anything missed while offline
    };

    source.onerror = function () {
      streamOpen = false;
      updateLive();
    };
  }

  document.getElementById('logout').addEventListener('click', function () {
    function goToLogin() {
      window.location.href = 'login.html';
    }
    fetch('/api/logout', { method: 'POST' }).then(goToLogin, goToLogin);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !noAccess) loadUpcoming();
  });

  render();
  loadUpcoming();
  connectStream();
  pollTimer = setInterval(loadUpcoming, SAFETY_POLL_MS);
})();
