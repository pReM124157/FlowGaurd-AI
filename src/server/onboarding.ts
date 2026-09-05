import type { OrganizationRuntime } from "./live-store.ts";

export type OnboardingStage =
  | "BUSINESS_PROFILE"
  | "RISK_PREFERENCES"
  | "DATA_CONNECTIONS"
  | "DATA_VALIDATION"
  | "INITIAL_CALCULATION"
  | "READY";

export type UserDeclared<T> = Readonly<{
  value: T;
  provenance: "USER_DECLARED";
  declaredAt: string;
}>;

export type BusinessProfileInput = Readonly<{
  organizationName: string;
  industryType: string;
  /** Every selected answer from the revenue-source step. */
  revenueChannels?: ReadonlyArray<string>;
  /** Every selected answer from the cash-pressure step. */
  cashPressureSources?: ReadonlyArray<string>;
  /** Requested connection tiles from the final onboarding step. */
  connectionRequests?: ReadonlyArray<string>;
  timezone: string;
  currency: "INR";
  payrollAmountMinor: number;
  /** Optional approximate cash balance explicitly supplied by the user. */
  currentCashMinor?: number;
  payrollSchedule: string;
  minimumLiquidityBufferMinor: number;
  receivableTermsDays: number;
  recurringObligations: ReadonlyArray<{ label: string; amountMinor: number; cadence: string; dueDay?: number }>;
  financingObligations: ReadonlyArray<{ lender: string; amountMinor: number; cadence: string; dueDay?: number }>;
  notificationPreferences: {
    inAppEnabled: boolean;
    emailEnabled: boolean;
    minimumSeverity: "WARNING" | "HIGH" | "CRITICAL";
  };
}>;

export type RiskPreferencesInput = Readonly<{
  lateReceivableProbability: number;
  materialAmountMinor: number;
  feeRateUpperBound: number;
  concentrationThreshold: number;
}>;

export type DataConnectionInput = Readonly<{
  razorpay: "NOT_CONNECTED" | "CONNECTED" | "SKIPPED";
  bank: "NOT_CONNECTED" | "IMPORTED" | "CONNECTED" | "SKIPPED";
  receivables: "NOT_CONNECTED" | "IMPORTED" | "CONNECTED" | "SKIPPED";
}>;

export type ReadinessAudit = Readonly<{
  organizationId: string;
  readyForDashboard: boolean;
  reliableCashSource: boolean;
  missingSources: string[];
  freshness: Record<string, string>;
  metricReadiness: {
    availableCash: MetricReadiness;
    pendingSettlement: MetricReadiness;
    receivables: MetricReadiness;
    forecast: MetricReadiness;
  };
  assessedAt: string;
}>;

export type MetricReadiness = Readonly<{
  status: "READY" | "INSUFFICIENT";
  label?: "ACTUAL" | "PENDING" | "FORECAST" | "PREDICTED" | "SIMULATED" | "USER_DECLARED";
  reason?: string;
}>;

export type OnboardingRecord = Readonly<{
  organizationId: string;
  stage: OnboardingStage;
  businessProfile?: UserDeclared<BusinessProfileInput>;
  riskPreferences?: UserDeclared<RiskPreferencesInput>;
  dataConnections?: UserDeclared<DataConnectionInput>;
  readinessAudit?: ReadinessAudit;
  firstAssessment?: unknown;
  updatedAt: string;
}>;

const onboardingByOrg = new Map<string, OnboardingRecord>();

export function seedOnboarding(organizationId: string, stage: OnboardingStage): void {
  onboardingByOrg.set(organizationId, Object.freeze({ organizationId, stage, updatedAt: nowIso() }));
}

export function restoreOnboardingStage(organizationId: string, stage: string | undefined): void {
  if (stage && ["BUSINESS_PROFILE", "RISK_PREFERENCES", "DATA_CONNECTIONS", "DATA_VALIDATION", "INITIAL_CALCULATION", "READY"].includes(stage)) {
    seedOnboarding(organizationId, stage as OnboardingStage);
  }
}

/** Restores the full tenant-owned onboarding record after a server restart or login. */
export function restoreOnboardingRecord(organizationId: string, persisted: {
  stage?: unknown;
  profile?: unknown;
  risk_preferences?: unknown;
  data_connections?: unknown;
  updated_at?: unknown;
} | undefined): OnboardingRecord {
  const stage = typeof persisted?.stage === "string" && ["BUSINESS_PROFILE", "RISK_PREFERENCES", "DATA_CONNECTIONS", "DATA_VALIDATION", "INITIAL_CALCULATION", "READY"].includes(persisted.stage)
    ? persisted.stage as OnboardingStage
    : "BUSINESS_PROFILE";
  const updatedAt = typeof persisted?.updated_at === "string" ? persisted.updated_at : nowIso();
  const next = Object.freeze({
    organizationId,
    stage,
    updatedAt,
    ...(restoreDeclared<BusinessProfileInput>(persisted?.profile, updatedAt) ? { businessProfile: restoreDeclared<BusinessProfileInput>(persisted?.profile, updatedAt)! } : {}),
    ...(restoreDeclared<RiskPreferencesInput>(persisted?.risk_preferences, updatedAt) ? { riskPreferences: restoreDeclared<RiskPreferencesInput>(persisted?.risk_preferences, updatedAt)! } : {}),
    ...(restoreDeclared<DataConnectionInput>(persisted?.data_connections, updatedAt) ? { dataConnections: restoreDeclared<DataConnectionInput>(persisted?.data_connections, updatedAt)! } : {}),
  });
  onboardingByOrg.set(organizationId, next);
  return next;
}

export function getOnboardingRecord(organizationId: string): OnboardingRecord {
  return onboardingByOrg.get(organizationId) ?? Object.freeze({ organizationId, stage: "BUSINESS_PROFILE", updatedAt: nowIso() });
}

export function resetOnboardingForTests(): void {
  onboardingByOrg.clear();
}

export function isDashboardReady(organizationId: string, mode: "LIVE" | "DEMO"): boolean {
  const stage = getOnboardingRecord(organizationId).stage;
  // DATA_VALIDATION and INITIAL_CALCULATION are valid progression stages where
  // the user has declared their context. Treat them as complete so accounts
  // are never trapped in redirect loops when opening the dashboard overview.
  return mode === "DEMO" || stage === "READY" || stage === "INITIAL_CALCULATION" || stage === "DATA_VALIDATION";
}

export function saveBusinessProfile(organizationId: string, input: BusinessProfileInput): OnboardingRecord {
  validateBusinessProfile(input);
  return updateRecord(organizationId, {
    stage: "RISK_PREFERENCES",
    businessProfile: declared(input),
  });
}

/** Updates saved declared inputs without sending an established account back through onboarding. */
export function updateBusinessProfile(organizationId: string, input: BusinessProfileInput): OnboardingRecord {
  validateBusinessProfile(input);
  return updateRecord(organizationId, { businessProfile: declared(input) });
}

export function saveRiskPreferences(organizationId: string, input: RiskPreferencesInput): OnboardingRecord {
  validateRiskPreferences(input);
  return updateRecord(organizationId, {
    stage: "DATA_CONNECTIONS",
    riskPreferences: declared(input),
  });
}

export function saveDataConnections(organizationId: string, input: DataConnectionInput): OnboardingRecord {
  return updateRecord(organizationId, {
    stage: "DATA_VALIDATION",
    dataConnections: declared(input),
  });
}

export function runReadinessAudit(organizationId: string, runtime: OrganizationRuntime): OnboardingRecord {
  const reliableCashSource = runtime.state.bankTransactions.size > 0;
  const hasPayments = runtime.state.payments.size > 0;
  const hasReceivables = runtime.state.invoices.size > 0;
  const missingSources = [
    reliableCashSource ? "" : "bank cash source",
    hasPayments ? "" : "payment source",
    hasReceivables ? "" : "receivables source",
  ].filter(Boolean);
  const audit: ReadinessAudit = Object.freeze({
    organizationId,
    readyForDashboard: reliableCashSource,
    reliableCashSource,
    missingSources,
    freshness: runtime.freshness,
    metricReadiness: {
      availableCash: reliableCashSource ? { status: "READY", label: "ACTUAL" } : { status: "INSUFFICIENT", reason: "No reliable bank cash source has been imported." },
      pendingSettlement: hasPayments ? { status: "READY", label: "PENDING" } : { status: "INSUFFICIENT", reason: "No payment source has been connected." },
      receivables: hasReceivables ? { status: "READY", label: "FORECAST" } : { status: "INSUFFICIENT", reason: "No receivables source has been imported." },
      forecast: reliableCashSource ? { status: "READY", label: "FORECAST" } : { status: "INSUFFICIENT", reason: "Forecast needs a reliable starting cash source." },
    },
    assessedAt: nowIso(),
  });
  return updateRecord(organizationId, { stage: "INITIAL_CALCULATION", readinessAudit: audit });
}

export function finalizeInitialCalculation(organizationId: string, runtime: OrganizationRuntime): OnboardingRecord {
  const current = getOnboardingRecord(organizationId);
  const audit = current.readinessAudit ?? runReadinessAudit(organizationId, runtime).readinessAudit;
  const assessment = firstAssessment(runtime, audit!);
  // Completing the guided setup completes onboarding. A missing live source is
  // an evidence gap, not a reason to trap the user in the setup flow. The
  // dashboard and assessment already label unavailable metrics accordingly.
  return updateRecord(organizationId, {
    stage: "READY",
    readinessAudit: audit,
    firstAssessment: assessment,
  });
}

export function buildOnboardingSummary(organizationId: string) {
  const record = getOnboardingRecord(organizationId);
  return {
    ...record,
    requiredStages: ["BUSINESS_PROFILE", "RISK_PREFERENCES", "DATA_CONNECTIONS", "DATA_VALIDATION", "INITIAL_CALCULATION", "READY"],
    canResume: record.stage !== "READY",
  };
}

function firstAssessment(runtime: OrganizationRuntime, audit: ReadinessAudit) {
  return Object.freeze({
    dataLabel: runtime.dataLabel,
    availableCash: audit.metricReadiness.availableCash.status === "READY" ? { ...runtime.cash.actualBankCash, state: "ACTUAL" } : { state: "ACTUAL", value: "Not enough data" },
    upcomingObligations: runtime.profile.payrollSchedule.map((payroll) => ({
      label: "Payroll",
      amount: { amountMinor: payroll.amountMinor, currency: runtime.profile.currency, state: "USER_DECLARED" },
      dueAt: payroll.date,
      provenance: "USER_DECLARED",
    })),
    receivables: audit.metricReadiness.receivables.status === "READY" ? { ...runtime.cash.expectedReceivables, state: "FORECAST" } : { state: "FORECAST", value: "Not enough data" },
    forecast: audit.metricReadiness.forecast.status === "READY" ? runtime.forecast : { state: "FORECAST", value: "Not enough data" },
    activeRisks: runtime.alerts.filter((alert) => alert.lifecycleStatus !== "RESOLVED"),
  });
}

function updateRecord(organizationId: string, patch: Partial<OnboardingRecord>): OnboardingRecord {
  const next = Object.freeze({
    ...getOnboardingRecord(organizationId),
    ...patch,
    organizationId,
    updatedAt: nowIso(),
  });
  onboardingByOrg.set(organizationId, next);
  return next;
}

function declared<T>(value: T): UserDeclared<T> {
  return Object.freeze({ value, provenance: "USER_DECLARED", declaredAt: nowIso() });
}

function restoreDeclared<T>(value: unknown, fallbackDate: string): UserDeclared<T> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as { value?: unknown; provenance?: unknown; declaredAt?: unknown };
  if (!candidate.value || typeof candidate.value !== "object" || candidate.provenance !== "USER_DECLARED") return undefined;
  return Object.freeze({
    value: candidate.value as T,
    provenance: "USER_DECLARED",
    declaredAt: typeof candidate.declaredAt === "string" ? candidate.declaredAt : fallbackDate,
  });
}

function validateBusinessProfile(input: BusinessProfileInput): void {
  if (!input.organizationName || !input.industryType || !input.timezone || input.currency !== "INR") throw invalid("Invalid business profile");
  if (!Number.isSafeInteger(input.payrollAmountMinor) || input.payrollAmountMinor < 0) throw invalid("Invalid payroll amount");
  if (input.currentCashMinor !== undefined && (!Number.isSafeInteger(input.currentCashMinor) || input.currentCashMinor < 0)) throw invalid("Invalid declared cash amount");
  if (!input.payrollSchedule) throw invalid("Invalid payroll schedule");
  if (!Number.isSafeInteger(input.minimumLiquidityBufferMinor) || input.minimumLiquidityBufferMinor < 0) throw invalid("Invalid liquidity buffer");
  if (!Number.isSafeInteger(input.receivableTermsDays) || input.receivableTermsDays < 0) throw invalid("Invalid receivable terms");
  for (const answers of [input.revenueChannels, input.cashPressureSources, input.connectionRequests]) {
    if (answers !== undefined && (!Array.isArray(answers) || answers.some((answer) => typeof answer !== "string" || !answer.trim()))) {
      throw invalid("Invalid onboarding answers");
    }
  }
}

function validateRiskPreferences(input: RiskPreferencesInput): void {
  if (input.lateReceivableProbability < 0 || input.lateReceivableProbability > 1) throw invalid("Invalid late receivable probability");
  if (!Number.isSafeInteger(input.materialAmountMinor) || input.materialAmountMinor < 0) throw invalid("Invalid materiality");
  if (input.feeRateUpperBound < 0 || input.feeRateUpperBound > 1) throw invalid("Invalid fee threshold");
  if (input.concentrationThreshold < 0 || input.concentrationThreshold > 1) throw invalid("Invalid concentration threshold");
}

function invalid(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400, code: "FG_INVALID_PAYLOAD" });
}

function nowIso(): string {
  return new Date().toISOString();
}
