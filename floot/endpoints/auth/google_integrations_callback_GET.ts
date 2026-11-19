import { getServerUserSession } from "../../helpers/getServerUserSession";
import {
  finalizeGoogleConnection,
  renderConnectionPopup,
} from "@floot/google-integrations";
import { db } from "../../helpers/db";

export async function handle(request: Request): Promise<Response> {
  try {
    const {user} = await getServerUserSession(request);
    if (user.role !== 'admin') return new Response('Acceso denegado', {status:403});
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
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

  return renderConnectionPopup({
    type: "GOOGLE_INTEGRATION_SUCCESS",
    email: connection.email,
    scopes: connection.scopes,
  });
}
