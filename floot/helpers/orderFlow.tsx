import {sql} from 'kysely';
import {db} from './db';
import type {z} from 'zod';
import type {transferReport} from '../endpoints/tarsi_preview_checkout_POST.schema';

export const bankKey=(reference:string)=>reference.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');

export async function reportTransfer(input:z.infer<typeof transferReport>,isTest:boolean){
  return db.transaction().execute(async trx=>{
    const order=(await sql<{id:string;status:string;total:number;date:string}>`SELECT o.id,o.status,(o.payload->>'total')::int AS total,
      (o.created_at AT TIME ZONE 'America/Mexico_City')::date::text AS date
      FROM tarsi_web_orders o JOIN tarsi_order_flow f ON f.order_id=o.id
      WHERE f.recovery_key=${input.key}::uuid AND o.is_test=${isTest} AND f.revoked_at IS NULL AND f.recover_until>now()
      FOR UPDATE OF o`.execute(trx)).rows[0];
    if(!order)return {status:404,error:'Este enlace ya no está activo. Contacta a TARSI con tu folio.'};
    if(!['Pendiente de pago','Pago por verificar','Cancelado'].includes(order.status))
      return {status:409,error:'El pedido ya se procesó. Consulta con TARSI si necesitas ayuda.'};
    const today=(await sql<{date:string}>`SELECT (now() AT TIME ZONE 'America/Mexico_City')::date::text AS date`.execute(trx)).rows[0].date;
    if(input.date>today||input.date<order.date)return {status:400,error:'La fecha debe estar entre el día del pedido y hoy.'};
    const reference=bankKey(input.reference);
    if(input.reference && reference.length<5)return {status:400,error:'Revisa la clave de rastreo.'};
    const existing=(await sql<{bank:string;referenceKey:string|null;date:string;cents:number;details:string|null}>`
      SELECT bank,reference_key,transferred_on::text AS date,cents,details FROM tarsi_transfer_reports WHERE order_id=${order.id}::uuid`.execute(trx)).rows[0];
    if(existing){
      if(existing.referenceKey===(reference||null)&&existing.bank===input.bank&&existing.cents===input.cents&&existing.date===input.date&&existing.details===(input.details||null))
        return {status:200,orderId:order.id};
      return {status:409,error:'Ya recibimos un reporte. Contacta a TARSI para corregir sus datos.'};
    }
    const orderId=order.id;
    async function duplicateReference(){
      const note='Referencia reportada en otro pedido';
      const flagged=await sql`UPDATE tarsi_order_flow SET last_issue=${note} WHERE order_id=${orderId}::uuid
        AND last_issue IS DISTINCT FROM ${note} RETURNING order_id`.execute(trx);
      if(flagged.rows.length) await sql`INSERT INTO tarsi_web_order_history(order_id,status)
        VALUES(${orderId}::uuid,${note})`.execute(trx);
      return {status:409,error:'La referencia ya se utilizó. Contacta a TARSI para revisarla.'};
    }
    if(reference) await sql`SELECT pg_advisory_xact_lock(${isTest?912:911},hashtext(${reference}))`.execute(trx);
    if(reference && (await sql`SELECT 1 FROM tarsi_verified_payments WHERE is_test=${isTest}
      AND reference_key=${reference} AND order_id<>${order.id}::uuid`.execute(trx)).rows.length)
      return duplicateReference();
    const inserted=await sql`INSERT INTO tarsi_transfer_reports(order_id,is_test,bank,reference,reference_key,transferred_on,cents,details)
      VALUES(${order.id}::uuid,${isTest},${input.bank},${input.reference||null},${reference||null},${input.date}::date,${input.cents},${input.details||null})
      ON CONFLICT DO NOTHING RETURNING order_id`.execute(trx);
    if(!inserted.rows.length)return duplicateReference();
    if(order.status!=='Cancelado')await sql`UPDATE tarsi_web_orders SET status='Pago por verificar' WHERE id=${order.id}::uuid`.execute(trx);
    const issue=order.status==='Cancelado'?'Transferencia en pedido cancelado':input.cents!==order.total*100?'Importe reportado distinto del total':null;
    if(issue)await sql`UPDATE tarsi_order_flow SET last_issue=${issue} WHERE order_id=${order.id}::uuid`.execute(trx);
    await sql`INSERT INTO tarsi_web_order_history(order_id,status) VALUES(${order.id}::uuid,'Transferencia reportada')`.execute(trx);
    await sql`UPDATE tarsi_mail_outbox SET state='suppressed' WHERE order_id=${order.id}::uuid AND kind='reminder' AND state='pending'`.execute(trx);
    await sql`INSERT INTO tarsi_mail_outbox(order_id,kind,due_at) VALUES(${order.id}::uuid,'reported',now()) ON CONFLICT DO NOTHING`.execute(trx);
    return {status:200,orderId:order.id};
  });
}
