'use strict';

const {createSkydropx} = require('../netlify/lib/skydropx');

const origin = {
  country_code: 'MX', postal_code: process.env.TARSI_ORIGIN_CP || '76099',
  area_level1: 'Querétaro', area_level2: 'Querétaro',
  area_level3: process.env.TARSI_ORIGIN_COLONY || 'Plazas del Sol 2a Sección'
};
const samples = [
  {quantity: 1, destination: {country_code: 'MX', postal_code: '01000', area_level1: 'Ciudad de México',
    area_level2: 'Álvaro Obregón', area_level3: 'San Ángel'}},
  {quantity: 4, destination: {country_code: 'MX', postal_code: '64000', area_level1: 'Nuevo León',
    area_level2: 'Monterrey', area_level3: 'Monterrey Centro'}}
];

let carrierTotal;
const fetcher = async (url, options) => {
  const response = await fetch(url, options);
  if (url.includes('/oauth/token')) {
    console.log('TARSI_VERIFY_OAUTH ' + response.status);
  }
  if (response.ok && url.includes('/quotations/')) {
    const data = await response.clone().json();
    const {usableRates} = require('../netlify/lib/skydropx');
    const rows = Array.isArray(data.rates) ? data.rates :
      (data.included ?? []).filter(row => row.type === 'rate');
    carrierTotal = usableRates(rows)[0]?.cents;
  }
  return response;
};

(async () => {
  console.log('TARSI_VERIFY_CONTEXT ' + process.env.CONTEXT);
  if (process.env.CONTEXT !== 'production') throw new Error('CONTEXT_NOT_PRODUCTION');
  const quote = createSkydropx({fetcher});
  for (const {quantity, destination} of samples) {
    const result = await quote(origin, destination, quantity);
    console.log('TARSI_VERIFY_RATE ' + JSON.stringify({
      postal: destination.postal_code, quantity, carrier_mxn: carrierTotal / 100,
      price_mxn: result.customerPrice, days: result.days
    }));
  }
})().catch(error => {
  console.error('TARSI_VERIFY_ERROR ' + (error.code || error.message));
  process.exitCode = 1;
});
