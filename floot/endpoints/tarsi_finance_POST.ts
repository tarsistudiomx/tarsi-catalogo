import {sql} from 'kysely';
import {db} from '../helpers/db';
import {getServerUserSession} from '../helpers/getServerUserSession';
import {schema} from './tarsi_finance_POST.schema';

const json = (data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});

export function handle(request:Request){ return handleFinance(request,false); }

export async function handleFinance(request:Request,isTest:boolean){
  const session=await getServerUserSession(request).catch(()=>null);
  if(session?.user.role!=='admin' || request.headers.get('origin')!==new URL(request.url).origin)
    return json({error:'Acceso reservado a administradores.'},403);
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success) return json({error:'Revisa el mes o los datos del movimiento.'},400);
  const input=parsed.data;
  if(input.action==='report'){
    const start=input.month+'-01';
    const result=await sql<{gross:number;adjustments:number;expenses:number;count:number;entries:string}>`
      WITH bounds AS (SELECT ${start}::date AS start, (${start}::date + interval '1 month')::date AS finish),
      payments AS (
        SELECT sum((o.payload->>'total')::bigint*100) AS gross, count(*) AS count
        FROM tarsi_web_orders o CROSS JOIN bounds b
        WHERE o.is_test=${isTest} AND (o.paid_at AT TIME ZONE 'America/Mexico_City')::date >= b.start
        AND (o.paid_at AT TIME ZONE 'America/Mexico_City')::date < b.finish
      ),
      adjustments AS (
        SELECT sum(a.cents) AS adjustments FROM tarsi_order_adjustments a
        JOIN tarsi_web_orders o ON o.id=a.order_id CROSS JOIN bounds b
        WHERE o.is_test=${isTest} AND (a.recorded_at AT TIME ZONE 'America/Mexico_City')::date >= b.start
        AND (a.recorded_at AT TIME ZONE 'America/Mexico_City')::date < b.finish
      ),
      expenses AS (
        SELECT sum(e.cents) FILTER (WHERE e.voided_at IS NULL) AS expenses,
          jsonb_agg(jsonb_build_object('id',e.id,'date',e.incurred_on,'category',e.category,'description',e.description,
            'cents',e.cents,'voided',e.voided_at IS NOT NULL,'voidReason',e.void_reason)
            ORDER BY e.incurred_on DESC,e.recorded_at DESC) AS entries
        FROM tarsi_expenses e CROSS JOIN bounds b WHERE e.is_test=${isTest} AND e.incurred_on>=b.start AND e.incurred_on<b.finish
      )
      SELECT coalesce(gross,0)::float8 AS gross, coalesce(adjustments,0)::float8 AS adjustments,
        coalesce(expenses,0)::float8 AS expenses,count::integer,coalesce(entries,'[]'::jsonb)::text AS entries
      FROM payments CROSS JOIN adjustments CROSS JOIN expenses`.execute(db);
    const {entries,...report}=result.rows[0];
    return json({...report,entries:JSON.parse(entries)});
  }
  if(input.action==='add'){
    const result=await sql`INSERT INTO tarsi_expenses (id,is_test,incurred_on,category,description,cents,recorded_by)
      SELECT ${input.id}::uuid,${isTest},${input.date}::date,${input.category},${input.description},${input.cents},${session.user.id}
      WHERE ${input.date}::date <= (now() AT TIME ZONE 'America/Mexico_City')::date
      ON CONFLICT (id) DO NOTHING RETURNING id`.execute(db);
    if(result.rows.length) return json({ok:true});
    const prior=await sql`SELECT id FROM tarsi_expenses WHERE id=${input.id}::uuid AND is_test=${isTest} AND incurred_on=${input.date}::date
      AND category=${input.category} AND description=${input.description} AND cents=${input.cents}`.execute(db);
    return prior.rows.length ? json({ok:true}) : json({error:'Revisa la fecha o vuelve a abrir el formulario.'},409);
  }
  const result=await sql`UPDATE tarsi_expenses SET voided_at=now(),voided_by=${session.user.id},void_reason=${input.reason}
    WHERE id=${input.id}::uuid AND is_test=${isTest} AND voided_at IS NULL RETURNING id`.execute(db);
  return result.rows.length ? json({ok:true}) : json({error:'El gasto ya fue anulado o no existe.'},409);
}
