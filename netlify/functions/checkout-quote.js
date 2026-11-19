'use strict';

const {endpoint, readBody, HttpError} = require('../lib/http');
const {storefrontMode, flootCheckout} = require('../lib/floot-checkout');

function createHandler(fetcher = fetch) {
  return endpoint(['POST'], async event => {
    const mode = storefrontMode(event);
    if (!mode) throw new HttpError(404, 'NOT_FOUND', 'Cotización no disponible.');
    if ((event.body?.length ?? 0) > 2000) throw new HttpError(413, 'INVALID_QUOTE', 'Revisa los datos de envío.');
    return flootCheckout(readBody(event), 'quote', mode, fetcher);
  });
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.config = {rateLimit: {windowLimit: 15, windowSize: 60, aggregateBy: ['ip']}};
