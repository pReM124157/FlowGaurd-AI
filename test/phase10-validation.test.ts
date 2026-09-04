import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeAgentFailure } from "../src/agent/failure-policy.ts";
import { money } from "../src/domain/money.ts";
import { answerFinanceQuestion } from "../src/agent/controller.ts";
import { forecastCash } from "../src/forecast/forecast.ts";
import { optimizeCashPlan } from "../src/optimizer/optimizer.ts";
import { runScenario } from "../src/scenario/scenario.ts";
import { phase10Events, phase10GroundTruth, phase10Model, PHASE10_ORG, stateHash } from "../src/demo/phase10-company.ts";
import { replayLedger } from "../src/ledger/projector.ts";
import { getCashPosition } from "../src/ledger/cash-position.ts";
import { tracePayment } from "../src/reconciliation/reconcile.ts";

describe("phase 10 controlled ground truth", () => {
  it("builds a deterministic synthetic company with required incidents", () => {
    const model = phase10Model();
    const truth = phase10GroundTruth();

    assert.equal(model.state.payments.size, truth.expectedPaymentCount);
    assert.equal(model.state.invoices.size, truth.expectedInvoiceCount);
    assert.equal(model.cash.actualBankCash.amountMinor, truth.expectedAvailableCashMinor);
    assert.equal(model.cash.pendingSettlements.amountMinor, truth.expectedPendingSettlementMinor);
    assert.equal(model.reconciliation.filter((item) => item.status !== "MATCHED").length, truth.expectedReconciliationExceptions);
    assert.deepEqual(truth.expectedLineage, tracePayment(model.state, truth.expectedLineagePaymentId));
    assert.ok(truth.incidents.includes("settlement mismatch"));
    assert.ok(truth.incidents.includes("missing bank credit"));
  });

  it("replays five times with identical state hash and no money drift", () => {
    const hashes = new Set<string>();
    const cashValues = new Set<number>();
    for (let index = 0; index < 5; index += 1) {
      const state = replayLedger(PHASE10_ORG, phase10Events());
      hashes.add(stateHash(state));
      cashValues.add(getCashPosition(state).actualBankCash.amountMinor);
    }
    assert.equal(hashes.size, 1);
    assert.equal(cashValues.size, 1);
  });
});

describe("phase 10 cross-system audits", () => {
  it("keeps overview/cash/controller financial numbers consistent", () => {
    const model = phase10Model();
    const cash = getCashPosition(model.state);
    const answer = answerFinanceQuestion(model.state, PHASE10_ORG, "Where did my money go?");

    assert.equal(cash.actualBankCash.amountMinor, model.cash.actualBankCash.amountMinor);
    assert.match(answer.answer, new RegExp(String(model.cash.actualBankCash.amountMinor)));
  });

  it("detects all material reconciliation ground-truth incidents", () => {
    const model = phase10Model();
    const statuses = new Map(model.reconciliation.map((item) => [item.settlementId, item.status]));

    assert.equal(statuses.get("P10-SET-2"), "UNDER_SETTLED");
    assert.equal(statuses.get("P10-SET-3"), "MISSING_BANK_CREDIT");
  });

  it("keeps scenario output isolated from authoritative state", () => {
    const model = phase10Model();
    const before = stateHash(model.state);
    runScenario(model.cash.actualBankCash, [{ date: "2026-08-26", inflow: money(0), outflow: money(0), label: "FORECAST" }], { type: "MARKETING_SPEND", amount: money(300_000), spendDate: "2026-08-26" }, 9);
    assert.equal(stateHash(model.state), before);
  });

  it("returns no safe plan instead of violating hard constraints", () => {
    const plan = optimizeCashPlan(money(1_000_000), money(-1_000_000), [
      { id: "delay_payroll", kind: "RESCHEDULE_VENDOR", impact: money(1_000_000), cost: money(0), eligible: false, hardConstraintReason: "payroll cannot be postponed" },
    ]);

    assert.equal(plan.status, "NO_SAFE_PLAN_FOUND");
    assert.equal(plan.selectedActions.length, 0);
  });

  it("keeps forecast deterministic and labeled as forecast output", () => {
    const flows = [{ date: "2026-08-23", inflow: money(10_000), outflow: money(5_000), label: "FORECAST" as const }];
    const first = forecastCash(money(100_000), flows, 7);
    const second = forecastCash(money(100_000), flows, 7);
    assert.deepEqual(first, second);
    assert.equal(first.days[0].label, "FORECAST");
  });
});

describe("phase 10 agent failure policy", () => {
  it("fails closed for missing/stale/timeout/tool/optimizer/forecast/input/unsupported cases", () => {
    const cases = ["MISSING_DATA", "STALE_DATA", "TOOL_TIMEOUT", "TOOL_FAILURE", "OPTIMIZER_NO_SOLUTION", "FORECAST_FAILURE", "MALFORMED_USER_INPUT", "UNSUPPORTED_QUESTION"] as const;
    for (const kind of cases) {
      const response = safeAgentFailure(kind);
      assert.equal(response.safe, true);
      assert.deepEqual(response.authoritativeNumbers, []);
      assert.doesNotMatch(response.answer, /enough cash|guaranteed|10 crore/i);
    }
  });
});

describe("phase 10 demo reliability", () => {
  it("passes five consecutive in-process demo workflows", () => {
    for (let run = 1; run <= 5; run += 1) {
      const model = phase10Model();
      const truth = phase10GroundTruth();
      assert.equal(model.state.payments.size, 5000, `run ${run} payments`);
      assert.equal(model.reconciliation.filter((item) => item.status !== "MATCHED").length, truth.expectedReconciliationExceptions, `run ${run} reconciliation`);
      assert.ok(model.receivableRisk.probabilityLate > 0.5, `run ${run} receivables`);
      assert.equal(model.scenario.assumptions.type, "MARKETING_SPEND", `run ${run} scenario`);
      assert.ok(answerFinanceQuestion(model.state, PHASE10_ORG, "Where did my money go?").toolCalls.includes("get_cash_position"), `run ${run} controller`);
    }
  });
});
