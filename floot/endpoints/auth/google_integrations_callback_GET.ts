import { getServerUserSession } from "../../helpers/getServerUserSession";
import {
  finalizeGoogleConnection,
  renderConnectionPopup,
} from "@floot/google-integrations";
import { db } from "../../helpers/db";

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const relay = request.headers.get('x-tarsi-oauth-return') === '1';
  try {
    const {user} = await getServerUserSession(request);
    if (user.role !== 'admin') return new Response('Acceso denegado', {status:403});
  } catch {
    const code = url.searchParams.get('connection_code');
    if (relay || !code || code.length > 4096) return new Response('Inicia sesión en TARSI y vuelve a conectar Gmail.', {status:401});
    const data = JSON.stringify({type:'TARSI_GOOGLE_RETURN', code}).replace(/</g, '\\u003c');
    const target = JSON.stringify(url.origin).replace(/</g, '\\u003c');
    return new Response('<!doctype html><meta charset="utf-8"><p>Regresa al Dashboard para finalizar la conexión de Gmail.</p><script>if(window.opener)window.opener.postMessage('+data+','+target+')</script>', {
      headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}
    });
  }

  const code = url.searchParams.get("connection_code");
  const error = url.searchParams.get("error");

  if (error) {
    return renderConnectionPopup({ type: "GOOGLE_INTEGRATION_ERROR", error });
  }

  if (!code) {
    return renderConnectionPopup({
      type: "GOOGLE_INTEGRATION_ERROR",
      error: "missing_connection_code",
    });
  }

  let connection;
  try {
    connection = await finalizeGoogleConnection(db, { code });
  } catch (e) {
    return renderConnectionPopup({
      type: "GOOGLE_INTEGRATION_ERROR",
      error: "connection_failed",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  if (relay) return Response.json({email:connection.email}, {headers:{'Cache-Control':'no-store'}});
  return renderConnectionPopup({
    type: "GOOGLE_INTEGRATION_SUCCESS",
    email: connection.email,
    scopes: connection.scopes,
  });
}
