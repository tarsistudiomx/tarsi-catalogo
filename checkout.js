'use strict';

(() => {
  const status = $('orderStatus');
  const button = $('submitOrder');
  const api = location.hostname === 'tarsistudiomx.github.io' ? 'https://tarsi-skydropx.netlify.app' : '';
  const preview = /^deploy-preview-\d+--tarsi-skydropx\.netlify\.app$/.test(location.hostname);
  const draftKey = 'tarsi-checkout-attempt';
  const fields = [...document.querySelectorAll('.cart-modal .checkout input, .cart-modal .checkout select')];
  let attempt;
  let receipt;
  let confirmedDraft;

  function draft() {
    const value = id => $(id).value.trim();
    return {
      items: cart.map(({id, size, qty}) => ({id, size, qty})),
      customer: {name: value('buyer'), phone: value('phone'), email: value('buyerEmail')},
      address: {street: value('street'), postal_code: value('zipCode'), area_level1: value('state'),
        area_level2: value('city'), area_level3: value('neighborhood')},
      delivery: value('delivery')
    };
  }

  function summary(order, quote, includeContact, saved) {
    const quantity = order.items.reduce((sum, x) => sum + x.qty, 0);
    const subtotal = saved?.subtotal ?? pricing(quantity);
    const shipping = saved?.shipping ?? quote?.customer_price;
    return [
      'PEDIDO TARSI', ...(saved ? ['NÚMERO: ' + saved.number] : []),
      ...order.items.map(x => (x.name || products[x.id].name) + ' | Talla ' + x.size + ' | ' + x.qty + ' pieza(s)'),
      'SUBTOTAL: ' + money(subtotal),
      'ENVÍO: ' + (shipping === undefined ? 'Por confirmar' : money(shipping)),
      ...([quote?.carrier_name, quote?.carrier_service].some(Boolean) ?
        ['PAQUETERÍA: ' + [quote.carrier_name, quote.carrier_service].filter(Boolean).join(' · ')] : []),
      'TOTAL: ' + (shipping === undefined ? 'Por confirmar' : money(saved?.total ?? subtotal + shipping)),
      'ENTREGA: ' + order.delivery,
      ...(includeContact ? [
        'NOMBRE: ' + order.customer.name, 'TELÉFONO: ' + order.customer.phone,
        ...(order.customer.email ? ['CORREO: ' + order.customer.email] : []),
        'DIRECCIÓN: ' + [order.address.street, order.address.area_level3, order.city, order.state, order.address.postal_code].filter(Boolean).join(', ')
      ] : [])
    ].join('\n');
  }

  async function copy(value) {
    try {
      if (!navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement('textarea');
      input.value = value;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      try { if (!document.execCommand('copy')) throw new Error(); }
      finally { input.remove(); }
    }
  }

  async function share(order, quote, saved) {
    if (!order.items.length) return toast('AGREGA AL MENOS UNA PLAYERA');
    const text = summary(order, quote, false, saved);
    try {
      const data = {title: 'Pedido TARSI', text};
      if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
        try { await navigator.share(data); return; }
        catch (error) { if (error.name === 'AbortError') return; }
      }
      await copy(text);
      toast('PEDIDO COPIADO PARA COMPARTIR');
    } catch { toast('NO SE PUDO COMPARTIR EL PEDIDO'); }
  }

  function prepareEmail(event, order, quote, saved) {
    if (!order.items.length) {
      event.preventDefault();
      return toast('AGREGA AL MENOS UNA PLAYERA');
    }
    const params = new URLSearchParams({
      view: 'cm', fs: '1', to: 'arista.studiot@gmail.com', su: 'Nuevo pedido TARSI',
      body: summary(order, quote, true, saved)
    });
    event.currentTarget.href = 'https://mail.google.com/mail/?' + params;
  }

  function withLocation(order) {
    return {...order, city: $('city').value, state: $('state').value};
  }

  function showReceipt(data) {
    const box = $('orderReceipt');
    box.replaceChildren();
    function line(label, value) {
      const row = document.createElement('p');
      const title = document.createElement('strong');
      title.textContent = label + ' ';
      row.append(title, value);
      box.append(row);
    }
    line('Pedido', data.number);
    line('Estado', data.status);
    if (preview) line('Modo de prueba.', 'En el Dashboard, abre Pedidos y luego Ver pedidos de prueba.');
    for (const item of data.items) line(item.name, 'Talla ' + item.size + ' · ' + item.qty + ' pieza(s)');
    line('Subtotal', money(data.subtotal));
    line('Envío', money(data.shipping));
    line('Total', money(data.total));
    $('transferDetails').hidden = !data.transfer;
    $('transferPending').hidden = Boolean(data.transfer);
    $('proofInstagram').textContent = data.transfer ? 'ENVIAR COMPROBANTE POR INSTAGRAM' : 'CONTACTAR A TARSI EN INSTAGRAM';
    $('bankDetails').replaceChildren();
    if (data.transfer) {
      for (const [label, value] of Object.entries({
        Banco: data.transfer.bank, Titular: data.transfer.holder, CLABE: data.transfer.clabe,
        'Total exacto': money(data.total), 'Número de pedido': data.number
      })) {
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        term.textContent = label;
        detail.textContent = value;
        $('bankDetails').append(term, detail);
      }
    }
    $('orderConfirmation').hidden = false;
    $('orderReceived').focus();
  }

  function showCheckout() {
    const confirmed = !count() && Boolean(receipt);
    for (const selector of ['.cart-modal > .checkout', '#shippingPanel', '#shippingQuote', '#orderActions', '#cartItems', '#totals']) {
      const element = document.querySelector(selector);
      element.style.display = confirmed ? 'none' : '';
    }
    $('orderConfirmation').hidden = !confirmed;
  }

  document.addEventListener('tarsi-render-totals', showCheckout);
  $('shareOrder').onclick = () => share(draft(), window.TarsiShipping.currentQuote());
  $('emailOrder').onclick = event => prepareEmail(event, withLocation(draft()), window.TarsiShipping.currentQuote());
  $('shareReceipt').onclick = () => share(confirmedDraft.order, confirmedDraft.quote, receipt);
  $('emailReceipt').onclick = event => prepareEmail(event, confirmedDraft.order, confirmedDraft.quote, receipt);
  $('copyOrderNumber').onclick = async () => {
    try { await copy(receipt.number); toast('NÚMERO DE PEDIDO COPIADO'); }
    catch { toast('NO SE PUDO COPIAR EL NÚMERO'); }
  };

  async function getAttempt(order) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(order)));
    const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    let previous = attempt;
    try { previous ||= JSON.parse(localStorage.getItem(draftKey)); } catch {}
    if (previous?.fingerprint === fingerprint && typeof previous.key === 'string') return previous;
    return {fingerprint, key: crypto.randomUUID()};
  }

  button.onclick = async () => {
    if (button.disabled) return;
    const order = draft();
    status.textContent = '';
    if (!order.items.length) return toast('AGREGA AL MENOS UNA PLAYERA');
    const quote = window.TarsiShipping.currentQuote();
    const snapshot = withLocation(order);
    const form = document.querySelector('.cart-modal .checkout');
    const cartItems = $('cartItems');
    button.disabled = form.inert = cartItems.inert = true;
    button.textContent = 'REGISTRANDO PEDIDO…';
    try {
      if (fields.some(input => !input.checkValidity())) throw new Error('Revisa el formato de tu correo electrónico.');
      attempt = await getAttempt(order);
      try { localStorage.setItem(draftKey, JSON.stringify(attempt)); } catch {}
      const response = await fetch(api + '/.netlify/functions/submit-order', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...order, key: attempt.key, proof: quote?.proof}),
        signal: AbortSignal.timeout(21000)
      });
      if (preview && [401, 403].includes(response.status)) {
        throw new Error('La vista previa requiere una sesión de Netlify. Inicia sesión y vuelve a intentar.');
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Intenta nuevamente.');
      if (!result.number || !Array.isArray(result.items)) throw new Error();
      receipt = result;
      confirmedDraft = {order: snapshot, quote};
      cart = [];
      save();
      renderCart();
      showCheckout();
      showReceipt(receipt);
      try { localStorage.removeItem(draftKey); } catch {}
      attempt = undefined;
    } catch (error) {
      status.textContent = error instanceof TypeError || ['SyntaxError', 'TimeoutError', 'AbortError'].includes(error.name)
        ? 'No pudimos confirmar el registro. Reintenta con el mismo pedido.' : error.message || 'No pudimos confirmar el registro. Reintenta.';
    } finally {
      button.disabled = form.inert = cartItems.inert = false;
      button.textContent = 'ENVIAR PEDIDO';
    }
  };
})();
