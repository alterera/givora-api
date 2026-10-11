export const GIFT_TRANSITIONS: Record<string, string[]> = {
  PAYMENT_PENDING: ['READY_TO_SEND', 'CANCELLED'],
  READY_TO_SEND: ['CLAIMED', 'EXPIRED', 'REVOKED'],
  EXPIRED: ['REFUNDED'],
  REVOKED: ['REFUNDED'],
  CLAIMED: ['REFUNDED'],
  CANCELLED: ['REFUNDED', 'READY_TO_SEND'],
  REFUNDED: [],
};

export const PAYMENT_TRANSITIONS: Record<string, string[]> = {
  CREATED: ['PENDING', 'FAILED', 'EXPIRED'],
  PENDING: ['PAID', 'FAILED', 'EXPIRED'],
  PAID: [],
  FAILED: [],
  EXPIRED: [],
};

export const FULFILMENT_TRANSITIONS: Record<string, string[]> = {
  PLACED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED'],
  CANCELLED: [],
  RETURNED: [],
};

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
