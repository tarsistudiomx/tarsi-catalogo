'use strict';

const {endpoint} = require('../lib/http');

exports.handler = endpoint(['GET'], async () => {
  const value = process.env.TARSI_LOCAL_DELIVERY_MXN;
  return {data: {localDelivery: /^\d{1,5}$/.test(value || '') ? Number(value) : null}};
});
