export function normalizePhone(input: string): string {
  const trimmed = input.replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;
  if (/^[6-9]\d{9}$/.test(trimmed)) return `+91${trimmed}`;
  if (/^91[6-9]\d{9}$/.test(trimmed)) return `+${trimmed}`;
  throw new Error('INVALID_PHONE');
}

export function phonesMatch(a: string, b: string): boolean {
  return normalizePhone(a) === normalizePhone(b);
}
