function collectStrings(value: unknown, out: string[], depth = 0) {
  if (depth > 8 || value == null) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, out, depth + 1);
  }
}

export function extractUpiQrPayload(response: Record<string, unknown>): string | null {
  const strings: string[] = [];
  collectStrings(response, strings);
  const upi = strings.find((s) => s.startsWith('upi://') || s.startsWith('UPI://'));
  if (upi) return upi;
  const data = response.data as Record<string, unknown> | undefined;
  const payload = data?.payload as Record<string, unknown> | undefined;
  for (const key of ['qrcode', 'qr_code', 'qrCode', 'qr_data', 'qrData']) {
    const val = payload?.[key];
    if (typeof val === 'string' && val.length > 8) return val;
  }
  return null;
}

export function extractPaymentUrl(response: Record<string, unknown>): string | null {
  const data = response.data as Record<string, unknown> | undefined;
  if (typeof data?.url === 'string' && data.url.startsWith('http')) return data.url;
  const strings: string[] = [];
  collectStrings(response, strings);
  return strings.find((s) => s.startsWith('http://') || s.startsWith('https://')) ?? null;
}
