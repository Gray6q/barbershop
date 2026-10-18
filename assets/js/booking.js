/* =========================================================
   Booking page: form, free times from the server, sending
   ========================================================= */
function initBookingForm() {
  var form = document.getElementById('booking-form');
  if (!form) return;

  var serviceSelect = form.elements.service;
  var dateInput = form.elements.date;
  var timeSelect = form.elements.time;
  var message = document.getElementById('form-message');
  var lastRequest = 0;
  var account = null;

  // the service list comes from the server
  SERVICES.forEach(function (service) {
    var option = document.createElement('option');
    option.value = service.name;
    option.textContent = service.name + ' · ' + service.price + ' MDL';
    serviceSelect.appendChild(option);
  });

  // the earliest date is today, by Chisinau time
  dateInput.min = getChisinauNow().dateStr;

  // pre-select the service when the link has ?service=...
  var wanted = new URLSearchParams(window.location.search).get('service');
  if (wanted) {
    Array.prototype.forEach.call(serviceSelect.options, function (option) {
      if (option.value === wanted) serviceSelect.value = wanted;
    });
  }

  /* ---------- Free times ---------- */
  function setTimeOptions(options, enabled) {
    timeSelect.innerHTML = '';
    options.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      timeSelect.appendChild(option);
    });
    timeSelect.disabled = !enabled;
  }

  function loadTimes() {
    if (!dateInput.value || !serviceSelect.value) {
      setTimeOptions([{ value: '', label: 'Choose a service and a date first' }], false);
      return;
    }

    var request = ++lastRequest;
    setTimeOptions([{ value: '', label: 'Loading...' }], false);

    var url = '/api/availability?date=' + encodeURIComponent(dateInput.value) +
              '&service=' + encodeURIComponent(serviceSelect.value);

    apiRequest('GET', url)
      .then(function (data) {
        if (request !== lastRequest) return;

        if (!data.times.length) {
          setTimeOptions([{ value: '', label: 'No free times on this day' }], false);
          return;
        }

        var options = [{ value: '', label: 'Choose a time' }];
        data.times.forEach(function (time) {
          options.push({ value: time, label: time });
        });
        setTimeOptions(options, true);
      })
      .catch(function () {
        if (request !== lastRequest) return;
        setTimeOptions([{ value: '', label: 'Could not load times' }], false);
      });
  }

  serviceSelect.addEventListener('change', loadTimes);
  dateInput.addEventListener('change', loadTimes);
  loadTimes();

  /* ---------- Name and phone of a logged-in client ---------- */
  function fillContactFields() {
    if (!account) return;
    if (!form.elements.name.value) form.elements.name.value = account.name;
    if (!form.elements.phone.value) form.elements.phone.value = account.phone;
  }

  apiRequest('GET', '/api/me')
    .then(function (data) {
      account = data.user;
      fillContactFields();
    })
    .catch(function () {});

  /* ---------- Validation ---------- */
  function showError(field, text) {
    var error = form.querySelector('[data-error="' + field + '"]');
    if (error) error.textContent = text;
    form.elements[field].classList.toggle('form__input--invalid', Boolean(text));
  }

  function validate() {
    var e = form.elements;
    var valid = true;
    var dateOk = true;

    ['name', 'phone', 'service', 'date', 'time'].forEach(function (field) {
      showError(field, '');
    });

    function fail(field, text) {
      showError(field, text);
      valid = false;
    }

    if (e.name.value.trim().length < 2) fail('name', 'Please enter your name.');
    if (!/^\+?[0-9\s()-]{8,15}$/.test(e.phone.value.trim())) fail('phone', 'Invalid phone number.');
    if (!e.service.value) fail('service', 'Please choose a service.');

    if (!e.date.value) {
      fail('date', 'Please choose a date.');
      dateOk = false;
    } else if (e.date.value < getChisinauNow().dateStr) {
      fail('date', 'The date cannot be in the past.');
      dateOk = false;
    } else if (!HOURS[weekdayOf(e.date.value)]) {
      fail('date', 'We are closed on this day.');
      dateOk = false;
    }

    if (dateOk && e.service.value && !e.time.value) fail('time', 'Please choose a time.');

    return valid;
  }

  /* ---------- Sending ---------- */
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    message.textContent = '';
    message.classList.remove('form__message--error');

    if (!validate()) return;

    var e = form.elements;
    var data = {
      name: e.name.value.trim(),
      phone: e.phone.value.trim(),
      service: e.service.value,
      date: e.date.value,
      time: e.time.value,
      comment: e.comment.value.trim()
    };

    apiRequest('POST', '/api/bookings', data)
      .then(function () {
        message.textContent = 'Your booking has been sent. We will call you to confirm.';
        form.reset();
        fillContactFields();
        loadTimes();
      })
      .catch(function (error) {
        if (error.status === 409) loadTimes(); // the time was just taken
        message.textContent = error.userMessage || 'Could not send. Please try again or call us.';
        message.classList.add('form__message--error');
      });
  });
}

whenConfigReady(initBookingForm, function () {
  var message = document.getElementById('form-message');
  if (!message) return;
  message.textContent = 'Could not load the booking options. Please call us.';
  message.classList.add('form__message--error');
});
