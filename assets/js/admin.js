(function () {
  var TIMEZONE = 'Europe/Chisinau';
  var SAFETY_POLL_MS = 60000;
  var UPCOMING_LABELS = { pending: 'Waiting', confirmed: 'Confirmed', cancelled: 'Cancelled' };
  var HISTORY_LABELS = { pending: 'Not confirmed', confirmed: 'Completed', cancelled: 'Cancelled' };

  var listEl = document.getElementById('bookings');
  var bannerEl = document.getElementById('banner');
  var bannerText = document.getElementById('banner-text');
  var liveEl = document.getElementById('live-status');
  var soundButton = document.getElementById('sound-toggle');
  var searchEl = document.getElementById('search');
  var tabs = document.querySelectorAll('[data-view]');

  var view = 'upcoming';
  var upcomingData = null;
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
        if (!response.ok) throw new Error(data.error || 'server');
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

  /* ---------- Cards ---------- */
  function card(booking, mode) {
    var labels = mode === 'history' ? HISTORY_LABELS : UPCOMING_LABELS;
    var isNew = mode === 'upcoming' && Boolean(unseenIds[booking.id]);
    var node = el('article', 'booking-card booking-card--' + booking.status + (isNew ? ' booking-card--new' : ''));

    var time = el('div', 'booking-card__time', booking.time);
    time.appendChild(el('span', 'booking-card__until', 'until ' + toTime(toMinutes(booking.time) + booking.duration)));
    node.appendChild(time);

    var main = el('div', 'booking-card__main');
    var service = el('div', 'booking-card__service', booking.service);
    service.appendChild(el('span', 'booking-card__badge', labels[booking.status] || booking.status));
    main.appendChild(service);

    var client = el('div', 'booking-card__client', booking.name + ' · ');
    var phone = el('a', 'booking-card__phone', booking.phone);
    phone.href = 'tel:' + booking.phone.replace(/[^0-9+]/g, '');
    client.appendChild(phone);
    main.appendChild(client);

    if (booking.comment) {
      main.appendChild(el('div', 'booking-card__comment', '“' + booking.comment + '”'));
    }

    var meta = 'Booked ' + formatStamp(booking.created_at);
    if (booking.status_changed_at && booking.status !== 'pending') {
      meta += ' · ' + booking.status + ' ' + formatStamp(booking.status_changed_at);
    }
    main.appendChild(el('div', 'booking-card__meta', meta));
    node.appendChild(main);

    var actions = el('div', 'booking-card__actions');
    if (mode === 'upcoming') {
      if (booking.status === 'pending') {
        actions.appendChild(button('Confirm', 'btn btn--primary btn--small booking-card__button', function () {
          setStatus(booking, 'confirmed');
        }));
      }
      if (booking.status !== 'cancelled') {
        actions.appendChild(button('Cancel', 'btn btn--danger btn--small booking-card__button', function () {
          if (window.confirm('Cancel the booking of ' + booking.name + ' at ' + booking.time + '?')) {
            setStatus(booking, 'cancelled');
          }
        }));
      }
    }
    node.appendChild(actions);

    return node;
  }

  /* ---------- Rendering ---------- */
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
      listEl.appendChild(el('p', 'admin__empty', history.query ? 'Nothing found.' : 'No past bookings yet.'));
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

  function render() {
    if (noAccess) return;
    listEl.innerHTML = '';
    if (view === 'upcoming') renderUpcoming();
    else renderHistory();
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

  /* ---------- New booking alert ---------- */
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
        if (!first && booking.status === 'pending') fresh.push(booking);
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

  function setStatus(booking, status) {
    delete unseenIds[booking.id];

    request('PATCH', '/api/admin/bookings/' + booking.id, { status: status })
      .then(loadUpcoming)
      .catch(function (error) {
        if (error.message === 'redirect') return;
        window.alert(error.message === 'forbidden' ? 'No access.' : error.message);
      });
  }

  /* ---------- Instant notifications ---------- */
  function connectStream() {
    if (!window.EventSource) return;

    source = new EventSource('/api/admin/stream');

    source.addEventListener('booking', function () {
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
