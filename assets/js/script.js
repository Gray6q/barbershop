/* =========================================================
   CONFIG – change the opening hours here
   Days: 0 = Sunday, 1 = Monday ... 6 = Saturday
   null = closed all day
   ========================================================= */
var TIMEZONE = 'Europe/Chisinau';
var SLOT_MINUTES = 30;

var HOURS = {
  0: null,
  1: ['09:00', '20:00'],
  2: ['09:00', '20:00'],
  3: ['09:00', '20:00'],
  4: ['09:00', '20:00'],
  5: ['09:00', '20:00'],
  6: ['10:00', '18:00']
};

var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* =========================================================
   Chisinau time (regardless of the visitor's time zone)
   ========================================================= */
function getChisinauNow() {
  var parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());

  var p = {};
  parts.forEach(function (part) {
    p[part.type] = part.value;
  });

  var dateStr = p.year + '-' + p.month + '-' + p.day;

  return {
    dateStr: dateStr,
    weekday: weekdayOf(dateStr),
    minutes: Number(p.hour) * 60 + Number(p.minute)
  };
}

// weekday for a date in the form "YYYY-MM-DD"
function weekdayOf(dateStr) {
  var d = dateStr.split('-');
  return new Date(Date.UTC(Number(d[0]), Number(d[1]) - 1, Number(d[2]))).getUTCDay();
}

function toMinutes(time) {
  var t = time.split(':');
  return Number(t[0]) * 60 + Number(t[1]);
}

function toTime(minutes) {
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

/* =========================================================
   Status: Open now / Closed
   ========================================================= */
function updateStatus() {
  var elements = document.querySelectorAll('[data-status]');
  if (!elements.length) return;

  var now = getChisinauNow();
  var today = HOURS[now.weekday];
  var text;
  var isOpen = false;

  if (today && now.minutes >= toMinutes(today[0]) && now.minutes < toMinutes(today[1])) {
    isOpen = true;
    text = 'Open now · until ' + today[1];
  } else if (today && now.minutes < toMinutes(today[0])) {
    text = 'Closed · opens today at ' + today[0];
  } else {
    text = 'Closed';
    for (var i = 1; i <= 7; i++) {
      var day = (now.weekday + i) % 7;
      if (HOURS[day]) {
        var when = i === 1 ? 'tomorrow' : DAY_NAMES[day];
        text = 'Closed · opens ' + when + ' at ' + HOURS[day][0];
        break;
      }
    }
  }

  elements.forEach(function (el) {
    el.textContent = text;
    el.classList.toggle('status--open', isOpen);
    el.classList.toggle('status--closed', !isOpen);
  });
}

/* =========================================================
   Schedule in the "Hours" section (filled from HOURS)
   ========================================================= */
function fillSchedule() {
  document.querySelectorAll('[data-day]').forEach(function (el) {
    var hours = HOURS[el.getAttribute('data-day')];
    el.textContent = hours ? hours[0] + ' – ' + hours[1] : 'Closed';
  });
}

/* =========================================================
   Hamburger menu (mobile)
   ========================================================= */
function initMenu() {
  var toggle = document.querySelector('.header__toggle');
  var nav = document.querySelector('.header__nav');
  if (!toggle || !nav) return;

  function setOpen(open) {
    nav.classList.toggle('header__nav--open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  toggle.addEventListener('click', function () {
    setOpen(!nav.classList.contains('header__nav--open'));
  });

  nav.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') setOpen(false);
  });
}

/* =========================================================
   Booking form
   ========================================================= */
function initBookingForm() {
  var form = document.getElementById('booking-form');
  if (!form) return;

  var dateInput = form.elements.date;
  var timeSelect = form.elements.time;
  var message = document.getElementById('form-message');

  // minimum date = today, by Chisinau time
  dateInput.min = getChisinauNow().dateStr;

  function fillTimes() {
    var date = dateInput.value;
    timeSelect.innerHTML = '';

    function addOption(value, label) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      timeSelect.appendChild(option);
    }

    if (!date) {
      addOption('', 'Choose a date first');
      timeSelect.disabled = true;
      return;
    }

    var hours = HOURS[weekdayOf(date)];
    if (!hours) {
      addOption('', 'Closed on this day');
      timeSelect.disabled = true;
      return;
    }

    var now = getChisinauNow();
    var start = toMinutes(hours[0]);
    var end = toMinutes(hours[1]);
    var slots = [];

    for (var t = start; t + SLOT_MINUTES <= end; t += SLOT_MINUTES) {
      // if it is today, skip times that have already passed
      if (date === now.dateStr && t <= now.minutes) continue;
      slots.push(t);
    }

    if (!slots.length) {
      addOption('', 'No free slots left');
      timeSelect.disabled = true;
      return;
    }

    addOption('', 'Choose a time');
    slots.forEach(function (t) {
      addOption(toTime(t), toTime(t));
    });
    timeSelect.disabled = false;
  }

  dateInput.addEventListener('change', fillTimes);

  function showError(field, text) {
    var error = form.querySelector('[data-error="' + field + '"]');
    if (error) error.textContent = text;
    if (form.elements[field]) {
      form.elements[field].classList.toggle('form__input--invalid', Boolean(text));
    }
  }

  function validate() {
    var v = {
      name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      service: form.elements.service.value,
      date: dateInput.value,
      time: timeSelect.value
    };
    var valid = true;

    ['name', 'phone', 'service', 'date', 'time'].forEach(function (f) {
      showError(f, '');
    });

    function fail(field, text) {
      showError(field, text);
      valid = false;
    }

    if (v.name.length < 2) fail('name', 'Please enter your name.');
    if (!/^\+?[0-9\s()-]{8,15}$/.test(v.phone)) fail('phone', 'Invalid phone number.');
    if (!v.service) fail('service', 'Please choose a service.');

    if (!v.date) {
      fail('date', 'Please choose a date.');
    } else if (v.date < getChisinauNow().dateStr) {
      fail('date', 'The date cannot be in the past.');
    } else if (!HOURS[weekdayOf(v.date)]) {
      fail('date', 'We are closed on this day.');
    }

    if (!v.time && v.date && !form.querySelector('[data-error="date"]').textContent) {
      fail('time', 'Please choose a time.');
    }

    return valid;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    message.textContent = '';
    message.classList.remove('form__message--error');

    if (!validate()) return;

    var data = {
      name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      service: form.elements.service.value,
      date: dateInput.value,
      time: timeSelect.value,
      comment: form.elements.comment.value.trim()
    };

    sendBooking(data)
      .then(function () {
        message.textContent = 'Your booking has been sent. We will call you to confirm.';
        form.reset();
        fillTimes();
      })
      .catch(function () {
        message.textContent = 'Could not send. Please try again or call us.';
        message.classList.add('form__message--error');
      });
  });
}

/* =========================================================
   Sending to the server – to do later
   For now it only logs the data to the console.
   When the server is ready, replace the body of the function with:

   return fetch('SERVER-URL', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(data)
   }).then(function (response) {
     if (!response.ok) throw new Error('Server error');
   });
   ========================================================= */
function sendBooking(data) {
  console.log('Booking (not yet sent to the server):', data);
  return Promise.resolve();
}

/* ===== Start ===== */
fillSchedule();
updateStatus();
setInterval(updateStatus, 60000);
initMenu();
initBookingForm();


/* =========================================================
   Highlight today in the opening hours
   ========================================================= */
function highlightToday() {
  var today = getChisinauNow().weekday;
  document.querySelectorAll('.hours__row').forEach(function (row) {
    var time = row.querySelector('[data-day]');
    var isToday = Boolean(time) && Number(time.getAttribute('data-day')) === today;
    row.classList.toggle('hours__row--today', isToday);
  });
}

/* =========================================================
   Pre-select the service from the link (?service=...)
   ========================================================= */
function preselectService() {
  var select = document.getElementById('service');
  if (!select) return;

  var wanted = new URLSearchParams(window.location.search).get('service');
  if (!wanted) return;

  Array.prototype.forEach.call(select.options, function (option) {
    if (option.value === wanted) select.value = wanted;
  });
}

highlightToday();
preselectService();
