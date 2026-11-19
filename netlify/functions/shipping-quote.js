'use strict';

const {maxQuantity} = require('../../shop');
const {endpoint, readBody, HttpError} = require('../lib/http');
const {postal} = require('../lib/postal');
const {createSkydropx} = require('../lib/skydropx');

const {useFlootPreview, flootPreview} = require('../lib/floot-preview');
const {sealQuote, destinationKey} = require('../lib/quote-proof');

function formatQuote(data, address, quantity, env, rateId) {
  const {quotation_id, ...publicQuote} = data;
  if (env.TARSI_QUOTE_SECRET?.length >= 32) {
    publicQuote.proof = sealQuote(env.TARSI_QUOTE_SECRET, {
      destination: destinationKey(address), quantity, price: data.customer_price,
      expires: data.expires_at, carrier: data.carrier_name, service: data.carrier_service,
      quotationId: quotation_id, rateId: rateId ?? null
    });
  }
  return publicQuote;
}

function createHandler({env = process.env, catalog = postal, sky = createSkydropx({env}), fetcher = fetch} = {}) {
  return endpoint(['POST'], async event => {
    const {destination, quantity} = readBody(event);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity) {
      throw new HttpError(400, 'INVALID_QUANTITY', 'Elige de 1 a 30 playeras para cotizar.');
    }
    if (useFlootPreview(event)) return flootPreview({destination, quantity}, 'quote', fetcher);
    const address = await catalog.validate(destination);
    const hostname = event.rawUrl && new URL(event.rawUrl).hostname;
    if (/^deploy-preview-\d+--tarsi-skydropx\.netlify\.app$/.test(hostname || '') &&
        !env.SKYDROPX_CLIENT_ID && !env.SKYDROPX_CLIENT_SECRET) {
      const response = await fetcher('https://tarsi-skydropx.netlify.app/.netlify/functions/shipping-quote', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({destination: address, quantity}),
        redirect: 'error',
        signal: AbortSignal.timeout(25000)
      });
      const data = await response.json();
      return {status: response.status, data: response.ok ? formatQuote(data, address, quantity, env) : data};
    }
    let origin;
    try {
      origin = await catalog.validate({
        postal_code: env.TARSI_ORIGIN_CP || '76099',
        area_level3: env.TARSI_ORIGIN_COLONY || 'Plazas del Sol 2a Sección'
      });
    } catch (error) {
      if (error.code === 'POSTAL_UNAVAILABLE') throw error;
      console.warn('TARSI origin validation', {code: error.code});
      throw new HttpError(503, 'INVALID_ORIGIN', 'El origen de los envíos no está disponible.');
    }
    const quote = await sky(origin, address, quantity);
    const expires = Date.now() + 15 * 60 * 1000;
    return {data: formatQuote({
      customer_price: quote.customerPrice,
      estimated_days: quote.days,
      service: 'Envío TARSI',
      carrier_name: quote.carrier,
      carrier_service: quote.service,
      quotation_id: quote.quotationId,
      expires_at: new Date(expires).toISOString()
    }, address, quantity, env, quote.rateId)};
  });
}
exports.handler = createHandler();
exports.createHandler = createHandler;
