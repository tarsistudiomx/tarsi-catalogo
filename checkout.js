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

  function summary(order, quote, saved) {
    const quantity = order.items.reduce((sum, x) => sum + x.qty, 0);
    const subtotal = saved?.subtotal ?? pricing(quantity);
    const local = (saved?.delivery ?? order.delivery) === 'Entrega en Querétaro';
    const shipping = local ? 0 : saved?.shipping ?? quote?.customer_price;
    return [
      'PEDIDO TARSI', ...(saved ? ['NÚMERO: ' + saved.number] : []),
      ...order.items.map(x => (x.name || products[x.id].name) + ' | Talla ' + x.size + ' | ' + x.qty + ' pieza(s)'),
      'SUBTOTAL: ' + money(subtotal),
      'DESCUENTOS: ' + money(saved?.discount ?? quantity * unitPrice - subtotal),
      'ENVÍO: ' + (local ? 'Por cotizar el día de la entrega' : shipping === undefined ? 'Por confirmar' : money(shipping)),
      ...([quote?.carrier_name, quote?.carrier_service].some(Boolean) ?
        ['PAQUETERÍA: ' + [quote.carrier_name, quote.carrier_service].filter(Boolean).join(' · ')] : []),
      'TOTAL: ' + (shipping === undefined ? 'Por confirmar' : money(saved?.total ?? subtotal + shipping)),
      ...(order.delivery ? ['ENTREGA: ' + order.delivery] : []),
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

  let shareText = '';
  let recoveryKey = '';
  try { recoveryKey = JSON.parse(localStorage.getItem(draftKey))?.key || ''; } catch {}
  $('recoverOrder').hidden = !recoveryKey;
  function share(order, quote, saved) {
    if (!order.items.length) return toast('AGREGA AL MENOS UNA PLAYERA');
    shareText = summary(order, quote, saved);
    $('shareStatus').textContent = '';
    $('shareDialog').showModal();
  }
  $('copySummary').onclick = async () => {
    try { await copy(shareText); $('shareStatus').textContent = 'Resumen copiado.'; }
    catch { $('shareStatus').textContent = 'No se pudo copiar el resumen.'; }
  };

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
    if (preview) line('Modo de prueba. No realices una transferencia.', 'En el Dashboard, abre Pedidos y luego Ver pedidos de prueba.');
    for (const item of data.items) line(item.name, 'Talla ' + item.size + ' · ' + item.qty + ' pieza(s)');
    line('Subtotal', money(data.subtotal));
    const local = data.delivery === 'Entrega en Querétaro';
    line('Envío', local ? 'Por cotizar el día de la entrega. TARSI te escribirá cuando tus playeras estén listas.' : money(data.shipping));
    line(local ? 'Total a transferir por las playeras' : 'Total', money(data.total));
    const payable = Boolean(data.transfer) && ['Pendiente de pago','Pago por verificar'].includes(data.status);
    $('transferDetails').hidden = !payable;
    $('transferPending').hidden = Boolean(data.transfer) || data.status !== 'Pendiente de pago';

    $('bankDetails').replaceChildren();
    if (payable) {
      for (const [label, value] of Object.entries({
        Banco: data.transfer.bank, Titular: data.transfer.holder, CLABE: data.transfer.clabe,
        'Total exacto': money(data.total), Concepto: data.number
      })) {
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        term.textContent = label;
        detail.textContent = value;
        $('bankDetails').append(term, detail);
      }
    }
    if (!$('orderConfirmation').open) $('orderConfirmation').showModal();
    if (data.status !== 'Pendiente de pago') $('orderReceived').nextElementSibling.textContent = 'Consulta el estado actual de tu pedido.';
    $('notificationStatus').textContent = ({
      accepted: 'El proveedor de correo aceptó la notificación.',
      retry: 'El pedido está registrado. Vuelve a intentar el correo desde esta ventana.',
      review: 'El pedido está registrado. Contacta a TARSI para revisar la notificación.',
      unavailable: 'El pedido está registrado. El correo automático no está disponible en este momento.'
    })[data.notification] || '';
  }

  $('shareOrder').onclick = () => share(draft(), window.TarsiShipping.currentQuote());
  $('shareReceipt').onclick = () => share({items: receipt.items}, {carrier_name: receipt.carrier, carrier_service: receipt.service}, receipt);
  for (const [id, value] of [
    ['copyOrderNumber', () => receipt.number], ['copyClabe', () => receipt.transfer.clabe], ['copyConcept', () => receipt.number]
  ]) $(id).onclick = async () => {
    try { await copy(value()); $('notificationStatus').textContent = 'Copiado.'; }
    catch { $('notificationStatus').textContent = 'No se pudo copiar.'; }
  };

  async function getAttempt(order) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(order)));
    const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    let previous;
    try { previous = JSON.parse(localStorage.getItem(draftKey)); } catch {}
    if (previous?.fingerprint === fingerprint && typeof previous.key === 'string') return previous;
    return {fingerprint, key: crypto.randomUUID()};
  }

  let busy = false;
  async function submit(notify, recover = false) {
    if (busy) return;
    const order = recover ? null : draft();
    if (!recover && !order.items.length) return toast('AGREGA AL MENOS UNA PLAYERA');
    const quote = window.TarsiShipping.currentQuote();
    const fee = quote?.customer_price ?? (order?.delivery === 'Entrega en Querétaro' ? 0 : null);
    const form = document.querySelector('.cart-modal .checkout');
    busy = button.disabled = $('emailOrder').disabled = $('emailReceipt').disabled = form.inert = $('cartItems').inert = true;
    const feedback = $('orderConfirmation').open ? $('notificationStatus') : status;
    feedback.textContent = 'Procesando…';
    try {
      if (!recover) {
        if (fields.some(input => !input.checkValidity())) throw new Error('Revisa el formato de tu correo electrónico.');
        const loadAttempt = async () => {
          attempt = await getAttempt(order);
          localStorage.setItem(draftKey, JSON.stringify(attempt));
        };
        if (navigator.locks) await navigator.locks.request(draftKey, loadAttempt);
        else await loadAttempt();
        recoveryKey = attempt.key;
        $('recoverOrder').hidden = false;
      }
      const payload = recover ? {key: recoveryKey, recover: true, notify} : {
        ...order, key: recoveryKey, notify, proof: quote?.proof,
        acceptedTotal: fee === null ? undefined : pricing(count()) + fee
      };
      const response = await fetch(api + '/.netlify/functions/submit-order', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(28000)
      });
      if (preview && [401, 403].includes(response.status)) throw new Error('Inicia sesión en Netlify para usar esta vista previa.');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Intenta nuevamente.');
      if (!result.number || !Array.isArray(result.items)) throw new Error();
      receipt = result;
      if (!recover) { cart = []; save(); renderCart(); }
      feedback.textContent = '';
      showReceipt(receipt);
    } catch (error) {
      feedback.textContent = error instanceof TypeError || ['SyntaxError','TimeoutError','AbortError'].includes(error.name)
        ? 'No se pudo comprobar el registro. Reintenta con los mismos datos o usa Ver instrucciones de pago.' : error.message || 'No pudimos confirmar el registro.';
    } finally {
      busy = button.disabled = $('emailOrder').disabled = $('emailReceipt').disabled = form.inert = $('cartItems').inert = false;
    }
  }
  button.onclick = () => submit(false);
  $('emailOrder').onclick = () => submit(true);
  $('recoverOrder').onclick = () => submit(false, true);
  $('emailReceipt').onclick = () => submit(true, true);
})();
