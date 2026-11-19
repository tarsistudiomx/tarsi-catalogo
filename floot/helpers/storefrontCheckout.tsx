import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from 'node:crypto';
import {sql} from 'kysely';
import {db} from './db';
import {persistWebOrder} from './persistWebOrder';
import {names,subtotal,unit} from './previewShopCatalog';
import {schema, destination} from '../endpoints/tarsi_preview_checkout_POST.schema';
import {payload} from '../endpoints/tarsi_web_order_POST.schema';
import type {z} from 'zod';

const upstream = 'https://tarsi-skydropx.netlify.app/.netlify/functions/';
type Destination = z.infer<typeof destination>;
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

async function allot(category:'quote'|'order'|'notify',isTest:boolean) {
  const table=sql.table(isTest?'tarsi_preview_checkout_budget':'tarsi_live_checkout_budget');
  const limit = (isTest ? {quote:150,order:30,notify:12} : {quote:400,order:100,notify:80})[category];
  const result=await sql`INSERT INTO ${table} (day,category,requests)
    VALUES (current_date,${category},1) ON CONFLICT (day,category) DO UPDATE SET requests=${table}.requests+1
    WHERE ${table}.requests < ${limit} RETURNING requests`.execute(db);
  if (!result.rows.length) throw new VisibleError(429,'La vista previa alcanzó su límite de pruebas por hoy.');
}

export async function handleStorefront(request:Request,isTest:boolean) {
  try {
    const marker = isTest ? 'checkout-v1' : 'storefront-v1';
    if (request.headers.get(isTest ? 'x-tarsi-preview' : 'x-tarsi-storefront') !== marker) return json({error:'Solicitud no válida.'},403);
    const table = sql.table(isTest ? 'tarsi_preview_checkout_config' : 'tarsi_live_checkout_config');
    const transfer = (await sql<{bank:string;holder:string;clabe:string}>`SELECT bank,holder,clabe FROM ${table}
      WHERE slot ${isTest ? sql`` : sql`AND enabled`}`.execute(db)).rows[0];
    if (!isTest && !transfer) return json({error:'El registro de pedidos aún no está habilitado.'},503);
    const raw=await request.text();
    if(raw.length>16000) return json({error:'La solicitud es demasiado grande.'},413);
    const parsed=schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({error:'Revisa los datos del pedido o vuelve a cotizar.'},400);
    const input=parsed.data;
    if(input.mode==='quote'){
      await allot('quote',isTest);
      const address=await canonical(input.destination);
      const response=await fetch(upstream+'shipping-quote',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({destination:address,quantity:input.quantity}),signal:AbortSignal.timeout(22000),redirect:'error'});
      if(!response.ok) throw new VisibleError(503,'Por ahora no encontramos una cotización disponible.');
      const data=await response.json() as {customer_price:number;expires_at:string;carrier_name:string;carrier_service:string;quotation_id?:string;estimated_days?:number};
      if(!Number.isSafeInteger(data.customer_price) || data.customer_price<=0 || !(Date.parse(data.expires_at)>Date.now())) throw unavailable();
      const quote:Quote={destination:keyFor(address),quantity:input.quantity,price:data.customer_price,
        expires:data.expires_at,carrier:data.carrier_name??null,service:data.carrier_service??null,
        quotationId:data.quotation_id,rateId:null};
      return json({customer_price:quote.price,carrier_name:quote.carrier,carrier_service:quote.service,
        expires_at:quote.expires,estimated_days:data.estimated_days,service:'Envío TARSI',proof:seal(quote,isTest)});
    }
    let result;
    if(input.mode==='recover'){
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
        await allot('order',isTest);
        const address=await canonical(input.address);
        if(input.delivery==='Entrega en Querétaro' && normalize(address.area_level1)!=='queretaro'){
          throw new VisibleError(400,'Selecciona envío nacional para ese domicilio.');
        }
        const quote=input.delivery==='Envío nacional'?open(input.proof,address,quantity,isTest):null;
        const merchandise=subtotal(quantity);
        const shipping=quote?.price??0;
        if(merchandise+shipping!==input.acceptedTotal) throw new VisibleError(409,'El importe cambió. Revisa el total antes de continuar.');
        const order=payload.parse({items,quantity,customer:input.customer,address:{...address,street:input.address.street},
          delivery:input.delivery,subtotal:merchandise,discount:quantity*unit-merchandise,shipping,total:merchandise+shipping,
          promotions:{threePack:Math.floor(quantity/3),twoPack:quantity%3===2?1:0},
          carrier:quote?.carrier??null,service:quote?.service??null,skydropx:quote,origin:'tienda web TARSI'});
        result=await persistWebOrder({action:'create',key:input.key,digest,order},isTest);
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
    return json({number:receipt.number,status:receipt.status,items:receipt.items.map(({name,size,qty})=>({name,size,qty})),
      subtotal:receipt.subtotal,shipping:receipt.shipping,delivery:receipt.delivery,total:receipt.total,discount:receipt.discount,
      carrier:receipt.carrier,service:receipt.service,transfer,notification});
  } catch(error){
    if(error instanceof VisibleError) return json({error:error.message},error.status);
    if(error instanceof SyntaxError) return json({error:'Solicitud inválida.'},400);
    return json({error:'No pudimos completar la solicitud. Intenta otra vez.'},503);
  }
}
