// floot:external
import {sql} from 'kysely';
import {db} from './db';
import {schema, payload} from '../endpoints/tarsi_web_order_POST.schema';
import {notifyOrder} from './webOrderMail';
import type {z} from 'zod';


type Row = {id:string; status:string; number:string; requestDigest:string; payload:string};

export async function persistWebOrder(input: z.infer<typeof schema>, isTest: boolean) {
  const row = await db.transaction().execute(async trx => {
    if (input.action === 'create') {
      const inserted = await sql<{id: string}>`
        INSERT INTO tarsi_web_orders (idempotency_key, request_digest, payload, is_test)
        VALUES (${input.key}::uuid, ${input.digest}, ${JSON.stringify(input.order)}::text::jsonb, ${isTest})
        ON CONFLICT (is_test, idempotency_key) DO NOTHING RETURNING id
      `.execute(trx);
      if (inserted.rows[0]) {
        await sql`INSERT INTO tarsi_web_order_history (order_id, status)
          VALUES (${inserted.rows[0].id}::uuid, 'Pendiente de pago')`.execute(trx);
      }
    }
    const result = await sql<Row>`SELECT id, number, status, request_digest, payload::text AS payload FROM tarsi_web_orders
      WHERE idempotency_key = ${input.key}::uuid AND is_test = ${isTest}`.execute(trx);
    return result.rows[0];
  });
  if (!row) return {receipt: null};
  if ('digest' in input && row.requestDigest !== input.digest) return {conflict:true as const, receipt:null};
  const order = JSON.parse(row.payload) as z.infer<typeof payload>;
  const {items, subtotal, shipping, total, discount, carrier, service, delivery} = order;
  const notification = input.action === 'notify' ? await notifyOrder(row.id, row.number, isTest, order).catch(() => 'retry') : undefined;
  return {receipt: {number: row.number, items, subtotal, shipping, total, discount, carrier, service, delivery, status: row.status}, notification};
}
