import { money } from "../src/domain/money.ts";
import type { CanonicalEvent, EventType } from "../src/domain/types.ts";

export const ORG = "org_flowguard_demo";

let sequence = 0;

export function event(
  type: EventType,
  sourceExternalId: string,
  payload: Record<string, unknown>,
  occurredAt = "2026-08-23T00:00:00.000+05:30",
): CanonicalEvent {
  sequence += 1;
  return Object.freeze({
    id: `evt_${String(sequence).padStart(4, "0")}`,
    type,
    provenance: Object.freeze({
      organizationId: ORG,
      source: type === "BANK_CREDIT_RECEIVED" ? "BANK_SYNTHETIC" : type.startsWith("INVOICE") ? "INVOICE_SYNTHETIC" : "RAZORPAY_SYNTHETIC",
      sourceExternalId,
      occurredAt,
      createdAt: "2026-08-23T00:00:00.000+05:30",
    }),
    payload: Object.freeze(payload),
  });
}

export function baseEvents(): CanonicalEvent[] {
  return [
    event("ORDER_CREATED", "order_ext_1", {
      orderId: "ORD-8821",
      customerId: "CUS-001",
      amount: money(1800000),
    }),
    event("PAYMENT_CREATED", "payment_create_ext_1", {
      paymentId: "PAY-8821",
      orderId: "ORD-8821",
      amount: money(1800000),
    }),
    event("PAYMENT_CAPTURED", "payment_capture_ext_1", {
      paymentId: "PAY-8821",
      orderId: "ORD-8821",
      amount: money(1800000),
    }),
    event("REFUND_PROCESSED", "refund_ext_1", {
      refundId: "REF-100",
      paymentId: "PAY-8821",
      amount: money(100000),
    }),
    event("SETTLEMENT_PROCESSED", "settlement_ext_119", {
      settlementId: "SETTLEMENT-119",
      lines: [
        {
          paymentId: "PAY-8821",
          gross: money(1800000),
          fee: money(40000),
          tax: money(7200),
          refund: money(100000),
        },
      ],
    }),
    event("BANK_CREDIT_RECEIVED", "bank_credit_ext_771", {
      bankTransactionId: "BANK-TXN-771",
      settlementId: "SETTLEMENT-119",
      amount: money(1652800),
    }),
    event("INVOICE_CREATED", "invoice_ext_204", {
      invoiceId: "INV-204",
      customerId: "CUS-ABC",
      amount: money(680000),
      dueAt: "2026-09-14T00:00:00.000+05:30",
    }),
    event("INVOICE_PAID", "invoice_pay_ext_204_1", {
      invoiceId: "INV-204",
      amount: money(280000),
    }),
  ];
}

export function mismatchEvents(): CanonicalEvent[] {
  return [
    event("ORDER_CREATED", "order_ext_mismatch", {
      orderId: "ORD-9000",
      customerId: "CUS-002",
      amount: money(1800000),
    }),
    event("PAYMENT_CAPTURED", "payment_capture_ext_mismatch", {
      paymentId: "PAY-9000",
      orderId: "ORD-9000",
      amount: money(1800000),
    }),
    event("SETTLEMENT_PROCESSED", "settlement_ext_120", {
      settlementId: "SETTLEMENT-120",
      lines: [
        {
          paymentId: "PAY-9000",
          gross: money(1800000),
          fee: money(40000),
          tax: money(7200),
          refund: money(0),
        },
      ],
    }),
    event("BANK_CREDIT_RECEIVED", "bank_credit_ext_772", {
      bankTransactionId: "BANK-TXN-772",
      settlementId: "SETTLEMENT-120",
      amount: money(1692800),
    }),
  ];
}
