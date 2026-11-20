// floot:external
import {liveIntegration,matchesBearer,previewIntegration} from '../helpers/previewIntegration';
import {drainOrderMail} from '../helpers/orderFlowMail';
export const flootPublic=true;
export const flootPreviewPublic=true;
export async function handle(request:Request){
  const env=process.env as Record<string,string|undefined>;
  const isTest=new URL(request.url).hostname.endsWith('.sandbox.floot.app');
  const key=isTest?env.TARSI_TEST_MAIL_WORKER_KEY:env.TARSI_MAIL_WORKER_KEY;
  const configured = !key ? await (isTest ? previewIntegration() : liveIntegration()) : undefined;
  if(!matchesBearer(request.headers.get('authorization')||'',key,configured?.mailAuthSha256))
    return Response.json({error:'Acceso denegado.'},{status:403});
  const result=await drainOrderMail(isTest);
  return Response.json(result,{status:result.available?200:503});
}
