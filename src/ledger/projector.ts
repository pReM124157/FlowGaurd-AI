import { addMoney, assertNonNegative, assertSameCurrency, money } from "../domain/money.ts";
import type {
  BankTransaction,
  CanonicalEvent,
  Invoice,
  LedgerState,
  Order,
  Payment,
  Refund,
  Settlement,
  SettlementLine,
} from "../domain/types.ts";
import { sourceKey } from "../domain/types.ts";

export function emptyLedger(organizationId: string): LedgerState {
  return Object.freeze({
    organizationId,
    orders: new Map<string, Order>(),
    payments: new Map<string, Payment>(),
    refunds: new Map<string, Refund>(),
    settlements: new Map<string, Settlement>(),
    bankTransactions: new Map<string, BankTransaction>(),
    invoices: new Map<string, Invoice>(),
    eventIds: new Set<string>(),
    sourceKeys: new Set<string>(),
  });
}

export function replayLedger(organizationId: string, events: CanonicalEvent[]): LedgerState {
  return sortEvents(events).reduce((state, event) => applyEvent(state, event), emptyLedger(organizationId));
}

export function applyEvent(state: LedgerState, event: CanonicalEvent): LedgerState {
  if (event.provenance.organizationId !== state.organizationId) {
    throw new Error("Cross-organization event rejected");
  }

  if (state.eventIds.has(event.id) || state.sourceKeys.has(sourceKey(event))) {
    return state;
  }

  const next = cloneStateWithEvent(state, event);

  switch (event.type) {
    case "ORDER_CREATED":
      return putOrder(next, event);
    case "PAYMENT_CREATED":
      return putPayment(next, event, "CREATED");
    case "PAYMENT_CAPTURED":
      return capturePayment(next, event);
    case "PAYMENT_FAILED":
      return putPayment(next, event, "FAILED");
    case "REFUND_CREATED":
    case "REFUND_PROCESSED":
      return putRefund(next, event);
    case "SETTLEMENT_CREATED":
    case "SETTLEMENT_PROCESSED":
      return putSettlement(next, event);
    case "BANK_CREDIT_RECEIVED":
      return putBankCredit(next, event);
    case "INVOICE_CREATED":
      return putInvoice(next, event);
    case "INVOICE_PAID":
      return payInvoice(next, event);
    case "INVOICE_DUE":
    case "PAYABLE_CREATED":
    case "PAYABLE_PAID":
      return next;
    default:
      assertNever(event.type);
  }
}

function sortEvents(events: CanonicalEvent[]): CanonicalEvent[] {
  return [...events].sort((left, right) => {
    const time = Date.parse(left.provenance.occurredAt) - Date.parse(right.provenance.occurredAt);
    if (time !== 0) return time;
    return left.id.localeCompare(right.id);
  });
}

function cloneStateWithEvent(state: LedgerState, event: CanonicalEvent): LedgerState {
  return {
    organizationId: state.organizationId,
    orders: new Map(state.orders),
    payments: new Map(state.payments),
    refunds: new Map(state.refunds),
    settlements: new Map(state.settlements),
    bankTransactions: new Map(state.bankTransactions),
    invoices: new Map(state.invoices),
    eventIds: new Set([...state.eventIds, event.id]),
    sourceKeys: new Set([...state.sourceKeys, sourceKey(event)]),
  };
}

function putOrder(state: LedgerState, event: CanonicalEvent): LedgerState {
  const amount = payloadMoney(event, "amount");
  assertNonNegative(amount, "order amount");
  const order = Object.freeze({
    id: payloadString(event, "orderId"),
    organizationId: state.organizationId,
    amount,
    customerId: payloadString(event, "customerId"),
    createdAt: event.provenance.occurredAt,
  });
  state.orders.set(order.id, order);
  return state;
}

function putPayment(state: LedgerState, event: CanonicalEvent, status: Payment["status"]): LedgerState {
  const amount = payloadMoney(event, "amount");
  assertNonNegative(amount, "payment amount");
  const payment = Object.freeze({
    id: payloadString(event, "paymentId"),
    organizationId: state.organizationId,
    orderId: payloadString(event, "orderId"),
    amount,
    status,
  });
  state.payments.set(payment.id, payment);
  return state;
}

function capturePayment(state: LedgerState, event: CanonicalEvent): LedgerState {
  const amount = payloadMoney(event, "amount");
  assertNonNegative(amount, "captured payment amount");
  const paymentId = payloadString(event, "paymentId");
  const existing = state.payments.get(paymentId);
  const payment = Object.freeze({
    id: paymentId,
    organizationId: state.organizationId,
    orderId: payloadString(event, "orderId"),
    amount,
    status: "CAPTURED" as const,
    capturedAt: event.provenance.occurredAt,
  });

  if (existing) {
    assertSameCurrency(existing.amount.currency, amount.currency);
  }

  state.payments.set(payment.id, payment);
  return state;
}

function putRefund(state: LedgerState, event: CanonicalEvent): LedgerState {
  const amount = payloadMoney(event, "amount");
  assertNonNegative(amount, "refund amount");
  const refund = Object.freeze({
    id: payloadString(event, "refundId"),
    organizationId: state.organizationId,
    paymentId: payloadString(event, "paymentId"),
    amount,
    processedAt: event.type === "REFUND_PROCESSED" ? event.provenance.occurredAt : undefined,
  });
  state.refunds.set(refund.id, refund);
  return state;
}

function putSettlement(state: LedgerState, event: CanonicalEvent): LedgerState {
  const lines = payloadSettlementLines(event);
  const expectedNet = lines.reduce(
    (total, line) => addMoney(total, line.gross, money(-line.fee.amountMinor), money(-line.tax.amountMinor), money(-line.refund.amountMinor)),
    money(0),
  );
  const settlement = Object.freeze({
    id: payloadString(event, "settlementId"),
    organizationId: state.organizationId,
    lines,
    expectedNet,
    processedAt: event.type === "SETTLEMENT_PROCESSED" ? event.provenance.occurredAt : undefined,
  });
  state.settlements.set(settlement.id, settlement);
  return state;
}

function putBankCredit(state: LedgerState, event: CanonicalEvent): LedgerState {
  const amount = payloadMoney(event, "amount");
  assertNonNegative(amount, "bank credit amount");
  const bankTransaction = Object.freeze({
    id: payloadString(event, "bankTransactionId"),
    organizationId: state.organizationId,
    settlementId: optionalPayloadString(event, "settlementId"),
    amount,
    postedAt: event.provenance.occurredAt,
  });
  state.bankTransactions.set(bankTransaction.id, bankTransaction);
  return state;
}

function putInvoice(state: LedgerState, event: CanonicalEvent): LedgerState {
  const amount = payloadMoney(event, "amount");
  assertNonNegative(amount, "invoice amount");
  const invoice = Object.freeze({
    id: payloadString(event, "invoiceId"),
    organizationId: state.organizationId,
    customerId: payloadString(event, "customerId"),
    amount,
    dueAt: payloadString(event, "dueAt"),
    paidAmount: money(0, amount.currency),
  });
  state.invoices.set(invoice.id, invoice);
  return state;
}

function payInvoice(state: LedgerState, event: CanonicalEvent): LedgerState {
  const amount = payloadMoney(event, "amount");
  assertNonNegative(amount, "invoice payment amount");
  const invoiceId = payloadString(event, "invoiceId");
  const existing = state.invoices.get(invoiceId);
  if (!existing) throw new Error(`Invoice not found: ${invoiceId}`);
  const paidAmount = addMoney(existing.paidAmount, amount);
  if (paidAmount.amountMinor > existing.amount.amountMinor) {
    throw new Error(`Invoice overpayment rejected: ${invoiceId}`);
  }
  state.invoices.set(invoiceId, Object.freeze({ ...existing, paidAmount }));
  return state;
}

function payloadMoney(event: CanonicalEvent, key: string) {
  const value = event.payload[key];
  if (!isRecord(value) || typeof value.amountMinor !== "number" || value.currency !== "INR") {
    throw new Error(`Missing money payload field: ${key}`);
  }
  return money(value.amountMinor, value.currency);
}

function payloadSettlementLines(event: CanonicalEvent): SettlementLine[] {
  const raw = event.payload.lines;
  if (!Array.isArray(raw)) throw new Error("Settlement lines must be an array");

  return raw.map((line) => {
    if (!isRecord(line)) throw new Error("Invalid settlement line");
    const settlementLine = {
      paymentId: readString(line, "paymentId"),
      gross: readMoney(line, "gross"),
      fee: readMoney(line, "fee"),
      tax: readMoney(line, "tax"),
      refund: readMoney(line, "refund"),
    };
    assertNonNegative(settlementLine.gross, "settlement gross");
    assertNonNegative(settlementLine.fee, "settlement fee");
    assertNonNegative(settlementLine.tax, "settlement tax");
    assertNonNegative(settlementLine.refund, "settlement refund");
    return Object.freeze(settlementLine);
  });
}

function payloadString(event: CanonicalEvent, key: string): string {
  return readString(event.payload, key);
}

function optionalPayloadString(event: CanonicalEvent, key: string): string | undefined {
  const value = event.payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid string payload field: ${key}`);
  return value;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string payload field: ${key}`);
  return value;
}

function readMoney(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!isRecord(value) || typeof value.amountMinor !== "number" || value.currency !== "INR") {
    throw new Error(`Missing money field: ${key}`);
  }
  return money(value.amountMinor, value.currency);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled event type: ${value}`);
}
