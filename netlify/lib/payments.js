'use strict';

const Stripe = require('stripe');
const {getStore} = require('@netlify/blobs');
const {products, maxQuantity, subtotal, count, isLine} = require('../../shop');
const {HttpError} = require('./http');
const {digest, verifyQuote} = require('./quotes');
const {postal} = require('./postal');

const orderIdPattern = /^[a-f0-9]{64}$/;
const sessionIdPattern = /^cs_(test|live)_[A-Za-z0-9]{10,250}$/;

function paymentMode(env) {
  if (!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_') || !(env.TARSI_QUOTE_SECRET?.length >= 32)) return null;
  let url;
  try { url = new URL(env.TARSI_SITE_URL); } catch { return null; }
  if (url.href !== url.origin + '/' || url.username || url.password) return null;
  if (env.STRIPE_SECRET_KEY?.startsWith('sk_test_') &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) return 'test';
  if (env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && env.TARSI_ENABLE_LIVE_PAYMENTS === 'true' &&
    url.protocol === 'https:') return 'live';
  return null;
}

function validateItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > maxQuantity ||
    !items.every(isLine) || count(items) > maxQuantity) {
    throw new HttpError(400, 'INVALID_CART', 'El carrito debe tener entre 1 y 30 playeras con modelo y talla válidos.');
  }
  const merged = new Map();
  for (const {id, size, qty} of items) {
    const key = id + ':' + size;
    if (merged.has(key)) merged.get(key).qty += qty;
    else merged.set(key, {id, size, qty});
  }
  return [...merged.values()].sort((a, b) => a.id - b.id || a.size.localeCompare(b.size));
}

function validateContact(contact) {
  const {name, street, phone} = contact || {};
  const clean = (value, max) => typeof value === 'string' && value.trim().length >= 2 &&
    value.trim().length <= max && !/[\x00-\x1f\x7f]/.test(value);
  const number = typeof phone === 'string' ? phone.trim().replace(/[\s().-]/g, '').replace(/^\+52/, '') : '';
  if (!clean(name, 100) || !clean(street, 200) || !/^\d{10}$/.test(number)) {
    throw new HttpError(400, 'INVALID_CONTACT', 'Ingresa nombre, calle y número, y un teléfono mexicano de 10 dígitos.');
  }
  return {name: name.trim(), street: street.trim(), phone: '+52' + number};
}

function createPayments({
  env = process.env, catalog = postal,
  openStore = mode => getStore({name: 'tarsi-orders-' + mode, consistency: 'strong'}),
  openStripe = key => new Stripe(key, {timeout: 7000, maxNetworkRetries: 1})
} = {}) {
  const mode = paymentMode(env);
  const enabled = () => {
    if (!mode) throw new HttpError(503, 'PAYMENTS_DISABLED', 'Los pagos con tarjeta aún no están disponibles.');
    return {store: openStore(mode), stripe: openStripe(env.STRIPE_SECRET_KEY)};
  };

  async function checkout(body) {
    const {store, stripe} = enabled();
    const items = validateItems(body.items);
    const quantity = count(items);
    const contact = validateContact(body.contact);
    const destination = await catalog.validate(body.destination);
    const quote = verifyQuote(body.quote_token, destination, quantity, env.TARSI_QUOTE_SECRET);
    const id = digest([mode, quote.quotationId]);
    const cart = items.map(item => ({...item, name: products[item.id].name}));
    const order = {id, items: cart, quantity, contact, destination, subtotal: subtotal(quantity),
      shipping: quote.customerPrice, quotationId: quote.quotationId, rateId: quote.rateId, currency: 'mxn'};
    order.total = order.subtotal + order.shipping;

    // A quote can create one order and one Stripe session, including concurrent requests and retries.
    const key = 'pending/' + id;
    const paidKey = 'paid/' + id;
    const alreadyPaid = () => new HttpError(409, 'ORDER_ALREADY_PAID', 'Ese pedido ya está pagado.');
    if (await store.get(paidKey, {type: 'json'})) throw alreadyPaid();
    const saved = await store.setJSON(key, order, {onlyIfNew: true});
    if (!saved.modified && digest(await store.get(key, {type: 'json'})) !== digest(order)) {
      throw new HttpError(409, 'QUOTE_ALREADY_USED', 'La cotización está asociada a otro pedido. Cotiza nuevamente.');
    }
    if (await store.get(paidKey, {type: 'json'})) {
      await store.delete(key);
      throw alreadyPaid();
    }
    const site = new URL(env.TARSI_SITE_URL).origin;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      expires_at: Math.floor(quote.expires / 1000) + 31 * 60,
      payment_method_types: ['card'],
      success_url: site + '/?pago={CHECKOUT_SESSION_ID}',
      cancel_url: site + '/?pago=cancelado',
      client_reference_id: id,
      metadata: {order_id: id},
      line_items: [
        {quantity: 1, price_data: {currency: 'mxn', unit_amount: order.subtotal * 100,
          product_data: {name: 'Playeras TARSI (' + quantity + ')'}}},
        {quantity: 1, price_data: {currency: 'mxn', unit_amount: order.shipping * 100,
          product_data: {name: 'Envío TARSI'}}}
      ]
    }, {idempotencyKey: 'tarsi-checkout-' + id});
    if (session.status !== 'open' || !session.url) {
      throw new HttpError(409, 'CHECKOUT_CLOSED', 'La sesión de pago ya se cerró.');
    }
    return {url: session.url};
  }

  async function record(raw, signature) {
    const {store, stripe} = enabled();
    let event;
    try {
      event = stripe.webhooks.constructEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new HttpError(400, 'INVALID_SIGNATURE', 'Firma de Stripe inválida.');
    }
    if (event.type !== 'checkout.session.completed') return {received: true};
    const session = event.data.object;
    if (session.payment_status !== 'paid') return {received: true};
    const id = session.client_reference_id;
    if (event.livemode !== (mode === 'live') || session.livemode !== event.livemode ||
      session.mode !== 'payment' || session.status !== 'complete' ||
      !sessionIdPattern.test(session.id) || !orderIdPattern.test(id) || session.metadata?.order_id !== id) {
      throw new HttpError(400, 'INVALID_SESSION', 'La sesión no corresponde a TARSI.');
    }
    const paidKey = 'paid/' + id;
    const order = await store.get('pending/' + id, {type: 'json'});
    if (!order) {
      const existing = await store.get(paidKey, {type: 'json'});
      if (existing?.sessionId === session.id) return {received: true};
    }
    if (!order || session.currency !== order.currency || session.amount_total !== order.total * 100) {
      throw new HttpError(409, 'ORDER_MISMATCH', 'El pago no coincide con el pedido registrado.');
    }
    await store.setJSON(paidKey, {...order, sessionId: session.id,
      email: session.customer_details?.email ?? null, paymentIntent: session.payment_intent,
      paidAt: new Date(event.created * 1000).toISOString()}, {onlyIfNew: true});
    await store.delete('pending/' + id);
    return {received: true};
  }

  async function status(sessionId) {
    const {store, stripe} = enabled();
    if (typeof sessionId !== 'string' || !sessionIdPattern.test(sessionId)) {
      throw new HttpError(400, 'INVALID_SESSION', 'Referencia de pago inválida.');
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const id = session.client_reference_id;
    if (!orderIdPattern.test(id) || session.metadata?.order_id !== id || session.livemode !== (mode === 'live')) {
      throw new HttpError(404, 'ORDER_NOT_FOUND', 'No se encontró el pedido.');
    }
    const order = await store.get('paid/' + id, {type: 'json'});
    return order?.sessionId === sessionId
      ? {status: 'paid', reference: order.id.slice(0, 12).toUpperCase(), total: order.total}
      : {status: 'pending'};
  }

  return {mode, checkout, record, status};
}

module.exports = {createPayments, paymentMode, validateItems};
