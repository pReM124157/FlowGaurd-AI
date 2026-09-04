import { formatMoney } from "../domain/money.ts";
import { getCashPosition } from "../ledger/cash-position.ts";
import { replayLedger } from "../ledger/projector.ts";
import { reconciliationMetrics, reconcileSettlements, tracePayment } from "../reconciliation/reconcile.ts";
import { baseEvents, mismatchEvents, ORG } from "../../test/fixtures.ts";

const state = replayLedger(ORG, [...baseEvents(), ...mismatchEvents()]);
const cash = getCashPosition(state);
const reconciliation = reconcileSettlements(state);
const metrics = reconciliationMetrics(reconciliation);

console.log("FLOWGUARD AI SYNTHETIC DEMO COMPANY");
console.log("Data label: SYNTHETIC");
console.log("");
console.log("Cash position");
console.log(`ACTUAL bank cash: ${formatMoney(cash.actualBankCash)}`);
console.log(`PENDING settlements: ${formatMoney(cash.pendingSettlements)}`);
console.log(`FORECAST receivables: ${formatMoney(cash.expectedReceivables)}`);
console.log("");
console.log("Where did PAY-8821 go?");
console.log(tracePayment(state, "PAY-8821").join(" -> "));
console.log("");
console.log("Reconciliation");
for (const result of reconciliation) {
  console.log(
    `${result.status}: settlement=${result.settlementId ?? "n/a"} expected=${formatMoney({
      amountMinor: result.expectedAmountMinor,
      currency: "INR",
    })} actual=${formatMoney({ amountMinor: result.actualAmountMinor, currency: "INR" })} variance=${formatMoney({
      amountMinor: result.differenceMinor,
      currency: "INR",
    })}`,
  );
}
console.log("");
console.log(`Reconciliation rate: ${(metrics.reconciliationRate * 100).toFixed(1)}%`);
console.log(`Unreconciled count: ${metrics.unreconciledCount}`);
console.log(`Variance value: ${formatMoney({ amountMinor: metrics.varianceValueMinor, currency: "INR" })}`);
