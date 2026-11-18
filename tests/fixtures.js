'use strict';
const {createPostal} = require('../netlify/lib/postal');

const env = {
  SKYDROPX_CLIENT_ID: 'fixture-client', SKYDROPX_CLIENT_SECRET: 'fixture-secret',
  SKYDROPX_ENV: 'sandbox'
};

const postalGroups = {
  '01': {'01000': [{name: 'San Ángel', city: 'Álvaro Obregón', state: 'Ciudad de México'}]},
  '64': {'64000': ['Monterrey Centro', 'La Finca'].map(name => ({name, city: 'Monterrey', state: 'Nuevo León'}))},
  '76': {'76099': ['1a', '2a', '3a'].map(n => ({name: 'Plazas del Sol ' + n + ' Sección', city: 'Querétaro', state: 'Querétaro'}))}
};
const destination = {postal_code: '01000', area_level1: 'CIUDAD DE MEXICO', area_level2: 'alvaro obregon',
  area_level3: 'COL. SAN ANGEL'};
const rate = {
  id: 'r-1', success: true, status: 'price_found_internal', currency_code: 'MXN',
  provider_name: 'fedex', provider_service_name: 'Priority', total: '106.19', days: 2
};

function memoryStore(entries) {
  const values = new Map(entries);
  return {
    get: async key => structuredClone(values.get(key) ?? null),
    setJSON: async (key, value, {onlyIfNew} = {}) => {
      if (onlyIfNew && values.has(key)) return {modified: false};
      values.set(key, structuredClone(value));
      return {modified: true};
    },
    delete: async key => { values.delete(key); },
    values
  };
}

function mockCatalog(groups = postalGroups) {
  const store = memoryStore([['current', {version: 'fixture'}],
    ...Object.entries(groups).map(([prefix, rows]) => ['fixture/' + prefix, rows])]);
  return createPostal(() => store);
}

const event = (method, {body, query, headers, base64 = false} = {}) => ({
  httpMethod: method, headers, queryStringParameters: query,
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  isBase64Encoded: base64,
  rawUrl: 'https://tarsi.example/.netlify/functions/test'
});
const unpack = response => ({status: response.statusCode, data: JSON.parse(response.body)});

module.exports = {env, destination, rate, mockCatalog, memoryStore, event, unpack};
