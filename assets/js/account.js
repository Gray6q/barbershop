/* =========================================================
   Account page: the client's data, upcoming bookings, history
   ========================================================= */
function initAccountPage() {
  var box = document.querySelector('[data-account]');
  if (!box) return;

  apiRequest('GET', '/api/me')
    .then(function (data) {
      // the administrator's account page is the reception page
      if (data.user.role === 'admin') {
        window.location.href = 'admin.html';
        return;
      }

      document.querySelectorAll('[data-field]').forEach(function (element) {
        element.textContent = data.user[element.getAttribute('data-field')];
      });
      box.hidden = false;
      loadMyBookings();
    })
    .catch(function () {
      window.location.href = 'login.html';
    });

  document.getElementById('logout').addEventListener('click', function () {
    function goToLogin() {
      window.location.href = 'login.html';
    }
    apiRequest('POST', '/api/logout').then(goToLogin, goToLogin);
  });
}

function loadMyBookings() {
  var upcomingEl = document.getElementById('upcoming-list');
  var historyEl = document.getElementById('history-list');
  if (!upcomingEl || !historyEl) return;

  var UPCOMING_LABELS = { pending: 'Waiting for confirmation', confirmed: 'Confirmed' };
  var HISTORY_LABELS = {
    pending: 'Not confirmed',
    confirmed: 'Confirmed',
    completed: 'Completed',
    no_show: 'Missed',
    cancelled: 'Cancelled'
  };

  function visitNode(booking, labels, cancellable) {
    var node = document.createElement('article');
    node.className = 'visit visit--' + booking.status;

    var parts = booking.date.split('-').map(Number);
    var day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    });

    var when = document.createElement('div');
    when.className = 'visit__when';
    when.textContent = day + ' · ' + booking.time;

    var status = document.createElement('div');
    status.className = 'visit__status';
    status.textContent = labels[booking.status] || booking.status;

    var service = document.createElement('div');
    service.className = 'visit__service';
    service.textContent = booking.service;

    node.appendChild(when);
    node.appendChild(status);
    node.appendChild(service);

    if (cancellable && booking.canCancel) {
      var actions = document.createElement('div');
      actions.className = 'visit__actions';

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn--danger btn--small visit__button';
      cancel.textContent = 'Cancel booking';
      cancel.addEventListener('click', function () {
        if (!window.confirm('Cancel your booking on ' + day + ' at ' + booking.time + '?')) return;

        cancel.disabled = true;
        apiRequest('POST', '/api/my/bookings/' + booking.id + '/cancel')
          .then(loadMyBookings)
          .catch(function (error) {
            cancel.disabled = false;
            window.alert(error.userMessage || 'Could not cancel. Please call us.');
          });
      });

      actions.appendChild(cancel);
      node.appendChild(actions);
    }

    return node;
  }

  function fill(container, items, labels, emptyText, withLink, cancellable) {
    container.innerHTML = '';

    if (!items.length) {
      var empty = document.createElement('p');
      empty.className = 'account__empty';
      empty.textContent = emptyText;

      if (withLink) {
        var link = document.createElement('a');
        link.className = 'account__link';
        link.href = 'booking.html';
        link.textContent = ' Book a time';
        empty.appendChild(link);
      }

      container.appendChild(empty);
      return;
    }

    items.forEach(function (booking) {
      container.appendChild(visitNode(booking, labels, cancellable));
    });
  }

  apiRequest('GET', '/api/my/bookings')
    .then(function (data) {
      fill(upcomingEl, data.upcoming, UPCOMING_LABELS, 'No upcoming bookings.', true, true);
      fill(historyEl, data.history, HISTORY_LABELS, 'No visits yet.', false, false);

      if (data.upcoming.length) {
        var note = document.createElement('p');
        note.className = 'account__note';
        note.textContent = 'You can cancel online up to ' + data.cancelHours +
          ' hours before. Closer than that, please call us.';
        upcomingEl.appendChild(note);
      }
    })
    .catch(function () {
      upcomingEl.textContent = 'Could not load your bookings.';
      historyEl.textContent = '';
    });
}

initAccountPage();
