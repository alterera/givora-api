import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramWebUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  now = Date.now(),
  maxAgeSeconds = 86_400,
): { user: TelegramWebUser; startParam: string | null } | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheck).digest('hex');
  const left = Buffer.from(expected);
  const right = Buffer.from(hash);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || Math.abs(now / 1000 - authDate) > maxAgeSeconds) return null;
  const rawUser = params.get('user');
  if (!rawUser) return null;
  const user = JSON.parse(rawUser) as TelegramWebUser;
  if (!user?.id) return null;
  return { user, startParam: params.get('start_param') };
}
