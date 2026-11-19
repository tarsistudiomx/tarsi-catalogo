import { createHash, timingSafeEqual } from 'node:crypto';

// Store only SHA-256 fingerprints of independent, randomly generated 256-bit tokens.
const previewFingerprint = '';
const productionFingerprint = '';

export function sourceFor(request: Request): boolean | null {
  const header = request.headers.get('authorization') ?? '';
  const token = /^Bearer ([a-f0-9]{64})$/.exec(header)?.[1];
  if (!token) return null;
  const digest = createHash('sha256').update(token).digest();
  const matches = (fingerprint: string) => fingerprint.length === 64 &&
    timingSafeEqual(digest, Buffer.from(fingerprint, 'hex'));
  if (matches(previewFingerprint)) return true;
  if (matches(productionFingerprint)) return false;
  return null;
}
