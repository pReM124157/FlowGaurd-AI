import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { money } from "../src/domain/money.ts";
import { evaluateForecast, forecastCash, type CashFlow } from "../src/forecast/forecast.ts";
import { optimizeCashPlan } from "../src/optimizer/optimizer.ts";
import { scoreInvoiceRisk } from "../src/receivables/risk.ts";
import { runScenario } from "../src/scenario/scenario.ts";

const flows: CashFlow[] = [
  { date: "2026-08-23", inflow: money(100000), outflow: money(0), label: "FORECAST" },
  { date: "2026-08-25", inflow: money(0), outflow: money(250000), label: "FORECAST" },
  { date: "2026-08-27", inflow: money(400000), outflow: money(0), label: "PREDICTED" },
];

describe("forecast baseline", () => {
  it("produces cash forecast with uncertainty and shortfall detection", () => {
    const result = forecastCash(money(50000), flows, 7);

    assert.equal(result.method, "DETERMINISTIC_BASELINE");
    assert.equal(result.days.length, 7);
    assert.equal(result.shortfallDate, "2026-08-25");
    assert.equal(result.minimumBalance.amountMinor, -100000);
    assert.equal(result.days[0].label, "FORECAST");
    assert.ok(result.days[0].lower80.amountMinor < result.days[0].upper80.amountMinor);
  });

  it("evaluates using aligned temporal series", () => {
    const metrics = evaluateForecast([money(100), money(200)], [money(90), money(210)]);

    assert.equal(metrics.maeMinor, 10);
    assert.equal(metrics.noFutureLeakage, true);
    assert.equal(metrics.temporalSplit, true);
  });
});

describe("receivables risk baseline", () => {
  it("scores late-payment risk with traceable drivers", () => {
    const risk = scoreInvoiceRisk({
      customerId: "CUS-ABC",
      invoiceAmount: money(680000),
      customerMedianAmount: money(320000),
      medianDelayDays: 14,
      previousLateCount: 3,
      previousInvoiceCount: 5,
      currentOverdueDays: 4,
    });

    assert.ok(risk.probabilityLate > 0.5);
    assert.ok(risk.drivers.some((driver) => driver.includes("median delay")));
    assert.equal(risk.modelVersion, "STATISTICAL_BASELINE_V1");
  });
});

describe("scenario engine", () => {
  it("keeps baseline immutable and is reproducible with the same seed", () => {
    const scenario = { type: "LARGEST_CUSTOMER_DELAY" as const, amount: money(400000), delayDays: 10, originalDate: "2026-08-27" };
    const first = runScenario(money(50000), flows, scenario, 123);
    const second = runScenario(money(50000), flows, scenario, 123);

    assert.deepEqual(first, second);
    assert.equal(first.baseline.shortfallDate, "2026-08-25");
    assert.equal(first.modified.shortfallDate, "2026-08-25");
    assert.equal(flows[2].date, "2026-08-27");
  });
});

describe("optimizer", () => {
  it("rejects ineligible hard-constraint actions and improves objective against do nothing", () => {
    const doNothingObjective = 214000;
    const plan = optimizeCashPlan(money(214000), money(-214000), [
      { id: "collect_inv_204", kind: "COLLECT_INVOICE", impact: money(280000), cost: money(0), eligible: true },
      { id: "move_payroll", kind: "RESCHEDULE_VENDOR", impact: money(500000), cost: money(0), eligible: false, hardConstraintReason: "payroll cannot be postponed" },
      { id: "reduce_marketing", kind: "REDUCE_DISCRETIONARY_SPEND", impact: money(44000), cost: money(0), eligible: true },
    ]);

    assert.equal(plan.rejectedActions[0].id, "move_payroll");
    assert.ok(plan.objectiveValueMinor < doNothingObjective);
    assert.equal(plan.expectedMinimumCash.amountMinor, 110000);
  });
});
