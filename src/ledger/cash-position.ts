import { addMoney, money } from "../domain/money.ts";
import type { LedgerState } from "../domain/types.ts";

export function getCashPosition(state: LedgerState) {
  const bankCash = addMoney(...[...state.bankTransactions.values()].map((transaction) => transaction.amount));
  const settledIds = new Set([...state.bankTransactions.values()].map((transaction) => transaction.settlementId).filter(Boolean));
  const pendingSettlements = addMoney(
    ...[...state.settlements.values()]
      .filter((settlement) => !settledIds.has(settlement.id))
      .map((settlement) => settlement.expectedNet),
  );
  const expectedReceivables = addMoney(
    ...[...state.invoices.values()].map((invoice) => money(invoice.amount.amountMinor - invoice.paidAmount.amountMinor, invoice.amount.currency)),
  );

  return Object.freeze({
    actualBankCash: bankCash,
    pendingSettlements,
    expectedReceivables,
    labels: {
      actualBankCash: "ACTUAL",
      pendingSettlements: "PENDING",
      expectedReceivables: "FORECAST",
    } as const,
  });
}
