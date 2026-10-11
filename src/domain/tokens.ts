import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function publicRef(): string {
  return `GV${randomBytes(5).toString('hex').toUpperCase()}`;
}

export function orderNumber(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `ORD${day}${randomBytes(3).toString('hex').toUpperCase()}`;
}

export function otpCode(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}
