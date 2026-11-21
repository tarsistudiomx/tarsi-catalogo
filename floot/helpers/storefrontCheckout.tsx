import {liveIntegration,matchesBearer,previewIntegration} from './previewIntegration';
import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from 'node:crypto';
import {sql} from 'kysely';
import {db} from './db';
import {persistWebOrder,StockUnavailable,InventoryNotReady} from './persistWebOrder';
import {reportTransfer} from './orderFlow';
import {drainOrderMail} from './orderFlowMail';
import {names,subtotal,unit} from './previewShopCatalog';
import {orderAction, schema as legacyAction, destination} from '../endpoints/tarsi_preview_checkout_POST.schema';
import {payload} from '../endpoints/tarsi_web_order_POST.schema';
import type {z} from 'zod';

const freeShippingThreshold = 1300;
const upstream = 'https://tarsi-skydropx.netlify.app/.netlify/functions/';
type Destination = z.infer<typeof destination>;
type Order = z.infer<typeof payload>;
type Quote = NonNullable<z.infer<typeof payload>['skydropx']>;
const normalize = (value:string) => value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
const keyFor = (address:Destination) => [address.postal_code,address.area_level1,address.area_level2,address.area_level3].join('|');
class VisibleError extends Error {
  constructor(readonly status:number, message:string){super(message);}
}

const json = (data:unknown, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const unavailable = () => new VisibleError(503,'Los pedidos están temporalmente indisponibles. Tu carrito sigue guardado.');
function quoteKey(isTest:boolean) {
  if (!process.env.JWT_SECRET) throw unavailable();
  return createHmac('sha256',process.env.JWT_SECRET).update(isTest?'tarsi-preview-quote:v1':'tarsi-live-quote:v1').digest();
}
function seal(quote:Quote,isTest:boolean) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm',quoteKey(isTest),iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(quote)),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');
}
function open(proof:string | undefined, address:Destination, quantity:number,isTest:boolean):Quote {
  try {
    const bytes=Buffer.from(proof || '', 'base64url');
    const cipher=createDecipheriv('aes-256-gcm',quoteKey(isTest),bytes.subarray(0,12));
    cipher.setAuthTag(bytes.subarray(12,28));
    const quote=JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString()) as Quote;
    if (quote.destination===keyFor(address) && quote.quantity===quantity && Date.parse(quote.expires)>Date.now()) return quote;
  } catch {}
  throw new VisibleError(409,'Vuelve a cotizar el envío antes de enviar tu pedido.');
}

async function canonical(address:Destination) {
  const response=await fetch(upstream+'postal-code?zip='+address.postal_code,{signal:AbortSignal.timeout(5000),redirect:'error'});
  if (response.status===404) throw new VisibleError(400,'No encontramos ese código postal.');
  if (!response.ok) throw unavailable();
  const info=await response.json() as {colonies:{name:string;city:string;state:string}[]};
  const matches=info.colonies.filter(colony=>normalize(colony.name)===normalize(address.area_level3)
    && (!address.area_level1 || normalize(colony.state)===normalize(address.area_level1))
    && (!address.area_level2 || normalize(colony.city)===normalize(address.area_level2)));
  if (matches.length!==1) throw new VisibleError(400,'Selecciona una colonia válida para ese código postal.');
  const [{state,city,name}]=matches;
  return {country_code:'MX' as const,postal_code:address.postal_code,area_level1:state,area_level2:city,area_level3:name};
}

async function currentTariff(address:Destination,quantity:number){
  const response=await fetch(upstream+'shipping-quote',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({destination:address,quantity}),signal:AbortSignal.timeout(22000),redirect:'error'});
  if(!response.ok) throw new VisibleError(503,'Por ahora no encontramos una cotización disponible.');
  const data=await response.json() as {customer_price:number;expires_at:string;carrier_name:string;carrier_service:string;quotation_id?:string;estimated_days?:number};
  if(!Number.isSafeInteger(data.customer_price) || data.customer_price<=0 || !(Date.parse(data.expires_at)>Date.now())) throw unavailable();
  const quote:Quote={destination:keyFor(address),quantity,price:data.customer_price,
    expires:data.expires_at,carrier:data.carrier_name??null,service:data.carrier_service??null,
    quotationId:data.quotation_id,rateId:null};
  return {quote,days:data.estimated_days};
}

async function allot(category:'quote'|'order'|'notify',isTest:boolean) {
  const table=sql.table(isTest?'tarsi_preview_checkout_budget':'tarsi_live_checkout_budget');
  const limit = (isTest ? {quote:150,order:30,notify:12} : {quote:400,order:100,notify:80})[category];
  const result=await sql`INSERT INTO ${table} (day,category,requests)
    VALUES (current_date,${category},1) ON CONFLICT (day,category) DO UPDATE SET requests=${table}.requests+1
    WHERE ${table}.requests < ${limit} RETURNING requests`.execute(db);
  if (!result.rows.length) throw new VisibleError(429,'La vista previa alcanzó su límite de pruebas por hoy.');
}

export async function handleStorefront(request:Request,isTest:boolean, flow=false) {
  try {
    const marker = isTest ? 'checkout-v1' : 'storefront-v1';
    if (request.headers.get(isTest ? 'x-tarsi-preview' : 'x-tarsi-storefront') !== marker) return json({error:'Solicitud no válida.'},403);
    if(flow){
      const env=process.env as Record<string,string|undefined>;
      const key=isTest?env.TARSI_PREVIEW_STOREFRONT_KEY:env.TARSI_STOREFRONT_KEY;
      const configured = !key ? await (isTest ? previewIntegration() : liveIntegration()) : undefined;
      if(!matchesBearer(request.headers.get('authorization')||'',key,configured?.storefrontAuthSha256))
        return json({error:'Solicitud no válida.'},403);
    }
    const table = sql.table(isTest ? 'tarsi_preview_checkout_config' : 'tarsi_live_checkout_config');
    const transfer = (await sql<{bank:string;holder:string;clabe:string}>`SELECT bank,holder,clabe FROM ${table}
      WHERE slot ${isTest ? sql`` : sql`AND enabled`}`.execute(db)).rows[0];
    if (!isTest && !transfer) return json({error:'El registro de pedidos aún no está habilitado.'},503);
    const raw=await request.text();
    if(raw.length>16000) return json({error:'La solicitud es demasiado grande.'},413);
    const parsed=(flow?orderAction:legacyAction).safeParse(JSON.parse(raw));
    if (!parsed.success) return json({error:'Revisa los datos del pedido o vuelve a cotizar.'},400);
    const input=parsed.data;
    if(input.mode==='quote'){
      await allot('quote',isTest);
      const address=await canonical(input.destination);
      const {quote,days}=await currentTariff(address,input.quantity);
      return json({customer_price:quote.price,shipping_charge:flow&&subtotal(input.quantity)>=freeShippingThreshold?0:quote.price,carrier_name:quote.carrier,carrier_service:quote.service,
        expires_at:quote.expires,estimated_days:days,service:'Envío TARSI',proof:seal(quote,isTest)});
    }
    if(input.mode==='report'){
      await allot('notify',isTest);
      const report=await reportTransfer(input,isTest);
      if(report.status!==200) return json({error:report.error},report.status);
      if(report.orderId) await drainOrderMail(isTest,report.orderId).catch(()=>{});
      return json({reported:true});
    }
    if(input.mode==='renew'){
      await allot('order',isTest);
      const prior=(await sql<{id:string;payload:string}>`SELECT o.id,o.payload::text FROM tarsi_web_orders o JOIN tarsi_order_flow f ON f.order_id=o.id
         WHERE f.recovery_key=${input.key}::uuid AND o.is_test=${isTest} AND o.status='Pendiente de pago'
         AND f.renewals<2 AND f.revoked_at IS NULL AND f.recover_until>now()`.execute(db)).rows[0];
      if(!prior) return json({error:'No se puede renovar esta reserva. Si ya transferiste, registra tu pago o contacta a TARSI.'},409);
      const order=payload.parse(JSON.parse(prior.payload));
      if(order.items.some(item=>item.size==='XS'||names[item.id]!==item.name)||subtotal(order.quantity)!==order.subtotal)
        return json({error:'Cambió la disponibilidad o el precio de tu selección. No transfieras; contacta a TARSI con tu folio.'},409);
      const address=await canonical(order.address);
      let quote:Order['skydropx']=null;
      if(order.delivery==='Envío nacional'){
        ({quote}=await currentTariff(address,order.quantity));
        if((order.shipping>0&&quote.price!==order.shipping)||quote.carrier!==order.carrier||quote.service!==order.service)
          return json({error:'Cambió la tarifa o el servicio de envío. No transfieras; contacta a TARSI para revisar el mismo folio.'},409);
      }else if(normalize(address.area_level1)!=='queretaro'){
        return json({error:'La entrega local ya no está disponible para ese domicilio.'},409);
      }
      const renewed=await db.transaction().execute(async trx=>{
        const lock=(await sql<{active:boolean}>`SELECT f.hold_until>clock_timestamp() AS active
          FROM tarsi_web_orders o JOIN tarsi_order_flow f ON f.order_id=o.id
          WHERE o.id=${prior.id}::uuid AND o.status='Pendiente de pago' AND f.renewals<2 AND f.revoked_at IS NULL
          AND f.recover_until>now() FOR UPDATE OF o`.execute(trx)).rows[0];
        if(!lock) return false;
        if(lock.active) return true;
        const stock=(await sql<{ok:boolean}>`SELECT tarsi_allocate_blanks(${prior.id}::uuid,false) AS ok`.execute(trx)).rows[0];
        if(!stock.ok) return false;
        if(quote) await sql`UPDATE tarsi_web_orders SET payload=jsonb_set(payload,'{skydropx}',${JSON.stringify(quote)}::jsonb)
          WHERE id=${prior.id}::uuid`.execute(trx);
        await sql`UPDATE tarsi_order_flow SET renewals=renewals+1 WHERE order_id=${prior.id}::uuid AND hold_until IS NOT NULL`.execute(trx);
        return true;
      });
      if(!renewed){
        const sizes=(await sql<{size:string}>`SELECT size FROM tarsi_blank_stock b WHERE is_test=${isTest} AND on_hand>
          (SELECT coalesce(sum(h.qty),0) FROM tarsi_blank_holds h JOIN tarsi_order_flow f ON f.order_id=h.order_id
             WHERE h.is_test=b.is_test AND h.size=b.size AND h.assigned_at IS NULL AND f.hold_until>now()) ORDER BY size`.execute(db)).rows.map(row=>row.size);
        return json({error:'No hay existencias para renovar tu selección.'+(sizes.length?' Tallas con existencias: '+sizes.join(', ')+'.':'')+' Si ya transferiste, registra tu pago para revisarlo.'},409);
      }
    }
    let result;
    if(input.mode==='recover'||input.mode==='renew'){
      result=await persistWebOrder({action:'recover',key:input.key},isTest);
    } else {
      const groups=new Map<string,(typeof input.items)[number]>();
      for(const item of input.items){
        if(!names[item.id]) throw new VisibleError(400,'Selecciona un producto válido.');
        const key=item.id+':'+item.size;
        groups.set(key,{...item,qty:item.qty+(groups.get(key)?.qty||0)});
      }
      const items=[...groups.values()].sort((a,b)=>a.id-b.id||a.size.localeCompare(b.size))
        .map(item=>({...item,name:names[item.id],unitPrice:unit}));
      const quantity=items.reduce((sum,item)=>sum+item.qty,0);
      if(quantity>30) throw new VisibleError(400,'El pedido admite hasta 30 playeras.');
      const digest=createHash('sha256').update(JSON.stringify([items,input.customer,input.address,input.delivery,input.acceptedTotal])).digest('hex');
      result=await persistWebOrder({action:'lookup',key:input.key,digest},isTest);
      if(!result.conflict && !result.receipt){
        if(!transfer) throw unavailable();
        await allot('order',isTest);
        const address=await canonical(input.address);
        if(input.delivery==='Entrega en Querétaro' && normalize(address.area_level1)!=='queretaro'){
          throw new VisibleError(400,'Selecciona envío nacional para ese domicilio.');
        }
        const quote=input.delivery==='Envío nacional'?open(input.proof,address,quantity,isTest):null;
        const merchandise=subtotal(quantity);
        const quotedShipping=quote?.price??0;
        const freeShipping=flow&&quote!==null&&merchandise>=freeShippingThreshold;
        const shipping=freeShipping?0:quotedShipping;
        // Cached storefronts can still show the full carrier price. Charge the lower total.
        const acceptsShippingOffer=freeShipping&&input.acceptedTotal===merchandise+quotedShipping;
        if(merchandise+shipping!==input.acceptedTotal&&!acceptsShippingOffer)
          throw new VisibleError(409,'El importe cambió. Revisa el total antes de continuar.');
        const order=payload.parse({items,quantity,customer:input.customer,address:{...address,street:input.address.street},
          delivery:input.delivery,subtotal:merchandise,discount:quantity*unit-merchandise,shipping,total:merchandise+shipping,
          promotions:{threePack:Math.floor(quantity/3),twoPack:quantity%3===2?1:0},
          carrier:quote?.carrier??null,service:quote?.service??null,skydropx:quote,origin:'tienda web TARSI'});
        result=await persistWebOrder({action:'create',key:input.key,digest,order},isTest,flow);
        if(flow && result.receipt){
          const id=(await sql<{id:string}>`SELECT id FROM tarsi_web_orders WHERE idempotency_key=${input.key}::uuid AND is_test=${isTest}`.execute(db)).rows[0]?.id;
          if(id) await drainOrderMail(isTest,id).catch(()=>{});
        }
      }
    }
    if(result.conflict) throw new VisibleError(409,'Este intento ya corresponde a otro pedido.');
    if(!result.receipt) throw new VisibleError(404,'Todavía no se registró un pedido para este intento.');
    const {receipt}=result;
    let notification;
    if(input.notify){
      try {
        await allot('notify',isTest);
        notification=(await persistWebOrder({action:'notify',key:input.key},isTest)).notification;
      } catch {notification='retry';}
    }
    const inventoryActive=(await sql<{enabled:boolean}>`SELECT enabled FROM tarsi_blank_policy WHERE is_test=${isTest}`.execute(db)).rows[0]?.enabled===true;
    const showBank=!receipt.isFlow || receipt.status==='Pendiente de pago' &&
      (!inventoryActive || Boolean(receipt.holdUntil&&new Date(receipt.holdUntil).getTime()>Date.now()));
    return json({holdUntil:receipt.holdUntil,inventoryActive,isFlow:receipt.isFlow,reported:receipt.reported,number:receipt.number,status:receipt.status,items:receipt.items.map(({name,size,qty})=>({name,size,qty})),
      subtotal:receipt.subtotal,shipping:receipt.shipping,delivery:receipt.delivery,total:receipt.total,discount:receipt.discount,
      carrier:receipt.carrier,service:receipt.service,transfer:showBank?transfer:null,notification});
  } catch(error){
    if(error instanceof InventoryNotReady) return json({error:'La tienda todavía no puede reservar tu selección. Tu carrito sigue guardado.'},503);
    if(error instanceof StockUnavailable) return json({error:'No hay suficientes playeras de una de las tallas solicitadas. Ajusta tu selección.'},409);
    if(error instanceof VisibleError) return json({error:error.message},error.status);
    if(error instanceof SyntaxError) return json({error:'Solicitud inválida.'},400);
    return json({error:'No pudimos completar la solicitud. Intenta otra vez.'},503);
  }
}
