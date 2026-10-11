export interface CreateProviderOrderInput {
  orderId: string;
  amountPaise: number;
  currency: string;
  customerId: string;
  customerPhone: string;
  customerEmail?: string | null;
  returnUrl: string;
}

export interface ProviderOrder {
  providerOrderId: string;
  paymentSessionId: string;
}

export interface ProviderPayment {
  paymentId: string | null;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'USER_DROPPED' | 'NOT_ATTEMPTED';
  amountPaise: number;
}

export interface PaymentProvider {
  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder>;
  fetchPayments(providerOrderId: string): Promise<ProviderPayment>;
  refund(input: {
    providerOrderId: string;
    refundId: string;
    amountPaise: number;
  }): Promise<{ providerRefundId: string; status: string }>;
}
