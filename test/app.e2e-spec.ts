import { describe, expect, it } from 'vitest';
import { verifyCashfreeWebhook, cashfreeSignature } from '../src/payments/cashfree/signature.js';

describe('app e2e smoke', () => {
  it('keeps the webhook helper available to the suite', () => {
    const timestamp = '1760000000';
    const rawBody = '{}';
    const secret = 'secret-secret-secret';
    expect(
      verifyCashfreeWebhook({
        timestamp,
        rawBody,
        secret,
        signature: cashfreeSignature(timestamp, rawBody, secret),
        now: 1760000000 * 1000,
      }),
    ).toBe(true);
  });
});
