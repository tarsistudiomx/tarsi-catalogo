// floot:external
import {sql} from 'kysely';
import {db} from '../helpers/db';
import {sourceFor} from '../helpers/webOrderAccess';
import {schema, payload} from './tarsi_web_order_POST.schema';
import type {z} from 'zod';

export const flootPreviewPublic = true;
export const flootPublic = true;
type Row = {number: string; request_digest: string; payload: z.infer<typeof payload>};

function json(value: unknown, status = 200) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
}

export async function handle(request: Request) {
  const isTest = sourceFor(request);
  if (isTest === null) return json({error: 'Acceso no autorizado'}, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({error: 'Pedido inválido'}, 400);
  const input = parsed.data;
  const row = await db.transaction().execute(async trx => {
    if (input.action === 'create') {
      const inserted = await sql<{id: string}>`
        INSERT INTO tarsi_web_orders (idempotency_key, request_digest, payload, is_test)
        VALUES (${input.key}::uuid, ${input.digest}, ${JSON.stringify(input.order)}::jsonb, ${isTest})
        ON CONFLICT (is_test, idempotency_key) DO NOTHING RETURNING id
      `.execute(trx);
      if (inserted.rows[0]) {
        await sql`INSERT INTO tarsi_web_order_history (order_id, status)
          VALUES (${inserted.rows[0].id}::uuid, 'Pendiente de pago')`.execute(trx);
      }
    }
    const result = await sql<Row>`SELECT number, request_digest, payload FROM tarsi_web_orders
      WHERE idempotency_key = ${input.key}::uuid AND is_test = ${isTest}`.execute(trx);
    return result.rows[0];
  });
  if (!row) return json({receipt: null});
  if (row.request_digest !== input.digest) return json({error: 'Conflicto de idempotencia'}, 409);
  const {items, subtotal, shipping, total} = row.payload;
  return json({receipt: {number: row.number, items, subtotal, shipping, total, status: 'Pendiente de pago'}});
}
