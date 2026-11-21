'use strict';

(() => {
  const status = $('orderStatus');
  const button = $('submitOrder');
  const api = location.hostname === 'tarsistudiomx.github.io' ? 'https://tarsi-skydropx.netlify.app' : '';
  const preview = /^deploy-preview-\d+--tarsi-skydropx\.netlify\.app$/.test(location.hostname);
  const draftKey = 'tarsi-checkout-attempt';
  const savedOrderKey = 'tarsi-saved-order';
  const savedOrderPrefix = savedOrderKey + ':';
  const validKey = key => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
  const fields = [...document.querySelectorAll('.cart-modal .checkout input, .cart-modal .checkout select')];
  let receipt;
  let timer;
  const labels={'Pendiente de pago':'SIN REPORTE DE PAGO','Pago por verificar':'PAGO REPORTADO · POR VERIFICAR',
    Pagado:'PAGO VERIFICADO','En preparación':'PAGO VERIFICADO · EN PREPARACIÓN',Enviado:'PAGO VERIFICADO · ENVIADO',Entregado:'PAGO VERIFICADO · ENTREGADO'};
  const linkedKey = new URLSearchParams(location.hash.slice(1)).get('pedido');
  const fromLink = validKey(linkedKey);

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
    const shipping = local ? 0 : saved?.shipping ?? window.TarsiShipping.charge(quote) ?? undefined;
    return [
      'PEDIDO TARSI', ...(saved ? ['NÚMERO: ' + saved.number] : []),
      ...order.items.map(x => (x.name || products[x.id].name) + ' | Talla ' + x.size + ' | ' + x.qty + ' pieza(s)'),
      'SUBTOTAL: ' + money(subtotal),
      'DESCUENTOS: ' + money(saved?.discount ?? quantity * unitPrice - subtotal),
      'ENVÍO: ' + (local ? 'Por cotizar el día de la entrega' : shipping === undefined ? 'Por confirmar' : shipping === 0 ? 'Gratis' : money(shipping)),
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
  const savedOrders = new Map();
  function draftRecoveryKey() {
    try {
      const key = JSON.parse(localStorage.getItem(draftKey))?.key;
      return validKey(key) ? key : '';
    } catch { return ''; }
  }

  function rememberOrder(key, number, tabOnly) {
    if (savedOrders.get(key)?.number === number) return;
    const order = {number, savedAt: Date.now(), tabOnly};
    savedOrders.set(key, order);
    try { (tabOnly ? sessionStorage : localStorage).setItem(savedOrderPrefix + key, JSON.stringify(order)); } catch {}
  }

  function recoverableOrders() {
    const orders = new Map(savedOrders);
    for (const tabOnly of [true, false]) {
      try {
        const storage = tabOnly ? sessionStorage : localStorage;
        for (let index = 0; index < storage.length; index++) {
          const entry = storage.key(index);
          if (!entry?.startsWith(savedOrderPrefix)) continue;
          const key = entry.slice(savedOrderPrefix.length);
          if (!validKey(key)) continue;
          try {
            const order = JSON.parse(storage.getItem(entry));
            if (typeof order?.number === 'string') orders.set(key, {...order, tabOnly});
          } catch {}
        }
      } catch {}
    }
    try {
      const legacy = localStorage.getItem(savedOrderKey);
      if (validKey(legacy) && !orders.has(legacy)) orders.set(legacy, {number: 'Pedido guardado', tabOnly: false});
    } catch {}
    const draftKey = draftRecoveryKey();
    if (draftKey && !orders.has(draftKey)) orders.set(draftKey, {number: 'Registro por comprobar', tabOnly: false});
    return [...orders].sort(([, a], [, b]) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  function showRecoveryControls() {
    const total = recoverableOrders().length;
    $('recoverOrder').hidden = !total;
    $('resumePurchase').hidden = !total;
    $('resumePurchaseButton').textContent = total > 1 ? 'VER MIS PEDIDOS' : 'CONTINUAR MI PEDIDO';
  }
  window.addEventListener('storage', showRecoveryControls);
  showRecoveryControls();
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

  function showReceipt(data, recovered = false) {
    $('transferReport').reset();
    $('transferReportStatus').textContent = '';
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
    line('Estado', data.isFlow ? labels[data.status] || data.status : data.status);
    $('previewPaymentNotice').hidden = !preview;
    $('receiptSummary').open = !data.isFlow;
    for (const item of data.items) line(item.name, 'Talla ' + item.size + ' · ' + item.qty + ' pieza(s)');
    line('Subtotal', money(data.subtotal));
    const local = data.delivery === 'Entrega en Querétaro';
    line('Envío', local ? 'Por cotizar el día de la entrega. TARSI te escribirá cuando tus playeras estén listas.' : data.delivery === 'Envío nacional' && data.shipping === 0 ? 'Gratis' : money(data.shipping));
    line(local ? 'Total a transferir por las playeras' : 'Total', money(data.total));
    const payable = Boolean(data.transfer) && ['Pendiente de pago','Pago por verificar'].includes(data.status);
    $('transferDetails').hidden = !payable;
    $('transferPending').hidden = Boolean(data.transfer) || data.status !== 'Pendiente de pago' || data.inventoryActive;

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
    $('transferReport').hidden = true;
    const needsProof = data.isFlow && data.reported && ['Pago por verificar','Cancelado'].includes(data.status);
    $('proofOptions').hidden = !needsProof;
    $('proofEmailDetails').hidden = true;
    $('proofEmail').setAttribute('aria-expanded','false');
    $('proofCopyStatus').textContent = '';
    $('proofNumber').textContent = data.number;
    $('proofSubject').textContent = 'Comprobante de pago · ' + data.number;
    $('legacyReceiptActions').hidden = Boolean(data.isFlow);
    $('savePaymentLink').hidden = !data.isFlow || !recoveryKey ||
      !['Pendiente de pago','Pago por verificar','Cancelado'].includes(data.status);
    $('savePaymentLinkHint').textContent = recoverableOrders().some(([key, order]) => key === recoveryKey && !order.tabOnly)
      ? 'Puedes volver a este pedido desde la tienda o guardar su enlace privado.'
      : 'Para volver a este pedido, guarda su enlace privado o abre el de tu correo.';
    $('paymentLinkStatus').textContent = '';
    $('manualPaymentLink').hidden = true;
    $('manualPaymentLink').value = '';
    $('openReport').hidden = !data.isFlow || data.reported || !['Pendiente de pago','Pago por verificar','Cancelado'].includes(data.status);
    clearInterval(timer);
    const refreshHold = () => {
      const remaining = data.holdUntil ? Math.max(0,Date.parse(data.holdUntil)-Date.now()) : 0;
      const show = data.isFlow && data.inventoryActive && data.status === 'Pendiente de pago';
      $('holdStatus').hidden = !show;
      $('renewReservation').hidden = !show || remaining > 0;
      if(show){
        $('holdStatus').textContent = remaining > 0
          ? 'Reserva disponible por '+Math.ceil(remaining/60000)+' min.'
          : 'Tu selección se guardó, pero ya no está reservada. Renueva antes de transferir.';
        if(!remaining) $('transferDetails').hidden = true;
      }
    };
    refreshHold();
    if (data.holdUntil) timer=setInterval(refreshHold,1000);
    if (!$('orderConfirmation').open) $('orderConfirmation').showModal();
    $('orderReceived').textContent = needsProof ? 'TRANSFERENCIA REPORTADA'
      : recovered ? 'TU PEDIDO SIGUE AQUÍ' : '¡TU PEDIDO FUE RECIBIDO!';
    $('orderIntro').textContent = needsProof
      ? 'Falta el comprobante. TARSI verificará el depósito antes de confirmar tu pedido.'
      : data.status === 'Pendiente de pago' ? 'Pedido ' + data.number + ' · ' + money(data.total) + '. Transfiere y después envía tu comprobante.'
        : 'Pedido ' + data.number + ' · ' + (labels[data.status] || data.status) + '.';
    $('orderConfirmation').scrollTop = 0;
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
    ['copyOrderNumber', () => receipt.number], ['copyClabe', () => receipt.transfer.clabe], ['copyConcept', () => receipt.number], ['copyAmount', () => receipt.total.toFixed(2)]
  ]) $(id).onclick = async () => {
    try { await copy(value()); $('notificationStatus').textContent = 'Copiado.'; }
    catch { $('notificationStatus').textContent = 'No se pudo copiar.'; }
  };

  const proofAddress = 'tarsi.studiomx@gmail.com';
  function copyProof(value, success) {
    return copy(value).then(() => { $('proofCopyStatus').textContent = success; },
      () => { $('proofCopyStatus').textContent = 'Selecciona el texto para copiarlo manualmente.'; });
  }
  $('proofEmail').onclick = () => {
    $('proofEmailDetails').hidden = false;
    $('proofEmail').setAttribute('aria-expanded','true');
    void copyProof(proofAddress,'Correo copiado. Adjunta tu comprobante y usa el asunto indicado.');
  };
  $('copyProofAddress').onclick = () => void copyProof(proofAddress,'Correo copiado.');
  $('copyProofSubject').onclick = () => void copyProof($('proofSubject').textContent,'Asunto copiado.');

  $('copyPaymentLink').onclick = async () => {
    if (!recoveryKey) return;
    const link = new URL(location.pathname,location.origin);
    link.hash = new URLSearchParams({pedido:recoveryKey}).toString();
    try {
      await copy(link.href);
      $('paymentLinkStatus').textContent = 'Enlace copiado. Guárdalo en un lugar privado.';
    } catch {
      const input = $('manualPaymentLink');
      input.value = link.href;
      input.hidden = false;
      input.select();
      $('paymentLinkStatus').textContent = 'Copia el enlace y guárdalo en un lugar privado.';
    }
  };

  async function getAttempt(order) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(order)));
    const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    let previous;
    try { previous = JSON.parse(localStorage.getItem(draftKey)); } catch {}
    if (previous?.fingerprint === fingerprint && typeof previous.key === 'string') return previous;
    return {fingerprint, key: crypto.randomUUID()};
  }

  function requestOrder(payload) {
    return fetch(api+'/.netlify/functions/submit-order',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(28000)
    }).then(async response=>{
      if (preview && [401,403].includes(response.status)) throw new Error('Inicia sesión en Netlify para usar esta vista previa.');
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Intenta nuevamente.');
      return result;
    });
  }
  $('openReport').onclick=()=>{
    $('openReport').hidden=true;
    $('transferReport').hidden=false;
    $('transferReport').elements.bank.focus();
  };
  async function updateReceipt(payload) {
    if(busy)return;
    busy=true;
    const control=payload.mode==='renew' ? $('renewReservation') : $('transferReport').querySelector('button[type="submit"]');
    control.disabled=true;
    const feedback = $(payload.mode==='report' ? 'transferReportStatus' : 'notificationStatus');
    feedback.textContent='Procesando…';
    try{
      const result=await requestOrder({key:recoveryKey,...payload});
      receipt=result.reported===true && !result.number ? await requestOrder({key:recoveryKey,recover:true}) : result;
      showReceipt(receipt);
      if(payload.mode==='report') $('proofTitle').focus({preventScroll:true});
    }catch(error){feedback.textContent=error.message||'No pudimos guardar el cambio.';}
    finally{busy=false;control.disabled=false;}
  }
  $('renewReservation').onclick=()=>void updateReceipt({mode:'renew'});
  $('transferReport').onsubmit=e=>{
    e.preventDefault();
    const values=new FormData(e.currentTarget);
    const reference=String(values.get('reference')||'').trim();
    const details=String(values.get('details')||'').trim();
    const amount=String(values.get('amount')||'').trim().replace(',','.');
    if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount)||Number(amount)<=0){
      $('transferReportStatus').textContent='Ingresa un importe válido en pesos.';return;
    }
    if(reference.length<5 && details.length<10){
      $('transferReportStatus').textContent='Escribe la clave de rastreo o el concepto que usaste en la transferencia.';return;
    }
    void updateReceipt({mode:'report',bank:values.get('bank'),reference,
      date:values.get('date'),details,cents:Math.round(Number(amount)*100)});
  };

  let busy = false;
  async function submit(notify, orderKey = '', recoveryFeedback, fromEmail = false) {
    if (busy) return;
    const recover = Boolean(orderKey);
    const order = recover ? null : draft();
    if (!recover && !order.items.length) return toast('AGREGA AL MENOS UNA PLAYERA');
    const quote = window.TarsiShipping.currentQuote();
    const fee = order?.delivery === 'Entrega en Querétaro' ? 0 : window.TarsiShipping.charge(quote);
    const form = document.querySelector('.cart-modal .checkout');
    busy = button.disabled = $('emailOrder').disabled = $('emailReceipt').disabled = form.inert = $('cartItems').inert = true;
    const feedback = recoveryFeedback || ($('orderConfirmation').open ? $('notificationStatus') : status);
    feedback.textContent = 'Procesando…';
    try {
      if (!recover) {
        if (fields.some(input => !input.checkValidity())) throw new Error('Revisa el formato de tu correo electrónico.');
        const loadAttempt = async () => {
          const attempt = await getAttempt(order);
          localStorage.setItem(draftKey, JSON.stringify(attempt));
          return attempt.key;
        };
        orderKey = navigator.locks ? await navigator.locks.request(draftKey, loadAttempt) : await loadAttempt();
        showRecoveryControls();
      }
      const payload = recover ? {key: orderKey, recover: true, notify} : {
        ...order, key: orderKey, notify, proof: quote?.proof,
        acceptedTotal: fee === null ? undefined : pricing(count()) + fee
      };
      const result = await requestOrder(payload);
      if (!result.number || !Array.isArray(result.items)) throw new Error();
      receipt = result;
      recoveryKey = orderKey;
      if (fromEmail) history.replaceState(null,'',location.pathname+location.search);
      const saved = recoverableOrders().find(([key]) => key === orderKey)?.[1];
      rememberOrder(orderKey, result.number, saved?.tabOnly ?? fromEmail);
      showRecoveryControls();
      if (!recover) { cart = []; save(); renderCart(); }
      feedback.textContent = '';
      if ($('savedOrdersDialog').open) $('savedOrdersDialog').close();
      showReceipt(receipt, recover);
    } catch (error) {
      feedback.textContent = error instanceof TypeError || ['SyntaxError','TimeoutError','AbortError'].includes(error.name)
        ? 'No se pudo comprobar el registro. Reintenta con los mismos datos o usa Ver instrucciones de pago.' : error.message || 'No pudimos confirmar el registro.';
    } finally {
      busy = button.disabled = $('emailOrder').disabled = $('emailReceipt').disabled = form.inert = $('cartItems').inert = false;
    }
  }
  button.onclick = () => submit(false);
  $('emailOrder').onclick = () => submit(true);
  function openSavedOrders(feedback) {
    if (busy) return;
    const orders = recoverableOrders();
    if (orders.length === 1) return submit(false, orders[0][0], feedback);
    if (!orders.length) return;
    $('savedOrdersStatus').textContent = '';
    const list = $('savedOrdersList');
    list.replaceChildren();
    for (const [key, order] of orders) {
      const row = document.createElement('li');
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = order.number;
      open.onclick = () => submit(false, key, $('savedOrdersStatus'));
      row.append(open);
      list.append(row);
    }
    $('savedOrdersDialog').showModal();
  }
  $('recoverOrder').onclick = () => openSavedOrders(status);
  $('resumePurchaseButton').onclick = () => openSavedOrders($('resumePurchaseStatus'));
  $('emailReceipt').onclick = () => submit(true, recoveryKey);
  if (fromLink) {
    $('navCart').click();
    void submit(false, linkedKey, undefined, true);
  }
})();
