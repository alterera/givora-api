export const GIFT_TRANSITIONS: Record<string, string[]> = {
  AWAITING_REDEMPTION: ['REDEEMED', 'FULFILLED', 'EXPIRED', 'CANCELLED'],
  REDEEMED: ['FULFILLED', 'REFUNDED'],
  EXPIRED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  FULFILLED: [],
  REFUNDED: [],
};

export const ORDER_TRANSITIONS: Record<string, string[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'FAILED', 'EXPIRED'],
  CONFIRMED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['REFUNDED'],
  FAILED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export const SHIPMENT_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['PACKED', 'FAILED'],
  PACKED: ['SHIPPED', 'FAILED'],
  SHIPPED: ['DELIVERED', 'FAILED', 'RETURNED'],
  DELIVERED: ['RETURNED'],
  FAILED: [],
  RETURNED: [],
};

export const PAYMENT_TRANSITIONS: Record<string, string[]> = {
  CREATED: ['PENDING', 'FAILED', 'EXPIRED'],
  PENDING: ['PAID', 'FAILED', 'EXPIRED'],
  PAID: [],
  FAILED: [],
  EXPIRED: [],
};

export const FULFILMENT_TRANSITIONS = SHIPMENT_TRANSITIONS;

export function canTransition(
  table: Record<string, string[]>,
  from: string,
  to: string,
): boolean {
  return (table[from] ?? []).includes(to);
}

export function assertTransition(
  table: Record<string, string[]>,
  from: string,
  to: string,
): void {
  if (!canTransition(table, from, to)) {
    throw new Error(`INVALID_TRANSITION:${from}->${to}`);
  }
}
