'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');
const {createSkydropx} = require('../netlify/lib/skydropx');
const {createPayments} = require('../netlify/lib/payments');
const shipping = require('../netlify/functions/shipping-quote');
const checkout = require('../netlify/functions/checkout');
const webhook = require('../netlify/functions/stripe-webhook');
const orderStatus = require('../netlify/functions/order-status');
const postal = require('../netlify/functions/postal-code');
const {env, destination, rate, mockCatalog, memoryStore, event, unpack} = require('./fixtures');

const dummyResponse = (data, status = 200) => new Response(JSON.stringify(data), {status});
function skydropx(polls, onFetch = () => {}) {
  const fetcher = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://sb-pro.skydropx.com');
    onFetch(url, options);
    if (url.endsWith('/oauth/token')) return dummyResponse({access_token: 'fake-oauth', expires_in: 3600});
    assert.equal(options.headers.Authorization, 'Bearer fake-oauth');
    if (url.endsWith('/quotations')) return dummyResponse({id: 'q-1', is_completed: false});
    return polls.shift() ?? dummyResponse({is_completed: false});
  };
  return createSkydropx({env, fetcher, delay: async () => {}});
}

test('POST /shipping-quote espera disponibilidad, valida origen/destino y elige la más económica', async () => {
  const polls = [dummyResponse({is_completed: false, rates: [rate]}), dummyResponse({}, 429),
    dummyResponse({is_completed: true, rates: [{...rate, id: 'r-2', total: 129}, rate]})];
  const sky = skydropx(polls, (url, options) => {
    if (url.endsWith('/oauth/token')) assert.equal(options.body.get('grant_type'), 'client_credentials');
    if (url.endsWith('/quotations')) {
      const {quotation} = JSON.parse(options.body);
      assert.equal(quotation.address_from.area_level3, 'Plazas del Sol 2a Sección');
      assert.equal(quotation.address_to.area_level3, 'San Ángel');
      assert.equal(quotation.parcels[0].weight, 1.4);
    }
  });
  const handler = shipping.createHandler({env, catalog: mockCatalog(), sky});
  const result = unpack(await handler(event('POST', {body: {quantity: 4, destination}})));
  assert.equal(polls.length, 0);
  assert.equal(result.status, 200);
  assert.equal(result.data.customer_price, 140);
  assert.equal(typeof result.data.quote_token, 'string');
  assert.equal(unpack(await handler(event('POST', {body: {quantity: 31, destination}}))).status, 400);
  assert.equal(unpack(await handler(event('POST', {body: {quantity: 4,
    destination: {...destination, area_level3: 'Inventada'}}}))).status, 422);
});

test('JSON:API, errores de autenticación, tarifas vacías, no válidas, tiempo agotado y respuestas dañadas', async () => {
  const catalog = mockCatalog();
  const evaluate = async sky => unpack(await shipping.createHandler({env, catalog, sky})(
    event('POST', {body: {quantity: 1, destination}})));
  const jsonApi = {data: {type: 'quotation', attributes: {status: 'is_completed'}},
    included: [{type: 'parcel', attributes: {total: 1}}, {type: 'rate', id: rate.id, attributes: rate}]};
  assert.equal((await evaluate(skydropx([dummyResponse(jsonApi)]))).data.customer_price, 140);
  for (const [payload, code] of [
    [{is_completed: true, rates: []}, 'RATES_EMPTY'],
    [{is_completed: true, rates: [{...rate, total: null, amount: '50'}]}, 'RATES_UNUSABLE'],
    [{is_completed: true}, 'SKYDROPX_RESPONSE'], [{status: 'failed'}, 'QUOTE_FAILED'],
    [{is_completed: false}, 'QUOTE_TIMEOUT']
  ]) {
    assert.equal((await evaluate(skydropx([dummyResponse(payload)]))).data.code, code);
  }
  const denied = createSkydropx({env, fetcher: async () => dummyResponse({}, 401)});
  assert.equal((await evaluate(denied)).data.code, 'SKYDROPX_OAUTH');
  const offline = createSkydropx({env, fetcher: async () => { throw new TypeError(); }});
  assert.equal((await evaluate(offline)).data.code, 'SKYDROPX_TRANSPORT');
});

test('GET /postal-code valida código, CORS y método', async () => {
  const handler = postal.createHandler(mockCatalog());
  const result = await handler(event('GET', {query: {zip: '64000'}, headers: {origin: 'https://tarsi.example'}}));
  assert.equal(result.headers['Access-Control-Allow-Origin'], 'https://tarsi.example');
  assert.deepEqual(unpack(result).data.colonies.map(row => row.name), ['Monterrey Centro', 'La Finca']);
  assert.equal(unpack(await handler(event('GET', {query: {zip: '00000'}}))).status, 404);
  assert.equal(unpack(await handler(event('GET', {headers: {origin: 'https://somewhere.example'}}))).status, 403);
  assert.equal(unpack(await handler(event('POST'))).status, 405);
});

test('Stripe simulado: sesión idempotente, totales del servidor, webhook firmado, registro y consulta', async () => {
  const catalog = mockCatalog();
  const store = memoryStore();
  const created = new Map();
  const sdk = new Stripe(env.STRIPE_SECRET_KEY);
  const sessionId = 'cs_test_abcdefghijklmnopqrst1';
  let providerSession;
  const stripe = {
    webhooks: sdk.webhooks,
    checkout: {sessions: {
      async create(data, {idempotencyKey}) {
        assert.deepEqual(data.line_items.map(item => item.price_data.unit_amount), [99900, 14000]);
        assert.equal(data.success_url, 'https://tarsi.example/?pago={CHECKOUT_SESSION_ID}');
        if (!created.has(idempotencyKey)) created.set(idempotencyKey, data);
        providerSession = {id: sessionId, client_reference_id: data.client_reference_id, metadata: data.metadata,
          livemode: false, status: 'open', url: 'https://checkout.stripe.com/c/pay/' + sessionId};
        return providerSession;
      },
      async retrieve(id) {
        assert.equal(id, sessionId);
        return providerSession;
      }
    }}
  };
  const payments = createPayments({env, catalog, openStore: () => store, openStripe: () => stripe});
  const paymentHandler = checkout.createHandler(payments);
  const webhookHandler = webhook.createHandler(payments);
  const statusHandler = orderStatus.createHandler(payments);
  const status = () => statusHandler(event('POST', {body: {session_id: sessionId}})).then(unpack);
  const quote = await shipping.createHandler({env, catalog,
    sky: skydropx([dummyResponse({is_completed: true, rates: [rate]})])
  })(event('POST', {body: {quantity: 3, destination}})).then(unpack);
  const body = {items: [{id: 0, size: 'S', qty: 2}, {id: 4, size: 'XL', qty: 1}],
    contact: {name: 'Cliente de prueba', street: 'Calle 123', phone: '+52 55 5555 1234'},
    quote_token: quote.data.quote_token, destination, total: 1, shipping: 1};
  const pay = value => paymentHandler(event('POST', {body: value})).then(unpack);
  assert.equal((await pay({...body, items: [{id: 0, size: 'S', qty: 1}]})).data.code, 'QUOTE_INVALID');
  assert.equal((await pay({...body, contact: {name: 'Cliente'}})).data.code, 'INVALID_CONTACT');
  const [first, second] = await Promise.all([pay(body), pay(body)]);
  assert.deepEqual(first, second);
  assert.equal(first.status, 200);
  assert.equal(created.size, 1);
  assert.equal(store.values.size, 1);
  assert.equal((await pay({...body, contact: {...body.contact, street: 'Otra calle 25'}})).data.code,
    'QUOTE_ALREADY_USED');
  assert.equal((await status()).data.status, 'pending');

  const send = (session, signed = true) => {
    const payload = JSON.stringify({id: 'evt_fixture', type: 'checkout.session.completed',
      livemode: false, created: Math.floor(Date.now() / 1000), data: {object: session}});
    const signature = signed ? sdk.webhooks.generateTestHeaderString({payload, secret: env.STRIPE_WEBHOOK_SECRET}) : 'invalid';
    return webhookHandler(event('POST', {body: Buffer.from(payload).toString('base64'),
      headers: {'stripe-signature': signature}, base64: true})).then(unpack);
  };
  const paid = {...providerSession, mode: 'payment', status: 'complete', payment_status: 'paid',
    currency: 'mxn', amount_total: 113900, payment_intent: 'pi_fixture', customer_details: {email: 'test@example.com'}};
  assert.equal((await send(paid, false)).data.code, 'INVALID_SIGNATURE');
  assert.equal((await send({...paid, amount_total: 5})).data.code, 'ORDER_MISMATCH');
  assert.equal((await send({...paid, payment_status: 'unpaid'})).status, 200);
  assert.equal((await status()).data.status, 'pending');
  const deliveries = await Promise.all([send(paid), send(paid)]);
  assert.ok(deliveries.every(delivery => delivery.status === 200));
  assert.equal((await send(paid)).status, 200);
  assert.equal(store.values.size, 1);
  assert.equal((await status()).data.total, 1139);
  assert.equal((await pay(body)).data.code, 'ORDER_ALREADY_PAID');
  assert.equal((await checkout.createHandler(createPayments({env: {}}))(event('POST', {body}))).statusCode, 503);
});
