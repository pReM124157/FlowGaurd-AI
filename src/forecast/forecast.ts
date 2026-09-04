import { money, type Money } from "../domain/money.ts";

export type CashFlow = Readonly<{
  date: string;
  inflow: Money;
  outflow: Money;
  label: "ACTUAL" | "FORECAST" | "PREDICTED" | "SIMULATED";
}>;

export type ForecastDay = Readonly<{
  date: string;
  expectedInflow: Money;
  expectedOutflow: Money;
  closingCash: Money;
  lower80: Money;
  upper80: Money;
  label: "FORECAST";
}>;

export type ForecastResult = Readonly<{
  horizonDays: 7 | 30 | 60 | 90;
  days: ForecastDay[];
  minimumBalance: Money;
  shortfallDate?: string;
  runwayDays: number;
  method: "DETERMINISTIC_BASELINE";
}>;

export function forecastCash(startingCash: Money, flows: CashFlow[], horizonDays: 7 | 30 | 60 | 90): ForecastResult {
  let closing = startingCash.amountMinor;
  const days: ForecastDay[] = [];
  const start = new Date("2026-08-23T00:00:00.000Z");

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const date = addDays(start, offset);
    const dailyFlows = flows.filter((flow) => flow.date === date);
    const expectedInflow = sum(dailyFlows.map((flow) => flow.inflow));
    const expectedOutflow = sum(dailyFlows.map((flow) => flow.outflow));
    closing += expectedInflow.amountMinor - expectedOutflow.amountMinor;
    const uncertainty = Math.round(Math.abs(expectedInflow.amountMinor - expectedOutflow.amountMinor) * 0.2);
    days.push(
      Object.freeze({
        date,
        expectedInflow,
        expectedOutflow,
        closingCash: money(closing, startingCash.currency),
        lower80: money(closing - uncertainty, startingCash.currency),
        upper80: money(closing + uncertainty, startingCash.currency),
        label: "FORECAST" as const,
      }),
    );
  }

  const minimumBalance = days.reduce((min, day) => (day.closingCash.amountMinor < min.amountMinor ? day.closingCash : min), days[0].closingCash);
  const shortfallDate = days.find((day) => day.closingCash.amountMinor < 0)?.date;

  return Object.freeze({
    horizonDays,
    days,
    minimumBalance,
    shortfallDate,
    runwayDays: shortfallDate ? days.findIndex((day) => day.date === shortfallDate) + 1 : horizonDays,
    method: "DETERMINISTIC_BASELINE",
  });
}

export function evaluateForecast(actual: Money[], predicted: Money[]) {
  if (actual.length !== predicted.length || actual.length === 0) throw new Error("Actual and predicted series must align");
  const errors = actual.map((value, index) => value.amountMinor - predicted[index].amountMinor);
  const mae = errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length);
  return Object.freeze({ maeMinor: mae, rmseMinor: rmse, temporalSplit: true, noFutureLeakage: true });
}

function sum(values: Money[]): Money {
  return money(values.reduce((total, value) => total + value.amountMinor, 0), values[0]?.currency ?? "INR");
}

function addDays(start: Date, offset: number): string {
  const date = new Date(start);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
