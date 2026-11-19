// floot:external
import {createHash,timingSafeEqual} from 'node:crypto';
import {drainOrderMail} from '../helpers/orderFlowMail';
export const flootPublic=true;
export const flootPreviewPublic=true;
export async function handle(request:Request){
  const env=process.env as Record<string,string|undefined>;
  const isTest=new URL(request.url).hostname.endsWith('.sandbox.floot.app');
  const key=isTest?env.TARSI_TEST_MAIL_WORKER_KEY:env.TARSI_MAIL_WORKER_KEY;
  const token=request.headers.get('authorization')||'';
  const hash=(value:string)=>createHash('sha256').update(value).digest();
  if(!key||key.length<32||!timingSafeEqual(hash(token),hash('Bearer '+key)))return Response.json({error:'Acceso denegado.'},{status:403});
  const result=await drainOrderMail(isTest);
  return Response.json(result,{status:result.available?200:503});
}
