'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {readFileSync} = require('node:fs');
const {event, unpack} = require('./fixtures');
const {products, unitPrice, subtotal} = require('../shop');
const {createHandler: submit} = require('../netlify/functions/submit-order');
const {createHandler: quote} = require('../netlify/functions/shipping-quote');

test('Floot preview matches the active product names and prices', () => {
  const source = readFileSync('floot/helpers/previewShopCatalog.tsx', 'utf8');
  const names = JSON.parse(source.match(/names = (\[[\s\S]+?\]);/)[1]);
  assert.deepEqual(names, products.map(product => product.name));
  assert.match(source, new RegExp('unit = ' + unitPrice + ';'));
  assert.ok(source.includes(subtotal.toString().replace('quantity =>', '(quantity: number) =>')));
});

test('The new preview forwards reports, renewals, quotes and checkout to Floot without Netlify secrets', async t => {
  const saved = process.env.TARSI_FLOOT_PREVIEW_ORIGIN;
  t.after(() => {
    if (saved === undefined) delete process.env.TARSI_FLOOT_PREVIEW_ORIGIN;
    else process.env.TARSI_FLOOT_PREVIEW_ORIGIN = saved;
  });
  process.env.TARSI_FLOOT_PREVIEW_ORIGIN = 'https://a5112529-9f7b-46bf-b94b-3a7cc76b3b15.sandbox.floot.app';
  const calls = [];
  const fetcher = async (url, request) => {
    calls.push(JSON.parse(request.body));
    assert.match(url, /\.sandbox\.floot\.app\/_api\/tarsi_preview_checkout_v2$/);
    assert.equal(request.headers['X-Tarsi-Preview'], 'checkout-v1');
    assert.equal(request.headers.Authorization, undefined);
    return Response.json({ok:true});
  };
  const request = body => ({...event('POST',{body}), rawUrl:'https://deploy-preview-7--tarsi-skydropx.netlify.app/.netlify/functions/test'});
  assert.equal(unpack(await quote({env:{},fetcher})(request({quantity:1,destination:{}}))).status, 200);
  assert.equal(unpack(await submit({env:{},fetcher})(request({notify:true}))).status, 200);
  assert.equal(unpack(await submit({env:{},fetcher})(request({recover:true}))).status, 200);
  assert.equal(unpack(await submit({env:{},fetcher})(request({mode:'report'}))).status, 200);
  assert.equal(unpack(await submit({env:{},fetcher})(request({mode:'renew'}))).status, 200);
  assert.deepEqual(calls.map(call=>call.mode),['quote','checkout','recover','report','renew']);
  assert.equal(unpack(await submit({env:{},fetcher})(event('POST',{body:{}}))).status, 400);
});

test('Published checkout routes to Floot while the carrier endpoint stays independent', async () => {
  const checkoutQuote = require('../netlify/functions/checkout-quote').createHandler;
  const calls = [];
  const fetcher = async (url, request) => {
    assert.equal(url, 'https://tarsi-control-ventas.floot.app/_api/tarsi_live_checkout_v2');
    assert.equal(request.headers['X-Tarsi-Storefront'], 'storefront-v1');
    assert.equal(request.headers.Authorization, undefined);
    calls.push(JSON.parse(request.body).mode);
    return Response.json({ok:true});
  };
  const publicRequest = body => ({...event('POST',{body}), rawUrl:'https://tarsi-skydropx.netlify.app/.netlify/functions/test'});
  assert.equal(unpack(await checkoutQuote(fetcher)(publicRequest({quantity:1,destination:{}}))).status, 200);
  assert.equal(unpack(await submit({env:{},fetcher})(publicRequest({recover:true}))).status, 200);
  assert.deepEqual(calls,['quote','recover']);
  const {mockCatalog, destination} = require('./fixtures');
  let queried = false;
  const tariff = quote({env:{},catalog:mockCatalog(),sky:async()=> {
    queried = true;
    return {customerPrice:140,carrier:'FedEx',service:'Priority',days:2};
  },fetcher});
  assert.equal(unpack(await tariff(publicRequest({quantity:1,destination}))).data.customer_price, 140);
  assert.equal(queried,true);
  assert.deepEqual(calls,['quote','recover']);
});
