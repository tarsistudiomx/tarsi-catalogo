import {sql} from 'kysely';
import {db} from '../helpers/db';
import {getServerUserSession} from '../helpers/getServerUserSession';
import {drainOrderMail} from '../helpers/orderFlowMail';
import {schema, transitions} from './tarsi_web_admin_POST.schema';

class NeedsInventory extends Error {}

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
    const orders = await sql<{details: string; adjustments: string | null; transferReport:string|null; mailHistory:string|null; history: string | null}>`SELECT o.id, o.number, o.created_at, o.status, o.paid_at, o.tracking, w.queued_at, w.estimated_from::text, w.estimated_until::text,
      w.started_at, w.prepared_at, w.dispatched_at, w.delivered_at, w.dispatch_carrier, w.delivery_note,
      f.hold_until, f.recover_until, f.last_issue, f.revoked_at,
      CASE WHEN r.order_id IS NULL THEN NULL ELSE jsonb_build_object('bank',r.bank,'reference',r.reference,
        'date',r.transferred_on,'cents',r.cents,'details',r.details,'reportedAt',r.reported_at)::text END AS transfer_report,
      p.reference AS payment_reference, p.amount_cents AS payment_cents, p.verified_by AS payment_actor, p.note AS payment_note,
      (o.payload - 'skydropx')::text AS details,
      (SELECT jsonb_agg(jsonb_build_object('kind',m.kind,'state',m.state,'attempts',m.attempts,
        'dueAt',m.due_at,'acceptedAt',m.accepted_at,'lastError',m.last_error) ORDER BY m.due_at,m.kind)
        FROM tarsi_mail_outbox m WHERE m.order_id=o.id)::text AS mail_history,
      (SELECT jsonb_agg(jsonb_build_object('cents', a.cents, 'reference', a.reference, 'reason', a.reason,
        'date', a.recorded_at, 'actorId', a.recorded_by) ORDER BY a.id DESC)
        FROM tarsi_order_adjustments a WHERE a.order_id=o.id)::text AS adjustments,
      (SELECT jsonb_agg(jsonb_build_object('status', h.status, 'date', h.changed_at, 'actorId', h.actor_id)
        ORDER BY h.id) FROM tarsi_web_order_history h WHERE h.order_id = o.id)::text AS history
      FROM tarsi_web_orders o
      LEFT JOIN tarsi_production_work w ON w.order_id = o.id
      LEFT JOIN tarsi_verified_payments p ON p.order_id = o.id
      LEFT JOIN tarsi_order_flow f ON f.order_id=o.id
      LEFT JOIN tarsi_transfer_reports r ON r.order_id=o.id
      WHERE o.is_test = ${input.test}
        ${input.search ? sql`AND (strpos(lower(o.number),lower(${input.search}))>0 OR
          strpos(lower(o.payload #>> '{customer,name}'),lower(${input.search}))>0)` : sql``}
        ${input.from ? sql`AND (o.created_at AT TIME ZONE 'America/Mexico_City')::date>=${input.from}::date` : sql``}
        ${input.to ? sql`AND (o.created_at AT TIME ZONE 'America/Mexico_City')::date<=${input.to}::date` : sql``}
        ${input.amount ? sql`AND (o.payload->>'total')::int=${input.amount}` : sql``}
        ${input.status ? sql`AND o.status=${input.status}` : sql``}
      ORDER BY o.created_at DESC LIMIT 100`.execute(db);
    const result = await sql<{revenue: number; paid: number}>`SELECT
      (coalesce(sum((o.payload->>'total')::integer * 100::bigint
        + coalesce((SELECT sum(a.cents) FROM tarsi_order_adjustments a WHERE a.order_id=o.id), 0)), 0) / 100.0)::float8 AS revenue,
      count(*)::integer AS paid FROM tarsi_web_orders o WHERE NOT o.is_test AND o.paid_at IS NOT NULL`.execute(db);
    return json({orders: orders.rows.map(row => ({...row, details: JSON.parse(row.details), transferReport: row.transferReport ? JSON.parse(row.transferReport) : null, adjustments: row.adjustments ? JSON.parse(row.adjustments) : [], history: row.history ? JSON.parse(row.history) : [], mailHistory: row.mailHistory ? JSON.parse(row.mailHistory) : []})), ...result.rows[0]});
  }
  const actor = session.user.id;
  const orderId = input.id;
  const outcome = await db.transaction().execute(async trx => {
    const result = await sql<{status: keyof typeof transitions; total: number; delivery: string; paid: boolean; isFlow:boolean; prepared: boolean}>`
      SELECT o.status, (o.payload->>'total')::integer AS total, o.payload->>'delivery' AS delivery,
        o.paid_at IS NOT NULL AS paid, EXISTS (SELECT 1 FROM tarsi_order_flow f WHERE f.order_id=o.id) AS is_flow, w.prepared_at IS NOT NULL AS prepared
      FROM tarsi_web_orders o LEFT JOIN tarsi_production_work w ON w.order_id=o.id
      WHERE o.id=${orderId}::uuid AND o.is_test=${input.test} FOR UPDATE OF o`.execute(trx);
    const order = result.rows[0];
    if (!order) return {error: 'Pedido no encontrado.', status: 404};
    async function history(status: string) {
      await sql`INSERT INTO tarsi_web_order_history (order_id,status,actor_id)
        VALUES (${orderId}::uuid,${status},${actor})`.execute(trx);
    }
    if(input.action==='issue'){
      if(order.isFlow) await sql`UPDATE tarsi_order_flow SET last_issue=${input.note} WHERE order_id=${orderId}::uuid`.execute(trx);
      await history('Discrepancia: '+input.note);
      return null;
    }
    if(input.action==='revoke-recovery'){
      if(!order.isFlow) return {error:'Este pedido histórico no tiene un enlace revocable.',status:409};
      await sql`UPDATE tarsi_order_flow SET revoked_at=coalesce(revoked_at,now()) WHERE order_id=${orderId}::uuid`.execute(trx);
      await sql`UPDATE tarsi_mail_outbox SET state='suppressed' WHERE order_id=${orderId}::uuid
        AND kind IN ('reminder','recovery') AND state IN ('pending','sending')`.execute(trx);
      await history('Enlace de recuperación revocado');
      return null;
    }
    if(input.action==='reissue-recovery'){
      if(!order.isFlow) return {error:'Este pedido histórico no admite reemisión.',status:409};
      const changed=await sql`UPDATE tarsi_order_flow SET recovery_key=gen_random_uuid(),revoked_at=NULL,
        recover_until=now()+interval '30 days' WHERE order_id=${orderId}::uuid
        AND (revoked_at IS NOT NULL OR recover_until<=now()) RETURNING order_id`.execute(trx);
      if(!changed.rows.length) return {error:'El enlace existente todavía está activo.',status:409};
      await sql`INSERT INTO tarsi_mail_outbox(order_id,kind,due_at) VALUES(${orderId}::uuid,'recovery',now())
        ON CONFLICT(order_id,kind) DO UPDATE SET due_at=now(),state='pending',attempts=0,claimed_at=NULL,claim_id=NULL,
          accepted_at=NULL,provider_id=NULL,last_error=NULL`.execute(trx);
      await history('Enlace de recuperación reemitido');
      return null;
    }
    if (input.action === 'adjust') {
      if (!order.paid) return {error: 'Primero confirma el pago del pedido.', status: 409};
      const referenceKey = input.reference.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (referenceKey.length < 3) return {error: 'Ingresa la referencia bancaria completa.', status: 400};
      const previous = (await sql<{cents:number; reason:string}>`SELECT cents,reason FROM tarsi_order_adjustments
        WHERE order_id=${orderId}::uuid AND reference_key=${referenceKey}`.execute(trx)).rows[0];
      const cents = input.kind === 'refund' ? -input.cents : input.cents;
      if (previous) return previous.cents === cents && previous.reason === input.reason ? null :
        {error: 'Ya existe otro movimiento con esa referencia.', status: 409};
      const balance = await sql<{adjustments:number}>`SELECT coalesce(sum(cents),0)::float8 AS adjustments
        FROM tarsi_order_adjustments WHERE order_id=${orderId}::uuid`.execute(trx);
      if (order.total * 100 + balance.rows[0].adjustments + cents < 0) {
        return {error: 'La devolución supera el saldo cobrado.', status: 422};
      }
      await sql`INSERT INTO tarsi_order_adjustments (order_id,reference_key,reference,cents,reason,recorded_by)
        VALUES (${orderId}::uuid,${referenceKey},${input.reference},${cents},${input.reason},${actor})`.execute(trx);
      await history(cents < 0 ? 'Devolución registrada' : 'Cobro adicional registrado');
      return null;
    }
    if (input.action === 'confirm-payment') {
      if (!['Pendiente de pago','Pago por verificar'].includes(order.status)) return {error: 'Este pago ya se procesó o el pedido se canceló.', status: 409};
      if (input.cents !== order.total * 100) return {error: 'El monto difiere del total. Resuelve la diferencia antes de confirmar.', status: 422};
      const key = input.reference.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (key.length < 3) return {error: 'Ingresa la referencia bancaria completa.', status: 400};
      await sql`SELECT pg_advisory_xact_lock(${input.test?912:911},hashtext(${key}))`.execute(trx);
      if((await sql`SELECT 1 FROM tarsi_transfer_reports WHERE is_test=${input.test} AND reference_key=${key}
        AND order_id<>${orderId}::uuid`.execute(trx)).rows.length)
        return {error:'La referencia está reportada en otro pedido. Revisa el depósito.',status:409};
      const payment = await sql`INSERT INTO tarsi_verified_payments
        (order_id,is_test,reference,reference_key,amount_cents,verified_at,verified_by,note)
        VALUES (${orderId}::uuid,${input.test},${input.reference},${key},${input.cents},now(),${actor},${input.note || null})
        ON CONFLICT DO NOTHING RETURNING order_id`.execute(trx);
      if (!payment.rows.length) return {error: 'La referencia bancaria ya se utilizó. Verifica el depósito.', status: 409};
      if(order.isFlow){
        const stock=(await sql<{ok:boolean}>`SELECT tarsi_allocate_blanks(${orderId}::uuid,true,${actor}) AS ok`.execute(trx)).rows[0];
        if(!stock?.ok) throw new NeedsInventory();
        await sql`INSERT INTO tarsi_mail_outbox(order_id,kind,due_at) VALUES(${orderId}::uuid,'confirmed',now()) ON CONFLICT DO NOTHING`.execute(trx);
        await sql`UPDATE tarsi_mail_outbox SET state='suppressed' WHERE order_id=${orderId}::uuid AND kind='reminder' AND state='pending'`.execute(trx);
        await sql`UPDATE tarsi_order_flow SET last_issue=NULL WHERE order_id=${orderId}::uuid`.execute(trx);
      }
      await sql`UPDATE tarsi_web_orders SET status='Pagado',paid_at=now() WHERE id=${orderId}::uuid`.execute(trx);
      await sql`INSERT INTO tarsi_production_work (order_id,queued_at,estimated_from,estimated_until)
        SELECT ${orderId}::uuid,now(),days[3],days[5] FROM (
          SELECT array_agg(day ORDER BY day) AS days FROM (
            SELECT (now() AT TIME ZONE 'America/Mexico_City')::date + n AS day
            FROM generate_series(1, 10) AS series(n)
            WHERE EXTRACT(ISODOW FROM (now() AT TIME ZONE 'America/Mexico_City')::date + n) < 6
          ) weekdays
        ) schedule`.execute(trx);
      await history('Pagado');
      return null;
    }
    if (input.action === 'prepare') {
      if (order.status !== 'En preparación' || order.prepared) return {error: 'El pedido debe estar en preparación.', status: 409};
      const prepared = await sql`UPDATE tarsi_production_work SET prepared_at=now() WHERE order_id=${orderId}::uuid RETURNING order_id`.execute(trx);
      if (!prepared.rows.length) return {error: 'Este pedido requiere revisión administrativa.', status: 409};
      await history('Preparado');
      return null;
    }
    if (order.status !== input.expected || !transitions[input.expected].includes(input.status)) return {error: 'El pedido cambió o la acción no está disponible.', status: 409};
    const local = order.delivery === 'Entrega en Querétaro';
    if (input.status === 'Enviado' && (!order.prepared || (!local && (!input.carrier || !input.tracking || !/^[\w .-]{4,100}$/.test(input.tracking))) || (local && !input.note))) {
      return {error: 'Completa la preparación y registra la paquetería y guía, o la evidencia de entrega local.', status: 400};
    }
    if (local && input.status === 'Entregado' && !input.note) return {error: 'Registra cómo confirmaste la entrega local.', status: 400};
    await sql`UPDATE tarsi_web_orders SET status=${input.status},
      tracking=CASE WHEN ${input.status}='Enviado' THEN ${local ? null : input.tracking ?? null} ELSE tracking END
      WHERE id=${orderId}::uuid`.execute(trx);
    await sql`UPDATE tarsi_production_work SET
      started_at=CASE WHEN ${input.status}='En preparación' THEN now() ELSE started_at END,
      dispatched_at=CASE WHEN ${input.status}='Enviado' THEN now() ELSE dispatched_at END,
      delivered_at=CASE WHEN ${input.status}='Entregado' THEN now() ELSE delivered_at END,
      dispatch_carrier=COALESCE(${input.carrier || null},dispatch_carrier),
      delivery_note=COALESCE(${input.note || null},delivery_note)
      WHERE order_id=${orderId}::uuid`.execute(trx);
    if(input.status==='Cancelado' && order.isFlow){
      await sql`UPDATE tarsi_order_flow SET hold_until=NULL WHERE order_id=${orderId}::uuid`.execute(trx);
      await sql`UPDATE tarsi_mail_outbox SET state='suppressed' WHERE order_id=${orderId}::uuid AND kind IN ('reminder','registered') AND state='pending'`.execute(trx);
    }
    await history(input.status);
    return null;
  }).catch(async error=>{
    if(!(error instanceof NeedsInventory)) throw error;
    await sql`UPDATE tarsi_order_flow f SET last_issue='Pago en revisión: no hay existencias suficientes'
      FROM tarsi_web_orders o WHERE f.order_id=o.id AND o.id=${orderId}::uuid AND o.paid_at IS NULL`.execute(db);
    return {error:'No hay existencias suficientes. El pago queda para resolver y no pasa a producción.',status:409};
  });
  if(!outcome && ['confirm-payment','reissue-recovery'].includes(input.action)) await drainOrderMail(input.test,orderId).catch(()=>{});
  return outcome ? json({error: outcome.error}, outcome.status) : json({ok:true});
}
