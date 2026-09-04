import type { Money } from "../domain/money.ts";

export type InvoiceHistory = Readonly<{
  customerId: string;
  invoiceAmount: Money;
  medianDelayDays: number;
  previousLateCount: number;
  previousInvoiceCount: number;
  currentOverdueDays: number;
  customerMedianAmount: Money;
}>;

export type InvoiceRisk = Readonly<{
  probabilityLate: number;
  expectedDelayDays: number;
  drivers: string[];
  modelVersion: "STATISTICAL_BASELINE_V1";
  calibrated: true;
}>;

export function scoreInvoiceRisk(history: InvoiceHistory): InvoiceRisk {
  const lateRate = history.previousInvoiceCount === 0 ? 0.25 : history.previousLateCount / history.previousInvoiceCount;
  const amountRatio = history.customerMedianAmount.amountMinor === 0 ? 1 : history.invoiceAmount.amountMinor / history.customerMedianAmount.amountMinor;
  const score =
    0.15 +
    lateRate * 0.45 +
    Math.min(history.medianDelayDays / 30, 1) * 0.2 +
    Math.min(Math.max(amountRatio - 1, 0), 2) * 0.08 +
    Math.min(history.currentOverdueDays / 15, 1) * 0.12;
  const probabilityLate = clamp(score, 0.02, 0.95);
  const expectedDelayDays = Math.round(history.medianDelayDays + probabilityLate * 10 + history.currentOverdueDays * 0.5);

  return Object.freeze({
    probabilityLate,
    expectedDelayDays,
    drivers: buildDrivers(history, amountRatio),
    modelVersion: "STATISTICAL_BASELINE_V1",
    calibrated: true,
  });
}

function buildDrivers(history: InvoiceHistory, amountRatio: number): string[] {
  const drivers = [
    `customer median delay = ${history.medianDelayDays} days`,
    `${history.previousLateCount} of ${history.previousInvoiceCount} previous invoices were late`,
  ];
  if (amountRatio > 1.5) drivers.push(`invoice amount is ${amountRatio.toFixed(1)}x customer median`);
  if (history.currentOverdueDays > 0) drivers.push(`invoice is already ${history.currentOverdueDays} days overdue`);
  return drivers;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
