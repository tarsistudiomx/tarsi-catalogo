import {getGoogleAccessToken} from '@floot/google-integrations';
import {sql} from 'kysely';
import {db} from './db';
import type {z} from 'zod';
import type {payload} from '../endpoints/tarsi_web_order_POST.schema';

export async function notifyOrder(id: string, number: string, test: boolean, order: z.infer<typeof payload>) {
  const {customer, items, address, delivery, carrier, service, subtotal, shipping, total} = order;
  const body = [
    test ? 'PEDIDO DE PRUEBA' : 'Nuevo pedido TARSI', number, 'Estado al registrar: Pendiente de pago',
    customer.name, customer.phone, customer.email,
    [address.street, address.area_level3, address.area_level2, address.area_level1, address.postal_code].join(', '),
    [delivery, carrier, service].filter(Boolean).join(' · '),
    ...items.map(item => `${item.name} · ${item.size} × ${item.qty}`),
    `Subtotal: $${subtotal} MXN`, delivery === 'Entrega en Querétaro' ? 'Envío: por cotizar el día de la entrega' : `Envío: $${shipping} MXN`, `Total: $${total} MXN`
  ].join('\n');
  const sender = 'tarsi.studiomx@gmail.com';
  const subject = (test ? '[PRUEBA] ' : '') + 'Pedido ' + number;
  const previouslyAccepted = await sql`SELECT order_id FROM tarsi_order_notifications
    WHERE order_id=${id}::uuid AND accepted_at IS NOT NULL`.execute(db);
  if (previouslyAccepted.rows.length) return 'accepted';
  const google = await getGoogleAccessToken(db, sender).catch(() => null);
  if (google) {
    const claimed = await sql`INSERT INTO tarsi_order_notifications (order_id)
      VALUES (${id}::uuid) ON CONFLICT DO NOTHING RETURNING order_id`.execute(db);
    if (!claimed.rows.length) {
      const accepted = await sql`SELECT order_id FROM tarsi_order_notifications
        WHERE order_id=${id}::uuid AND accepted_at IS NOT NULL`.execute(db);
      return accepted.rows.length ? 'accepted' : 'review';
    }
    try {
      const raw = Buffer.from([
        'From: '+sender, 'To: '+sender, 'Subject: '+subject,
        'Message-ID: <tarsi-'+id+'@gmail.com>',
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
        '', Buffer.from(body).toString('base64').match(/.{1,76}/g)?.join('\r\n') || ''
      ].join('\r\n')).toString('base64url');
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method:'POST', redirect:'error', signal:AbortSignal.timeout(4500),
        headers:{Authorization:'Bearer '+google.access_token,'Content-Type':'application/json'},
        body:JSON.stringify({raw})
      });
      if ([400,401,403,429].includes(response.status)) {
        await sql`DELETE FROM tarsi_order_notifications WHERE order_id=${id}::uuid AND accepted_at IS NULL`.execute(db);
        return 'retry';
      }
      if (!response.ok) return 'review';
      const result = await response.json();
      if (typeof result.id !== 'string' || !result.id) return 'review';
      await sql`UPDATE tarsi_order_notifications SET accepted_at=now(),provider_id=${result.id}
        WHERE order_id=${id}::uuid`.execute(db);
      return 'accepted';
    } catch { return 'review'; }
  }
  if (!test) return 'unavailable';
  const env = process.env as Record<string,string | undefined>;
  const key = env.TARSI_RESEND_API_KEY;
  const from = env.TARSI_RESEND_FROM;
  const to = env.TARSI_RESEND_TEST_TO;
  if (!key || !from || !to) return 'unavailable';
  const state = await db.transaction().execute(async trx => {
    await sql`INSERT INTO tarsi_order_notifications (order_id) VALUES (${id}::uuid) ON CONFLICT DO NOTHING`.execute(trx);
    return (await sql<{accepted: boolean; withinWindow: boolean}>`SELECT accepted_at IS NOT NULL AS accepted,
      started_at > now() - interval '23 hours' AS within_window
      FROM tarsi_order_notifications WHERE order_id=${id}::uuid`.execute(trx)).rows[0];
  });
  if (state.accepted) return 'accepted';
  if (!state.withinWindow) return 'review';
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4500),
      headers: {'Content-Type':'application/json',Authorization:'Bearer '+key,'Idempotency-Key':'tarsi-order/'+id},
      body: JSON.stringify({from,to:[to],subject:(test?'[PRUEBA] ':'')+'Pedido '+number,text:body})
    });
    if (!response.ok) return 'retry';
    const result = await response.json();
    if (typeof result.id !== 'string' || !result.id) return 'retry';
    await sql`UPDATE tarsi_order_notifications SET accepted_at=COALESCE(accepted_at,now()), provider_id=${result.id}
      WHERE order_id=${id}::uuid`.execute(db);
    return 'accepted';
  } catch { return 'retry'; }
}
