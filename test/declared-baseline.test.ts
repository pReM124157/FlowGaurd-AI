import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDeclaredBaseline } from "../src/server/declared-baseline.ts";

const baseProfile = {
  organizationName: "Nexa AI",
  industryType: "saas",
  timezone: "Asia/Kolkata",
  currency: "INR" as const,
  payrollAmountMinor: 100_000,
  payrollSchedule: "monthly",
  minimumLiquidityBufferMinor: 250_000,
  receivableTermsDays: 30,
  recurringObligations: [
    { label: "Payroll", amountMinor: 100_000, cadence: "monthly" },
    { label: "Vendor payments", amountMinor: 45_000, cadence: "monthly" },
  ],
  financingObligations: [{ lender: "Bank", amountMinor: 25_000, cadence: "monthly" }],
  notificationPreferences: { inAppEnabled: true, emailEnabled: true, minimumSeverity: "WARNING" as const },
};

describe("declared financial baseline", () => {
  it("keeps cash unknown when it was never declared and never duplicates payroll", () => {
    const baseline = buildDeclaredBaseline({ organizationId: "org", stage: "DATA_VALIDATION", updatedAt: "2026-08-26T00:00:00.000Z", businessProfile: { value: baseProfile, provenance: "USER_DECLARED", declaredAt: "2026-08-26T00:00:00.000Z" } });
    assert.equal(baseline.availableCash.state, "UNKNOWN");
    assert.equal(baseline.position30Day.state, "UNKNOWN");
    assert.equal(baseline.obligations30Day.amountMinor, 170_000);
  });

  it("calculates declared cash, estimated position, and runway only from supplied inputs", () => {
    const profile = { ...baseProfile, currentCashMinor: 1_000_000 };
    const baseline = buildDeclaredBaseline({ organizationId: "org", stage: "DATA_VALIDATION", updatedAt: "2026-08-26T00:00:00.000Z", businessProfile: { value: profile, provenance: "USER_DECLARED", declaredAt: "2026-08-26T00:00:00.000Z" } });
    assert.deepEqual(baseline.availableCash.amountMinor, 1_000_000);
    assert.equal(baseline.availableCash.state, "DECLARED");
    assert.equal(baseline.position30Day.amountMinor, 830_000);
    assert.equal(baseline.position30Day.state, "ESTIMATED");
    assert.equal(baseline.runway.days, 176);
  });

  it("normalizes weekly and bi-weekly declared commitments into the 30-day model", () => {
    const profile = {
      ...baseProfile,
      payrollAmountMinor: 10_000,
      payrollSchedule: "weekly",
      recurringObligations: [],
      financingObligations: [{ lender: "Lender", amountMinor: 20_000, cadence: "bi-weekly" }],
    };
    const baseline = buildDeclaredBaseline({ organizationId: "org", stage: "READY", updatedAt: "2026-08-26T00:00:00.000Z", businessProfile: { value: profile, provenance: "USER_DECLARED", declaredAt: "2026-08-26T00:00:00.000Z" } });

    assert.equal(baseline.obligations30Day.amountMinor, 86_666);
  });
});
