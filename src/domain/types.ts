import type { Money } from "./money.ts";

export type SourceSystem = "RAZORPAY_SYNTHETIC" | "RAZORPAY_LIVE" | "BANK_SYNTHETIC" | "INVOICE_SYNTHETIC" | "INTERNAL" | "USER_DECLARED";

export type EventType =
  | "ORDER_CREATED"
  | "PAYMENT_CREATED"
  | "PAYMENT_CAPTURED"
  | "PAYMENT_FAILED"
  | "REFUND_CREATED"
  | "REFUND_PROCESSED"
  | "SETTLEMENT_CREATED"
  | "SETTLEMENT_PROCESSED"
  | "BANK_CREDIT_RECEIVED"
  | "INVOICE_CREATED"
  | "INVOICE_DUE"
  | "INVOICE_PAID"
  | "PAYABLE_CREATED"
  | "PAYABLE_PAID";

export type Provenance = Readonly<{
  organizationId: string;
  source: SourceSystem;
  sourceExternalId: string;
  occurredAt: string;
  createdAt: string;
}>;

export type CanonicalEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> =
  Readonly<{
    id: string;
    type: EventType;
    provenance: Provenance;
    payload: Readonly<TPayload>;
  }>;

export type Order = Readonly<{
  id: string;
  organizationId: string;
  amount: Money;
  customerId: string;
  createdAt: string;
}>;

export type PaymentStatus = "CREATED" | "CAPTURED" | "FAILED";

export type Payment = Readonly<{
  id: string;
  organizationId: string;
  orderId: string;
  amount: Money;
  status: PaymentStatus;
  capturedAt?: string;
}>;

export type Refund = Readonly<{
  id: string;
  organizationId: string;
  paymentId: string;
  amount: Money;
  processedAt?: string;
}>;

export type SettlementLine = Readonly<{
  paymentId: string;
  gross: Money;
  fee: Money;
  tax: Money;
  refund: Money;
}>;

export type Settlement = Readonly<{
  id: string;
  organizationId: string;
  lines: SettlementLine[];
  expectedNet: Money;
  processedAt?: string;
}>;

export type BankTransaction = Readonly<{
  id: string;
  organizationId: string;
  settlementId?: string;
  amount: Money;
  postedAt: string;
}>;

export type Invoice = Readonly<{
  id: string;
  organizationId: string;
  customerId: string;
  amount: Money;
  dueAt: string;
  paidAmount: Money;
}>;

export type LedgerState = Readonly<{
  organizationId: string;
  orders: ReadonlyMap<string, Order>;
  payments: ReadonlyMap<string, Payment>;
  refunds: ReadonlyMap<string, Refund>;
  settlements: ReadonlyMap<string, Settlement>;
  bankTransactions: ReadonlyMap<string, BankTransaction>;
  invoices: ReadonlyMap<string, Invoice>;
  eventIds: ReadonlySet<string>;
  sourceKeys: ReadonlySet<string>;
}>;

export function sourceKey(event: CanonicalEvent): string {
  const { organizationId, source, sourceExternalId } = event.provenance;
  return `${organizationId}:${source}:${sourceExternalId}`;
}
