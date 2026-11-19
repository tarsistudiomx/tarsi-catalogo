// floot:external
import {sql} from 'kysely';
import {db} from './db';
import {schema, payload} from '../endpoints/tarsi_web_order_POST.schema';
import {notifyOrder} from './webOrderMail';
import type {z} from 'zod';


export class StockUnavailable extends Error {}
export class InventoryNotReady extends Error {}

type Row = {id:string; status:string; number:string; requestDigest:string; payload:string; holdUntil:Date|null; recoverUntil:Date|null; revokedAt:Date|null; transferredOn:string|null; isFlow:boolean};

export async function persistWebOrder(input: z.infer<typeof schema>, isTest: boolean, flow = false) {
  const row = await db.transaction().execute(async trx => {
    if (input.action === 'create') {
      const inserted = await sql<{id: string}>`
        INSERT INTO tarsi_web_orders (idempotency_key, request_digest, payload, is_test${flow ? sql`, number` : sql``})
        VALUES (${input.key}::uuid, ${input.digest}, ${JSON.stringify(input.order)}::text::jsonb, ${isTest}${flow ? sql`, (SELECT 'TARSI-' || lpad(n, greatest(6,length(n)), '0') FROM
          (SELECT nextval('tarsi_short_order_seq')::text AS n) numbered)` : sql``})
        ON CONFLICT (is_test, idempotency_key) DO NOTHING RETURNING id
      `.execute(trx);
      if (inserted.rows[0]) {
        const id=inserted.rows[0].id;
        if (flow) {
          const policy=await sql<{enabled:boolean}>`SELECT enabled FROM tarsi_blank_policy WHERE is_test=${isTest} FOR SHARE`.execute(trx);
          if (!policy.rows[0]?.enabled) throw new InventoryNotReady();
          await sql`INSERT INTO tarsi_order_flow(order_id) VALUES (${id}::uuid)`.execute(trx);
          const inventory=await sql<{ok:boolean}>`SELECT tarsi_allocate_blanks(${id}::uuid,false) AS ok`.execute(trx);
          if (!inventory.rows[0]?.ok) throw new StockUnavailable();
          await sql`INSERT INTO tarsi_mail_outbox(order_id,kind,due_at) VALUES
            (${id}::uuid,'registered',now()),(${id}::uuid,'reminder',now()+interval '20 minutes')`.execute(trx);
        }
        await sql`INSERT INTO tarsi_web_order_history (order_id, status)
          VALUES (${inserted.rows[0].id}::uuid, 'Pendiente de pago')`.execute(trx);
      }
    }
    const result = await sql<Row>`SELECT o.id,o.number,o.status,o.request_digest,o.payload::text AS payload,
      f.hold_until,f.recover_until,f.revoked_at,r.transferred_on::text,f.order_id IS NOT NULL AS is_flow
      FROM tarsi_web_orders o LEFT JOIN tarsi_order_flow f ON f.order_id=o.id
      LEFT JOIN tarsi_transfer_reports r ON r.order_id=o.id
      WHERE o.idempotency_key=${input.key}::uuid AND o.is_test=${isTest}
      AND (f.order_id IS NULL OR (f.revoked_at IS NULL AND f.recover_until>now()))`.execute(trx);
    return result.rows[0];
  });
  if (!row) return {receipt: null};
  if ('digest' in input && row.requestDigest !== input.digest) return {conflict:true as const, receipt:null};
  const order = JSON.parse(row.payload) as z.infer<typeof payload>;
  const {items, subtotal, shipping, total, discount, carrier, service, delivery} = order;
  const notification = input.action === 'notify' ? await notifyOrder(row.id, row.number, isTest, order).catch(() => 'retry') : undefined;
  return {receipt: {number: row.number, items, subtotal, shipping, total, discount, carrier, service, delivery, status: row.status, holdUntil: row.holdUntil, isFlow: row.isFlow, reported: Boolean(row.transferredOn)}, notification};
}
