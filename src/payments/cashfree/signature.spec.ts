import { describe, expect, it } from 'vitest';
import { cashfreeSignature, verifyCashfreeWebhook } from './signature.js';

describe('cashfree webhook signature', () => {
  it('accepts a fresh matching signature over the raw body', () => {
    const timestamp = '1760000000';
    const rawBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
    const secret = 'whsec_test';
    const signature = cashfreeSignature(timestamp, rawBody, secret);
    expect(
      verifyCashfreeWebhook({
        timestamp,
        signature,
        rawBody,
        secret,
        now: 1760000000 * 1000,
      }),
    ).toBe(true);
  });

  it('rejects a mutated body', () => {
    const timestamp = '1760000000';
    const secret = 'whsec_test';
    const signature = cashfreeSignature(timestamp, '{"ok":true}', secret);
    expect(
      verifyCashfreeWebhook({
        timestamp,
        signature,
        rawBody: '{"ok":false}',
        secret,
        now: 1760000000 * 1000,
      }),
    ).toBe(false);
  });
});
