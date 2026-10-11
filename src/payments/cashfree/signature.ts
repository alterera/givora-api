import { createHmac, timingSafeEqual } from 'node:crypto';

export function cashfreeSignature(timestamp: string, rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}${rawBody}`).digest('base64');
}

export function verifyCashfreeWebhook(input: {
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  secret: string;
  now?: number;
  maxSkewSeconds?: number;
}): boolean {
  if (!input.timestamp || !input.signature || !input.secret) return false;
  const skew = Math.abs((input.now ?? Date.now()) / 1000 - Number(input.timestamp));
  if (!Number.isFinite(skew) || skew > (input.maxSkewSeconds ?? 300)) return false;
  const expected = cashfreeSignature(input.timestamp, input.rawBody, input.secret);
  const left = Buffer.from(expected);
  const right = Buffer.from(input.signature);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
