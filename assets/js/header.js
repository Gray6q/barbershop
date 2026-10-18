/* =========================================================
   Header: mobile menu and the "Log in" / "Account" link
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

  nav.addEventListener('click', function (event) {
    if (event.target.tagName === 'A') setOpen(false);
  });
}

// Logged-in visitors see "Account" instead of "Log in"
function updateAuthLink() {
  var link = document.querySelector('.header__nav a[href$="login.html"]');
  if (!link) return;

  apiRequest('GET', '/api/me')
    .then(function () {
      link.href = link.getAttribute('href').replace('login.html', 'account.html');
      link.textContent = 'Account';
    })
    .catch(function () {});
}

initMenu();
updateAuthLink();
