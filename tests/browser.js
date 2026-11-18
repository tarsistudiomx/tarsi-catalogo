'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const {resolve, extname} = require('node:path');
const {createServer} = require('node:http');
const {chromium} = require('playwright');
const {createHandler: postalHandler} = require('../netlify/functions/postal-code');
const {createHandler: shippingHandler} = require('../netlify/functions/shipping-quote');
const {HttpError} = require('../netlify/lib/http');
const {env, mockCatalog, event} = require('./fixtures');

const root = resolve('dist');
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg', '.png': 'image/png'};
const catalog = mockCatalog();
const checkoutSession = 'cs_test_browserfixture12345';
let incomingCheckout;
let pending = true;
const routes = {
  'postal-code': postalHandler(catalog),
  'shipping-quote': shippingHandler({env, catalog, async sky(origin, address) {
    if (address.area_level3 === 'La Finca') throw new HttpError(503, 'RATES_UNUSABLE', 'No hay una tarifa a domicilio disponible.');
    return {quotationId: 'browser-q', rateId: 'r-1', customerPrice: 140, days: 2};
  }}),
  checkout: async request => {
    if (request.httpMethod === 'POST') incomingCheckout = JSON.parse(request.body);
    return {statusCode: 200, headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(request.httpMethod === 'GET' ? {mode: 'test'} :
        {url: 'https://checkout.stripe.com/c/pay/' + checkoutSession})};
  },
  'order-status': async request => {
    assert.equal(JSON.parse(request.body).session_id, checkoutSession);
    const data = pending ? {status: 'pending'} : {status: 'paid', reference: 'TEST12345678', total: 1538};
    pending = false;
    return {statusCode: 200, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)};
  }
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const route = routes[url.pathname.replace('/.netlify/functions/', '')];
    if (route) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const source = event(request.method, {
        body: Buffer.concat(chunks).toString(), query: Object.fromEntries(url.searchParams), headers: request.headers
      });
      source.rawUrl = 'http://' + request.headers.host + url.pathname;
      const result = await route(source);
      response.writeHead(result.statusCode, result.headers).end(result.body);
      return;
    }
    const file = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + '/')) throw new Error();
    const contents = await readFile(file);
    response.writeHead(200, {'Content-Type': types[extname(file)] || 'application/octet-stream'}).end(contents);
  } catch {
    response.writeHead(404).end();
  }
});
let browser;
let base;
test.before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({
    executablePath: process.env.TARSI_CHROMIUM || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
});
test.after(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
});

const waitText = (page, selector, text) => page.locator(selector).getByText(text, {exact: false}).waitFor();

async function selectProduct(page, id, size, quantity) {
  await page.locator('button[data-open="' + id + '"]').click();
  await page.selectOption('#detailSize', size);
  await page.selectOption('#detailQty', String(quantity));
  await page.click('#detailAdd');
}

test('Chromium móvil: catálogo, carrito mixto, dirección canónica, total, Stripe simulado y confirmación', async () => {
  const page = await browser.newPage({viewport: {width: 390, height: 844}, reducedMotion: 'reduce'});
  try {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    assert.equal(await page.locator('.product').count(), 12);
    const logoLoaded = await page.locator('.logo').evaluate(image => image.complete && image.naturalWidth > 0);
    assert.equal(logoLoaded, true);
    await selectProduct(page, 0, 'S', 2);
    await selectProduct(page, 4, 'XL', 2);
    await page.click('#navCart');
    assert.equal(await page.locator('.cart-line').count(), 2);
    await waitText(page, '#totals', '$1,398 MXN');
    await page.selectOption('#delivery', 'Envío nacional');
    await page.fill('#zipCode', '01000');
    await page.waitForFunction(() => document.querySelector('#state').value === 'Ciudad de México');
    assert.equal(await page.inputValue('#city'), 'Álvaro Obregón');
    await page.fill('#neighborhood', 'COL. san angel');
    await page.fill('#buyer', 'Cliente de prueba');
    await page.fill('#street', 'Calle de prueba 123');
    await page.fill('#phone', '55 5555 1234');
    assert.equal(await page.inputValue('#neighborhood'), 'San Ángel');
    await page.click('#quoteShipping');
    await waitText(page, '#totals .final', '$1,538 MXN');
    await waitText(page, '#shippingStatus', '2 días hábiles');
    await page.getByRole('button', {name: 'Sumar una'}).first().click();
    assert.equal(await page.locator('#payOrder').isDisabled(), true);
    await waitText(page, '#totals', '$1,698 MXN');
    await page.getByRole('button', {name: 'Restar una'}).first().click();
    await page.click('#quoteShipping');
    await waitText(page, '#totals .final', '$1,538 MXN');
    await page.route('https://checkout.stripe.com/**', route => route.fulfill({
      contentType: 'text/html', body: '<h1>Stripe simulado</h1><a href="' + base + '/?pago=' + checkoutSession + '">Confirmar prueba</a>'
    }));
    await page.click('#payOrder');
    await page.getByRole('heading', {name: 'Stripe simulado'}).waitFor();
    assert.deepEqual(incomingCheckout.items, [{id: 0, size: 'S', qty: 2}, {id: 4, size: 'XL', qty: 2}]);
    assert.equal(incomingCheckout.destination.area_level3, 'San Ángel');
    assert.equal(incomingCheckout.total, undefined);
    await page.getByRole('link', {name: 'Confirmar prueba'}).click();
    await waitText(page, '#paymentStatus', 'TEST12345678');
    await waitText(page, '#cartItems', 'Tu carrito está vacío');
    assert.deepEqual(errors, []);
    assert.equal(new URL(page.url()).searchParams.has('pago'), false);
  } finally {
    await page.close();
  }
});

test('Chromium escritorio: CP desconocido, varias colonias, error de tarifas y cambio de destino', async () => {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  try {
    await page.goto(base);
    await selectProduct(page, 1, 'M', 1);
    await page.click('#navCart');
    await page.selectOption('#delivery', 'Envío nacional');
    await page.fill('#zipCode', '00000');
    await waitText(page, '#postalStatus', 'no aparece');
    assert.equal(await page.locator('#neighborhood').isDisabled(), true);
    await page.fill('#zipCode', '64000');
    await page.waitForFunction(() => document.querySelectorAll('#postalColonies option').length === 2);
    assert.equal(await page.inputValue('#state'), 'Nuevo León');
    await page.fill('#neighborhood', 'Col. Inventada');
    await page.click('#quoteShipping');
    await waitText(page, '#shippingStatus', 'selecciona una colonia');
    await page.fill('#neighborhood', 'La Finca');
    await page.click('#quoteShipping');
    await waitText(page, '#shippingStatus', 'No hay una tarifa');
    assert.equal(await page.locator('#payOrder').isDisabled(), true);
    await page.fill('#neighborhood', 'monterrey centro');
    await page.click('#quoteShipping');
    await waitText(page, '#totals .final', '$539 MXN');
    await page.fill('#zipCode', '76099');
    await page.waitForFunction(() => document.querySelector('#state').value === 'Querétaro');
    assert.equal(await page.locator('#payOrder').isDisabled(), true);
    assert.equal(await page.inputValue('#neighborhood'), '');
    await waitText(page, '#totals .final', 'Por confirmar');
  } finally {
    await page.close();
  }
});
