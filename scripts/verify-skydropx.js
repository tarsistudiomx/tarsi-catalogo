'use strict';

const assert = require('node:assert/strict');
const {createSkydropx, usableRates} = require('../netlify/lib/skydropx');

const allowed = ['fedex', 'estafeta', 'paquetexpress', 'dhl'];
const origin = {
  country_code: 'MX', postal_code: process.env.TARSI_ORIGIN_CP || '76099',
  area_level1: 'Querétaro', area_level2: 'Querétaro',
  area_level3: process.env.TARSI_ORIGIN_COLONY || 'Plazas del Sol 2a Sección'
};
const samples = [
  {quantity: 1, destination: {country_code: 'MX', postal_code: '01000', area_level1: 'Ciudad de México',
    area_level2: 'Álvaro Obregón', area_level3: 'San Ángel'}},
  {quantity: 4, destination: {country_code: 'MX', postal_code: '64000', area_level1: 'Nuevo León',
    area_level2: 'Monterrey', area_level3: 'Monterrey Centro'}},
  {quantity: 1, destination: {country_code: 'MX', postal_code: '76090', area_level1: 'Querétaro',
    area_level2: 'Querétaro', area_level3: 'Colinas del Cimatario'}}
];

let candidates;
const fetcher = async (url, options) => {
  if (url.endsWith('/quotations')) {
    assert.deepEqual(JSON.parse(options.body).quotation.requested_carriers, allowed);
  }
  const response = await fetch(url, options);
  if (url.includes('/oauth/token')) console.log('TARSI_VERIFY_OAUTH ' + response.status);
  if (response.ok && url.includes('/quotations/')) {
    const data = await response.clone().json();
    const rows = Array.isArray(data.rates) ? data.rates :
      (data.included ?? []).filter(row => row.type === 'rate');
    candidates = usableRates(rows);
    if (data.is_completed === true || data.status === 'is_completed' || data.data?.attributes?.status === 'is_completed') {
      const safeCode = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value) ? value : null;
      console.log('TARSI_VERIFY_CARRIERS ' + JSON.stringify(rows.map(row => {
        const rate = row.attributes ?? row;
        return {
          carrier: safeCode(rate.provider_name),
          service: safeCode(rate.provider_service_code),
          success: rate.success, status: safeCode(rate.status), currency: safeCode(rate.currency_code),
          total: /^\d{1,8}(\.\d{1,2})?$/.test(String(rate.total)) ? rate.total : null,
          office: rate.office_delivery, verifyOrigin: rate.requires_origin_verification,
          reasons: Array.isArray(rate.error_messages) ? rate.error_messages.map(e =>
            [e.error_type, e.error_category, e.error_code, e.module].map(safeCode)) : Object.keys(rate.error_messages ?? {}).map(safeCode)
        };
      })));
    }
  }
  return response;
};

(async () => {
  console.log('TARSI_VERIFY_CONTEXT ' + process.env.CONTEXT);
  assert.equal(process.env.CONTEXT, 'production');
  assert.equal(process.env.SKYDROPX_ENV || 'production', 'production');
  const quote = createSkydropx({fetcher});
  for (const {quantity, destination} of samples) {
    candidates = undefined;
    console.log('TARSI_VERIFY_SAMPLE ' + destination.postal_code + ' ' + quantity);
    try {
      const result = await quote(origin, destination, quantity);
      const rate = candidates?.find(candidate => candidate.id === result.rateId);
      assert.ok(rate && allowed.includes(result.carrier.toLowerCase()));
      assert.ok(result.service && result.quotationId);
      const expected = Math.ceil(Math.max(rate.cents + 3000, rate.cents * 6 / 5) / 1000) * 10;
      assert.equal(result.customerPrice, expected);
      console.log('TARSI_VERIFY_RATE ' + JSON.stringify({
        postal: destination.postal_code, quantity, carrier: result.carrier, service: result.service,
        carrier_mxn: rate.cents / 100, price_mxn: result.customerPrice, days: result.days
      }));
    } catch (error) {
      console.error('TARSI_VERIFY_SAMPLE_ERROR ' + destination.postal_code + ' ' + (error.code || error.name));
      process.exitCode = 1;
    }
  }
})().catch(error => {
  console.error('TARSI_VERIFY_ERROR ' + (error.code || error.name));
  process.exitCode = 1;
});
