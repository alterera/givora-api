import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyTelegramInitData } from './init-data.js';

function sign(fields: Record<string, string>, botToken: string) {
  const dataCheck = Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

describe('telegram initData', () => {
  const botToken = '123:ABC';
  const now = 1_760_000_000_000;

  it('accepts a fresh valid payload', () => {
    const initData = sign(
      {
        auth_date: String(now / 1000),
        user: JSON.stringify({ id: 42, username: 'fan', first_name: 'Fan' }),
        start_param: 'c_8f3k2',
      },
      botToken,
    );
    const result = verifyTelegramInitData(initData, botToken, now);
    expect(result?.user.id).toBe(42);
    expect(result?.startParam).toBe('c_8f3k2');
  });

  it('rejects a tampered field', () => {
    const initData = sign(
      { auth_date: String(now / 1000), user: JSON.stringify({ id: 42 }) },
      botToken,
    ).replace('42', '99');
    expect(verifyTelegramInitData(initData, botToken, now)).toBeNull();
  });

  it('rejects a stale auth date and the wrong bot token', () => {
    const initData = sign(
      { auth_date: String(now / 1000 - 90_000), user: JSON.stringify({ id: 7 }) },
      botToken,
    );
    expect(verifyTelegramInitData(initData, botToken, now)).toBeNull();
    const fresh = sign(
      { auth_date: String(now / 1000), user: JSON.stringify({ id: 7 }) },
      botToken,
    );
    expect(verifyTelegramInitData(fresh, 'other-token', now)).toBeNull();
  });
});
