'use strict';

const {randomUUID} = require('node:crypto');
const assert = require('node:assert/strict');
const {createHandler: quoteHandler} = require('../netlify/functions/shipping-quote');
const {createHandler: orderHandler} = require('../netlify/functions/submit-order');
const {mockCatalog, event, unpack, destination} = require('../tests/fixtures');

async function main() {
  const env = process.env;
  assert.equal(new URL(env.TARSI_DASHBOARD_URL).hostname, '66f62c32-15c0-4546-ba6e-bce0efe72d71.sandbox.floot.app');
  assert.match(env.TARSI_DASHBOARD_TOKEN, /^[a-f0-9]{64}$/);
  assert.ok(env.TARSI_QUOTE_SECRET.length >= 32);
  // Use a known SEPOMEX fixture. The production relay supplies the actual Skydropx tariff.
  const catalog = mockCatalog();
  const quoteEvent = event('POST', {body: {destination, quantity: 1}});
  quoteEvent.rawUrl = 'https://deploy-preview-5--tarsi-skydropx.netlify.app/.netlify/functions/shipping-quote';
  const quote = unpack(await quoteHandler({catalog, env})(quoteEvent));
  assert.equal(quote.status, 200, JSON.stringify(quote.data));
  assert.ok(quote.data.proof);
  assert.ok(!quote.data.quotation_id);
  const key = randomUUID();
  const input = {
    key, items: [{id: 0, size: 'M', qty: 1}], customer: {name: 'PRUEBA AUTOMATIZADA TARSI', phone: '5555550000'},
    address: {...destination, street: 'Dirección de prueba 123'}, delivery: 'Envío nacional',
    proof: quote.data.proof, total: 1
  };
  const handler = orderHandler({catalog, env});
  const submit = async body => unpack(await handler(event('POST', {body})));
  const [first, second] = await Promise.all([submit(input), submit(input)]);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.deepEqual(second, first);
  assert.deepEqual(await submit({...input, proof: undefined}), first);
  assert.equal((await submit({...input, items: [{id: 0, size: 'L', qty: 1}]})).status, 409);
  assert.equal(first.data.shipping, quote.data.customer_price);
  assert.equal(first.data.total, 399 + quote.data.customer_price);
  console.log(JSON.stringify({
    key, number: first.data.number, carrier: quote.data.carrier_name, service: quote.data.carrier_service,
    shipping: first.data.shipping, subtotal: 399, total: first.data.total, status: first.data.status,
    parallel: 2, retryWithoutProof: true, changedPayload: 409
  }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
