import {sql} from 'kysely';
import {db} from '../helpers/db';
import {getServerUserSession} from '../helpers/getServerUserSession';
import {schema, transitions} from './tarsi_web_admin_POST.schema';

function json(value: unknown, status = 200) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
}

export async function handle(request: Request) {
  const session = await getServerUserSession(request).catch(() => null);
  if (session?.user.role !== 'admin') return json({error: 'Acceso reservado a administradores'}, 403);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({error: 'Origen no autorizado'}, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({error: 'Solicitud inválida'}, 400);
  const input = parsed.data;
  if (input.action === 'list') {
    const orders = await sql<{details: string; history: string | null}>`SELECT o.id, o.number, o.created_at, o.status, o.paid_at, o.tracking,
      (o.payload - 'skydropx')::text AS details,
      (SELECT jsonb_agg(jsonb_build_object('status', h.status, 'date', h.changed_at, 'actorId', h.actor_id)
        ORDER BY h.id) FROM tarsi_web_order_history h WHERE h.order_id = o.id)::text AS history
      FROM tarsi_web_orders o WHERE o.is_test = ${input.test}
      ORDER BY o.created_at DESC LIMIT 100`.execute(db);
    const result = await sql<{revenue: number; paid: number}>`SELECT
      coalesce(sum((payload->>'total')::integer), 0)::float8 AS revenue, count(*)::integer AS paid
      FROM tarsi_web_orders WHERE NOT is_test AND paid_at IS NOT NULL`.execute(db);
    return json({orders: orders.rows.map(row => ({...row, details: JSON.parse(row.details), history: row.history ? JSON.parse(row.history) : []})), ...result.rows[0]});
  }
  if (!transitions[input.expected].includes(input.status) || (input.status === 'Enviado' && !input.tracking)) {
    return json({error: 'Transición inválida o falta la guía'}, 400);
  }
  const changed = await db.transaction().execute(async trx => {
    const result = await sql`UPDATE tarsi_web_orders SET status = ${input.status},
      paid_at = CASE WHEN ${input.status} = 'Pagado' THEN now() ELSE paid_at END,
      tracking = CASE WHEN ${input.status} = 'Enviado' THEN ${input.tracking ?? null} ELSE tracking END
      WHERE id = ${input.id}::uuid AND status = ${input.expected} AND is_test = ${input.test} RETURNING id`.execute(trx);
    if (!result.rows.length) return false;
    await sql`INSERT INTO tarsi_web_order_history (order_id, status, actor_id)
      VALUES (${input.id}::uuid, ${input.status}, ${session.user.id})`.execute(trx);
    return true;
  });
  return changed ? json({ok: true}) : json({error: 'El pedido cambió. Actualiza la lista.'}, 409);
}
