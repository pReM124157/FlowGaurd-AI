import { createHash } from "node:crypto";
import { money } from "../domain/money.ts";
import type { CanonicalEvent, EventType } from "../domain/types.ts";
import { forecastCash, type CashFlow } from "../forecast/forecast.ts";
import { getCashPosition } from "../ledger/cash-position.ts";
import { replayLedger } from "../ledger/projector.ts";
import { scoreInvoiceRisk } from "../receivables/risk.ts";
import { reconcileSettlements, reconciliationMetrics, tracePayment } from "../reconciliation/reconcile.ts";
import { runScenario } from "../scenario/scenario.ts";

export const PHASE10_ORG = "org_phase10_demo";
export const PHASE10_COMPANY = "FlowGuard Demo Commerce Pvt Ltd";

let sequence = 0;

function event(type: EventType, sourceExternalId: string, payload: Record<string, unknown>, dayOffset = 0): CanonicalEvent {
  sequence += 1;
  const occurredAt = new Date(Date.UTC(2026, 7, 1 + dayOffset, 0, 0, 0)).toISOString();
  return Object.freeze({
    id: `p10_evt_${String(sequence).padStart(6, "0")}`,
    type,
    provenance: Object.freeze({
      organizationId: PHASE10_ORG,
      source: type === "BANK_CREDIT_RECEIVED" ? "BANK_SYNTHETIC" : type.startsWith("INVOICE") ? "INVOICE_SYNTHETIC" : "RAZORPAY_SYNTHETIC",
      sourceExternalId,
      occurredAt,
      createdAt: "2026-08-23T00:00:00.000Z",
    }),
    payload: Object.freeze(payload),
  });
}

export function phase10Events(): CanonicalEvent[] {
  sequence = 0;
  const events: CanonicalEvent[] = [];
  const settlementLines: Array<{ paymentId: string; gross: ReturnType<typeof money>; fee: ReturnType<typeof money>; tax: ReturnType<typeof money>; refund: ReturnType<typeof money> }> = [];

  for (let index = 1; index <= 5000; index += 1) {
    const amountMinor = 10_000 + (index % 35) * 1_000;
    const day = index % 90;
    const orderId = `P10-ORD-${String(index).padStart(5, "0")}`;
    const paymentId = `P10-PAY-${String(index).padStart(5, "0")}`;
    events.push(event("ORDER_CREATED", `p10_order_${index}`, { orderId, customerId: `CUS-${String(index % 45).padStart(3, "0")}`, amount: money(amountMinor) }, day));
    events.push(event("PAYMENT_CAPTURED", `p10_payment_${index}`, { paymentId, orderId, amount: money(amountMinor) }, day));
    const refund = index % 997 === 0 ? 2_000 : 0;
    if (refund > 0) events.push(event("REFUND_PROCESSED", `p10_refund_${index}`, { refundId: `P10-REF-${index}`, paymentId, amount: money(refund) }, day + 1));
    settlementLines.push({ paymentId, gross: money(amountMinor), fee: money(250), tax: money(45), refund: money(refund) });
  }

  const chunks = [
    settlementLines.slice(0, 1667),
    settlementLines.slice(1667, 3334),
    settlementLines.slice(3334),
  ];

  chunks.forEach((lines, index) => {
    const settlementId = `P10-SET-${index + 1}`;
    events.push(event("SETTLEMENT_PROCESSED", `p10_settlement_${index + 1}`, { settlementId, lines }, 91 + index));
    const expected = lines.reduce((sum, line) => sum + line.gross.amountMinor - line.fee.amountMinor - line.tax.amountMinor - line.refund.amountMinor, 0);
    const credit = index === 1 ? expected - 60_000 : expected;
    if (index !== 2) {
      events.push(event("BANK_CREDIT_RECEIVED", `p10_bank_${index + 1}`, { bankTransactionId: `P10-BANK-${index + 1}`, settlementId, amount: money(credit) }, 94 + index));
    }
  });

  events.push(events[8]);
  for (let index = 1; index <= 220; index += 1) {
    events.push(
      event(
        "INVOICE_CREATED",
        `p10_invoice_${index}`,
        { invoiceId: `P10-INV-${String(index).padStart(4, "0")}`, customerId: index <= 20 ? "CUS-MAJOR" : `CUS-${String(index % 45).padStart(3, "0")}`, amount: money(80_000 + (index % 12) * 10_000), dueAt: "2026-09-14T00:00:00.000Z" },
        70 + (index % 20),
      ),
    );
  }

  return events;
}

export function phase10Model() {
  const events = phase10Events();
  const state = replayLedger(PHASE10_ORG, events);
  const cash = getCashPosition(state);
  const reconciliation = reconcileSettlements(state);
  const metrics = reconciliationMetrics(reconciliation);
  const flows: CashFlow[] = [
    { date: "2026-08-23", inflow: money(400_000), outflow: money(0), label: "FORECAST" },
    { date: "2026-08-29", inflow: money(0), outflow: money(1_500_000), label: "FORECAST" },
    { date: "2026-09-14", inflow: money(1_000_000), outflow: money(0), label: "PREDICTED" },
  ];
  const forecast = forecastCash(cash.actualBankCash, flows, 30);
  const receivableRisk = scoreInvoiceRisk({
    customerId: "CUS-MAJOR",
    invoiceAmount: money(680_000),
    customerMedianAmount: money(300_000),
    medianDelayDays: 18,
    previousLateCount: 7,
    previousInvoiceCount: 10,
    currentOverdueDays: 6,
  });
  const scenario = runScenario(cash.actualBankCash, flows, { type: "MARKETING_SPEND", amount: money(300_000), spendDate: "2026-08-26" }, 42);

  return { events, state, cash, reconciliation, metrics, forecast, receivableRisk, scenario };
}

export function phase10GroundTruth() {
  const model = phase10Model();
  return Object.freeze({
    company: PHASE10_COMPANY,
    dataLabel: "DEMO DATA",
    expectedPaymentCount: 5000,
    expectedInvoiceCount: 220,
    expectedAvailableCashMinor: model.cash.actualBankCash.amountMinor,
    expectedPendingSettlementMinor: model.cash.pendingSettlements.amountMinor,
    expectedAtRiskReceivablesMinor: 680_000,
    expectedReconciliationExceptions: model.reconciliation.filter((item) => item.status !== "MATCHED").length,
    expectedMaterialMismatchIds: ["P10-SET-2"],
    expectedMissingBankCreditIds: ["P10-SET-3"],
    expectedDuplicateEconomicEvents: 0,
    expectedLineagePaymentId: "P10-PAY-00001",
    expectedLineage: tracePayment(model.state, "P10-PAY-00001"),
    incidents: ["duplicate financial event", "partial refund", "settlement mismatch", "missing bank credit", "delayed receivable", "refund spike", "upcoming payroll", "cash-shortfall event", "customer concentration risk", "normal clean records"],
  });
}

export function stateHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, mapReplacer)).digest("hex");
}

function mapReplacer(_key: string, value: unknown) {
  if (value instanceof Map) return [...value.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)));
  if (value instanceof Set) return [...value].sort();
  return value;
}
