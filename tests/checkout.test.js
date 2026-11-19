'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHandler} = require('../netlify/functions/submit-order');
const {sealQuote, destinationKey} = require('../netlify/lib/quote-proof');
const {destination, mockCatalog, event, unpack} = require('./fixtures');

const secret = 'checkout-quote-test-secret-with-more-than-32-characters';
const env = {TARSI_QUOTE_SECRET: secret, TARSI_DASHBOARD_TOKEN: 'test', TARSI_DASHBOARD_URL: 'https://dashboard.example/order'};
const input = {
  key: 'a08244ed-3e7e-4ed2-86ca-4b5b6f8c07d7', items: [{id: 0, size: 'M', qty: 2}, {id: 2, size: 'S', qty: 2}],
  customer: {name: 'Prueba checkout', phone: '5555551234'}, address: {...destination, street: 'Calle de prueba 123'},
  delivery: 'Envío nacional', total: 1
};
function proof(overrides = {}) {
  return sealQuote(secret, {destination: destinationKey({postal_code: '01000', area_level1: 'Ciudad de México', area_level2: 'Álvaro Obregón', area_level3: 'San Ángel'}), quantity: 4, price: 140,
    expires: new Date(Date.now()+60000).toISOString(), carrier: 'FedEx', service: 'Priority',
    quotationId: 'private-quote', rateId: 'private-rate', ...overrides});
}
function setup() {
  let order;
  let digest;
  const handler = createHandler({env, catalog: mockCatalog(), fetcher: async (_url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer test');
    const data = JSON.parse(request.body);
    if (order && ['lookup','create'].includes(data.action) && data.digest !== digest) return Response.json({}, {status: 409});
    if (data.action === 'create' && !order) { order = data.order; digest = data.digest; }
    if (data.action === 'notify') return Response.json({notification: 'retry'});
    return Response.json({receipt: order ? {...order, number: 'TARSI-TEST', status: 'Pendiente de pago'} : null});
  }});
  return {request: async body => unpack(await handler(event('POST', {body}))), stored: () => order};
}

test('recalcula promociones e importes, conserva referencias privadas y permite un reintento sin cotización', async () => {
  const {request, stored} = setup();
  const first = await request({...input, proof: proof()});
  assert.equal(first.status, 200);
  assert.equal(first.data.total, 1538);
  assert.equal(first.data.subtotal, 1398);
  assert.equal(first.data.transfer, null);
  assert.equal(stored().discount, 198);
  assert.equal(stored().skydropx.rateId, 'private-rate');
  assert.doesNotMatch(JSON.stringify(first.data), /private-quote|private-rate/);
  assert.deepEqual(await request({...input}), first);
  assert.equal((await request({...input, customer: {...input.customer, name: 'Otra persona'}})).status, 409);
});

test('rechaza cotización alterada, vencida o de otra cantidad y datos incompletos sin registrar', async () => {
  const {request, stored} = setup();
  for (const token of [proof({quantity: 1}), proof({expires: '2020-01-01'}), 'alterada']) {
    assert.equal((await request({...input, proof: token})).data.code, 'QUOTE_REQUIRED');
  }
  assert.equal((await request({...input, customer: {}})).status, 400);
  assert.equal(stored(), undefined);
});

test('recupera el pedido sin datos personales y conserva el recibo si falla el correo', async () => {
  const {request} = setup();
  assert.equal((await request({...input, proof: proof(), acceptedTotal: 1})).data.code, 'TOTAL_CHANGED');
  const result = await request({...input, proof: proof(), notify:true});
  assert.equal(result.status, 200);
  assert.equal(result.data.notification, 'retry');
  const recovered = await request({key: input.key, recover:true});
  assert.equal(recovered.data.number, result.data.number);
  assert.doesNotMatch(JSON.stringify(recovered.data), /5555551234|Calle de prueba/);
});

test('Querétaro cobra solo prendas y deja el envío para el día de entrega', async () => {
  const {request, stored} = setup();
  const order = {...input, delivery: 'Entrega en Querétaro', acceptedTotal: 1398,
    address: {street: 'Calle de prueba 1', postal_code: '76099', area_level3: 'Plazas del Sol 2a Sección'}};
  const result = await request(order);
  assert.equal(result.status, 200);
  assert.equal(result.data.total, 1398);
  assert.equal(result.data.delivery, 'Entrega en Querétaro');
  assert.equal(stored().shipping, 0);
  assert.equal(stored().skydropx, null);
  assert.equal((await setup().request({...order, address: input.address})).status, 400);
});
