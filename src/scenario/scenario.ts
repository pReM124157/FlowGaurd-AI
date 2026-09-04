import { money, type Money } from "../domain/money.ts";
import { forecastCash, type CashFlow, type ForecastResult } from "../forecast/forecast.ts";

export type Scenario =
  | Readonly<{ type: "LARGEST_CUSTOMER_DELAY"; amount: Money; delayDays: number; originalDate: string }>
  | Readonly<{ type: "MARKETING_SPEND"; amount: Money; spendDate: string }>
  | Readonly<{ type: "REFUND_RATE_DOUBLES"; amount: Money; date: string }>;

export type ScenarioResult = Readonly<{
  baseline: ForecastResult;
  modified: ForecastResult;
  differenceMinimumCash: Money;
  assumptions: Scenario;
  seed: number;
}>;

export function runScenario(startingCash: Money, flows: CashFlow[], scenario: Scenario, seed = 42): ScenarioResult {
  const baseline = forecastCash(startingCash, flows, 30);
  const modifiedFlows = applyScenario(flows, scenario);
  const modified = forecastCash(startingCash, modifiedFlows, 30);
  return Object.freeze({
    baseline,
    modified,
    differenceMinimumCash: money(modified.minimumBalance.amountMinor - baseline.minimumBalance.amountMinor, startingCash.currency),
    assumptions: Object.freeze({ ...scenario }),
    seed,
  });
}

function applyScenario(flows: CashFlow[], scenario: Scenario): CashFlow[] {
  switch (scenario.type) {
    case "LARGEST_CUSTOMER_DELAY":
      return flows.map((flow) => {
        if (flow.date !== scenario.originalDate || flow.inflow.amountMinor < scenario.amount.amountMinor) return flow;
        const delayedDate = addDays(flow.date, scenario.delayDays);
        return Object.freeze({ ...flow, date: delayedDate });
      });
    case "MARKETING_SPEND":
      return [
        ...flows,
        Object.freeze({ date: scenario.spendDate, inflow: money(0), outflow: scenario.amount, label: "SIMULATED" as const }),
      ];
    case "REFUND_RATE_DOUBLES":
      return [...flows, Object.freeze({ date: scenario.date, inflow: money(0), outflow: scenario.amount, label: "SIMULATED" as const })];
    default:
      assertNever(scenario);
  }
}

function addDays(dateString: string, offset: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled scenario: ${JSON.stringify(value)}`);
}
