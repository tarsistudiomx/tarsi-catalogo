import { getServerUserSession } from "../../helpers/getServerUserSession";
import { handleGoogleAuthorize } from "@floot/google-integrations";

export async function handle(request: Request): Promise<Response> {
  try {
    const {user} = await getServerUserSession(request);
    if (user.role !== 'admin') return new Response('Acceso denegado', {status:403});
  } catch {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return handleGoogleAuthorize(request);
}
