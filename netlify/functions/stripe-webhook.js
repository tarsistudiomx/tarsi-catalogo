'use strict';
const {endpoint} = require('../lib/http');
const {createPayments} = require('../lib/payments');

const createHandler = (payments = createPayments()) => endpoint(['POST'], async event => ({
  data: await payments.record(
    Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8'),
    event.headers?.['stripe-signature'] ?? event.headers?.['Stripe-Signature']
  )
}), {webhook: true});
exports.handler = createHandler();
exports.createHandler = createHandler;
