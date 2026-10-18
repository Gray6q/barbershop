/* =========================================================
   Home page: the price list is built from the server's services
   ========================================================= */
function makeElement(tag, className, text) {
  var element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function priceItem(service) {
  var item = makeElement('div', 'price-list__item');

  var info = makeElement('div', 'price-list__info');
  var name = makeElement('h3', 'price-list__name', service.name);
  if (service.featured) {
    name.appendChild(document.createTextNode(' '));
    name.appendChild(makeElement('span', 'price-list__badge', 'Most popular'));
  }
  info.appendChild(name);
  info.appendChild(makeElement('p', 'price-list__description', service.description));

  var button = makeElement(
    'a',
    'btn ' + (service.featured ? 'btn--primary' : 'btn--outline') + ' btn--small price-list__button',
    'Book'
  );
  button.href = 'pages/booking.html?service=' + encodeURIComponent(service.name);

  item.appendChild(info);
  item.appendChild(makeElement('p', 'price-list__duration', service.duration + ' min'));
  item.appendChild(makeElement('p', 'price-list__price', service.price + ' MDL'));
  item.appendChild(button);
  return item;
}

function renderPriceList() {
  var list = document.getElementById('price-list');
  if (!list) return;

  list.innerHTML = '';
  SERVICES.forEach(function (service) {
    list.appendChild(priceItem(service));
  });
}

whenConfigReady(renderPriceList, function () {
  var list = document.getElementById('price-list');
  if (list) list.textContent = 'Prices are not available right now. Please call us.';
});
