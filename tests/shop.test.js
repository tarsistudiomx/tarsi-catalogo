'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const {subtotal, findColony, count, isLine} = require('../shop');
const {parcelFor, shippingPrice, usableRates} = require('../netlify/lib/skydropx');
const {parseCatalog} = require('../scripts/import-postal');
const {rate, destination, mockCatalog} = require('./fixtures');

test('promociones para 0 a 30 y mezcla de modelos y tallas', () => {
  assert.deepEqual(Array.from({length: 7}, (_, n) => subtotal(n)), [0, 399, 699, 999, 1398, 1698, 1998]);
  assert.equal(subtotal(30), 9990);
  const lines = [{id: 4, size: 'S', qty: 2}, {id: 4, size: 'M', qty: 1}, {id: 0, size: 'XL', qty: 1}];
  assert.ok(lines.every(isLine));
  assert.equal(subtotal(count(lines)), 1398);
  for (const line of [{id: '0', size: 'S', qty: 1}, {id: 12, size: 'S', qty: 1}, {id: 0, size: 'Z', qty: 1},
    {id: 0, size: 'S', qty: '1'}, {id: 0, size: 'S', qty: 1.5}, {id: 0, size: 'S', qty: 0}]) {
    assert.equal(isLine(line), false);
  }
});

test('peso de 350 g y envío exacto con umbrales de margen y de redondeo', () => {
  assert.deepEqual([1, 2, 3, 4, 6, 30].map(n => parcelFor(n).weight), [0.35, 0.7, 1.05, 1.4, 2.1, 10.5]);
  assert.deepEqual([10619, 12000, 12009, 15000, 15001, 16000, 20000, 25000].map(shippingPrice),
    [140, 150, 160, 180, 190, 200, 240, 300]);
});

test('tarifas utilizables: solo MXN, precio total y estados oficiales', () => {
  const rejected = [null, 0, -12, '', 'NaN', Infinity, true, '0x6E', '1e3', '100,000', '15.003']
    .map(total => ({...rate, total, amount: '9.00'}));
  rejected.push(...['no_coverage', 'pending', 'coverage_checked', 'tariff_price_not_found']
    .map(status => ({...rate, status})),
  {...rate, currency_code: 'USD'}, {...rate, success: false},
  {...rate, requires_origin_verification: true});
  assert.deepEqual(usableRates(rejected), []);
  assert.deepEqual(usableRates([rate, {...rate, id: 'r-2', status: 'approved', total: 105},
    {...rate, id: 'r-3', status: 'price_found_external', total: '105.00', days: 1}]).map(r => r.id),
  ['r-3', 'r-2', 'r-1']);
});

test('solo acepta el código oficial de las cuatro paqueterías y conserva el servicio', () => {
  const rows = [
    {...rate, id: 'cheap', provider_name: 'otro', provider_display_name: 'FedEx', total: 1},
    {...rate, id: 'missing', provider_name: undefined, total: 1},
    {...rate, id: 'dhl', provider_name: ' DHL ', provider_service_name: 'Express\nMéxico', total: 100, office_delivery: true},
    {...rate, id: 'estafeta', provider_name: 'estafeta', provider_service_name: '', provider_service_code: 'terrestre'},
    {...rate, id: 'paquetexpress', provider_name: 'paquetexpress', total: 110},
    rate
  ];
  const results = usableRates(rows);
  assert.deepEqual(new Set(results.map(r => r.carrier)), new Set(['DHL', 'Estafeta', 'Paquetexpress', 'FedEx']));
  assert.deepEqual(results[0], {id: 'dhl', carrier: 'DHL', service: 'Express México', cents: 10000, days: 2});
  assert.equal(results.find(r => r.id === 'estafeta').service, 'terrestre');
});

test('colonia canónica, acentos, abreviaturas y código postal de cinco caracteres', async () => {
  const postal = mockCatalog();
  const result = await postal.validate(destination);
  assert.equal(result.area_level3, 'San Ángel');
  assert.equal(result.area_level2, 'Álvaro Obregón');
  assert.equal((await postal.lookup('64000')).colonies.length, 2);
  assert.equal((await postal.validate({postal_code: '76099', area_level3: 'plazas del sol segunda secc.'})).area_level3,
    'Plazas del Sol 2a Sección');
  assert.equal(findColony('COL. Inventada', ['San Ángel']), null);
  assert.equal(findColony('San Ángel', ['San Ángel', 'San Angel']), 'San Ángel');
  assert.equal(findColony('COL. SAN ANGEL', ['San Ángel', 'San Angel']), null);
  await assert.rejects(postal.lookup('1000'), {code: 'INVALID_POSTAL_CODE'});
  await assert.rejects(postal.lookup('00000'), {code: 'POSTAL_NOT_FOUND'});
  await assert.rejects(postal.validate({...destination, area_level1: 'Jalisco'}), {code: 'INVALID_COLONY'});
  await assert.rejects(postal.validate({...destination, area_level3: 'Inventada'}), {code: 'INVALID_COLONY'});
});

test('catálogo nacional real SEPOMEX cuando se proporciona el TXT oficial', {
  skip: !process.env.TARSI_TEST_POSTAL_FILE
}, async t => {
  const bytes = readFileSync(process.env.TARSI_TEST_POSTAL_FILE);
  const parsed = parseCatalog(bytes);
  const postal = mockCatalog(parsed.table);
  t.diagnostic(parsed.count + ' CP, SHA-256 ' + createHash('sha256').update(bytes).digest('hex'));
  for (const [zip, city, name] of [
    ['01000', 'Álvaro Obregón', 'San Ángel'], ['64000', 'Monterrey', 'Monterrey Centro'],
    ['76099', 'Querétaro', 'Plazas del Sol 2a Sección'], ['44100', 'Guadalajara', 'Guadalajara Centro'],
    ['97000', 'Mérida', 'Mérida Centro'], ['22000', 'Tijuana', 'Zona Centro']
  ]) {
    const result = await postal.validate({postal_code: zip, area_level3: name});
    assert.equal(result.area_level2, city);
  }
});
