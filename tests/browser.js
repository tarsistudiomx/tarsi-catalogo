'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const {resolve, extname} = require('node:path');
const {createServer} = require('node:http');
const {chromium, webkit} = require('playwright');
const engine = process.env.TARSI_BROWSER === 'webkit' ? webkit : chromium;
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
  browser = await engine.launch(engine === chromium ? {
    executablePath: process.env.TARSI_CHROMIUM || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  } : {});
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

test(engine.name()+' móvil: catálogo, carrito mixto, dirección canónica, costo y pedido por correo', async () => {
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
    await page.fill('#buyerEmail', 'comprador@example.invalid');
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

test(engine.name()+' escritorio: CP desconocido, varias colonias, error de tarifas y cambio de destino', async () => {
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
      if (requests.length === 1) return route.abort('failed');
      return route.fulfill({json: {number: 'TARSI-PRUEBA', status: 'Pendiente de pago',
        items: [{name: 'The Amazing Spider-Man', size: 'M', qty: 1}], subtotal: 399, shipping: 140, total: 539,
        notification: body.notify ? 'retry' : undefined, transfer: {bank: 'Banco de prueba', holder: 'Titular de prueba', clabe: '000000000000000000'}}});
    });
    await page.goto(base);
    await selectProduct(page, 0, 'M', 1);
    await page.click('#navCart');
    await page.click('#submitOrder');
    await waitText(page, '#orderStatus', 'Revisa el formato de tu correo');
    assert.equal(requests.length, 0);
    await page.fill('#buyer', 'Cliente de prueba');
    await page.fill('#buyerEmail', 'comprador@example.invalid');
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
    assert.equal(requests.length, 1);
    assert.equal(await page.locator('.cart-line').count(), 1);
    await page.click('#submitOrder');
    await waitText(page, '#orderConfirmation', '¡TU PEDIDO FUE RECIBIDO!');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].key, requests[1].key);
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
    assert.equal(requests[2].key, requests[1].key);
    assert.equal(requests[2].notify, true);
    await page.reload();
    await page.click('#navCart');
    await page.click('#recoverOrder');
    await waitText(page, '#orderConfirmation', 'TU PEDIDO SIGUE AQUÍ');
    assert.equal(requests[3].key, requests[1].key);
    assert.equal(requests[3].recover, true);
    assert.equal(await page.locator('#cartOverlay .modal').evaluate(modal => modal.scrollWidth <= modal.clientWidth), true);
  } finally {
    await page.close();
  }
});

test('Checkout móvil v2: enlace en otro contexto, reserva vencida y reporte tardío', async () => {
  const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  const key = 'a5112529-9f7b-46bf-b94b-3a7cc76b3b15';
  let reported = false;
  let renewed = false;
  try {
    await page.route('**/.netlify/functions/submit-order', async route => {
      const body = route.request().postDataJSON();
      assert.equal(body.key,key);
      if (body.mode === 'report') {
        assert.equal(body.cents,39900);
        assert.equal(body.reference,'TEST12345');
        reported = true;
        return route.fulfill({json:{reported:true}});
      }
      if (body.mode === 'renew') renewed = true;
      return route.fulfill({json:{number:'TARSI-000001',status:reported?'Pago por verificar':'Pendiente de pago',
        isFlow:true,inventoryActive:true,reported,holdUntil:new Date(Date.now()+(renewed?120000:-80000)).toISOString(),
        items:[{name:'The Amazing Spider-Man',size:'M',qty:1}],subtotal:399,shipping:0,total:399,
        transfer:renewed&&!reported?{bank:'Prueba',holder:'Titular de prueba',clabe:'000000000000000000'}:null}});
    });
    await page.goto(base+'/#pedido='+key);
    await waitText(page,'#orderConfirmation','TU PEDIDO SIGUE AQUÍ');
    assert.equal(new URL(page.url()).hash,'');
    assert.equal(await page.locator('#transferDetails').isVisible(),false);
    await waitText(page,'#holdStatus','Renueva antes de transferir');
    await page.reload();
    await page.click('#resumePurchaseButton');
    await waitText(page,'#orderConfirmation','TU PEDIDO SIGUE AQUÍ');
    await waitText(page,'#holdStatus','Renueva antes de transferir');
    await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{
      value:{writeText:async value=>{window.copied=value;}},configurable:true
    }));
    await page.click('#copyPaymentLink');
    await waitText(page,'#paymentLinkStatus','Enlace copiado');
    const savedLink = new URL(await page.evaluate(() => window.copied));
    assert.equal(savedLink.hash,'#pedido='+key);
    assert.equal(savedLink.search,'');
    assert.equal(new URL(page.url()).hash,'');
    await page.click('#renewReservation');
    await waitText(page,'#holdStatus','Reserva disponible');
    await page.click('#openReport');
    await page.locator('[name="bank"]').fill('Banco de prueba');
    await page.locator('[name="reference"]').fill('TEST12345');
    await page.locator('[name="date"]').fill(new Date().toISOString().slice(0,10));
    await page.locator('[name="amount"]').fill('399');
    await page.click('#transferReport button[type="submit"]');
    await waitText(page,'#orderConfirmation','TRANSFERENCIA REPORTADA');
    assert.equal(await page.locator('#transferDetails').isVisible(),false);
    assert.equal(await page.locator('#proofInstagram').isVisible(),true);
    assert.equal(await page.locator('#legacyReceiptActions').isVisible(),false);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      value: {writeText: async value => {window.copied = value;}}, configurable: true
    }));
    await page.click('#proofEmail');
    await waitText(page,'#proofCopyStatus','Correo copiado');
    assert.equal(await page.evaluate(() => window.copied),'tarsi.studiomx@gmail.com');
    await waitText(page,'#proofEmailDetails','Comprobante de pago · TARSI-000001');
    await page.click('#copyProofSubject');
    assert.equal(await page.evaluate(() => window.copied),'Comprobante de pago · TARSI-000001');
  } finally { await page.close(); }
});

test('Dos compras en el mismo navegador conservan folios y datos de transferencia separados', async () => {
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page = await context.newPage();
  const saved = new Map();
  const requestHandler = async route => {
    const body = route.request().postDataJSON();
    if (!body.recover) {
      const number = saved.size + 1;
      saved.set(body.key, {number:'TARSI-00000'+number,status:number===1?'Pendiente de pago':'Pagado',
        isFlow:true,inventoryActive:true,holdUntil:new Date(Date.now()+150000).toISOString(),
        items:[{name:'Playera de prueba',size:'M',qty:1}],subtotal:399,shipping:0,total:399,
        transfer:number===1?{bank:'Prueba',holder:'Prueba',clabe:'000000000000000000'}:null});
    }
    return route.fulfill({json:saved.get(body.key)});
  };
  try {
    await context.route('**/.netlify/functions/submit-order', requestHandler);
    for (const number of [1,2]) {
      await page.goto(base);
      await selectProduct(page,0,'M',1);
      await page.click('#navCart');
      await page.fill('#buyer','Cliente '+number);
      await page.fill('#buyerEmail','cliente'+number+'@example.invalid');
      await page.fill('#phone','5555550000');
      await page.click('#submitOrder');
      await waitText(page,'#orderIntro','TARSI-00000'+number);
    }
    assert.equal(saved.size,2);
    await page.reload();
    await page.click('#resumePurchaseButton');
    await waitText(page,'#savedOrdersDialog','MIS PEDIDOS');
    await page.getByRole('button',{name:'TARSI-000002'}).click();
    await waitText(page,'#orderIntro','TARSI-000002 · PAGO VERIFICADO');
    assert.equal(await page.locator('#transferDetails').isVisible(),false);
    await page.locator('#orderConfirmation form[method=dialog] button').click();
    await page.click('#resumePurchaseButton');
    await page.getByRole('button',{name:'TARSI-000001'}).click();
    await waitText(page,'#orderIntro','TARSI-000001');
    assert.equal(await page.locator('#transferDetails').isVisible(),true);
    await page.click('#openReport');
    await page.locator('[name=bank]').fill('Banco de prueba');
    await page.locator('#orderConfirmation form[method=dialog] button').click();
    await page.click('#resumePurchaseButton');
    await page.getByRole('button',{name:'TARSI-000001'}).click();
    await page.click('#openReport');
    assert.equal(await page.locator('[name=bank]').inputValue(),'');
    assert.equal(saved.size,2);
  } finally { await context.close(); }
});

test('Enlace de correo conserva el acceso en la pestaña y carga el folio correcto', async () => {
  const context = await browser.newContext();
  const key = 'dc6404ba-235a-45cd-8f2f-623faa99723b';
  try {
    await context.route('**/.netlify/functions/submit-order',route=>{
      assert.equal(route.request().postDataJSON().key,key);
      return route.fulfill({json:{number:'TARSI-000039',status:'Pagado',isFlow:true,items:[],subtotal:399,shipping:0,total:399}});
    });
    const page=await context.newPage();
    await page.goto(base+'/#pedido='+key);
    await waitText(page,'#orderIntro','TARSI-000039');
    await page.reload();
    await page.click('#resumePurchaseButton');
    await waitText(page,'#orderIntro','TARSI-000039');
    const anotherTab=await context.newPage();
    await anotherTab.goto(base);
    assert.equal(await anotherTab.locator('#resumePurchase').isVisible(),false);
  } finally { await context.close(); }
});

test('Navegador y sandbox Floot v2: entrega local, folio, ventana bancaria y reporte', {
  skip: process.env.TARSI_TEST_FLOOT_V2 !== '1'
}, async () => {
  const {createHandler: orderHandler} = require('../netlify/functions/submit-order');
  const submit = orderHandler({env: {}});
  const page = await browser.newPage({viewport: {width: 768, height: 1024}});
  try {
    await page.route('**/.netlify/functions/submit-order', async route => {
      const source = event('POST', {body: route.request().postData()});
      source.rawUrl = 'https://deploy-preview-7--tarsi-skydropx.netlify.app/.netlify/functions/submit-order';
      if (process.env.TARSI_TEST_NETLIFY_BLOBS_CONTEXT_FILE) {
        const {siteID,deployID,token}=JSON.parse(await readFile(process.env.TARSI_TEST_NETLIFY_BLOBS_CONTEXT_FILE,'utf8'));
        const {setEnvironmentContext}=require('@netlify/blobs');
        setEnvironmentContext({siteID,deployID,token});
      }
      const response = await submit(source);
      await route.fulfill({status: response.statusCode, headers: response.headers, body: response.body});
    });
    await page.goto(base);
    await selectProduct(page, 0, 'M', 1);
    await page.click('#navCart');
    await page.fill('#buyer', 'PRUEBA BROWSER TARSI');
    await page.fill('#buyerEmail', 'comprador@example.invalid');
    await page.fill('#phone', '5555550000');
    await page.selectOption('#delivery', 'Entrega en Querétaro');
    await page.fill('#zipCode', '76099');
    await page.waitForFunction(() => !document.querySelector('#neighborhood').disabled);
    await page.fill('#neighborhood', 'Plazas del Sol 2a Sección');
    await page.fill('#street', 'Calle de prueba 123');
    await page.click('#submitOrder');
    await waitText(page, '#orderConfirmation', '¡TU PEDIDO FUE RECIBIDO!');
    await page.click('#receiptSummary summary');
    await waitText(page, '#orderReceipt', 'Por cotizar el día de la entrega');
    await waitText(page, '#transferDetails', '$399 MXN');
    const number = (await page.locator('#orderReceipt').innerText()).match(/TARSI-\d{6,}/)?.[0];
    assert.ok(number);
    await page.click('#openReport');
    await page.locator('[name="bank"]').fill('Banco ficticio');
    await page.locator('[name="reference"]').fill('QABROWSER'+require('node:crypto').randomUUID().replaceAll('-',''));
    await page.locator('[name="date"]').fill(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
    await page.locator('[name="amount"]').fill('399');
    await page.click('#transferReport button[type="submit"]');
    await waitText(page,'#orderConfirmation','TRANSFERENCIA REPORTADA');
    await page.click('#proofEmail');
    await waitText(page,'#proofEmailDetails','Comprobante de pago · '+number);
    console.log('Pedido sintético registrado y reportado:', number);
  } finally {
    await page.close();
  }
});
