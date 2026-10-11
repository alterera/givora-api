export function senderGiftView(gift: {
  id: string;
  publicRef: string;
  status: string;
  message: string;
  senderDisplayName: string;
  isAnonymous: boolean;
  revealTheme: string;
  recipientNameHint: string | null;
  recipientPhone: string | null;
  currency: string;
  subtotalPaise: number;
  shippingPaise: number;
  totalPaise: number;
  paymentExpiresAt: Date;
  claimExpiresAt: Date | null;
  openedAt: Date | null;
  claimedAt: Date | null;
  needsRefund: boolean;
  createdAt: Date;
  items: Array<{
    productName: string;
    variantName: string;
    imageUrl: string | null;
    quantity: number;
    unitPricePaise: number;
    lineTotalPaise: number;
  }>;
  events?: Array<{ type: string; createdAt: Date; toStatus: string | null }>;
  fulfilment?: { status: string; carrier: string | null; trackingRef: string | null; orderNumber: string } | null;
}) {
  return {
    id: gift.id,
    publicRef: gift.publicRef,
    status: gift.status,
    message: gift.message,
    senderDisplayName: gift.senderDisplayName,
    isAnonymous: gift.isAnonymous,
    revealTheme: gift.revealTheme,
    recipientNameHint: gift.recipientNameHint,
    recipientPhone: gift.recipientPhone,
    currency: gift.currency,
    subtotalPaise: gift.subtotalPaise,
    shippingPaise: gift.shippingPaise,
    totalPaise: gift.totalPaise,
    paymentExpiresAt: gift.paymentExpiresAt.toISOString(),
    claimExpiresAt: gift.claimExpiresAt?.toISOString() ?? null,
    openedAt: gift.openedAt?.toISOString() ?? null,
    claimedAt: gift.claimedAt?.toISOString() ?? null,
    needsRefund: gift.needsRefund,
    createdAt: gift.createdAt.toISOString(),
    items: gift.items,
    timeline: (gift.events ?? []).map((event) => ({
      type: event.type,
      status: event.toStatus,
      at: event.createdAt.toISOString(),
    })),
    fulfilment: gift.fulfilment
      ? {
          orderNumber: gift.fulfilment.orderNumber,
          status: gift.fulfilment.status,
          carrier: gift.fulfilment.carrier,
          trackingRef: gift.fulfilment.trackingRef,
        }
      : null,
  };
}
