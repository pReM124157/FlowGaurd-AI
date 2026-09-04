import { money } from "../domain/money.ts";
import type { CanonicalEvent, EventType } from "../domain/types.ts";
import { forecastCash, type CashFlow } from "../forecast/forecast.ts";
import { getCashPosition } from "../ledger/cash-position.ts";
import { replayLedger } from "../ledger/projector.ts";
import { optimizeCashPlan } from "../optimizer/optimizer.ts";
import { scoreInvoiceRisk } from "../receivables/risk.ts";
import { reconcileSettlements, reconciliationMetrics, tracePayment } from "../reconciliation/reconcile.ts";
import { runScenario } from "../scenario/scenario.ts";

export const DEMO_ORG = "org_flowguard_demo";

let sequence = 0;

function event(type: EventType, sourceExternalId: string, payload: Record<string, unknown>, occurredAt = "2026-08-23T00:00:00.000+05:30"): CanonicalEvent {
  sequence += 1;
  return Object.freeze({
    id: `evt_p9_${String(sequence).padStart(4, "0")}`,
    type,
    provenance: Object.freeze({
      organizationId: DEMO_ORG,
      source: type === "BANK_CREDIT_RECEIVED" ? "BANK_SYNTHETIC" : type.startsWith("INVOICE") ? "INVOICE_SYNTHETIC" : "RAZORPAY_SYNTHETIC",
      sourceExternalId,
      occurredAt,
      createdAt: "2026-08-23T00:00:00.000+05:30",
    }),
    payload: Object.freeze(payload),
  });
}

export function demoEvents(): CanonicalEvent[] {
  sequence = 0;
  return [
    event("ORDER_CREATED", "order_ext_1", { orderId: "ORD-8821", customerId: "CUS-001", amount: money(1800000) }),
    event("PAYMENT_CAPTURED", "payment_capture_ext_1", { paymentId: "PAY-8821", orderId: "ORD-8821", amount: money(1800000) }),
    event("REFUND_PROCESSED", "refund_ext_1", { refundId: "REF-100", paymentId: "PAY-8821", amount: money(100000) }),
    event("SETTLEMENT_PROCESSED", "settlement_ext_119", {
      settlementId: "SETTLEMENT-119",
      lines: [{ paymentId: "PAY-8821", gross: money(1800000), fee: money(40000), tax: money(7200), refund: money(100000) }],
    }),
    event("BANK_CREDIT_RECEIVED", "bank_credit_ext_771", { bankTransactionId: "BANK-TXN-771", settlementId: "SETTLEMENT-119", amount: money(1652800) }),
    event("ORDER_CREATED", "order_ext_2", { orderId: "ORD-9000", customerId: "CUS-002", amount: money(1800000) }),
    event("PAYMENT_CAPTURED", "payment_capture_ext_2", { paymentId: "PAY-9000", orderId: "ORD-9000", amount: money(1800000) }),
    event("SETTLEMENT_PROCESSED", "settlement_ext_120", {
      settlementId: "SETTLEMENT-120",
      lines: [{ paymentId: "PAY-9000", gross: money(1800000), fee: money(40000), tax: money(7200), refund: money(0) }],
    }),
    event("BANK_CREDIT_RECEIVED", "bank_credit_ext_772", { bankTransactionId: "BANK-TXN-772", settlementId: "SETTLEMENT-120", amount: money(1692800) }),
    event("INVOICE_CREATED", "invoice_ext_204", { invoiceId: "INV-204", customerId: "CUS-ABC", amount: money(680000), dueAt: "2026-09-14T00:00:00.000+05:30" }),
    event("INVOICE_PAID", "invoice_pay_ext_204_1", { invoiceId: "INV-204", amount: money(280000) }),
  ];
}

export function demoModel() {
  const state = replayLedger(DEMO_ORG, demoEvents());
  const cash = getCashPosition(state);
  const reconciliation = reconcileSettlements(state);
  const forecastFlows: CashFlow[] = [
    { date: "2026-08-23", inflow: money(100000), outflow: money(0), label: "FORECAST" },
    { date: "2026-08-25", inflow: money(0), outflow: money(250000), label: "FORECAST" },
    { date: "2026-08-27", inflow: money(400000), outflow: money(0), label: "PREDICTED" },
  ];
  const forecast = forecastCash(cash.actualBankCash, forecastFlows, 30);
  const receivableRisk = scoreInvoiceRisk({
    customerId: "CUS-ABC",
    invoiceAmount: money(680000),
    customerMedianAmount: money(320000),
    medianDelayDays: 14,
    previousLateCount: 3,
    previousInvoiceCount: 5,
    currentOverdueDays: 4,
  });
  const scenario = runScenario(cash.actualBankCash, forecastFlows, { type: "MARKETING_SPEND", amount: money(300000), spendDate: "2026-08-26" }, 42);
  const plan = optimizeCashPlan(money(214000), forecast.minimumBalance, [
    { id: "collect_inv_204", kind: "COLLECT_INVOICE", impact: money(280000), cost: money(0), eligible: true },
    { id: "move_payroll", kind: "RESCHEDULE_VENDOR", impact: money(500000), cost: money(0), eligible: false, hardConstraintReason: "payroll cannot be postponed" },
    { id: "reduce_marketing", kind: "REDUCE_DISCRETIONARY_SPEND", impact: money(44000), cost: money(0), eligible: true },
  ]);

  return { state, cash, reconciliation, metrics: reconciliationMetrics(reconciliation), forecast, receivableRisk, scenario, plan };
}

export function paymentLineage(paymentId: string): string[] {
  return tracePayment(demoModel().state, paymentId);
}
