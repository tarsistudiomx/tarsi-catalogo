import {createHash,timingSafeEqual} from 'node:crypto';
import {sql} from 'kysely';
import {db} from './db';

export function matchesBearer(authorization:string,key?:string,storedDigest?:string) {
  const hash=(value:string)=>createHash('sha256').update(value).digest();
  const expected=key && key.length>=32 ? hash('Bearer '+key) :
    storedDigest && /^[a-f0-9]{64}$/.test(storedDigest) ? Buffer.from(storedDigest,'hex') : null;
  return expected!==null && timingSafeEqual(hash(authorization),expected);
}

export async function previewIntegration() {
  const result=await sql<{storefrontAuthSha256:string;mailAuthSha256:string;storefrontUrl:string}>`
    SELECT storefront_auth_sha256,mail_auth_sha256,storefront_url FROM tarsi_preview_integration WHERE slot
  `.execute(db);
  return result.rows[0];
}

export async function liveIntegration() {
  const result=await sql<{storefrontAuthSha256:string;mailAuthSha256:string}>`
    SELECT storefront_auth_sha256,mail_auth_sha256 FROM tarsi_live_integration WHERE slot
  `.execute(db);
  return result.rows[0];
}
