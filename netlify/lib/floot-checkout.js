'use strict';

const {HttpError} = require('./http');
const previewTarget = 'https://66f62c32-15c0-4546-ba6e-bce0efe72d71.sandbox.floot.app/_api/tarsi_preview_checkout';

const liveTarget = 'https://tarsi-control-ventas.floot.app/_api/tarsi_live_checkout';
function storefrontMode(event) {
  if (!event.rawUrl) return null;
  const {hostname} = new URL(event.rawUrl);
  if (hostname === 'deploy-preview-6--tarsi-skydropx.netlify.app') return 'preview';
  if (hostname === 'tarsi-skydropx.netlify.app') return 'live';
  return null;
}

async function flootCheckout(body, mode, deployment, fetcher = fetch) {
  try {
    const preview = deployment === 'preview';
    const response = await fetcher(preview ? previewTarget : liveTarget, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', ...(preview ? {'X-Tarsi-Preview': 'checkout-v1'} : {'X-Tarsi-Storefront': 'storefront-v1'})},
      body: JSON.stringify({...body, mode}), redirect: 'error', signal: AbortSignal.timeout(25000)
    });
    return {status: response.status, data: await response.json()};
  } catch {
    throw new HttpError(503, 'CHECKOUT_UNAVAILABLE', 'Por ahora no pudimos completar el pedido. Tu carrito sigue guardado.');
  }
}

module.exports = {storefrontMode, flootCheckout};
