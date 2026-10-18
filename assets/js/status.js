/* =========================================================
   Opening hours: status badge, schedule table, today highlight
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

  elements.forEach(function (element) {
    element.textContent = text;
    element.classList.toggle('status--open', isOpen);
    element.classList.toggle('status--closed', !isOpen);
  });
}

// The hours table is filled from HOURS
function fillSchedule() {
  document.querySelectorAll('[data-day]').forEach(function (element) {
    var hours = HOURS[element.getAttribute('data-day')];
    element.textContent = hours ? hours[0] + ' – ' + hours[1] : 'Closed';
  });
}

function highlightToday() {
  var today = getChisinauNow().weekday;

  document.querySelectorAll('.hours__row').forEach(function (row) {
    var time = row.querySelector('[data-day]');
    var isToday = Boolean(time) && Number(time.getAttribute('data-day')) === today;
    row.classList.toggle('hours__row--today', isToday);
  });
}

whenConfigReady(function () {
  fillSchedule();
  highlightToday();
  updateStatus();

  setInterval(function () {
    updateStatus();
    highlightToday();
  }, 60000);
}, function () {
  document.querySelectorAll('[data-status]').forEach(function (element) {
    element.textContent = 'Opening hours unavailable';
  });
});
