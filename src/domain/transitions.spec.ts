import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, GIFT_TRANSITIONS } from './transitions.js';
import { shippingPaise, paiseToRupees } from './money.js';
import { normalizePhone } from './phone.js';

describe('gift transitions', () => {
  it('allows payment to ready and claim', () => {
    expect(canTransition(GIFT_TRANSITIONS, 'PAYMENT_PENDING', 'READY_TO_SEND')).toBe(true);
    expect(canTransition(GIFT_TRANSITIONS, 'READY_TO_SEND', 'CLAIMED')).toBe(true);
  });

  it('rejects skipping payment', () => {
    expect(() => assertTransition(GIFT_TRANSITIONS, 'PAYMENT_PENDING', 'CLAIMED')).toThrow(
      /INVALID_TRANSITION/,
    );
  });
});

describe('pricing', () => {
  it('waives shipping above the threshold', () => {
    expect(shippingPaise(200000, 4900, 150000)).toBe(0);
    expect(shippingPaise(100000, 4900, 150000)).toBe(4900);
  });

  it('converts paise without float drift', () => {
    expect(paiseToRupees(149900)).toBe(1499);
  });
});

describe('phone', () => {
  it('normalises Indian numbers to E.164', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
  });
});
