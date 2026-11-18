'use strict';
const {endpoint, readBody} = require('../lib/http');
const {createPayments} = require('../lib/payments');

const createHandler = (payments = createPayments()) => endpoint(['GET', 'POST'], async event => ({
  data: event.httpMethod === 'GET' ? {mode: payments.mode} : await payments.checkout(readBody(event))
}));
exports.handler = createHandler();
exports.createHandler = createHandler;
