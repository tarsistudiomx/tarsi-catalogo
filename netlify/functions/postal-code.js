'use strict';
const {endpoint} = require('../lib/http');
const {postal} = require('../lib/postal');

const createHandler = (catalog = postal) => endpoint(['GET'], async event => ({
  data: await catalog.lookup(event.queryStringParameters?.zip)
}));
exports.handler = createHandler();
exports.createHandler = createHandler;
