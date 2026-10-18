/* =========================================================
   Shared settings and helpers (loaded on every public page)
   ========================================================= */

var TIMEZONE = 'Europe/Chisinau';

// Opening hours and services come from the server (Server/config.js).
// HOURS: days 0 = Sunday ... 6 = Saturday, each [open, close] or null when closed.
// SERVICES: a list of { name, duration, price, description, featured }.
var HOURS = {};
var SERVICES = [];
var configPromise = null;

// Runs onReady when the settings are loaded; onError runs if they cannot be loaded.
function whenConfigReady(onReady, onError) {
  if (!configPromise) {
    configPromise = apiRequest('GET', '/api/config').then(function (config) {
      HOURS = config.hours;
      SERVICES = config.services;
    });
  }
  configPromise.then(onReady, onError || function () {});
}

var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ---------- Chisinau time, whatever the visitor's time zone is ---------- */
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

// weekday (0-6) of a date written as "YYYY-MM-DD"
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

/* ---------- Talking to the server ---------- */
// Returns the answer as an object. If the server refuses the request,
// the thrown error has .status (for example 401) and .userMessage (the server's text).
function apiRequest(method, url, body) {
  var options = { method: method, headers: {} };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  return fetch(url, options).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      if (!response.ok) {
        var error = new Error('server');
        error.status = response.status;
        error.userMessage = data.error;
        throw error;
      }
      return data;
    });
  });
}
