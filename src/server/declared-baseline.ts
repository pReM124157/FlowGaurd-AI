import type { BusinessProfileInput, OnboardingRecord } from "./onboarding.ts";

export type FinancialProvenance = "ACTUAL" | "PENDING" | "DECLARED" | "ESTIMATED" | "FORECAST" | "PREDICTED" | "SIMULATED" | "UNKNOWN";

export type BaselineMetric = Readonly<{
  amountMinor?: number;
  days?: number;
  state: FinancialProvenance;
  basedOn: readonly string[];
  note: string;
}>;

export type DeclaredFinancialBaseline = Readonly<{
  hasContext: boolean;
  confidence: number;
  availableCash: BaselineMetric;
  obligations30Day: BaselineMetric;
  position30Day: BaselineMetric;
  runway: BaselineMetric;
  liquidityBuffer: BaselineMetric;
  capturedAt?: string;
}>;

/**
 * A deliberately conservative financial baseline. It is deterministic and
 * never promotes declared inputs to an actual bank balance. A future verified
 * source therefore replaces/reconciles individual values rather than being
 * added to this baseline.
 */
export function buildDeclaredBaseline(record: OnboardingRecord): DeclaredFinancialBaseline {
  const profile = record.businessProfile?.value;
  if (!profile) return unknownBaseline();

  const obligations = recurringObligations(profile);
  const cash = declaredCash(profile);
  const buffer = profile.minimumLiquidityBufferMinor;
  const obligationMetric: BaselineMetric = obligations > 0
    ? { amountMinor: obligations, state: "DECLARED", basedOn: ["declared payroll", "declared recurring obligations", "declared financing obligations"], note: "Next 30 days from your onboarding information" }
    : { state: "UNKNOWN", basedOn: [], note: "No recurring obligations were supplied" };
  const cashMetric: BaselineMetric = cash === undefined
    ? { state: "UNKNOWN", basedOn: [], note: "Add a declared cash balance or connect a bank to verify it" }
    : { amountMinor: cash, state: "DECLARED", basedOn: ["declared cash balance"], note: "Provided by you during onboarding" };
  const position: BaselineMetric = cash === undefined
    ? { state: "UNKNOWN", basedOn: obligationMetric.basedOn, note: "Needs a declared or verified starting cash balance" }
    : { amountMinor: cash - obligations, state: "ESTIMATED", basedOn: [...cashMetric.basedOn, ...obligationMetric.basedOn], note: "Declared cash less known 30-day obligations; no unprovided inflows assumed" };
  const runway: BaselineMetric = cash === undefined || obligations <= 0
    ? { state: "UNKNOWN", basedOn: [], note: cash === undefined ? "Needs a declared or verified cash balance" : "Needs recurring operating costs" }
    : { days: Math.max(0, Math.floor((cash / obligations) * 30)), state: "ESTIMATED", basedOn: [...cashMetric.basedOn, ...obligationMetric.basedOn], note: "Declared baseline before live reconciliation" };

  return Object.freeze({
    hasContext: true,
    // Deterministic coverage score—not an LLM confidence claim.
    confidence: [cash !== undefined, obligations > 0, buffer > 0].filter(Boolean).length / 3,
    availableCash: cashMetric,
    obligations30Day: obligationMetric,
    position30Day: position,
    runway,
    liquidityBuffer: buffer > 0
      ? { amountMinor: buffer, state: "DECLARED", basedOn: ["liquidity buffer preference"], note: "Your stated minimum cash comfort level" }
      : { state: "UNKNOWN", basedOn: [], note: "No liquidity buffer was supplied" },
    capturedAt: record.businessProfile?.declaredAt,
  });
}

function recurringObligations(profile: BusinessProfileInput): number {
  // Payroll is stored separately. Exclude a mirrored payroll record so the
  // same declared commitment is never counted twice.
  const recurring = profile.recurringObligations
    .filter((item) => item.label.trim().toLowerCase() !== "payroll")
    .reduce((total, item) => total + monthlyAmount(item.amountMinor, item.cadence), 0);
  const financing = profile.financingObligations.reduce((total, item) => total + monthlyAmount(item.amountMinor, item.cadence), 0);
  return monthlyAmount(profile.payrollAmountMinor, profile.payrollSchedule) + recurring + financing;
}

/** Converts declared recurrence amounts into a conservative 30-day equivalent. */
function monthlyAmount(amountMinor: number, cadence: string): number {
  if (cadence === "weekly") return Math.round((amountMinor * 52) / 12);
  if (cadence === "bi-weekly") return Math.round((amountMinor * 26) / 12);
  return amountMinor;
}

function declaredCash(profile: BusinessProfileInput): number | undefined {
  // Optional backwards-compatible field: only present after a user explicitly
  // enters an approximate starting balance. It is never inferred from a buffer.
  const candidate = (profile as BusinessProfileInput & { currentCashMinor?: number }).currentCashMinor;
  return Number.isSafeInteger(candidate) && candidate! >= 0 ? candidate : undefined;
}

function unknownBaseline(): DeclaredFinancialBaseline {
  const unknown: BaselineMetric = { state: "UNKNOWN", basedOn: [], note: "Complete onboarding or connect a financial source" };
  return Object.freeze({ hasContext: false, confidence: 0, availableCash: unknown, obligations30Day: unknown, position30Day: unknown, runway: unknown, liquidityBuffer: unknown });
}
