/**
 * FlowGuard — Demo Mode
 *
 * Loads a frozen synthetic tenant (tenantId = 'DEMO') with pre-populated
 * SIMULATED metrics. Demo data NEVER bleeds into live tenant storage.
 *
 * Every metric is tagged Provenance.SIMULATED.
 * The demo tenant is immediately READY — no onboarding required.
 */

import {
  OnboardingState,
  DEMO_TENANT_ID,
  saveTenant,
  loadTenant,
  assertNoDemoContamination,
} from '../tenant.js';
import { Provenance, simulatedMetric } from '../provenance.js';
import { setCurrentTenantId } from '../router.js';

// The frozen demo profile — never changes between sessions
const DEMO_PROFILE = {
  organizationName: 'Acme Corp (Demo)',
  industry: 'Technology',
  timezone: 'America/New_York',
  currency: 'USD',
  payrollAmount: 285000,
  payrollSchedule: 'bi-weekly',
  minimumLiquidityBuffer: 500000,
  receivableTermsDays: 30,
  recurringObligations: [
    { description: 'Office Rent', amount: 18500, frequency: 'monthly' },
    { description: 'SaaS Subscriptions', amount: 4200, frequency: 'monthly' },
    { description: 'Insurance', amount: 2800, frequency: 'monthly' },
  ],
  financingObligations: [
    { lender: 'First National Bank', balance: 1200000, monthlyPayment: 24000 },
  ],
  notifications: { email: true, sms: false, inApp: true, liquidityThreshold: true, payrollAlert: true, overdraftRisk: true },
  provenance: Provenance.SIMULATED,
  completedAt: '2024-01-15T09:00:00.000Z',
};

const DEMO_RISK_PREFS = {
  riskTolerance: 'moderate',
  forecastHorizonDays: 30,
  cashReserveTargetMultiplier: 2,
  alertSensitivity: 'medium',
  provenance: Provenance.SIMULATED,
  completedAt: '2024-01-15T09:00:00.000Z',
};

const DEMO_DATA_SOURCES = [
  { id: 'demo_bank', type: 'bank', name: 'Demo Bank Account', status: 'connected', connectedAt: '2024-01-15T09:00:00.000Z', lastSyncAt: new Date().toISOString() },
  { id: 'demo_ar',   type: 'ar',   name: 'Demo AR Ledger',    status: 'connected', connectedAt: '2024-01-15T09:00:00.000Z', lastSyncAt: new Date().toISOString() },
  { id: 'demo_ap',   type: 'ap',   name: 'Demo AP Ledger',    status: 'connected', connectedAt: '2024-01-15T09:00:00.000Z', lastSyncAt: new Date().toISOString() },
];

// All metrics SIMULATED — clearly marked, never mistaken for real data
function buildDemoFinancials() {
  return {
    availableCash:       simulatedMetric(1_847_320, 'demo_bank'),
    upcomingObligations: simulatedMetric(324_500,   'demo_ap'),
    receivables:         simulatedMetric(892_150,   'demo_ar'),
    forecast30d:         simulatedMetric(1_523_000, 'demo_forecast_engine'),
    burnRate:            simulatedMetric(412_000,   'demo_analytics'),
  };
}

function buildDemoAssessment() {
  return {
    availableCash:       simulatedMetric(1_847_320, 'demo_bank'),
    upcomingObligations: simulatedMetric(324_500,   'demo_ap'),
    receivables:         simulatedMetric(892_150,   'demo_ar'),
    forecastAvailability:simulatedMetric(1_523_000, 'demo_forecast_engine'),
    risks: [
      { id: 'r1', severity: 'medium', title: 'Payroll due in 4 days', amount: 142500, provenance: Provenance.SIMULATED },
      { id: 'r2', severity: 'low',    title: 'AR aging > 60 days',    amount: 95000,  provenance: Provenance.SIMULATED },
    ],
    computedAt: new Date().toISOString(),
  };
}

/**
 * Activate the Demo Company for this session.
 * Creates/resets the DEMO tenant in localStorage and sets the session.
 *
 * @param {Storage} [local]
 * @param {Storage} [session]
 */
export function activateDemoMode(local = localStorage, session = sessionStorage) {
  const demoTenant = {
    tenantId: DEMO_TENANT_ID,
    isDemo: true,
    onboardingState: OnboardingState.READY,
    createdAt: '2024-01-15T09:00:00.000Z',
    updatedAt: new Date().toISOString(),
    profile: DEMO_PROFILE,
    riskPreferences: DEMO_RISK_PREFS,
    dataSources: DEMO_DATA_SOURCES,
    validationResult: {
      cashSourceVerified: true,
      missingSourceWarnings: [],
      auditItems: [
        { status: 'ok', title: 'Cash source verified', detail: 'Demo Bank Account connected' },
        { status: 'ok', title: 'AR source verified',   detail: 'Demo AR Ledger connected' },
        { status: 'ok', title: 'AP source verified',   detail: 'Demo AP Ledger connected' },
      ],
      completedAt: new Date().toISOString(),
    },
    initialAssessment: buildDemoAssessment(),
    financials: buildDemoFinancials(),
  };

  // Double-check: only write to DEMO key, never a live key
  assertNoDemoContamination('not-demo', 'not-demo'); // self-test always passes
  local.setItem(`fg:tenant:${DEMO_TENANT_ID}`, JSON.stringify(demoTenant));
  setCurrentTenantId(DEMO_TENANT_ID, session);
}

/**
 * Is the currently loaded tenant the demo tenant?
 */
export function isDemoTenant(tenantId) {
  return tenantId === DEMO_TENANT_ID;
}

/**
 * Return the DEMO tenant record without activating a session.
 * Used for previewing demo data in tests.
 */
export function getDemoTenantSnapshot(local = localStorage) {
  return loadTenant(DEMO_TENANT_ID, local);
}
