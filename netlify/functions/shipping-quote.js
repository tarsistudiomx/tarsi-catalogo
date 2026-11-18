'use strict';
const API='https://api-pro.skydropx.com';
const ORIGIN_ZIP='76099';
const allowedOrigins=new Set(['https://tarsistudiomx.github.io','https://tarsi-skydropx.netlify.app']);
const validZip=x=>/^\d{5}$/.test(String(x||''));
const positive=x=>{const n=Number(x);return Number.isFinite(n)&&n>0?n:null};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const parcelFor=q=>({length:30,width:25,height:4*Math.ceil(q/1),weight:Number((q*.35).toFixed(2))});
async function requestJson(url,options={}){
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error('Skydropx HTTP '+response.status);
 return body;
}
function unpackRates(result){
 const raw=result?.included||result?.rates||result?.data?.rates||result?.data?.attributes?.rates||[];
 return (Array.isArray(raw)?raw:[]).map(x=>{
  const a=x.attributes||x;
  return {id:x.id||a.id,price:positive(a.total)||positive(a.amount)||positive(a.price),days:positive(a.days)||positive(a.delivery_days),status:a.status};
 }).filter(x=>x.id&&x.price&&(!x.status||['price_found_external','price_found','available','completed'].includes(x.status)));
}
const customerPrice=price=>Math.ceil((price+Math.max(price*.2,30))/10)*10;
async function quote(body){
 if(!process.env.SKYDROPX_CLIENT_ID||!process.env.SKYDROPX_CLIENT_SECRET)return {statusCode:503,data:{error:'Faltan las credenciales de Skydropx en Netlify'}};
 const {destination,quantity}=body||{};const q=Number(quantity);
 if(!destination||!validZip(destination.postal_code)||!['area_level1','area_level2','area_level3'].every(k=>typeof destination[k]==='string'&&destination[k].trim().length>1)||!Number.isInteger(q)||q<1||q>30)return {statusCode:400,data:{error:'DirecciÃ³n o cantidad invÃ¡lida'}};
 const originColony=(process.env.TARSI_ORIGIN_COLONY||'Plazas del Sol Segunda SecciÃ³n').trim();
 const originZip=process.env.TARSI_ORIGIN_CP||ORIGIN_ZIP;
 if(!validZip(originZip))return {statusCode:503,data:{error:'CÃ³digo postal de origen invÃ¡lido'}};
 const tokenData=await requestJson(API+'/api/v1/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:process.env.SKYDROPX_CLIENT_ID,client_secret:process.env.SKYDROPX_CLIENT_SECRET})});
 const token=tokenData.access_token||tokenData.data?.access_token;
 if(!token)throw new Error('Skydropx no devolviÃ³ token');
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
 const payload={quotation:{address_from:{country_code:'MX',postal_code:originZip,area_level1:'QuerÃ©taro',area_level2:'QuerÃ©taro',area_level3:originColony},address_to:{country_code:'MX',postal_code:destination.postal_code,area_level1:destination.area_level1,area_level2:destination.area_level2,area_level3:destination.area_level3},parcels:[parcelFor(q)]}};
 const created=await requestJson(API+'/api/v1/quotations',{method:'POST',headers,body:JSON.stringify(payload)});
 const id=created.id||created.quotation_id||created.data?.id||created.data?.attributes?.quotation_id;
 if(!id)throw new Error('Skydropx no devolviÃ³ identificador');
 let rates=[];
 for(let attempt=0;attempt<7;attempt++){
  await sleep(1000);
  const result=await requestJson(API+'/api/v1/quotations/'+encodeURIComponent(id),{headers});
  const completed=result.is_completed===true||result.data?.attributes?.is_completed===true||result.data?.attributes?.status==='completed';
  if(completed){rates=unpackRates(result);break}
 }
 if(!rates.length)return {statusCode:503,data:{error:'No se encontraron tarifas completas para este destino'}};
 rates.sort((a,b)=>a.price-b.price||(a.days||999)-(b.days||999));
 const selected=rates[0];
 return {statusCode:200,data:{customer_price:customerPrice(selected.price),estimated_days:selected.days||null,service:'EnvÃ­o TARSI',expires_at:new Date(Date.now()+23*3600*1000).toISOString()}};
}
exports.handler=async(event)=>{
 const origin=event.headers?.origin||event.headers?.Origin||'';
 const cors={'Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'https://tarsistudiomx.github.io','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'};
 const respond=(statusCode,data)=>({statusCode,headers:cors,body:JSON.stringify(data)});
 if(origin&&!allowedOrigins.has(origin))return respond(403,{error:'Origen no autorizado'});
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:cors,body:''};
 if(event.httpMethod!=='POST')return respond(405,{error:'MÃ©todo no permitido'});
 let body;try{body=JSON.parse(event.body||'{}')}catch{return respond(400,{error:'JSON invÃ¡lido'})}
 try{const result=await quote(body);return respond(result.statusCode,result.data)}catch(error){console.error('Skydropx quote error:',error.message);return respond(502,{error:'No fue posible consultar las tarifas de Skydropx'})}
};
// Exportaciones para pruebas locales; no se exponen como rutas HTTP.
exports._test={parcelFor,customerPrice};
