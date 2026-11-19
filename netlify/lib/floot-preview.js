'use strict';

const {HttpError} = require('./http');
const target = 'https://66f62c32-15c0-4546-ba6e-bce0efe72d71.sandbox.floot.app/_api/tarsi_preview_checkout';

function useFlootPreview(event) {
  return event.rawUrl && new URL(event.rawUrl).hostname === 'deploy-preview-6--tarsi-skydropx.netlify.app';
}

async function flootPreview(body, mode, fetcher = fetch) {
  try {
    const response = await fetcher(target, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Tarsi-Preview': 'checkout-v1'},
      body: JSON.stringify({...body, mode}), redirect: 'error', signal: AbortSignal.timeout(25000)
    });
    return {status: response.status, data: await response.json()};
  } catch {
    throw new HttpError(503, 'PREVIEW_UNAVAILABLE', 'Por ahora no pudimos completar la prueba. Tu carrito sigue guardado.');
  }
}

module.exports = {useFlootPreview, flootPreview};
