'use strict';

const {createCipheriv, createDecipheriv, createHash, randomBytes} = require('node:crypto');
const {HttpError} = require('./http');

const keyFor = secret => createHash('sha256').update(secret).digest();
const destinationKey = address => [address.postal_code, address.area_level1, address.area_level2, address.area_level3].join('|');

function sealQuote(secret, record) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function verifyQuote(secret, proof, address, quantity) {
  try {
    if (typeof proof !== 'string' || proof.length > 4096) throw new Error();
    const bytes = Buffer.from(proof, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', keyFor(secret), bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const quote = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]));
    if (quote.destination !== destinationKey(address) || quote.quantity !== quantity ||
        !(Date.parse(quote.expires) > Date.now()) || !Number.isSafeInteger(quote.price) || quote.price <= 0) throw new Error();
    return quote;
  } catch {
    throw new HttpError(409, 'QUOTE_REQUIRED', 'Tu cotización venció o cambió. Cotiza el envío de nuevo.');
  }
}

module.exports = {sealQuote, verifyQuote, destinationKey};
