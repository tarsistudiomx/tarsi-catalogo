'use strict';
const {createHmac, createHash, timingSafeEqual} = require('node:crypto');
const {HttpError} = require('./http');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sign = (value, secret) => createHmac('sha256', secret).update(value).digest('base64url');

function issueQuote(quote, destination, quantity, expires, secret) {
  const body = Buffer.from(JSON.stringify({...quote, destination: digest(destination), quantity, expires})).toString('base64url');
  return body + '.' + sign(body, secret);
}

function verifyQuote(token, destination, quantity, secret) {
  const invalid = () => new HttpError(409, 'QUOTE_INVALID', 'Cotiza nuevamente el envío antes de pagar.');
  if (typeof token !== 'string' || token.length > 2048) throw invalid();
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) throw invalid();
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw invalid();
  const quote = JSON.parse(Buffer.from(body, 'base64url'));
  if (quote.expires <= Date.now() || quote.quantity !== quantity || quote.destination !== digest(destination)) throw invalid();
  return quote;
}

module.exports = {issueQuote, verifyQuote, digest};
