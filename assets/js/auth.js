/* =========================================================
   Login and registration forms
   ========================================================= */
function initAuthForms() {
  var form = document.querySelector('[data-auth]');
  if (!form) return;

  var mode = form.getAttribute('data-auth'); // 'login' or 'register'
  var message = document.getElementById('form-message');

  function setError(field, text) {
    var error = form.querySelector('[data-error="' + field + '"]');
    if (error) error.textContent = text;
    form.elements[field].classList.toggle('form__input--invalid', Boolean(text));
  }

  function validate() {
    var e = form.elements;
    var valid = true;
    var fields = mode === 'register'
      ? ['name', 'email', 'phone', 'password', 'confirm']
      : ['email', 'password'];

    function fail(field, text) {
      setError(field, text);
      valid = false;
    }

    fields.forEach(function (field) {
      setError(field, '');
    });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email.value.trim())) {
      fail('email', 'Please enter a valid email.');
    }

    if (mode === 'login') {
      if (!e.password.value) fail('password', 'Please enter your password.');
      return valid;
    }

    if (e.name.value.trim().length < 2) fail('name', 'Please enter your name.');
    if (!/^\+?[0-9\s()-]{8,15}$/.test(e.phone.value.trim())) fail('phone', 'Invalid phone number.');
    if (e.password.value.length < 8) fail('password', 'Use at least 8 characters.');
    if (e.confirm.value !== e.password.value) fail('confirm', 'Passwords do not match.');

    return valid;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    message.textContent = '';
    message.classList.remove('form__message--error');

    if (!validate()) return;

    var e = form.elements;
    var data = { email: e.email.value.trim(), password: e.password.value };

    if (mode === 'register') {
      data.name = e.name.value.trim();
      data.phone = e.phone.value.trim();
    }

    apiRequest('POST', '/api/' + mode, data)
      .then(function () {
        window.location.href = 'account.html';
      })
      .catch(function (error) {
        message.textContent = error.userMessage ||
          (error.status ? 'Something went wrong. Please try again.' : 'Could not reach the server. Please try again.');
        message.classList.add('form__message--error');
      });
  });
}

initAuthForms();
