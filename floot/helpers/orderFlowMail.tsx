import {previewIntegration} from './previewIntegration';
import {createHash} from 'node:crypto';
import {getGoogleAccessToken} from '@floot/google-integrations';
import {sql} from 'kysely';
import {db} from './db';
import type {z} from 'zod';
import type {payload} from '../endpoints/tarsi_web_order_POST.schema';

const inbox='tarsi.studiomx@gmail.com';
type Kind='registered'|'reminder'|'reported'|'confirmed'|'recovery';
type Order=z.infer<typeof payload>;
type Work={orderId:string;kind:Kind;attempts:number;claimedAt:string};
export async function drainOrderMail(isTest:boolean,orderId?:string){
  const env=process.env as Record<string,string|undefined>;
  const storefront=isTest?(env.TARSI_TEST_STOREFRONT_URL ?? (await previewIntegration())?.storefrontUrl):'https://tarsi-skydropx.netlify.app/';
  if(!storefront) return {available:false,processed:0};
  const linkOrigin=new URL(storefront);
  if(linkOrigin.protocol!=='https:'||(isTest&&!/^deploy-preview-\d+--tarsi-skydropx\.netlify\.app$/.test(linkOrigin.hostname)))
    return {available:false,processed:0};
  const google=await getGoogleAccessToken(db,inbox).catch(()=>null);
  if(!google)return {available:false,processed:0};
  await sql`UPDATE tarsi_mail_outbox m SET state='review',last_error='Resultado incierto; revisar Enviados.'
    FROM tarsi_web_orders o WHERE o.id=m.order_id AND o.is_test=${isTest} AND m.state='sending'
    AND m.claimed_at<now()-interval '10 minutes'`.execute(db);
  const claimed=await sql<Work>`WITH next AS (
    SELECT m.order_id,m.kind FROM tarsi_mail_outbox m JOIN tarsi_web_orders o ON o.id=m.order_id
    WHERE o.is_test=${isTest} AND m.state='pending' AND m.due_at<=now()
      ${orderId?sql`AND m.order_id=${orderId}::uuid`:sql``}
    ORDER BY m.due_at LIMIT ${orderId?1:3} FOR UPDATE OF m SKIP LOCKED
  ) UPDATE tarsi_mail_outbox m SET state='sending',claimed_at=now(),attempts=m.attempts+1
    FROM next WHERE m.order_id=next.order_id AND m.kind=next.kind RETURNING m.order_id,m.kind,m.attempts,m.claimed_at::text`.execute(db);
  for(const job of claimed.rows){
    await db.transaction().execute(async trx=>{
      const row=(await sql<{number:string;status:string;key:string;payload:string;eligible:boolean;reported:boolean}>`SELECT o.number,o.status,
        f.recovery_key::text AS key,o.payload::text,
        f.revoked_at IS NULL AND f.recover_until>now() AS eligible,r.order_id IS NOT NULL AS reported
        FROM tarsi_web_orders o JOIN tarsi_order_flow f ON f.order_id=o.id LEFT JOIN tarsi_transfer_reports r ON r.order_id=o.id
        WHERE o.id=${job.orderId}::uuid FOR UPDATE OF o`.execute(trx)).rows[0];
      const valid=(await sql`SELECT 1 FROM tarsi_mail_outbox WHERE order_id=${job.orderId}::uuid
        AND kind=${job.kind} AND claimed_at=${job.claimedAt}::timestamptz AND state='sending' FOR UPDATE`.execute(trx)).rows.length;
      if(!valid)return;
      const update=(state:string,reason:string|null=null,id:string|null=null)=>sql`UPDATE tarsi_mail_outbox SET
        state=${state},last_error=${reason},provider_id=${id},accepted_at=CASE WHEN ${state}='accepted' THEN now() ELSE NULL END,
        due_at=CASE WHEN ${state}='pending' THEN now()+(${job.attempts}*5)*interval '1 minute' ELSE due_at END
        WHERE order_id=${job.orderId}::uuid AND kind=${job.kind} AND state='sending'`.execute(trx);
      if(!row || (job.kind==='reminder' && (row.status!=='Pendiente de pago'||row.reported||!row.eligible)) ||
        (job.kind==='registered' && (!row.eligible||row.status==='Cancelado')) || (job.kind==='recovery' && !row.eligible)) {await update('suppressed');return;}
      const data=JSON.parse(row.payload) as Order;
      const to=isTest||job.kind==='reported'?inbox:data.customer.email;
      if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)){await update('failed','Correo del cliente inválido.');return;}
      const link=new URL(linkOrigin);
      link.hash='pedido='+row.key;
      const summary=data.items.map(i=>i.name+' · '+i.size+' × '+i.qty).join('\n');
      let subject='',body='';
      if(job.kind==='registered'){
        const table=sql.table(isTest?'tarsi_preview_checkout_config':'tarsi_live_checkout_config');
        const bank=(await sql<{bank:string;holder:string;clabe:string}>`SELECT bank,holder,clabe FROM ${table} WHERE slot`.execute(trx)).rows[0];
        if(!bank){await update(job.attempts>=5?'failed':'pending','Faltan los datos de transferencia.');return;}
        subject='Solicitud registrada '+row.number;
        body=[data.customer.name,'Estado: SIN REPORTE DE PAGO',summary,'Total: $'+data.total+' MXN',
          bank.bank,bank.holder,'CLABE: '+bank.clabe,'Concepto: '+row.number,
          'Antes de transferir, abre tu pedido para consultar la disponibilidad y la reserva. Después registra tu transferencia.', 'Continuar mi pedido: '+link.href].join('\n');
      } else if(job.kind==='recovery'){
        subject='Nuevo enlace de tu pedido '+row.number;
        body='Consulta el pedido original y el estado de tu transferencia.\nContinuar mi pedido: '+link.href;
      } else if(job.kind==='reminder'){
        subject='Sigue con tu pedido '+row.number;
        body='¿Ya realizaste tu transferencia? Si ya pagaste, recuerda registrar los datos para que podamos verificar tu pedido.\n'+link.href;
      } else if(job.kind==='confirmed'){
        subject='Tu pedido está confirmado '+row.number;
        body='¡Tu pedido '+row.number+' está confirmado! Comenzaremos su preparación.\n'+summary+
          '\nPreparación estimada: 3 a 5 días hábiles. El transporte se calcula aparte.';
      } else {
        subject='Transferencia por verificar '+row.number;
        body='Se recibió un reporte para '+row.number+'. Revisa sus datos en el Dashboard y verifica el depósito en Nu.';
      }
      const messageVersion=job.kind==='recovery'?'-'+createHash('sha256').update(row.key).digest('hex').slice(0,16):'';
      const raw=Buffer.from(['From: '+inbox,'To: '+to,'Subject: '+(isTest?'[PRUEBA] ':'')+subject,
        'Message-ID: <tarsi-'+job.orderId+'-'+job.kind+messageVersion+'@gmail.com>',
        'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',
        Buffer.from(body).toString('base64').match(/.{1,76}/g)?.join('\r\n')||''].join('\r\n')).toString('base64url');
      try{
        const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(4500),
          headers:{Authorization:'Bearer '+google.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw})
        });
        if([401,403,429].includes(response.status)){await update(job.attempts>=5?'failed':'pending','Gmail HTTP '+response.status);return;}
        if(response.status===400){await update('failed','Gmail rechazó el mensaje.');return;}
        if(!response.ok){await update('review','Gmail HTTP '+response.status+'; revisar Enviados.');return;}
        const result=await response.json() as {id?:string};
        await update(result.id?'accepted':'review',result.id?null:'No se recibió un identificador.',result.id||null);
      }catch{await update('review','Resultado incierto; revisar Enviados.');}
    });
  }
  return {available:true,processed:claimed.rows.length};
}
