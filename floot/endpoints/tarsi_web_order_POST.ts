// floot:external
import {sourceFor} from '../helpers/webOrderAccess';
import {schema} from './tarsi_web_order_POST.schema';
import {persistWebOrder} from '../helpers/persistWebOrder';

export const flootPreviewPublic = true;
export const flootPublic = true;

function json(value: unknown, status = 200) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
}

export async function handle(request: Request) {
  const isTest = sourceFor(request);
  if (isTest === null) return json({error: 'Acceso no autorizado'}, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({error: 'Pedido inválido'}, 400);
  const result = await persistWebOrder(parsed.data, isTest);
  return result.conflict ? json({error: 'Conflicto de idempotencia'}, 409) : json(result);
}
