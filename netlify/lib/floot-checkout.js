'use strict';

const {HttpError} = require('./http');
const previewTarget = 'https://66f62c32-15c0-4546-ba6e-bce0efe72d71.sandbox.floot.app/_api/tarsi_preview_checkout';

const liveTarget = 'https://tarsi-control-ventas.floot.app/_api/tarsi_live_checkout_v2';
function storefrontMode(event) {
  if (!event.rawUrl) return null;
  const {hostname} = new URL(event.rawUrl);
  if (hostname === 'deploy-preview-6--tarsi-skydropx.netlify.app') return 'legacy-preview';
  if (/^deploy-preview-(?:[7-9]|[1-9]\d+)--tarsi-skydropx\.netlify\.app$/.test(hostname)) return 'preview';
  if (hostname === 'tarsi-skydropx.netlify.app') return 'live';
  return null;
}

async function flootCheckout(body, mode, deployment, fetcher = fetch) {
  try {
    const preview = deployment !== 'live';
    const legacy = deployment === 'legacy-preview';
    const key = preview ? process.env.TARSI_PREVIEW_STOREFRONT_KEY : process.env.TARSI_STOREFRONT_KEY;
    if (!legacy && !(key?.length >= 32)) throw new Error('Storefront key required');
    let target = preview ? previewTarget : liveTarget;
    if (deployment === 'preview') {
      const origin = new URL(process.env.TARSI_FLOOT_PREVIEW_ORIGIN ?? '');
      if (origin.protocol !== 'https:' || origin.port || origin.username || origin.password ||
          !/^[a-f0-9-]{36}\.sandbox\.floot\.app$/.test(origin.hostname)) throw new Error('Floot branch required');
      target = new URL('/_api/tarsi_preview_checkout_v2', origin);
    }
    const response = await fetcher(String(target), {
      method: 'POST',
      headers: {'Content-Type': 'application/json', ...(!legacy && {Authorization: 'Bearer ' + key}), ...(preview ? {'X-Tarsi-Preview': 'checkout-v1'} : {'X-Tarsi-Storefront': 'storefront-v1'})},
      body: JSON.stringify({...body, mode}), redirect: 'error', signal: AbortSignal.timeout(25000)
    });
    if ([401,403].includes(response.status)) throw new Error('Floot refused the integration');
    return {status: response.status, data: await response.json()};
  } catch {
    throw new HttpError(503, 'CHECKOUT_UNAVAILABLE', 'Por ahora no pudimos completar el pedido. Tu carrito sigue guardado.');
  }
}

module.exports = {storefrontMode, flootCheckout};
