'use strict';

(() => {
  const api = location.hostname === 'tarsistudiomx.github.io' ? 'https://tarsi-skydropx.netlify.app' : '';
  const zip = $('zipCode');
  const colony = $('neighborhood');
  const state = $('state');
  const city = $('city');
  const postalStatus = $('postalStatus');
  const shippingStatus = $('shippingStatus');
  const national = () => $('delivery').value === 'Envío nacional';
  let postalRecord;
  let addressLookup;
  let shippingLookup;
  let quote;
  let expiry;
  const local = () => $('delivery').value === 'Entrega en Querétaro';

  async function request(route, data, signal) {
    const response = await fetch(api + '/.netlify/functions/' + route, {
      ...(data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)}),
      signal
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('El servicio no está disponible temporalmente.'); }
    if (!response.ok) throw new Error(result.error || 'El servicio no está disponible temporalmente.');
    return result;
  }

  function currentQuote() {
    return national() && quote && Date.parse(quote.expires_at) > Date.now() ? quote : null;
  }

  function renderTotals() {
    const pieces = count();
    const items = pricing(pieces);
    const shipping = currentQuote();
    const fee = shipping?.customer_price ?? (local() ? 0 : null);
    $('totals').innerHTML = `
      <div class="totalrow"><span>${pieces} piezas · precio individual</span><b>${money(pieces * unitPrice)}</b></div>
      <div class="totalrow"><span>Descuento por promociones</span><b>− ${money(pieces * unitPrice - items)}</b></div>
      <div class="totalrow"><span>Subtotal de prendas</span><b>${money(items)}</b></div>
      <div class="totalrow"><span>Envío</span><b>${local() ? 'Por cotizar el día de la entrega' : fee !== null ? money(fee) : national() ? 'Por cotizar' : 'Por confirmar'}</b></div>
      <div class="totalrow final"><span>${local() ? 'TOTAL A TRANSFERIR' : 'TOTAL'}</span><span>${fee !== null ? money(items + fee) : pieces ? 'Por confirmar' : money(0)}</span></div>`;
    $('quoteShipping').disabled = !national() || !pieces || pieces > maxQuantity || Boolean(shippingLookup);
  }

  function invalidate(message = 'Cotiza el envío para actualizar el total.') {
    shippingLookup?.abort();
    shippingLookup = undefined;
    quote = undefined;
    clearTimeout(expiry);
    shippingStatus.textContent = national() ? message : 'Selecciona «Envío nacional» para cotizar.';
    if (national() && count() > maxQuantity) shippingStatus.textContent = 'Reduce el carrito a un máximo de 30 playeras para cotizar.';
    renderTotals();
  }

  function showLocation() {
    const rows = postalRecord?.colonies ?? [];
    const name = TarsiShop.findColony(colony.value, [...new Set(rows.map(row => row.name))]);
    const matches = rows.filter(row => row.name === name);
    const selected = matches.length === 1 ? matches[0] : null;
    for (const [field, key] of [[state, 'state'], [city, 'city']]) {
      const candidates = [...new Set(rows.map(row => row[key]))];
      field.value = selected?.[key] ?? (candidates.length === 1 ? candidates[0] : '');
    }
    return selected;
  }

  function destination() {
    const selected = showLocation();
    if (!selected || postalRecord.postal_code !== zip.value) return null;
    return {postal_code: zip.value, area_level1: selected.state, area_level2: selected.city, area_level3: selected.name};
  }

  async function loadPostal() {
    addressLookup?.abort();
    postalRecord = undefined;
    colony.value = '';
    colony.disabled = true;
    city.value = state.value = '';
    $('postalColonies').replaceChildren();
    invalidate();
    if (!/^\d{5}$/.test(zip.value)) {
      postalStatus.textContent = zip.value ? 'Ingresa un código postal de cinco dígitos.' : '';
      return;
    }

    const requestedZip = zip.value;
    const controller = new AbortController();
    addressLookup = controller;
    postalStatus.textContent = 'Consultando el catálogo postal…';
    try {
      const result = await request('postal-code?zip=' + requestedZip, undefined, controller.signal);
      if (addressLookup !== controller || zip.value !== requestedZip || result.postal_code !== requestedZip) return;
      postalRecord = result;
      const names = [...new Set(result.colonies.map(row => row.name))];
      $('postalColonies').replaceChildren(...names.map(name => new Option(name, name)));
      colony.disabled = false;
      colony.placeholder = 'Selecciona o escribe tu colonia';
      if (names.length === 1) colony.value = names[0];
      showLocation();
      postalStatus.textContent = names.length === 1 ? 'Código postal encontrado.' : 'Elige una colonia de la lista.';
    } catch (error) {
      if (error.name !== 'AbortError' && addressLookup === controller) postalStatus.textContent = error.message;
    } finally {
      if (addressLookup === controller) addressLookup = undefined;
    }
  }

  zip.addEventListener('input', loadPostal);
  zip.addEventListener('change', () => {
    if (postalRecord?.postal_code !== zip.value && !addressLookup) loadPostal();
  });
  colony.addEventListener('input', () => {
    showLocation();
    invalidate();
  });
  colony.addEventListener('change', () => {
    const selected = showLocation();
    if (selected) colony.value = selected.name;
    postalStatus.textContent = selected ? 'Colonia validada.' : 'Selecciona una colonia registrada para este código postal.';
  });
  for (const id of ['street', 'delivery']) $(id).addEventListener('input', () => invalidate());
  document.addEventListener('tarsi-cart-update', () => invalidate());
  document.addEventListener('tarsi-render-totals', renderTotals);

  $('quoteShipping').onclick = async () => {
    const address = destination();
    if (!address) {
      shippingStatus.textContent = 'Ingresa tu código postal y selecciona una colonia del catálogo.';
      (colony.disabled ? zip : colony).focus();
      return;
    }
    invalidate('Buscando el mejor envío disponible…');
    const controller = new AbortController();
    shippingLookup = controller;
    renderTotals();
    try {
      const result = await request('shipping-quote', {destination: address, quantity: count()}, controller.signal);
      if (shippingLookup !== controller) return;
      if (!Number.isFinite(result.customer_price) || result.customer_price <= 0 ||
        !(Date.parse(result.expires_at) > Date.now())) throw new Error('La cotización recibida es inválida.');
      quote = result;
      expiry = setTimeout(() => invalidate('La cotización venció. Consulta el costo nuevamente.'),
        Date.parse(result.expires_at) - Date.now());
      const carrier = [quote.carrier_name, quote.carrier_service].filter(Boolean).join(' ');
      shippingStatus.textContent = [
        'Envío TARSI: ' + money(quote.customer_price),
        carrier,
        quote.estimated_days && 'Tránsito estimado: ' + quote.estimated_days + ' días hábiles'
      ].filter(Boolean).join(' · ') + '.';
    } catch (error) {
      if (error.name !== 'AbortError' && shippingLookup === controller) shippingStatus.textContent = error.message;
    } finally {
      if (shippingLookup === controller) shippingLookup = undefined;
      renderTotals();
    }
  };

  function readyForShipping() {
    if (count() > maxQuantity) {
      shippingStatus.textContent = 'Reduce el carrito a un máximo de 30 playeras para continuar.';
      return false;
    }
    if (!destination() || !currentQuote()) {
      shippingStatus.textContent = 'Valida tu colonia y cotiza el envío para continuar.';
      return false;
    }
    const missing = ['buyer', 'street', 'phone'].find(id => {
      const value = $(id).value.trim();
      return id === 'phone' ? !/^(?:\+52)?\d{10}$/.test(value.replace(/[\s().-]/g, '')) : value.length < 2;
    });
    if (missing) {
      shippingStatus.textContent = 'Completa tu nombre, calle y número, y teléfono de 10 dígitos.';
      $(missing).focus();
      return false;
    }
    return true;
  }

  window.TarsiShipping = {currentQuote, readyForShipping};
})();
