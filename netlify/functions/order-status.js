'use strict';
const {endpoint, readBody} = require('../lib/http');
const {createPayments} = require('../lib/payments');

const createHandler = (payments = createPayments()) => endpoint(['POST'], async event => ({
  data: await payments.status(readBody(event).session_id)
}));
exports.handler = createHandler();
exports.createHandler = createHandler;
