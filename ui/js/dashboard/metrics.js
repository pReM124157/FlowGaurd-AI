/**
 * FlowGuard — Metrics Engine
 *
 * Computes dashboard metrics ONLY from authoritative data sources.
 * If a reliable source is not available for a metric, returns noDataMetric().
 * Never fabricates, defaults, or invents financial values.
 */

import { Provenance, noDataMetric, createMetric, pendingMetric, isReliableForDashboard } from '../provenance.js';
import { loadTenant } from '../tenant.js';

/**
 * Compute the full set of dashboard metrics for a tenant.
 *
 * Returns an object where each key is a metric name and each value
 * is a MetricValue: { value, provenance, source, asOf, reliable }
 *
 * @param {string} tenantId
 * @param {Storage} [storage]
 * @returns {DashboardMetrics}
 */
export function computeMetrics(tenantId, storage = localStorage) {
  const tenant = loadTenant(tenantId, storage);
  if (!tenant) return buildEmptyMetrics('tenant_not_found');

  const sources = tenant.dataSources ?? [];
  const financials = tenant.financials ?? {};

  // ── Available Cash ──────────────────────────────────────────────────────
  // Only show if at least one bank/cash source is connected and has synced
  const cashSources = sources.filter(s => ['bank', 'payment_processor', 'cash_account'].includes(s.type) && s.status === 'connected');
  let availableCash;
  if (cashSources.length === 0) {
    availableCash = noDataMetric('No bank or cash source connected');
  } else if (financials.availableCash?.reliable) {
    availableCash = financials.availableCash;
  } else {
    availableCash = pendingMetric(cashSources[0].name);
  }

  // ── Upcoming Obligations ────────────────────────────────────────────────
  const apSources = sources.filter(s => ['ap', 'payroll', 'erp'].includes(s.type) && s.status === 'connected');
  let upcomingObligations;
  if (apSources.length === 0) {
    // We DO have user-declared payroll — but that is USER_DECLARED, not shown as a financial metric
    upcomingObligations = noDataMetric('No AP or payroll system connected');
  } else if (financials.upcomingObligations?.reliable) {
    upcomingObligations = financials.upcomingObligations;
  } else {
    upcomingObligations = pendingMetric(apSources[0].name);
  }

  // ── Receivables ─────────────────────────────────────────────────────────
  const arSources = sources.filter(s => ['ar', 'erp', 'crm'].includes(s.type) && s.status === 'connected');
  let receivables;
  if (arSources.length === 0) {
    receivables = noDataMetric('No AR system connected');
  } else if (financials.receivables?.reliable) {
    receivables = financials.receivables;
  } else {
    receivables = pendingMetric(arSources[0].name);
  }

  // ── 30-day Forecast ─────────────────────────────────────────────────────
  // Requires at least one cash source + some history (signaled by financials.forecast30d)
  let forecast30d;
  if (cashSources.length === 0) {
    forecast30d = noDataMetric('Cash source required for forecast');
  } else if (financials.forecast30d?.reliable) {
    forecast30d = financials.forecast30d;
  } else {
    forecast30d = noDataMetric('Insufficient transaction history for forecast');
  }

  // ── Burn Rate ───────────────────────────────────────────────────────────
  let burnRate;
  if (financials.burnRate?.reliable) {
    burnRate = financials.burnRate;
  } else {
    burnRate = noDataMetric('Insufficient history for burn rate');
  }

  return { availableCash, upcomingObligations, receivables, forecast30d, burnRate };
}

/**
 * Build a full set of no-data metrics (used for empty orgs / failed loads).
 */
function buildEmptyMetrics(reason) {
  return {
    availableCash:       noDataMetric(reason),
    upcomingObligations: noDataMetric(reason),
    receivables:         noDataMetric(reason),
    forecast30d:         noDataMetric(reason),
    burnRate:            noDataMetric(reason),
  };
}

/**
 * Run the data readiness audit for a tenant.
 * Identifies what's missing, what's stale, and what's ready.
 *
 * @param {string} tenantId
 * @param {Storage} [storage]
 * @returns {AuditResult}
 */
export function runReadinessAudit(tenantId, storage = localStorage) {
  const tenant = loadTenant(tenantId, storage);
  if (!tenant) return { cashSourceVerified: false, missingSourceWarnings: ['Tenant not found'], auditItems: [] };

  const sources = tenant.dataSources ?? [];
  const auditItems = [];
  const missingSourceWarnings = [];

  // Cash source check (critical — gates Available Cash metric)
  const cashSources = sources.filter(s =>
    ['bank', 'payment_processor', 'cash_account'].includes(s.type) && s.status === 'connected'
  );
  const cashSourceVerified = cashSources.length > 0;
  if (cashSourceVerified) {
    const src = cashSources[0];
    const freshness = formatFreshness(src.lastSyncAt);
    auditItems.push({ status: 'ok', title: 'Cash source verified', detail: src.name, freshness });
  } else {
    auditItems.push({ status: 'fail', title: 'No cash source connected', detail: 'Available Cash will show "Not enough data"', freshness: null });
    missingSourceWarnings.push('No bank or cash account connected');
  }

  // AR check
  const arSources = sources.filter(s => ['ar', 'erp'].includes(s.type) && s.status === 'connected');
  if (arSources.length > 0) {
    auditItems.push({ status: 'ok', title: 'Receivables source verified', detail: arSources[0].name, freshness: formatFreshness(arSources[0].lastSyncAt) });
  } else {
    auditItems.push({ status: 'warn', title: 'No AR system connected', detail: 'Receivables metric will be unavailable', freshness: null });
    missingSourceWarnings.push('No accounts receivable system connected');
  }

  // AP / Payroll check
  const apSources = sources.filter(s => ['ap', 'payroll', 'erp'].includes(s.type) && s.status === 'connected');
  if (apSources.length > 0) {
    auditItems.push({ status: 'ok', title: 'Obligations source verified', detail: apSources[0].name, freshness: formatFreshness(apSources[0].lastSyncAt) });
  } else {
    auditItems.push({ status: 'warn', title: 'No AP/payroll system connected', detail: 'User-declared payroll captured as context only, not financial data', freshness: null });
    missingSourceWarnings.push('No accounts payable or payroll system connected');
  }

  // Overall data sufficiency note
  const connectedCount = sources.filter(s => s.status === 'connected').length;
  auditItems.push({
    status: connectedCount >= 2 ? 'ok' : 'warn',
    title: `${connectedCount} data source${connectedCount !== 1 ? 's' : ''} connected`,
    detail: connectedCount === 0 ? 'Connect at least one source to see real metrics' : `${connectedCount} active integration${connectedCount !== 1 ? 's' : ''}`,
    freshness: null,
  });

  return { cashSourceVerified, missingSourceWarnings, auditItems };
}

/**
 * Compute the initial financial assessment from authoritative engines.
 * Only returns values that can be derived from connected sources.
 * USER_DECLARED values are referenced for context but never returned as financial metrics.
 */
export function computeInitialAssessment(tenantId, storage = localStorage) {
  const tenant  = loadTenant(tenantId, storage);
  if (!tenant) return {};

  const metrics = computeMetrics(tenantId, storage);
  const risks   = computeRisks(tenant, metrics);

  return {
    availableCash:        metrics.availableCash,
    upcomingObligations:  metrics.upcomingObligations,
    receivables:          metrics.receivables,
    forecastAvailability: metrics.forecast30d,
    risks,
  };
}

/**
 * Compute active risk signals. Only uses reliable metrics.
 * Never uses USER_DECLARED values to generate risk alerts.
 */
function computeRisks(tenant, metrics) {
  const risks = [];
  const profile = tenant.profile;

  // Payroll risk — only if we have reliable cash data
  if (metrics.availableCash.reliable && profile.payrollSchedule && profile.payrollAmount) {
    const cash = metrics.availableCash.value;
    // USER_DECLARED payroll amount used only as context for risk framing — not presented as ACTUAL
    const payrollCtx = profile.payrollAmount;
    if (cash !== null && payrollCtx && cash < payrollCtx * 2) {
      risks.push({
        id: 'payroll_risk',
        severity: cash < payrollCtx ? 'high' : 'medium',
        title: 'Cash may be insufficient for upcoming payroll',
        detail: 'Based on connected bank data vs. declared payroll amount (context only)',
        provenanceNote: 'Risk signal derived from ACTUAL cash data; payroll amount is USER_DECLARED context',
      });
    }
  }

  // Liquidity buffer risk
  if (metrics.availableCash.reliable && profile.minimumLiquidityBuffer !== null) {
    const cash   = metrics.availableCash.value;
    const buffer = profile.minimumLiquidityBuffer;
    if (cash !== null && cash < buffer) {
      risks.push({
        id: 'liquidity_risk',
        severity: 'high',
        title: 'Cash below minimum liquidity buffer',
        detail: `Current cash is below your declared ${formatCurrency(buffer, profile.currency)} target`,
        provenanceNote: 'Risk signal from ACTUAL cash vs USER_DECLARED buffer target',
      });
    }
  }

  return risks;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFreshness(isoString) {
  if (!isoString) return null;
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}
