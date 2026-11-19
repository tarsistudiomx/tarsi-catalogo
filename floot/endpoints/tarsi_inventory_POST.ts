import {sql} from 'kysely';
import {db} from '../helpers/db';
import {getServerUserSession} from '../helpers/getServerUserSession';
import {schema,sizes} from './tarsi_inventory_POST.schema';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function handle(request:Request){
  const session=await getServerUserSession(request).catch(()=>null);
  if(session?.user.role!=='admin'||request.headers.get('origin')!==new URL(request.url).origin)return json({error:'Acceso reservado a administradores.'},403);
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return json({error:'Revisa los datos del inventario.'},400);
  const input=parsed.data;
  if(input.action==='list'){
    const result=await sql`SELECT b.size,b.on_hand,b.low_at,b.restock_on::text,
      coalesce(sum(h.qty) FILTER(WHERE h.assigned_at IS NULL AND f.hold_until>clock_timestamp()),0)::int AS reserved,
      coalesce(sum(h.qty) FILTER(WHERE h.assigned_at IS NOT NULL AND o.status IN ('Pagado','En preparación')),0)::int AS assigned
      FROM tarsi_blank_stock b LEFT JOIN tarsi_blank_holds h ON h.is_test=b.is_test AND h.size=b.size
      LEFT JOIN tarsi_order_flow f ON f.order_id=h.order_id LEFT JOIN tarsi_web_orders o ON o.id=h.order_id
      WHERE b.is_test=${input.test} GROUP BY b.size,b.on_hand,b.low_at,b.restock_on ORDER BY b.size`.execute(db);
    const policy=await sql<{enabled:boolean}>`SELECT enabled FROM tarsi_blank_policy WHERE is_test=${input.test}`.execute(db);
    const moves=await sql`SELECT m.size,m.qty,m.reason,m.moved_at,m.actor_id,o.number
      FROM tarsi_blank_movements m LEFT JOIN tarsi_web_orders o ON o.id=m.order_id
      WHERE m.is_test=${input.test} ORDER BY m.id DESC LIMIT 100`.execute(db);
    return json({stock:result.rows,enabled:policy.rows[0]?.enabled===true,movements:moves.rows});
  }
  const error=await db.transaction().execute(async trx=>{
    await sql`INSERT INTO tarsi_blank_policy(is_test) VALUES(${input.test}) ON CONFLICT DO NOTHING`.execute(trx);
    await sql`SELECT 1 FROM tarsi_blank_policy WHERE is_test=${input.test} FOR UPDATE`.execute(trx);
    if(input.action==='enable'){
      const ready=await sql<{count:number}>`SELECT count(*)::int AS count FROM tarsi_blank_stock WHERE is_test=${input.test}`.execute(trx);
      if(ready.rows[0].count!==sizes.length)return 'Captura el stock real de cada talla. Usa cero cuando no tengas unidades.';
      await sql`UPDATE tarsi_blank_policy SET enabled=true WHERE is_test=${input.test}`.execute(trx);
      return null;
    }
    const previous=(await sql<{onHand:number}>`SELECT on_hand FROM tarsi_blank_stock WHERE is_test=${input.test} AND size=${input.size} FOR UPDATE`.execute(trx)).rows[0];
    const locked=(await sql<{qty:number}>`SELECT coalesce(sum(h.qty),0)::int AS qty FROM tarsi_blank_holds h
      JOIN tarsi_order_flow f ON f.order_id=h.order_id WHERE h.is_test=${input.test} AND h.size=${input.size}
      AND h.assigned_at IS NULL AND f.hold_until>clock_timestamp()`.execute(trx)).rows[0];
    if(input.count<locked.qty)return 'El conteo es menor que las reservas activas. Revisa los pedidos primero.';
    await sql`INSERT INTO tarsi_blank_stock(is_test,size,on_hand,low_at,restock_on)
       VALUES(${input.test},${input.size},${input.count},${input.low},${input.restock}::date)
       ON CONFLICT(is_test,size) DO UPDATE SET on_hand=excluded.on_hand,low_at=excluded.low_at,restock_on=excluded.restock_on`.execute(trx);
    const delta=input.count-(previous?.onHand??0);
    if(delta)await sql`INSERT INTO tarsi_blank_movements(is_test,size,qty,actor_id,reason)
      VALUES(${input.test},${input.size},${delta},${session.user.id},${input.reason})`.execute(trx);
    return null;
  });
  return error?json({error},409):json({ok:true});
}
