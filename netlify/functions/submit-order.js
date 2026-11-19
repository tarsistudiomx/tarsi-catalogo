'use strict';

const {createHash} = require('node:crypto');
const {products, unitPrice, subtotal, isLine, maxQuantity, normalize} = require('../../shop');
const {endpoint, readBody, HttpError} = require('../lib/http');
const {postal} = require('../lib/postal');
const {useFlootPreview, flootPreview} = require('../lib/floot-preview');
const {verifyQuote} = require('../lib/quote-proof');

const invalid = message => new HttpError(400, 'INVALID_ORDER', message);
const field = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit + 1) : '';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function readOrder(body) {
  if (typeof body.key !== 'string' || !uuid.test(body.key) ||
      !Array.isArray(body.items) || !body.items.length || body.items.length > maxQuantity ||
      !body.items.every(isLine)) throw invalid('Revisa los productos, tallas y cantidades del carrito.');
  const lines = new Map();
  for (const {id, size, qty} of body.items) {
    const key = id + ':' + size;
    if (qty > maxQuantity) throw invalid('El pedido admite hasta 30 playeras.');
    const previous = lines.get(key)?.qty ?? 0;
    lines.set(key, {id, size, qty: previous + qty});
  }
  const items = [...lines.values()].sort((a, b) => a.id - b.id || a.size.localeCompare(b.size))
    .map(line => ({...line, name: products[line.id].name, unitPrice}));
  const quantity = items.reduce((sum, item) => sum + item.qty, 0);
  if (quantity > maxQuantity) throw invalid('El pedido admite hasta 30 playeras.');
  const name = field(body.customer?.name, 120);
  const phone = field(body.customer?.phone, 30).replace(/[\s().-]/g, '').replace(/^\+52/, '');
  const email = field(body.customer?.email, 254);
  const street = field(body.address?.street, 200);
  const postal_code = field(body.address?.postal_code, 5);
  const area_level3 = field(body.address?.area_level3, 120);
  const area_level1 = field(body.address?.area_level1, 120);
  const area_level2 = field(body.address?.area_level2, 120);
  const delivery = body.delivery;
  if (name.length < 2 || name.length > 120 || !/^\d{10}$/.test(phone) ||
      email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw invalid('Revisa tu nombre, teléfono y correo.');
  if (street.length < 2 || street.length > 200 || !/^\d{5}$/.test(postal_code) || !area_level3 || area_level3.length > 120 || area_level1.length > 120 || area_level2.length > 120) {
    throw invalid('Completa tu calle, número, código postal y colonia.');
  }
  if (!['Envío nacional', 'Entrega en Querétaro'].includes(delivery)) throw invalid('Selecciona una modalidad de entrega.');
  const merchandise = subtotal(quantity);
  return {
    customer: {name, phone, email}, address: {street, postal_code, area_level1, area_level2, area_level3}, delivery, items, quantity,
    subtotal: merchandise, discount: quantity * unitPrice - merchandise,
    promotions: {threePack: Math.floor(quantity / 3), twoPack: quantity % 3 === 2 ? 1 : 0}
  };
}

function createHandler({env = process.env, catalog = postal, fetcher = fetch} = {}) {
  return endpoint(['POST'], async event => {
    if ((event.body?.length ?? 0) > 16000) throw invalid('El pedido excede el tamaño permitido.');
    const body = readBody(event);
    if (useFlootPreview(event)) return flootPreview(body, body.recover === true ? 'recover' : 'checkout', fetcher);
    if (typeof body.key !== 'string' || !uuid.test(body.key)) throw invalid('No se pudo identificar el intento.');
    const order = body.recover === true ? null : readOrder(body);
    if (!env.TARSI_DASHBOARD_URL || !env.TARSI_DASHBOARD_TOKEN || !(env.TARSI_QUOTE_SECRET?.length >= 32)) {
      throw new HttpError(503, 'ORDER_UNAVAILABLE', 'El registro de pedidos está temporalmente indisponible. Tu carrito sigue guardado.');
    }
    const url = new URL(env.TARSI_DASHBOARD_URL);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid dashboard URL');
    const key = body.key.toLowerCase();
    const digest = createHash('sha256').update(JSON.stringify(order)).digest('hex');
    async function dashboard(payload) {
      const response = await fetcher(url, {
        method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + env.TARSI_DASHBOARD_TOKEN},
        body: JSON.stringify({key, digest, ...payload}), redirect: 'error', signal: AbortSignal.timeout(8000)
      });
      if (response.status === 409) throw new HttpError(409, 'ORDER_CONFLICT', 'Este intento ya corresponde a otro pedido.');
      if (!response.ok) throw new Error('Dashboard request failed');
      return response.json();
    }
    let {receipt} = await dashboard({action: order ? 'lookup' : 'recover'});
    if (!receipt && !order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Todavía no hay un pedido registrado para este intento.');
    if (!receipt) {
      const address = await catalog.validate(order.address);
      let quote = null;
      if (order.delivery === 'Envío nacional') {
        quote = verifyQuote(env.TARSI_QUOTE_SECRET, body.proof, address, order.quantity);
      } else if (normalize(address.area_level1) !== 'queretaro') {
        throw invalid('Selecciona envío nacional para entregas fuera de Querétaro.');
      }
      const shipping = quote?.price ?? 0;
      if (body.acceptedTotal !== undefined && body.acceptedTotal !== order.subtotal + shipping) {
        throw new HttpError(409, 'TOTAL_CHANGED', 'El total cambió. Revisa la cotización antes de continuar.');
      }
      ({receipt} = await dashboard({action: 'create', order: {
        ...order, address: {...address, street: order.address.street}, shipping, total: order.subtotal + shipping,
        carrier: quote?.carrier ?? null, service: quote?.service ?? null, skydropx: quote,
        origin: 'tienda web TARSI'
      }}));
    }
    if (typeof receipt?.number !== 'string' || typeof receipt.status !== 'string' ||
        !Array.isArray(receipt.items) || ![receipt.subtotal, receipt.shipping, receipt.total].every(Number.isSafeInteger)) {
      throw new Error('Invalid dashboard receipt');
    }
    let notification;
    if (body.notify === true) {
      try { ({notification} = await dashboard({action: 'notify'})); }
      catch { notification = 'retry'; }
    }
    const {TARSI_BANK_NAME: bank, TARSI_BANK_HOLDER: holder, TARSI_BANK_CLABE: clabe} = env;
    const transfer = bank?.trim() && holder?.trim() && /^\d{18}$/.test(clabe || '') ? {bank, holder, clabe} : null;
    return {data: {number: receipt.number, status: receipt.status, items: receipt.items.map(({name, size, qty}) => ({name, size, qty})),
      subtotal: receipt.subtotal, shipping: receipt.shipping, delivery: receipt.delivery, total: receipt.total, discount: receipt.discount, carrier: receipt.carrier, service: receipt.service, transfer, notification}};
  });
}
exports.handler = createHandler();
exports.createHandler = createHandler;

exports.config = {rateLimit: {windowLimit: 20, windowSize: 60, aggregateBy: ['ip']}};
