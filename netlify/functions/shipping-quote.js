const API='https://api-pro.skydropx.com';
const zip=x=>/^\d{5}$/.test(String(x||''));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const number=x=>{const n=Number(x);return Number.isFinite(n)&&n>0?n:null};
async function json(url,options={}){
 const r=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error('Skydropx HTTP '+r.status);
 return data;
}
function unpackRates(result){
 const raw=result?.included||result?.rates||result?.data?.rates||result?.data?.attributes?.rates||[];
 return (Array.isArray(raw)?raw:[]).map(x=>{
   const a=x.attributes||x;
   return {id:x.id||a.id,price:number(a.total)||number(a.amount)||number(a.price),days:number(a.days)||number(a.delivery_days),service:a.service_name||a.service||a.provider_service_name||'',carrier:a.carrier_name||a.provider_name||'',status:a.status};
 }).filter(x=>x.id&&x.price&&(!x.status||['price_found_external','price_found','available','completed'].includes(x.status)));
}
async function handle(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'MÃ©todo no permitido'});
 if(!process.env.SKYDROPX_CLIENT_ID||!process.env.SKYDROPX_CLIENT_SECRET||!process.env.TARSI_ORIGIN_COLONY||!process.env.TARSI_PACKAGE_LENGTH_CM||!process.env.TARSI_PACKAGE_WIDTH_CM||!process.env.TARSI_PACKAGE_HEIGHT_CM||!process.env.TARSI_SHIRT_WEIGHT_KG)return res.status(503).json({error:'API_NO_CONFIGURADA'});
 const {destination,quantity}=req.body||{};
 const q=Number(quantity);
 if(!destination||!zip(destination.postal_code)||!['area_level1','area_level2','area_level3'].every(k=>typeof destination[k]==='string'&&destination[k].trim().length>1)||!Number.isInteger(q)||q<1||q>30)return res.status(400).json({error:'DirecciÃ³n o cantidad invÃ¡lida'});
 try{
   const tokenData=await json(API+'/api/v1/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:process.env.SKYDROPX_CLIENT_ID,client_secret:process.env.SKYDROPX_CLIENT_SECRET})});
   const token=tokenData.access_token||tokenData.data?.access_token;
   if(!token)throw Error('No se obtuvo token');
   const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
   const parcel={length:Number(process.env.TARSI_PACKAGE_LENGTH_CM),width:Number(process.env.TARSI_PACKAGE_WIDTH_CM),height:Number(process.env.TARSI_PACKAGE_HEIGHT_CM),weight:Math.ceil((q*Number(process.env.TARSI_SHIRT_WEIGHT_KG)+Number(process.env.TARSI_PACKAGING_WEIGHT_KG||0))*100)/100};
   if(!Object.values(parcel).every(x=>Number.isFinite(x)&&x>0))return res.status(503).json({error:'Medidas del paquete sin configurar'});
   const payload={quotation:{address_from:{country_code:'MX',postal_code:'76099',area_level1:'QuerÃ©taro',area_level2:'QuerÃ©taro',area_level3:process.env.TARSI_ORIGIN_COLONY},address_to:{country_code:'MX',postal_code:destination.postal_code,area_level1:destination.area_level1,area_level2:destination.area_level2,area_level3:destination.area_level3},parcels:[parcel]}};
   const created=await json(API+'/api/v1/quotations',{method:'POST',headers,body:JSON.stringify(payload)});
   const id=created.id||created.quotation_id||created.data?.id||created.data?.attributes?.quotation_id;
   if(!id)throw Error('Skydropx no devolviÃ³ identificador');
   let result,rates=[];
   for(let attempt=0;attempt<7;attempt++){
     await sleep(1000);
     result=await json(API+'/api/v1/quotations/'+encodeURIComponent(id),{headers});
     const completed=result.is_completed===true||result.data?.attributes?.is_completed===true||result.data?.attributes?.status==='completed';
     if(completed){rates=unpackRates(result);break}
   }
   if(!rates.length)return res.status(503).json({error:'No se encontraron tarifas completas para este destino'});
   // Evita servicios no disponibles. SelecciÃ³n automÃ¡tica: menor costo, desempate por plazo.
   rates.sort((a,b)=>a.price-b.price||(a.days||999)-(b.days||999));
   const chosen=rates[0];const customer_price=Math.ceil((chosen.price+Math.max(chosen.price*.2,30))/10)*10;
   return res.status(200).json({customer_price,estimated_days:chosen.days||null,service:'EnvÃ­o TARSI',expires_at:new Date(Date.now()+23*3600*1000).toISOString()});
 }catch(e){console.error('Skydropx quote error:',e.message);return res.status(502).json({error:'No fue posible consultar las tarifas de Skydropx'});}
}

exports.handler=async(event)=>{
 const allowed='https://tarsistudiomx.github.io';
 const origin=event.headers?.origin||event.headers?.Origin||'';
 const cors={'Access-Control-Allow-Origin':allowed,'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store'};
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:cors,body:''};
 if(origin&&origin!==allowed)return {statusCode:403,headers:cors,body:JSON.stringify({error:'Origen no autorizado'})};
 let result={statusCode:200,headers:cors,body:''};
 const res={setHeader:(k,v)=>{result.headers[k]=v},status:(n)=>{result.statusCode=n;return res},json:(obj)=>{result.body=JSON.stringify(obj);return result}};
 let parsed={};try{parsed=JSON.parse(event.body||'{}')}catch{return {statusCode:400,headers:cors,body:JSON.stringify({error:'JSON invÃ¡lido'})}}
 return await handle({method:event.httpMethod,body:parsed},res);
};
