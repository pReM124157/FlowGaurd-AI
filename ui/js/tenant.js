/**
 * FlowGuard — Tenant State Machine
 *
 * Manages per-tenant onboarding state, business profile, and financials.
 * Persisted to localStorage under the key namespace: `fg:tenant:<tenantId>:*`
 *
 * The DEMO tenant uses tenantId = 'DEMO' and is completely isolated from
 * all live tenant keys. Demo records NEVER appear in live namespaces.
 */

import { Provenance, noDataMetric, createMetric } from './provenance.js';

// ── Onboarding states ───────────────────────────────────────────────────────
export const OnboardingState = Object.freeze({
  BUSINESS_PROFILE:    'BUSINESS_PROFILE',
  RISK_PREFERENCES:    'RISK_PREFERENCES',
  DATA_CONNECTIONS:    'DATA_CONNECTIONS',
  DATA_VALIDATION:     'DATA_VALIDATION',
  INITIAL_CALCULATION: 'INITIAL_CALCULATION',
  READY:               'READY',
});

// Legal forward transitions
const TRANSITIONS = {
  [OnboardingState.BUSINESS_PROFILE]:    OnboardingState.RISK_PREFERENCES,
  [OnboardingState.RISK_PREFERENCES]:    OnboardingState.DATA_CONNECTIONS,
  [OnboardingState.DATA_CONNECTIONS]:    OnboardingState.DATA_VALIDATION,
  [OnboardingState.DATA_VALIDATION]:     OnboardingState.INITIAL_CALCULATION,
  [OnboardingState.INITIAL_CALCULATION]: OnboardingState.READY,
  [OnboardingState.READY]:               null,  // terminal
};

export const ORDERED_STATES = [
  OnboardingState.BUSINESS_PROFILE,
  OnboardingState.RISK_PREFERENCES,
  OnboardingState.DATA_CONNECTIONS,
  OnboardingState.DATA_VALIDATION,
  OnboardingState.INITIAL_CALCULATION,
  OnboardingState.READY,
];

export const DEMO_TENANT_ID = 'DEMO';

// ── Storage helpers ─────────────────────────────────────────────────────────
function storageKey(tenantId) {
  return `fg:tenant:${tenantId}`;
}

/**
 * Build a brand-new empty tenant record.
 */
function createEmptyTenant(tenantId) {
  return {
    tenantId,
    isDemo: tenantId === DEMO_TENANT_ID,
    onboardingState: OnboardingState.BUSINESS_PROFILE,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // Step 1 — Business profile (all USER_DECLARED)
    profile: {
      organizationName: '',
      industry: '',
      timezone: '',
      currency: 'USD',
      payrollAmount: null,
      payrollSchedule: '',
      minimumLiquidityBuffer: null,
      receivableTermsDays: null,
      recurringObligations: [],  // [{ description, amount, frequency }]
      financingObligations: [],  // [{ lender, balance, monthlyPayment }]
      notifications: {
        email: true,
        sms: false,
        inApp: true,
        liquidityThreshold: true,
        payrollAlert: true,
        overdraftRisk: true,
      },
      provenance: Provenance.USER_DECLARED,
      completedAt: null,
    },

    // Step 2 — Risk preferences (all USER_DECLARED)
    riskPreferences: {
      riskTolerance: 'moderate',          // conservative / moderate / aggressive
      forecastHorizonDays: 30,
      cashReserveTargetMultiplier: 2,     // months of obligations to keep
      alertSensitivity: 'medium',         // low / medium / high
      provenance: Provenance.USER_DECLARED,
      completedAt: null,
    },

    // Step 3 — Data connections
    dataSources: [],
    // e.g.: [{ id, type, name, status: 'connected'|'pending'|'failed', connectedAt, lastSyncAt }]

    // Step 4 — Validation result
    validationResult: null,
    // e.g.: { cashSourceVerified, missingSourceWarnings, auditItems, completedAt }

    // Step 5 — Initial financial snapshot (from authoritative engines only)
    initialAssessment: null,
    // e.g.: { availableCash, upcomingObligations, receivables, forecastAvailability, risks }

    // Dashboard financials — populated after READY
    financials: {
      availableCash:          noDataMetric('No bank source connected'),
      upcomingObligations:    noDataMetric('No payroll/AP source connected'),
      receivables:            noDataMetric('No AR source connected'),
      forecast30d:            noDataMetric('Insufficient history'),
      burnRate:               noDataMetric('Insufficient history'),
    },
  };
}

// ── Tenant CRUD ─────────────────────────────────────────────────────────────

/**
 * Load a tenant from localStorage. Returns null if not found.
 * @param {string} tenantId
 * @param {Storage} [storage]  - Injectable for testing
 */
export function loadTenant(tenantId, storage = localStorage) {
  const raw = storage.getItem(storageKey(tenantId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save tenant record to localStorage.
 * @param {object} tenant
 * @param {Storage} [storage]
 */
export function saveTenant(tenant, storage = localStorage) {
  if (!tenant?.tenantId) throw new Error('Tenant must have a tenantId');
  tenant.updatedAt = new Date().toISOString();
  storage.setItem(storageKey(tenant.tenantId), JSON.stringify(tenant));
  return tenant;
}

/**
 * Create a new tenant, persist, and return it.
 * @param {string} tenantId
 * @param {Storage} [storage]
 */
export function createTenant(tenantId, storage = localStorage) {
  if (!tenantId) throw new Error('tenantId is required');
  const tenant = createEmptyTenant(tenantId);
  return saveTenant(tenant, storage);
}

/**
 * Get or create a tenant (useful for resume flow).
 */
export function getOrCreateTenant(tenantId, storage = localStorage) {
  return loadTenant(tenantId, storage) ?? createTenant(tenantId, storage);
}

/**
 * Delete a tenant (for testing / cleanup).
 */
export function deleteTenant(tenantId, storage = localStorage) {
  storage.removeItem(storageKey(tenantId));
}

/**
 * List all tenant IDs in storage.
 */
export function listTenantIds(storage = localStorage) {
  const ids = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith('fg:tenant:') && !k.startsWith('fg:tenant:DEMO')) {
      const id = k.replace('fg:tenant:', '');
      ids.push(id);
    }
  }
  return ids;
}

// ── State machine ────────────────────────────────────────────────────────────

/**
 * Advance the tenant to the next onboarding state.
 * Throws if the current state is terminal or transition is invalid.
 */
export function advanceOnboarding(tenant, storage = localStorage) {
  const next = TRANSITIONS[tenant.onboardingState];
  if (!next) throw new Error(`Cannot advance from terminal state: ${tenant.onboardingState}`);
  tenant.onboardingState = next;
  return saveTenant(tenant, storage);
}

/**
 * Rewind to a previous step (allows editing earlier steps).
 * Only legal if target is behind current step.
 */
export function rewindOnboarding(tenant, targetState, storage = localStorage) {
  const currentIdx = ORDERED_STATES.indexOf(tenant.onboardingState);
  const targetIdx  = ORDERED_STATES.indexOf(targetState);
  if (targetIdx === -1) throw new Error(`Unknown state: ${targetState}`);
  if (targetIdx >= currentIdx) throw new Error('Cannot rewind forward');
  tenant.onboardingState = targetState;
  return saveTenant(tenant, storage);
}

/**
 * Is the tenant fully onboarded?
 */
export function isReady(tenant) {
  return tenant?.onboardingState === OnboardingState.READY;
}

/**
 * What percentage of onboarding is complete (0–100)?
 */
export function onboardingProgress(tenant) {
  const idx = ORDERED_STATES.indexOf(tenant?.onboardingState ?? OnboardingState.BUSINESS_PROFILE);
  return Math.round((idx / (ORDERED_STATES.length - 1)) * 100);
}

// ── Profile updates ──────────────────────────────────────────────────────────

/**
 * Merge partial profile fields into the tenant.
 * All values are stamped USER_DECLARED and never promoted to ACTUAL.
 */
export function updateProfile(tenant, partialProfile, storage = localStorage) {
  tenant.profile = {
    ...tenant.profile,
    ...partialProfile,
    provenance: Provenance.USER_DECLARED,  // immutable — always USER_DECLARED
  };
  return saveTenant(tenant, storage);
}

export function updateRiskPreferences(tenant, partial, storage = localStorage) {
  tenant.riskPreferences = {
    ...tenant.riskPreferences,
    ...partial,
    provenance: Provenance.USER_DECLARED,
  };
  return saveTenant(tenant, storage);
}

/**
 * Register a data source connection.
 */
export function connectDataSource(tenant, source, storage = localStorage) {
  const existing = tenant.dataSources.findIndex(s => s.id === source.id);
  if (existing >= 0) {
    tenant.dataSources[existing] = { ...tenant.dataSources[existing], ...source };
  } else {
    tenant.dataSources.push({ ...source, connectedAt: new Date().toISOString() });
  }
  return saveTenant(tenant, storage);
}

/**
 * Store validation result from the readiness audit.
 */
export function storeValidationResult(tenant, result, storage = localStorage) {
  tenant.validationResult = { ...result, completedAt: new Date().toISOString() };
  return saveTenant(tenant, storage);
}

/**
 * Store the initial financial assessment computed by the engine.
 * Metrics must carry explicit provenance — no fabrication allowed.
 */
export function storeInitialAssessment(tenant, assessment, storage = localStorage) {
  // Validate that no field is being promoted to ACTUAL without a source
  for (const [key, metric] of Object.entries(assessment)) {
    if (metric?.provenance === Provenance.ACTUAL && !metric?.source) {
      throw new Error(`Metric "${key}" claims ACTUAL provenance but has no source`);
    }
    if (metric?.provenance === Provenance.USER_DECLARED && metric?.value !== null) {
      // USER_DECLARED values are stored as context, not as financial facts
      console.warn(`Metric "${key}" is USER_DECLARED — will not be shown as financial data`);
    }
  }
  tenant.initialAssessment = { ...assessment, computedAt: new Date().toISOString() };
  return saveTenant(tenant, storage);
}

// ── Cross-tenant isolation guard ─────────────────────────────────────────────

/**
 * Asserts that a Demo tenant's data cannot contaminate a live tenant.
 * Call before any merge / copy operation.
 */
export function assertNoDemoContamination(sourceTenantId, targetTenantId) {
  if (sourceTenantId === DEMO_TENANT_ID && targetTenantId !== DEMO_TENANT_ID) {
    throw new Error(
      `SECURITY: Attempted to copy demo data into live tenant "${targetTenantId}". Blocked.`
    );
  }
}
