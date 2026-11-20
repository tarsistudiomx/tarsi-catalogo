import {getDeployStore} from '@netlify/blobs';

export const config = {schedule: '2,7,12,17,22,27,32,37,42,47,52,57 * * * *'};

export default async function dispatchMail(request) {
  const event = await request.json().catch(()=>null);
  if (typeof event?.next_run !== 'string' || !Number.isFinite(Date.parse(event.next_run))) {
    return Response.json({error:'Scheduled invocation required'}, {status:403});
  }
  const settings=await getDeployStore({region:'us-east-1'}).get('tarsi-live-integration',{type:'json'});
  if (typeof settings?.mailWorkerKey !== 'string' || settings.mailWorkerKey.length<32) {
    throw new Error('Missing private mail worker key');
  }
  const response=await fetch('https://tarsi-control-ventas.floot.app/_api/tarsi_mail_worker',{
    method:'POST',headers:{Authorization:'Bearer '+settings.mailWorkerKey,'content-type':'application/json'},
    body:'{}',signal:AbortSignal.timeout(25000),redirect:'error'
  });
  if(!response.ok) throw new Error('TARSI mail worker returned HTTP '+response.status);
  const result=await response.json();
  if(result.available!==true||!Number.isInteger(result.processed))throw new Error('TARSI mail worker not available');
  console.log('TARSI_MAIL_SCHEDULE_OK',JSON.stringify({processed:result.processed,nextRun:event.next_run}));
  return Response.json({processed:result.processed});
}
