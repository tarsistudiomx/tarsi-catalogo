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
const routes = {
  'postal-code': postalHandler(catalog),
  'shipping-quote': shippingHandler({env, catalog, async sky(origin, address) {
    if (address.area_level3 === 'La Finca') throw new HttpError(503, 'RATES_UNUSABLE', 'No hay una tarifa a domicilio disponible.');
    return {quotationId: 'browser-q', rateId: 'r-1', customerPrice: 140, days: 2, carrier: 'FedEx', service: 'Priority'};
  }})
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

test('Chromium móvil: catálogo, carrito mixto, dirección canónica, costo y pedido por correo', async () => {
  const page = await browser.newPage({viewport: {width: 390, height: 844}, reducedMotion: 'reduce'});
  try {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    assert.equal(await page.locator('.product').count(), 13);
    const urban = page.locator('.product').filter({hasText: 'Spider-Man urbano'});
    await urban.scrollIntoViewIfNeeded();
    await urban.locator('img').evaluate(image => image.decode());
    assert.match(await urban.locator('img').getAttribute('src'), /playera-13\.png$/);
    const logoLoaded = await page.locator('.logo').evaluate(image => image.complete && image.naturalWidth > 0);
    assert.equal(logoLoaded, true);
    await page.locator('button[data-open="0"]').click();
    await page.click('#detailZoom');
    assert.equal(await page.getAttribute('#detailZoom', 'aria-pressed'), 'true');
    assert.equal(await page.locator('#detailImg.is-zoomed').count(), 1);
    await page.click('#next');
    assert.equal(await page.getAttribute('#detailZoom', 'aria-pressed'), 'false');
    await page.click('#detailClose');
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
    await waitText(page, '#shippingStatus', 'FedEx Priority');
    await waitText(page, '#shippingStatus', '2 días hábiles');
    await page.getByRole('button', {name: 'Sumar una'}).first().click();
    await waitText(page, '#totals .final', 'Por confirmar');
    await waitText(page, '#totals', '$1,698 MXN');
    await page.getByRole('button', {name: 'Restar una'}).first().click();
    await page.click('#quoteShipping');
    await waitText(page, '#totals .final', '$1,538 MXN');
    assert.equal(await page.locator('#orderActions :is(button, a)').count(), 3);
    await page.click('#shareOrder');
    await waitText(page, '#shareDialog', 'COMPARTE TU PEDIDO.');
    assert.equal(await page.locator('#shareDialog a').getAttribute('href'), 'https://www.instagram.com/tarsi.mx/');
    assert.deepEqual(errors, []);
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
    await waitText(page, '#totals .final', 'Por confirmar');
    await page.fill('#neighborhood', 'monterrey centro');
    await page.click('#quoteShipping');
    await waitText(page, '#totals .final', '$539 MXN');
    await page.fill('#zipCode', '76099');
    await page.waitForFunction(() => document.querySelector('#state').value === 'Querétaro');
    await waitText(page, '#totals .final', 'Por confirmar');
    assert.equal(await page.inputValue('#neighborhood'), '');
    await waitText(page, '#totals .final', 'Por confirmar');
  } finally {
    await page.close();
  }
});

test('Checkout móvil: datos incompletos, doble clic, red, reintento, confirmación y enlaces', async () => {
  const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  const requests = [];
  try {
    await page.route('**/.netlify/functions/submit-order', async route => {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (!body.recover && !body.customer?.name) return route.fulfill({status: 400, json: {error: 'Revisa tu nombre.'}});
      if (requests.length === 2) return route.abort('failed');
      return route.fulfill({json: {number: 'TARSI-PRUEBA', status: 'Pendiente de pago',
        items: [{name: 'The Amazing Spider-Man', size: 'M', qty: 1}], subtotal: 399, shipping: 140, total: 539,
        notification: body.notify ? 'retry' : undefined, transfer: {bank: 'Banco de prueba', holder: 'Titular de prueba', clabe: '000000000000000000'}}});
    });
    await page.goto(base);
    await selectProduct(page, 0, 'M', 1);
    await page.click('#navCart');
    await page.click('#submitOrder');
    await waitText(page, '#orderStatus', 'Revisa tu nombre');
    await page.fill('#buyer', 'Cliente de prueba');
    await page.fill('#phone', '5555550000');
    await page.selectOption('#delivery', 'Envío nacional');
    await page.fill('#zipCode', '01000');
    await page.waitForFunction(() => document.querySelector('#state').value === 'Ciudad de México');
    await page.fill('#neighborhood', 'San Ángel');
    await page.fill('#street', 'Calle de prueba 123');
    await page.click('#quoteShipping');
    await waitText(page, '#totals .final', '$539 MXN');
    await page.locator('#submitOrder').evaluate(button => {button.click(); button.click();});
    await waitText(page, '#orderStatus', 'Reintenta con los mismos datos');
    assert.equal(requests.length, 2);
    assert.equal(await page.locator('.cart-line').count(), 1);
    await page.click('#submitOrder');
    await waitText(page, '#orderConfirmation', '¡TU PEDIDO FUE RECIBIDO!');
    assert.equal(requests.length, 3);
    assert.equal(requests[1].key, requests[2].key);
    assert.equal(await page.locator('.cart-line').count(), 0);
    assert.match(await page.locator('#orderReceipt').innerText(), /TARSI-PRUEBA[\s\S]*Pendiente de pago[\s\S]*\$539 MXN/);
    assert.equal(await page.locator('#proofInstagram').getAttribute('href'), 'https://www.instagram.com/tarsi.mx/');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', {value: undefined, configurable: true});
      Object.defineProperty(navigator, 'clipboard', {value: {writeText: value => {window.copied = value;}}, configurable: true});
    });
    await page.click('#copyOrderNumber');
    assert.equal(await page.evaluate(() => window.copied), 'TARSI-PRUEBA');
    await page.click('#shareReceipt');
    await page.click('#copySummary');
    await waitText(page, '#shareStatus', 'Resumen copiado.');
    const copied = await page.evaluate(() => window.copied);
    assert.match(copied, /TARSI-PRUEBA/);
    assert.doesNotMatch(copied, /SKYDROPX|5555550000/);
    await page.locator('#shareDialog button').first().click();
    await page.click('#emailReceipt');
    await waitText(page, '#notificationStatus', 'Vuelve a intentar el correo');
    assert.equal(requests[3].key, requests[2].key);
    assert.equal(requests[3].notify, true);
    await page.reload();
    await page.click('#navCart');
    await page.click('#recoverOrder');
    await waitText(page, '#orderConfirmation', '¡TU PEDIDO FUE RECIBIDO!');
    assert.equal(requests[4].key, requests[2].key);
    assert.equal(requests[4].recover, true);
    assert.equal(await page.locator('#cartOverlay .modal').evaluate(modal => modal.scrollWidth <= modal.clientWidth), true);
  } finally {
    await page.close();
  }
});

test('Navegador y sandbox Floot: entrega local, aviso y ventana bancaria', {
  skip: process.env.TARSI_TEST_LIVE_CHECKOUT !== '1'
}, async () => {
  const {createHandler: orderHandler} = require('../netlify/functions/submit-order');
  const configured = Object.fromEntries([
    'TARSI_DASHBOARD_TOKEN', 'TARSI_QUOTE_SECRET', 'TARSI_BANK_NAME', 'TARSI_BANK_HOLDER', 'TARSI_BANK_CLABE'
  ].map(key => [key, process.env[key]]));
  const submit = orderHandler({catalog, env: {
    ...configured,
    TARSI_DASHBOARD_URL: 'https://66f62c32-15c0-4546-ba6e-bce0efe72d71.sandbox.floot.app/_api/tarsi_web_order'
  }});
  const page = await browser.newPage({viewport: {width: 768, height: 1024}});
  try {
    await page.route('**/.netlify/functions/submit-order', async route => {
      const source = event('POST', {body: route.request().postData()});
      source.rawUrl = route.request().url();
      const response = await submit(source);
      await route.fulfill({status: response.statusCode, headers: response.headers, body: response.body});
    });
    await page.goto(base);
    await selectProduct(page, 0, 'M', 1);
    await page.click('#navCart');
    await page.fill('#buyer', 'PRUEBA BROWSER TARSI');
    await page.fill('#phone', '5555550000');
    await page.selectOption('#delivery', 'Entrega en Querétaro');
    await page.fill('#zipCode', '76099');
    await page.waitForFunction(() => !document.querySelector('#neighborhood').disabled);
    await page.fill('#neighborhood', 'Plazas del Sol 2a Sección');
    await page.fill('#street', 'Calle de prueba 123');
    await page.click('#emailOrder');
    await waitText(page, '#orderConfirmation', '¡TU PEDIDO FUE RECIBIDO!');
    await waitText(page, '#orderReceipt', 'Por cotizar el día de la entrega');
    await waitText(page, '#transferDetails', '$399 MXN');
    await waitText(page, '#notificationStatus', 'aceptó la notificación');
    const number = (await page.locator('#orderReceipt').innerText()).match(/TARSI-[A-F0-9]{32}/)?.[0];
    assert.ok(number);
    console.log('Pedido real de prueba registrado:', number);
  } finally {
    await page.close();
  }
});
