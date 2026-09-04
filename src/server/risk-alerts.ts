import type { OrganizationProfile } from "./live-store.ts";
import type { ReconciliationResult } from "../reconciliation/reconcile.ts";

export type RiskType =
  | "CASH_SHORTFALL"
  | "PAYROLL_RISK"
  | "LATE_RECEIVABLE_RISK"
  | "SETTLEMENT_DELAY"
  | "SETTLEMENT_MISMATCH"
  | "REFUND_SPIKE"
  | "FEE_ANOMALY"
  | "CUSTOMER_CONCENTRATION"
  | "LOW_LIQUIDITY"
  | "UNEXPECTED_EXPENSE";

export type Severity = "INFO" | "WATCH" | "WARNING" | "HIGH" | "CRITICAL";
export type AlertLifecycleStatus = "OPEN" | "ACKNOWLEDGED" | "ESCALATED" | "RESOLVED";
export type RiskState = "NORMAL" | "WATCH" | "WARNING" | "CRITICAL" | "RESOLVED";

export type Alert = Readonly<{
  alertId: string;
  organizationId: string;
  fingerprint: string;
  riskType: RiskType;
  severity: Severity;
  riskState: RiskState;
  lifecycleStatus: AlertLifecycleStatus;
  detectedAt: string;
  updatedAt: string;
  affectedAmountMinor: number;
  expectedRiskDate?: string;
  reason: string;
  sourceIds: string[];
  confidence?: number;
  recommendedNextStep: string;
  history: ReadonlyArray<{ status: AlertLifecycleStatus | RiskState; at: string; note: string }>;
}>;

export type Notification = Readonly<{
  notificationId: string;
  organizationId: string;
  alertId: string;
  channel: "IN_APP" | "EMAIL";
  status: "QUEUED" | "DELIVERED" | "FAILED";
  subject: string;
  createdAt: string;
}>;

export type AlertEvaluationInput = Readonly<{
  cashActualMinor: number;
  forecastMinimumMinor: number;
  forecastShortfallDate?: string;
  reconciliation: ReconciliationResult[];
  receivableRisk: { probabilityLate: number; expectedDelayDays: number; drivers: string[] };
  topOpenInvoiceMinor: number;
  refundRate: number;
  feeRate: number;
  customerConcentration: number;
  nextPayrollMinor: number;
  expectedPayrollDate?: string;
}>;

export function evaluateAlerts(profile: OrganizationProfile, input: AlertEvaluationInput, existing: Alert[]) {
  const candidates = [
    cashShortfall(profile, input),
    payrollRisk(profile, input),
    lateReceivableRisk(profile, input),
    settlementMismatch(profile, input),
    refundSpike(profile, input),
    feeAnomaly(profile, input),
    customerConcentration(profile, input),
    lowLiquidity(profile, input),
  ].filter((alert): alert is Alert => Boolean(alert));

  const nextAlerts = [...existing];
  const createdOrUpdated: Alert[] = [];
  const notifications: Notification[] = [];
  const activeFingerprints = new Set(candidates.map((alert) => alert.fingerprint));

  for (const candidate of candidates) {
    const current = nextAlerts.find((alert) => alert.fingerprint === candidate.fingerprint && alert.lifecycleStatus !== "RESOLVED");
    if (!current) {
      nextAlerts.push(candidate);
      createdOrUpdated.push(candidate);
      notifications.push(...notificationsFor(profile, candidate, "created"));
      continue;
    }

    const worsened = severityRank(candidate.severity) > severityRank(current.severity);
    if (worsened || candidate.affectedAmountMinor !== current.affectedAmountMinor) {
      const updated = Object.freeze({
        ...current,
        severity: candidate.severity,
        riskState: candidate.riskState,
        affectedAmountMinor: candidate.affectedAmountMinor,
        expectedRiskDate: candidate.expectedRiskDate,
        reason: candidate.reason,
        updatedAt: nowIso(),
        history: [...current.history, { status: candidate.riskState, at: nowIso(), note: worsened ? "Risk worsened" : "Risk amount changed" }],
      });
      replace(nextAlerts, updated);
      createdOrUpdated.push(updated);
      if (worsened) notifications.push(...notificationsFor(profile, updated, "worsened"));
    }
  }

  for (const current of [...nextAlerts]) {
    if (current.lifecycleStatus !== "RESOLVED" && !activeFingerprints.has(current.fingerprint)) {
      const resolved = Object.freeze({
        ...current,
        lifecycleStatus: "RESOLVED" as const,
        riskState: "RESOLVED" as const,
        updatedAt: nowIso(),
        history: [...current.history, { status: "RESOLVED" as const, at: nowIso(), note: "Risk condition no longer present" }],
      });
      replace(nextAlerts, resolved);
      createdOrUpdated.push(resolved);
      notifications.push(...notificationsFor(profile, resolved, "resolved"));
    }
  }

  return { alerts: nextAlerts, createdOrUpdated, notifications };
}

function cashShortfall(profile: OrganizationProfile, input: AlertEvaluationInput): Alert | undefined {
  if (input.forecastMinimumMinor >= profile.minimumLiquidityBufferMinor) return undefined;
  const severity = input.forecastMinimumMinor < 0 ? "CRITICAL" : "HIGH";
  return makeAlert(profile, "CASH_SHORTFALL", severity, Math.abs(input.forecastMinimumMinor), input.forecastShortfallDate, `Forecast minimum cash is below the configured liquidity buffer of ${profile.minimumLiquidityBufferMinor} minor units.`, ["forecast"], "Review collections, discretionary spend, and eligible vendor timing.", input.forecastMinimumMinor < 0 ? "CRITICAL" : "WARNING");
}

function payrollRisk(profile: OrganizationProfile, input: AlertEvaluationInput): Alert | undefined {
  if (!input.expectedPayrollDate || input.cashActualMinor >= input.nextPayrollMinor + profile.minimumLiquidityBufferMinor) return undefined;
  return makeAlert(profile, "PAYROLL_RISK", "CRITICAL", input.nextPayrollMinor, input.expectedPayrollDate, "Expected cash is below payroll requirement plus liquidity buffer.", ["payroll"], "Prioritize receivable collection before payroll date.", "CRITICAL");
}

function lateReceivableRisk(profile: OrganizationProfile, input: AlertEvaluationInput): Alert | undefined {
  if (input.receivableRisk.probabilityLate < profile.alertPreferences.lateReceivableProbability || input.topOpenInvoiceMinor < profile.alertPreferences.materialAmountMinor) return undefined;
  return makeAlert(profile, "LATE_RECEIVABLE_RISK", "HIGH", input.topOpenInvoiceMinor, undefined, `Major receivable has ${Math.round(input.receivableRisk.probabilityLate * 100)}% estimated late-payment probability.`, ["receivables"], "Contact the customer and run a cash scenario.", "WARNING", input.receivableRisk.probabilityLate);
}

function settlementMismatch(profile: OrganizationProfile, input: AlertEvaluationInput): Alert | undefined {
  const exception = input.reconciliation.find((item) => item.status !== "MATCHED");
  if (!exception) return undefined;
  return makeAlert(profile, "SETTLEMENT_MISMATCH", Math.abs(exception.differenceMinor) >= profile.alertPreferences.materialAmountMinor ? "HIGH" : "WARNING", Math.abs(exception.differenceMinor), undefined, `${exception.status} reconciliation exception detected.`, exception.sourceRecords, "Investigate settlement, fee, tax, refund, and bank records.", "WARNING");
}

function refundSpike(profile: OrganizationProfile, input: AlertEvaluationInput): Alert | undefined {
  if (input.refundRate < 0.05 * profile.alertPreferences.refundSpikeMultiple) return undefined;
  return makeAlert(profile, "REFUND_SPIKE", "HIGH", Math.round(input.refundRate * 10000), undefined, "Refund rate is materially above the configured baseline.", ["refunds"], "Review recent refunds and product/order issues.", "WARNING");
}

function feeAnomaly(profile: OrganizationProfile, input: AlertEvaluationInput): Alert | undefined {
  if (input.feeRate <= profile.alertPreferences.feeRateUpperBound) return undefined;
  return makeAlert(profile, "FEE_ANOMALY", "WARNING", Math.round(input.feeRate * 10000), undefined, "Effective gateway fee rate is above configured threshold.", ["fees"], "Review gateway fee and tax deductions.", "WATCH");
}

function customerConcentration(profile: OrganizationProfile, input: AlertEvaluationInput): Alert | undefined {
  if (input.customerConcentration <= profile.alertPreferences.concentrationThreshold) return undefined;
  return makeAlert(profile, "CUSTOMER_CONCENTRATION", "WARNING", Math.round(input.customerConcentration * 10000), undefined, "Future inflows are concentrated in one customer.", ["receivables"], "Reduce reliance on one customer or protect liquidity buffer.", "WATCH");
}

function lowLiquidity(profile: OrganizationProfile, input: AlertEvaluationInput): Alert | undefined {
  if (input.cashActualMinor >= profile.minimumLiquidityBufferMinor) return undefined;
  return makeAlert(profile, "LOW_LIQUIDITY", "CRITICAL", profile.minimumLiquidityBufferMinor - input.cashActualMinor, undefined, "Current bank cash is below configured liquidity buffer.", ["cash"], "Preserve cash and review immediate obligations.", "CRITICAL");
}

function makeAlert(profile: OrganizationProfile, riskType: RiskType, severity: Severity, affectedAmountMinor: number, expectedRiskDate: string | undefined, reason: string, sourceIds: string[], recommendedNextStep: string, riskState: RiskState, confidence?: number): Alert {
  const fingerprint = `${profile.organizationId}:${riskType}:${sourceIds[0] ?? "global"}:${expectedRiskDate ?? "current"}`;
  const now = nowIso();
  return Object.freeze({
    alertId: `alert_${hash(fingerprint)}`,
    organizationId: profile.organizationId,
    fingerprint,
    riskType,
    severity,
    riskState,
    lifecycleStatus: "OPEN",
    detectedAt: now,
    updatedAt: now,
    affectedAmountMinor,
    expectedRiskDate,
    reason,
    sourceIds,
    confidence,
    recommendedNextStep,
    history: [{ status: "OPEN", at: now, note: "Alert created" }, { status: riskState, at: now, note: reason }],
  });
}

function notificationsFor(profile: OrganizationProfile, alert: Alert, transition: "created" | "worsened" | "resolved"): Notification[] {
  if (!profile.notificationPreferences.inAppEnabled && !profile.notificationPreferences.emailEnabled) return [];
  if (transition !== "resolved" && severityRank(alert.severity) < severityRank(profile.notificationPreferences.minimumSeverity)) return [];
  const channels: Array<"IN_APP" | "EMAIL"> = [];
  if (profile.notificationPreferences.inAppEnabled) channels.push("IN_APP");
  if (profile.notificationPreferences.emailEnabled && (transition === "resolved" || alert.severity === "CRITICAL" || alert.severity === "HIGH")) channels.push("EMAIL");
  return channels.map((channel) => Object.freeze({
    notificationId: `notif_${hash(`${alert.alertId}:${channel}:${transition}`)}`,
    organizationId: profile.organizationId,
    alertId: alert.alertId,
    channel,
    status: "QUEUED" as const,
    subject: subjectFor(alert, transition),
    createdAt: nowIso(),
  }));
}

function subjectFor(alert: Alert, transition: string): string {
  if (transition === "resolved") return `FlowGuard - ${alert.riskType} resolved`;
  return `FlowGuard - ${alert.riskType} ${alert.severity}`;
}

function severityRank(severity: Severity): number {
  return { INFO: 0, WATCH: 1, WARNING: 2, HIGH: 3, CRITICAL: 4 }[severity];
}

function replace(alerts: Alert[], updated: Alert): void {
  const index = alerts.findIndex((alert) => alert.alertId === updated.alertId);
  if (index >= 0) alerts[index] = updated;
}

function hash(value: string): string {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) >>> 0;
  return result.toString(16);
}

function nowIso(): string {
  return new Date().toISOString();
}
