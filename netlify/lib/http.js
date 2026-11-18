'use strict';

const {connectLambda} = require('@netlify/blobs');

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function endpoint(methods, handle, {webhook = false} = {}) {
  return async (event, context) => {
    const origin = event.headers?.origin ?? event.headers?.Origin;
    const requestOrigin = event.rawUrl && new URL(event.rawUrl).origin;
    const allowedOrigin = origin && [requestOrigin, process.env.TARSI_SITE_URL,
      'https://tarsistudiomx.github.io'].includes(origin);
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Vary': 'Origin'
    };
    if (allowedOrigin && !webhook) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = [...methods, 'OPTIONS'].join(', ');
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
    }
    const respond = (statusCode, data) => ({
      statusCode, headers, body: data === undefined ? '' : JSON.stringify(data)
    });
    if (origin && !allowedOrigin && !webhook) return respond(403, {error: 'Origen no autorizado.'});
    if (event.httpMethod === 'OPTIONS' && !webhook) return respond(204);
    if (!methods.includes(event.httpMethod)) return respond(405, {error: 'Método no permitido.'});
    try {
      if (event.blobs) connectLambda(event);
      const result = await handle(event, context);
      return respond(result.status || 200, result.data);
    } catch (error) {
      if (error instanceof HttpError) return respond(error.status, {code: error.code, error: error.message});
      console.error('TARSI function error', {type: error.type || error.name, code: error.code});
      return respond(502, {code: 'SERVICE_ERROR', error: 'El servicio no está disponible. Intenta nuevamente.'});
    }
  };
}

function readBody(event) {
  try {
    const data = JSON.parse(event.body || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Solicitud inválida.');
  }
}

module.exports = {HttpError, endpoint, readBody};
