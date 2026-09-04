import { money } from "../domain/money.ts";
import type { CanonicalEvent, EventType, LedgerState } from "../domain/types.ts";
import { forecastCash, type CashFlow } from "../forecast/forecast.ts";
import { getCashPosition } from "../ledger/cash-position.ts";
import { replayLedger } from "../ledger/projector.ts";
import { optimizeCashPlan } from "../optimizer/optimizer.ts";
import { scoreInvoiceRisk } from "../receivables/risk.ts";
import { reconcileSettlements, reconciliationMetrics, tracePayment } from "../reconciliation/reconcile.ts";
import { runScenario } from "../scenario/scenario.ts";
import { resetOnboardingForTests, seedOnboarding, type BusinessProfileInput, type DataConnectionInput, type RiskPreferencesInput } from "./onboarding.ts";
import { evaluateAlerts, type Alert, type Notification } from "./risk-alerts.ts";

export type OrganizationProfile = Readonly<{
  organizationId: string;
  name: string;
  mode: "LIVE" | "DEMO";
  currency: "INR";
  timezone: string;
  minimumLiquidityBufferMinor: number;
  payrollSchedule: ReadonlyArray<{ date: string; amountMinor: number }>;
  alertPreferences: {
    lateReceivableProbability: number;
    materialAmountMinor: number;
    settlementDelayDays: number;
    refundSpikeMultiple: number;
    feeRateUpperBound: number;
    concentrationThreshold: number;
  };
  notificationPreferences: {
    inAppEnabled: boolean;
    emailEnabled: boolean;
    minimumSeverity: "WARNING" | "HIGH" | "CRITICAL";
    quietHours?: { startHour: number; endHour: number };
    escalationDelayHours: number;
  };
  dataConnections: ReadonlyArray<{ kind: string; status: string; lastSyncedAt?: string }>;
}>;

export type OrganizationRuntime = Readonly<{
  profile: OrganizationProfile;
  dataLabel: "LIVE DATA" | "DEMO DATA";
  dataState: "EMPTY" | "READY";
  state: LedgerState;
  cash: ReturnType<typeof getCashPosition>;
  reconciliation: ReturnType<typeof reconcileSettlements>;
  metrics: ReturnType<typeof reconciliationMetrics>;
  forecast: ReturnType<typeof forecastCash>;
  receivableRisk: ReturnType<typeof scoreInvoiceRisk>;
  scenario: ReturnType<typeof runScenario>;
  plan: ReturnType<typeof optimizeCashPlan>;
  alerts: Alert[];
  notifications: Notification[];
  timeline: TimelineEvent[];
  freshness: Record<string, string>;
}>;

export type TimelineEvent = Readonly<{
  timestamp: string;
  label: string;
  kind: "INGESTION" | "RECALCULATION" | "ALERT" | "NOTIFICATION";
}>;

const profiles = new Map<string, OrganizationProfile>();
const eventStreams = new Map<string, CanonicalEvent[]>();
const alertsByOrg = new Map<string, Alert[]>();
const notificationsByOrg = new Map<string, Notification[]>();
const timelinesByOrg = new Map<string, TimelineEvent[]>();
let sequence = 0;

seedOrganizations();

export function getOrganizationProfile(organizationId: string): OrganizationProfile | undefined {
  return profiles.get(organizationId);
}

/** Creates the empty, live organization that backs a newly authenticated account. */
export function ensureOrganization(organizationId: string, name: string): void {
  if (profiles.has(organizationId)) return;
  addProfile({
    organizationId,
    name: name.trim() || "New FlowGuard Organization",
    mode: "LIVE",
    currency: "INR",
    timezone: "Asia/Kolkata",
    minimumLiquidityBufferMinor: 200000,
    payrollSchedule: [],
    alertPreferences: defaultAlertPreferences(),
    notificationPreferences: defaultNotificationPreferences(),
    dataConnections: [],
  });
  eventStreams.set(organizationId, []);
  seedOnboarding(organizationId, "BUSINESS_PROFILE");
}

export function listOrganizationEvents(organizationId: string): CanonicalEvent[] {
  return [...(eventStreams.get(organizationId) ?? [])];
}

export function getOrganizationRuntime(organizationId: string): OrganizationRuntime {
  const profile = profiles.get(organizationId);
  if (!profile) throw Object.assign(new Error("Organization not found"), { statusCode: 404, code: "FG_ORG_NOT_FOUND" });

  const events = listOrganizationEvents(organizationId);
  const state = replayLedger(organizationId, events);
  const cash = getCashPosition(state);
  const reconciliation = reconcileSettlements(state);
  const forecastFlows = buildForecastFlows(profile, state, cash.actualBankCash.amountMinor);
  const forecast = forecastCash(cash.actualBankCash, forecastFlows, 30);
  const receivableRisk = scoreInvoiceRisk(buildReceivableHistory(state));
  const scenario = runScenario(cash.actualBankCash, forecastFlows, { type: "MARKETING_SPEND", amount: money(300000), spendDate: "2026-08-26" }, 42);
  const plan = optimizeCashPlan(money(Math.max(0, -forecast.minimumBalance.amountMinor)), forecast.minimumBalance, [
    { id: "collect_top_receivable", kind: "COLLECT_INVOICE", impact: money(topOpenInvoiceMinor(state)), cost: money(0), eligible: topOpenInvoiceMinor(state) > 0 },
    { id: "reduce_discretionary_spend", kind: "REDUCE_DISCRETIONARY_SPEND", impact: money(44000), cost: money(0), eligible: true },
    { id: "delay_payroll", kind: "RESCHEDULE_VENDOR", impact: money(nextPayroll(profile)?.amountMinor ?? 0), cost: money(0), eligible: false, hardConstraintReason: "payroll cannot be postponed" },
  ]);
  const metrics = reconciliationMetrics(reconciliation);
  const alerts =
    events.length === 0
      ? []
      : evaluateAndPersistAlerts(profile, {
          cashActualMinor: cash.actualBankCash.amountMinor,
          forecastMinimumMinor: forecast.minimumBalance.amountMinor,
          forecastShortfallDate: forecast.shortfallDate,
          reconciliation,
          receivableRisk,
          topOpenInvoiceMinor: topOpenInvoiceMinor(state),
          refundRate: refundRate(state),
          feeRate: feeRate(state),
          customerConcentration: customerConcentration(state),
          nextPayrollMinor: nextPayroll(profile)?.amountMinor ?? 0,
          expectedPayrollDate: nextPayroll(profile)?.date,
        });

  return Object.freeze({
    profile,
    dataLabel: profile.mode === "DEMO" ? "DEMO DATA" : "LIVE DATA",
    dataState: events.length === 0 ? "EMPTY" : "READY",
    state,
    cash,
    reconciliation,
    metrics,
    forecast,
    receivableRisk,
    scenario,
    plan,
    alerts,
    notifications: [...(notificationsByOrg.get(organizationId) ?? [])],
    timeline: [...(timelinesByOrg.get(organizationId) ?? [])].slice(-40).reverse(),
    freshness: freshnessFor(profile, events),
  });
}

export function ingestCanonicalEvents(organizationId: string, events: CanonicalEvent[], label = "Financial events imported"): OrganizationRuntime {
  const profile = profiles.get(organizationId);
  if (!profile) throw Object.assign(new Error("Organization not found"), { statusCode: 404, code: "FG_ORG_NOT_FOUND" });
  const existing = eventStreams.get(organizationId) ?? [];
  eventStreams.set(organizationId, [...existing, ...events]);
  pushTimeline(organizationId, label, "INGESTION");
  pushTimeline(organizationId, "Ledger, reconciliation, forecast, and alerts recalculated", "RECALCULATION");
  return getOrganizationRuntime(organizationId);
}

export function ingestBankCsv(organizationId: string, rows: Array<{ date: string; description: string; amountMinor: number; type: "CREDIT" | "DEBIT"; reference: string; settlementId?: string }>): OrganizationRuntime {
  return ingestCanonicalEvents(
    organizationId,
    rows
      .filter((row) => row.type === "CREDIT")
      .map((row) =>
        canonicalEvent(organizationId, "BANK_CREDIT_RECEIVED", `bank_csv_${row.reference}`, {
          bankTransactionId: `BANK-${row.reference}`,
          settlementId: row.settlementId,
          amount: money(row.amountMinor),
        }, row.date),
      ),
    "Bank CSV imported",
  );
}

export function ingestInvoiceCsv(organizationId: string, rows: Array<{ customer: string; invoiceAmountMinor: number; issueDate: string; dueDate: string; status: "OPEN" | "PAID"; reference: string }>): OrganizationRuntime {
  return ingestCanonicalEvents(
    organizationId,
    rows.map((row) =>
      canonicalEvent(organizationId, "INVOICE_CREATED", `invoice_csv_${row.reference}`, {
        invoiceId: `INV-${row.reference}`,
        customerId: row.customer,
        amount: money(row.invoiceAmountMinor),
        dueAt: row.dueDate,
      }, row.issueDate),
    ),
    "Receivables imported",
  );
}

export function ingestRazorpayMockPayment(organizationId: string, input: { orderId: string; paymentId: string; customerId: string; amountMinor: number; occurredAt: string }): OrganizationRuntime {
  return ingestCanonicalEvents(
    organizationId,
    [
      canonicalEvent(organizationId, "ORDER_CREATED", `rzp_mock_order_${input.orderId}`, { orderId: input.orderId, customerId: input.customerId, amount: money(input.amountMinor) }, input.occurredAt),
      canonicalEvent(organizationId, "PAYMENT_CAPTURED", `rzp_mock_payment_${input.paymentId}`, { paymentId: input.paymentId, orderId: input.orderId, amount: money(input.amountMinor) }, input.occurredAt),
    ],
    "Razorpay mock payment ingested",
  );
}

export function acknowledgeAlert(organizationId: string, alertId: string): Alert | undefined {
  const alerts = alertsByOrg.get(organizationId) ?? [];
  const alert = alerts.find((item) => item.alertId === alertId);
  if (!alert) return undefined;
  const updated = Object.freeze({ ...alert, lifecycleStatus: "ACKNOWLEDGED" as const, updatedAt: new Date().toISOString(), history: [...alert.history, { status: "ACKNOWLEDGED" as const, at: new Date().toISOString(), note: "User acknowledged alert" }] });
  alertsByOrg.set(organizationId, alerts.map((item) => (item.alertId === alertId ? updated : item)));
  return updated;
}

export function applyBusinessProfile(organizationId: string, input: BusinessProfileInput): OrganizationProfile {
  const current = requireProfile(organizationId);
  const next = Object.freeze({
    ...current,
    name: input.organizationName,
    timezone: input.timezone,
    currency: input.currency,
    minimumLiquidityBufferMinor: input.minimumLiquidityBufferMinor,
    payrollSchedule: input.payrollAmountMinor > 0 ? [{ date: nextPayrollDate(input.payrollSchedule), amountMinor: input.payrollAmountMinor }] : [],
    notificationPreferences: {
      ...current.notificationPreferences,
      ...input.notificationPreferences,
    },
  });
  profiles.set(organizationId, next);
  pushTimeline(organizationId, "Business profile saved with USER_DECLARED provenance", "INGESTION");
  return next;
}

export function applyRiskPreferences(organizationId: string, input: RiskPreferencesInput): OrganizationProfile {
  const current = requireProfile(organizationId);
  const next = Object.freeze({
    ...current,
    alertPreferences: {
      ...current.alertPreferences,
      lateReceivableProbability: input.lateReceivableProbability,
      materialAmountMinor: input.materialAmountMinor,
      feeRateUpperBound: input.feeRateUpperBound,
      concentrationThreshold: input.concentrationThreshold,
    },
  });
  profiles.set(organizationId, next);
  pushTimeline(organizationId, "Risk preferences saved with USER_DECLARED provenance", "INGESTION");
  return next;
}

export function applyDataConnections(organizationId: string, input: DataConnectionInput): OrganizationProfile {
  const current = requireProfile(organizationId);
  const now = nowIso();
  const next = Object.freeze({
    ...current,
    dataConnections: [
      { kind: "Razorpay Mock", status: input.razorpay, lastSyncedAt: input.razorpay === "CONNECTED" ? now : undefined },
      { kind: "Bank CSV", status: input.bank, lastSyncedAt: input.bank === "IMPORTED" || input.bank === "CONNECTED" ? now : undefined },
      { kind: "Receivables CSV", status: input.receivables, lastSyncedAt: input.receivables === "IMPORTED" || input.receivables === "CONNECTED" ? now : undefined },
    ],
  });
  profiles.set(organizationId, next);
  pushTimeline(organizationId, "Data connection preferences saved", "INGESTION");
  return next;
}

/** Records a provider choice without accepting credentials in the browser. */
export function requestConnectionSetup(organizationId: string, kind: "BANK" | "ACCOUNTING", provider: string): OrganizationProfile {
  const current = requireProfile(organizationId);
  const prefix = kind === "BANK" ? "Bank feed" : "Accounting ledger";
  const next = Object.freeze({
    ...current,
    dataConnections: [
      ...current.dataConnections.filter((connection) => !connection.kind.startsWith(prefix)),
      { kind: `${prefix}: ${provider}`, status: "PENDING_CONFIGURATION" },
    ],
  });
  profiles.set(organizationId, next);
  pushTimeline(organizationId, `${prefix} provider setup requested: ${provider}`, "INGESTION");
  return next;
}

export function resetLiveStoreForTests(): void {
  profiles.clear();
  eventStreams.clear();
  alertsByOrg.clear();
  notificationsByOrg.clear();
  timelinesByOrg.clear();
  sequence = 0;
  resetOnboardingForTests();
  seedOrganizations();
}

export function traceOrganizationPayment(organizationId: string, paymentId: string): string[] {
  return tracePayment(getOrganizationRuntime(organizationId).state, paymentId);
}

function evaluateAndPersistAlerts(profile: OrganizationProfile, input: Parameters<typeof evaluateAlerts>[1]): Alert[] {
  const current = alertsByOrg.get(profile.organizationId) ?? [];
  const result = evaluateAlerts(profile, input, current);
  alertsByOrg.set(profile.organizationId, result.alerts);
  if (result.notifications.length > 0) {
    notificationsByOrg.set(profile.organizationId, [...(notificationsByOrg.get(profile.organizationId) ?? []), ...result.notifications]);
    for (const notification of result.notifications) pushTimeline(profile.organizationId, notification.subject, "NOTIFICATION");
  }
  for (const alert of result.createdOrUpdated) pushTimeline(profile.organizationId, `${alert.riskType} ${alert.severity}`, "ALERT");
  return result.alerts;
}

function seedOrganizations(): void {
  addProfile({
    organizationId: "org_flowguard_demo",
    name: "FlowGuard Demo Commerce Pvt Ltd",
    mode: "DEMO",
    currency: "INR",
    timezone: "Asia/Kolkata",
    minimumLiquidityBufferMinor: 250000,
    payrollSchedule: [{ date: "2026-08-29", amountMinor: 510000 }],
    alertPreferences: defaultAlertPreferences(),
    notificationPreferences: defaultNotificationPreferences(),
    dataConnections: [{ kind: "Razorpay Mock", status: "DEMO DATA" }, { kind: "Bank CSV", status: "DEMO DATA" }],
  });
  seedOnboarding("org_flowguard_demo", "READY");
  addProfile({
    organizationId: "org_company_a",
    name: "Company A Healthy Retail",
    mode: "LIVE",
    currency: "INR",
    timezone: "Asia/Kolkata",
    minimumLiquidityBufferMinor: 200000,
    payrollSchedule: [{ date: "2026-08-29", amountMinor: 510000 }],
    alertPreferences: defaultAlertPreferences(),
    notificationPreferences: defaultNotificationPreferences(),
    dataConnections: [{ kind: "Razorpay Mock", status: "CONNECTED", lastSyncedAt: nowIso() }, { kind: "Bank CSV", status: "IMPORTED", lastSyncedAt: nowIso() }],
  });
  seedOnboarding("org_company_a", "READY");
  addProfile({
    organizationId: "org_company_b",
    name: "Company B Cash Stress",
    mode: "LIVE",
    currency: "INR",
    timezone: "Asia/Kolkata",
    minimumLiquidityBufferMinor: 450000,
    payrollSchedule: [{ date: "2026-08-29", amountMinor: 700000 }],
    alertPreferences: { ...defaultAlertPreferences(), lateReceivableProbability: 0.55 },
    notificationPreferences: defaultNotificationPreferences(),
    dataConnections: [{ kind: "Razorpay Mock", status: "CONNECTED", lastSyncedAt: nowIso() }],
  });
  seedOnboarding("org_company_b", "READY");
  addProfile({
    organizationId: "org_empty",
    name: "New FlowGuard Organization",
    mode: "LIVE",
    currency: "INR",
    timezone: "Asia/Kolkata",
    minimumLiquidityBufferMinor: 200000,
    payrollSchedule: [],
    alertPreferences: defaultAlertPreferences(),
    notificationPreferences: defaultNotificationPreferences(),
    dataConnections: [],
  });
  seedOnboarding("org_empty", "BUSINESS_PROFILE");
  eventStreams.set("org_flowguard_demo", seededEvents("org_flowguard_demo", 1800000, 1652800, 1692800, 680000));
  eventStreams.set("org_company_a", seededEvents("org_company_a", 820000, 820000, 270000, 1440000));
  eventStreams.set("org_company_b", seededEvents("org_company_b", 160000, 120000, 90000, 720000));
  eventStreams.set("org_empty", []);
}

function requireProfile(organizationId: string): OrganizationProfile {
  const profile = profiles.get(organizationId);
  if (!profile) throw Object.assign(new Error("Organization not found"), { statusCode: 404, code: "FG_ORG_NOT_FOUND" });
  return profile;
}

function nextPayrollDate(schedule: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(schedule)) return schedule;
  return "2026-08-29";
}

function seededEvents(organizationId: string, firstPaymentMinor: number, firstBankMinor: number, secondBankMinor: number, invoiceMinor: number): CanonicalEvent[] {
  return [
    canonicalEvent(organizationId, "ORDER_CREATED", "order_ext_1", { orderId: `${organizationId}-ORD-1`, customerId: "CUS-001", amount: money(firstPaymentMinor) }),
    canonicalEvent(organizationId, "PAYMENT_CAPTURED", "payment_ext_1", { paymentId: `${organizationId}-PAY-1`, orderId: `${organizationId}-ORD-1`, amount: money(firstPaymentMinor) }),
    canonicalEvent(organizationId, "SETTLEMENT_PROCESSED", "settlement_ext_1", {
      settlementId: `${organizationId}-SET-1`,
      lines: [{ paymentId: `${organizationId}-PAY-1`, gross: money(firstPaymentMinor), fee: money(40000), tax: money(7200), refund: money(0) }],
    }),
    canonicalEvent(organizationId, "BANK_CREDIT_RECEIVED", "bank_ext_1", { bankTransactionId: `${organizationId}-BANK-1`, settlementId: `${organizationId}-SET-1`, amount: money(firstBankMinor) }),
    canonicalEvent(organizationId, "ORDER_CREATED", "order_ext_2", { orderId: `${organizationId}-ORD-2`, customerId: "CUS-002", amount: money(300000) }),
    canonicalEvent(organizationId, "PAYMENT_CAPTURED", "payment_ext_2", { paymentId: `${organizationId}-PAY-2`, orderId: `${organizationId}-ORD-2`, amount: money(300000) }),
    canonicalEvent(organizationId, "SETTLEMENT_PROCESSED", "settlement_ext_2", {
      settlementId: `${organizationId}-SET-2`,
      lines: [{ paymentId: `${organizationId}-PAY-2`, gross: money(300000), fee: money(8000), tax: money(1440), refund: money(0) }],
    }),
    canonicalEvent(organizationId, "BANK_CREDIT_RECEIVED", "bank_ext_2", { bankTransactionId: `${organizationId}-BANK-2`, settlementId: `${organizationId}-SET-2`, amount: money(secondBankMinor) }),
    canonicalEvent(organizationId, "INVOICE_CREATED", "invoice_ext_1", { invoiceId: `${organizationId}-INV-1`, customerId: "ABC Industries", amount: money(invoiceMinor), dueAt: "2026-09-14T00:00:00.000Z" }),
  ];
}

function canonicalEvent(organizationId: string, type: EventType, sourceExternalId: string, payload: Record<string, unknown>, occurredAt = "2026-08-23T00:00:00.000Z"): CanonicalEvent {
  sequence += 1;
  return Object.freeze({
    id: `live_evt_${String(sequence).padStart(6, "0")}`,
    type,
    provenance: Object.freeze({
      organizationId,
      source: type === "BANK_CREDIT_RECEIVED" ? "BANK_SYNTHETIC" : type.startsWith("INVOICE") ? "INVOICE_SYNTHETIC" : "RAZORPAY_SYNTHETIC",
      sourceExternalId,
      occurredAt,
      createdAt: nowIso(),
    }),
    payload: Object.freeze(payload),
  });
}

function buildForecastFlows(profile: OrganizationProfile, state: LedgerState, cashMinor: number): CashFlow[] {
  const invoiceInflows = [...state.invoices.values()].map((invoice) => ({
    date: invoice.dueAt.slice(0, 10),
    inflow: money(invoice.amount.amountMinor - invoice.paidAmount.amountMinor),
    outflow: money(0),
    label: "PREDICTED" as const,
  }));
  const payrollOutflows = profile.payrollSchedule.map((payroll) => ({
    date: payroll.date,
    inflow: money(0),
    outflow: money(payroll.amountMinor),
    label: "FORECAST" as const,
  }));
  const stressOutflow = cashMinor < profile.minimumLiquidityBufferMinor ? [{ date: "2026-08-26", inflow: money(0), outflow: money(profile.minimumLiquidityBufferMinor), label: "FORECAST" as const }] : [];
  return [...invoiceInflows, ...payrollOutflows, ...stressOutflow];
}

function buildReceivableHistory(state: LedgerState) {
  const firstInvoice = [...state.invoices.values()][0];
  return {
    customerId: firstInvoice?.customerId ?? "UNKNOWN",
    invoiceAmount: firstInvoice?.amount ?? money(0),
    customerMedianAmount: money(Math.max(1, Math.round((firstInvoice?.amount.amountMinor ?? 100000) * 0.45))),
    medianDelayDays: firstInvoice ? 16 : 0,
    previousLateCount: firstInvoice ? 6 : 0,
    previousInvoiceCount: firstInvoice ? 9 : 0,
    currentOverdueDays: firstInvoice ? 5 : 0,
  };
}

function topOpenInvoiceMinor(state: LedgerState): number {
  return Math.max(0, ...[...state.invoices.values()].map((invoice) => invoice.amount.amountMinor - invoice.paidAmount.amountMinor));
}

function refundRate(state: LedgerState): number {
  const gross = [...state.payments.values()].reduce((sum, payment) => sum + payment.amount.amountMinor, 0);
  const refunds = [...state.refunds.values()].reduce((sum, refund) => sum + refund.amount.amountMinor, 0);
  return gross === 0 ? 0 : refunds / gross;
}

function feeRate(state: LedgerState): number {
  const lines = [...state.settlements.values()].flatMap((settlement) => settlement.lines);
  const gross = lines.reduce((sum, line) => sum + line.gross.amountMinor, 0);
  const fees = lines.reduce((sum, line) => sum + line.fee.amountMinor + line.tax.amountMinor, 0);
  return gross === 0 ? 0 : fees / gross;
}

function customerConcentration(state: LedgerState): number {
  const totals = new Map<string, number>();
  for (const invoice of state.invoices.values()) totals.set(invoice.customerId, (totals.get(invoice.customerId) ?? 0) + invoice.amount.amountMinor - invoice.paidAmount.amountMinor);
  const values = [...totals.values()];
  const total = values.reduce((sum, value) => sum + value, 0);
  return total === 0 ? 0 : Math.max(...values) / total;
}

function nextPayroll(profile: OrganizationProfile) {
  return profile.payrollSchedule[0];
}

function freshnessFor(profile: OrganizationProfile, events: CanonicalEvent[]): Record<string, string> {
  const latest = events.at(-1)?.provenance.createdAt ?? "never";
  return {
    payments: latest,
    bank: profile.dataConnections.find((connection) => connection.kind.includes("Bank"))?.lastSyncedAt ?? latest,
    forecast: nowIso(),
    alerts: nowIso(),
  };
}

function addProfile(profile: OrganizationProfile): void {
  profiles.set(profile.organizationId, Object.freeze(profile));
  timelinesByOrg.set(profile.organizationId, []);
  alertsByOrg.set(profile.organizationId, []);
  notificationsByOrg.set(profile.organizationId, []);
}

function pushTimeline(organizationId: string, label: string, kind: TimelineEvent["kind"]): void {
  timelinesByOrg.set(organizationId, [...(timelinesByOrg.get(organizationId) ?? []), Object.freeze({ timestamp: nowIso(), label, kind })]);
}

function defaultAlertPreferences(): OrganizationProfile["alertPreferences"] {
  return {
    lateReceivableProbability: 0.6,
    materialAmountMinor: 100000,
    settlementDelayDays: 3,
    refundSpikeMultiple: 1.8,
    feeRateUpperBound: 0.08,
    concentrationThreshold: 0.5,
  };
}

function defaultNotificationPreferences(): OrganizationProfile["notificationPreferences"] {
  return {
    inAppEnabled: true,
    emailEnabled: true,
    minimumSeverity: "HIGH",
    escalationDelayHours: 4,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}
