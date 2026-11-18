'use strict';

const {setTimeout: sleep} = require('node:timers/promises');
const {HttpError} = require('./http');

const hosts = {production: 'https://api-pro.skydropx.com', sandbox: 'https://sb-pro.skydropx.com'};
const available = new Set(['approved', 'price_found_internal', 'price_found_external']);
const parcelFor = quantity => ({length: 30, width: 25, height: 4 * quantity, weight: 350 * quantity / 1000});

function totalInCentavos(total) {
  if (!['string', 'number'].includes(typeof total)) return null;
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(total).trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return cents > 0 ? cents : null;
}

function shippingPrice(cents) {
  // Multiply both terms by five to calculate the 20% markup without floating-point rounding.
  return Math.ceil((cents * 5 + Math.max(cents, 15000)) / 5000) * 10;
}

function readQuotation(result) {
  const attributes = result?.data?.attributes ?? result;
  const rows = Array.isArray(result?.rates) ? result.rates :
    Array.isArray(result?.included) ? result.included.filter(row => row?.type === 'rate') : null;
  const status = attributes?.status;
  const completed = attributes?.is_completed === true || ['is_completed', 'completed'].includes(status);
  return {rows, completed, status};
}

function usableRates(rows) {
  return rows.flatMap(row => {
    const rate = row?.attributes ?? row;
    const cents = totalInCentavos(rate?.total);
    if (!cents || typeof row.id !== 'string' || !row.id || rate.success !== true ||
      rate.currency_code !== 'MXN' || !available.has(rate.status) || rate.office_delivery === true ||
      rate.requires_origin_verification === true) return [];
    return [{id: row.id, cents, days: Number.isInteger(rate.days) && rate.days > 0 ? rate.days : null}];
  }).sort((a, b) => a.cents - b.cents || (a.days ?? Infinity) - (b.days ?? Infinity));
}

function createSkydropx({env = process.env, fetcher = fetch, delay = sleep, now = Date.now} = {}) {
  let cachedToken;
  let authInFlight;

  return async function quote(origin, destination, quantity) {
    const host = hosts[env.SKYDROPX_ENV || 'production'];
    if (!host || !env.SKYDROPX_CLIENT_ID || !env.SKYDROPX_CLIENT_SECRET) {
      throw new HttpError(503, 'SKYDROPX_NOT_CONFIGURED', 'Las cotizaciones de envío aún no están disponibles.');
    }
    const deadline = now() + 22000;
    async function request(path, options, step) {
      const timeout = Math.min(4500, deadline - now());
      if (timeout <= 0) throw new HttpError(504, 'QUOTE_TIMEOUT', 'La cotización tardó demasiado. Intenta nuevamente.');
      let response;
      try {
        response = await fetcher(host + path, {...options, redirect: 'error', signal: AbortSignal.timeout(timeout)});
      } catch (error) {
        console.warn('Skydropx transport', {step, type: error.name});
        throw new HttpError(502, 'SKYDROPX_TRANSPORT', 'No se pudo contactar a Skydropx.');
      }
      if (!response.ok) {
        console.warn('Skydropx HTTP', {step, status: response.status});
        const failure = new HttpError(502, 'SKYDROPX_' + step, 'Skydropx no pudo procesar la cotización.');
        failure.upstream = response.status;
        throw failure;
      }
      try {
        return await response.json();
      } catch {
        throw new HttpError(502, 'SKYDROPX_RESPONSE', 'Skydropx devolvió una respuesta inválida.');
      }
    }

    async function token() {
      if (cachedToken?.until > now()) return cachedToken.value;
      authInFlight ??= (async () => {
        const data = await request('/api/v1/oauth/token', {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: new URLSearchParams({grant_type: 'client_credentials', client_id: env.SKYDROPX_CLIENT_ID,
            client_secret: env.SKYDROPX_CLIENT_SECRET})
        }, 'OAUTH');
        if (typeof data?.access_token !== 'string' || !data.access_token) {
          throw new HttpError(502, 'SKYDROPX_OAUTH', 'Skydropx no habilitó la cotización.');
        }
        cachedToken = {value: data.access_token, until: now() + Math.max(0, Number(data.expires_in || 0) - 60) * 1000};
        return data.access_token;
      })().finally(() => { authInFlight = undefined; });
      return authInFlight;
    }

    async function authorized(path, options, step) {
      let accessToken = await token();
      const send = () => request(path, {...options,
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken}}, step);
      try {
        return await send();
      } catch (error) {
        if (error.upstream !== 401) throw error;
        if (cachedToken?.value === accessToken) cachedToken = undefined;
        accessToken = await token();
        return send();
      }
    }

    const created = await authorized('/api/v1/quotations', {
      method: 'POST',
      body: JSON.stringify({quotation: {address_from: origin, address_to: destination, parcels: [parcelFor(quantity)]}})
    }, 'CREATE');
    const id = created?.id ?? created?.quotation_id ?? created?.data?.id ?? created?.data?.attributes?.quotation_id;
    if (typeof id !== 'string' || !id) {
      throw new HttpError(502, 'SKYDROPX_RESPONSE', 'Skydropx no identificó la cotización.');
    }

    for (let attempt = 0; attempt < 12 && now() < deadline; attempt++) {
      if (attempt) await delay(Math.min(attempt < 4 ? 900 : 1700, Math.max(0, deadline - now())));
      if (now() >= deadline) break;
      let result;
      try {
        result = await authorized('/api/v1/quotations/' + encodeURIComponent(id), {}, 'POLL');
      } catch (error) {
        const status = error.upstream;
        if (status === 429 || status === 404 || status >= 500 || error.code === 'SKYDROPX_TRANSPORT') continue;
        throw error;
      }
      const {rows, completed, status} = readQuotation(result);
      if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
        throw new HttpError(502, 'QUOTE_FAILED', 'Skydropx no pudo completar la cotización.');
      }
      if (!completed) continue;
      if (!rows) throw new HttpError(502, 'SKYDROPX_RESPONSE', 'Skydropx devolvió una cotización inválida.');
      const selected = usableRates(rows)[0];
      if (selected) return {quotationId: id, rateId: selected.id,
        customerPrice: shippingPrice(selected.cents), days: selected.days};
      console.warn('Skydropx sin tarifa válida', {
        quotationId: id, count: rows.length,
        statuses: [...new Set(rows.map(row => (row?.attributes ?? row)?.status))].slice(0, 12)
      });
      throw new HttpError(503, rows.length ? 'RATES_UNUSABLE' : 'RATES_EMPTY',
        'No hay una tarifa a domicilio disponible para esa dirección.');
    }
    throw new HttpError(504, 'QUOTE_TIMEOUT', 'La cotización tardó demasiado. Intenta nuevamente.');
  };
}

module.exports = {createSkydropx, parcelFor, shippingPrice, usableRates};
