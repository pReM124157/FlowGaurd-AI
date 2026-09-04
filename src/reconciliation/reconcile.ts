import { subtractMoney } from "../domain/money.ts";
import type { BankTransaction, LedgerState, Settlement } from "../domain/types.ts";

export type ReconciliationStatus =
  | "MATCHED"
  | "PARTIAL_MATCH"
  | "OVER_SETTLED"
  | "UNDER_SETTLED"
  | "MISSING_BANK_CREDIT"
  | "MISSING_SETTLEMENT"
  | "DUPLICATE"
  | "AMBIGUOUS"
  | "UNRECONCILED";

export type ReconciliationResult = Readonly<{
  settlementId?: string;
  bankTransactionId?: string;
  status: ReconciliationStatus;
  expectedAmountMinor: number;
  actualAmountMinor: number;
  differenceMinor: number;
  sourceRecords: string[];
  confidence: number;
  recommendedInvestigation: string;
}>;

export function reconcileSettlements(state: LedgerState): ReconciliationResult[] {
  const results: ReconciliationResult[] = [];
  const creditsBySettlement = groupCreditsBySettlement(state);

  for (const settlement of state.settlements.values()) {
    const credits = creditsBySettlement.get(settlement.id) ?? [];
    const actualAmountMinor = credits.reduce((sum, credit) => sum + credit.amount.amountMinor, 0);
    const difference = subtractMoney(settlement.expectedNet, {
      amountMinor: actualAmountMinor,
      currency: settlement.expectedNet.currency,
    });

    results.push(
      Object.freeze({
        settlementId: settlement.id,
        bankTransactionId: credits.length === 1 ? credits[0].id : undefined,
        status: statusFor(settlement, credits, actualAmountMinor),
        expectedAmountMinor: settlement.expectedNet.amountMinor,
        actualAmountMinor,
        differenceMinor: difference.amountMinor,
        sourceRecords: [settlement.id, ...credits.map((credit) => credit.id)],
        confidence: credits.length === 1 ? 1 : credits.length > 1 ? 0.7 : 0.3,
        recommendedInvestigation: investigationFor(settlement, credits, difference.amountMinor),
      }),
    );
  }

  for (const credit of state.bankTransactions.values()) {
    if (!credit.settlementId || !state.settlements.has(credit.settlementId)) {
      results.push(
        Object.freeze({
          bankTransactionId: credit.id,
          status: credit.settlementId ? "MISSING_SETTLEMENT" : "UNRECONCILED",
          expectedAmountMinor: 0,
          actualAmountMinor: credit.amount.amountMinor,
          differenceMinor: -credit.amount.amountMinor,
          sourceRecords: [credit.id],
          confidence: 0.2,
          recommendedInvestigation: "Bank credit cannot be linked to a known settlement.",
        }),
      );
    }
  }

  return results;
}

export function tracePayment(state: LedgerState, paymentId: string): string[] {
  const payment = state.payments.get(paymentId);
  if (!payment) throw new Error(`Payment not found: ${paymentId}`);

  const lineage = [payment.orderId, payment.id];

  for (const refund of state.refunds.values()) {
    if (refund.paymentId === paymentId) lineage.push(refund.id);
  }

  for (const settlement of state.settlements.values()) {
    if (settlement.lines.some((line) => line.paymentId === paymentId)) {
      lineage.push(settlement.id);
      for (const bankTransaction of state.bankTransactions.values()) {
        if (bankTransaction.settlementId === settlement.id) lineage.push(bankTransaction.id);
      }
    }
  }

  return lineage;
}

export function reconciliationMetrics(results: ReconciliationResult[]) {
  const matched = results.filter((result) => result.status === "MATCHED");
  const unreconciled = results.filter((result) => result.status !== "MATCHED");
  const varianceValueMinor = unreconciled.reduce((sum, result) => sum + Math.abs(result.differenceMinor), 0);
  return Object.freeze({
    reconciliationRate: results.length === 0 ? 1 : matched.length / results.length,
    unreconciledCount: unreconciled.length,
    varianceValueMinor,
  });
}

function groupCreditsBySettlement(state: LedgerState): Map<string, BankTransaction[]> {
  const grouped = new Map<string, BankTransaction[]>();
  for (const credit of state.bankTransactions.values()) {
    if (!credit.settlementId) continue;
    grouped.set(credit.settlementId, [...(grouped.get(credit.settlementId) ?? []), credit]);
  }
  return grouped;
}

function statusFor(settlement: Settlement, credits: BankTransaction[], actualAmountMinor: number): ReconciliationStatus {
  if (credits.length === 0) return "MISSING_BANK_CREDIT";
  if (credits.length > 1) return "AMBIGUOUS";
  if (actualAmountMinor === settlement.expectedNet.amountMinor) return "MATCHED";
  if (actualAmountMinor > settlement.expectedNet.amountMinor) return "OVER_SETTLED";
  if (actualAmountMinor > 0) return "UNDER_SETTLED";
  return "UNRECONCILED";
}

function investigationFor(settlement: Settlement, credits: BankTransaction[], differenceMinor: number): string {
  if (credits.length === 0) return "Expected settlement has no matching bank credit.";
  if (credits.length > 1) return "Multiple bank credits reference this settlement; inspect duplicate or split credits.";
  if (differenceMinor === 0) return "No investigation required.";
  return "Compare gateway fee, tax, refund, and bank credit records for variance.";
}
