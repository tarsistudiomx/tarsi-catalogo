'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createSkydropx} = require('../netlify/lib/skydropx');
const shipping = require('../netlify/functions/shipping-quote');
const postal = require('../netlify/functions/postal-code');
const {env, destination, rate, mockCatalog, event, unpack} = require('./fixtures');

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
    dummyResponse({is_completed: true, rates: [
      {...rate, id: 'r-cheap', provider_name: 'otra', total: 1}, {...rate, id: 'r-2', total: 129}, rate
    ]})];
  const sky = skydropx(polls, (url, options) => {
    if (url.endsWith('/oauth/token')) assert.equal(options.body.get('grant_type'), 'client_credentials');
    if (url.endsWith('/quotations')) {
      const {quotation} = JSON.parse(options.body);
      assert.equal(quotation.address_from.area_level3, 'Plazas del Sol 2a Sección');
      assert.equal(quotation.address_to.area_level3, 'San Ángel');
      assert.equal(quotation.parcels[0].weight, 1.4);
      assert.deepEqual(quotation.requested_carriers, ['fedex', 'estafeta', 'paquetexpress', 'dhl']);
    }
  });
  const handler = shipping.createHandler({env, catalog: mockCatalog(), sky});
  const result = unpack(await handler(event('POST', {body: {quantity: 4, destination}})));
  assert.equal(polls.length, 0);
  assert.equal(result.status, 200);
  assert.equal(result.data.customer_price, 140);
  assert.equal(result.data.carrier_name, 'FedEx');
  assert.equal(result.data.carrier_service, 'Priority');
  assert.equal(result.data.quotation_id, 'q-1');
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
    [{is_completed: true, rates: [{...rate, provider_name: 'otra', total: '50'}]}, 'RATES_UNUSABLE'],
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

test('GET /postal-code lee Blobs con el contexto real de Functions de Netlify', async t => {
  const previousContext = process.env.NETLIFY_BLOBS_CONTEXT;
  t.after(() => {
    if (previousContext === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT;
    else process.env.NETLIFY_BLOBS_CONTEXT = previousContext;
  });
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const {origin, pathname} = new URL(url);
    assert.equal(origin, 'https://blobs.example');
    assert.equal(options.headers.authorization, 'Bearer fixture-token');
    requested.push(pathname);
    if (pathname === '/fixture-site/site:tarsi-postal/current') {
      return dummyResponse({version: 'fixture'});
    }
    return dummyResponse({'01000': [{name: 'San Ángel', city: 'Álvaro Obregón', state: 'Ciudad de México'}]});
  });
  const result = await postal.handler({
    ...event('GET', {query: {zip: '01000'}, headers: {'x-nf-site-id': 'fixture-site', 'x-nf-deploy-id': 'fixture-deploy'}}),
    blobs: Buffer.from(JSON.stringify({url: 'https://blobs.example', token: 'fixture-token'})).toString('base64')
  });
  assert.equal(result.statusCode, 200);
  assert.equal(unpack(result).data.colonies[0].name, 'San Ángel');
  assert.deepEqual(requested, ['/fixture-site/site:tarsi-postal/current', '/fixture-site/site:tarsi-postal/fixture/01']);
});
