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

test('Only PR #6 forwards quote, submission and recovery to Floot without Netlify secrets', async () => {
  const calls = [];
  const fetcher = async (url, request) => {
    calls.push(JSON.parse(request.body));
    assert.match(url, /\.sandbox\.floot\.app\/_api\/tarsi_preview_checkout$/);
    assert.equal(request.headers['X-Tarsi-Preview'], 'checkout-v1');
    assert.equal(request.headers.Authorization, undefined);
    return Response.json({ok:true});
  };
  const request = body => ({...event('POST',{body}), rawUrl:'https://deploy-preview-6--tarsi-skydropx.netlify.app/.netlify/functions/test'});
  assert.equal(unpack(await quote({env:{},fetcher})(request({quantity:1,destination:{}}))).status, 200);
  assert.equal(unpack(await submit({env:{},fetcher})(request({notify:true}))).status, 200);
  assert.equal(unpack(await submit({env:{},fetcher})(request({recover:true}))).status, 200);
  assert.deepEqual(calls.map(call=>call.mode),['quote','checkout','recover']);
  assert.equal(unpack(await submit({env:{},fetcher})(event('POST',{body:{}}))).status, 400);
});
