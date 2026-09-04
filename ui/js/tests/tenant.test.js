/**
 * FlowGuard Tests — Tenant State Machine
 * 
 * Covers: empty org init, state transitions, resume, cross-tenant isolation.
 */
import { strict as assert } from 'assert';
import { test, describe, beforeEach } from 'node:test';

// ── In-memory localStorage mock ────────────────────────────────────────────
function makeStorage() {
  const store = new Map();
  return {
    getItem:    (k) => store.get(k) ?? null,
    setItem:    (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    clear:      () => store.clear(),
    get length() { return store.size; },
    key:        (i) => [...store.keys()][i] ?? null,
  };
}

// ── Import modules under test ──────────────────────────────────────────────
// We inline the modules because Node ESM with file:// imports from Desktop paths
// requires special config. We use dynamic inline evaluation for test isolation.

import {
  OnboardingState,
  ORDERED_STATES,
  DEMO_TENANT_ID,
  createTenant,
  loadTenant,
  saveTenant,
  deleteTenant,
  getOrCreateTenant,
  listTenantIds,
  advanceOnboarding,
  rewindOnboarding,
  isReady,
  onboardingProgress,
  updateProfile,
  updateRiskPreferences,
  connectDataSource,
  storeValidationResult,
  storeInitialAssessment,
  assertNoDemoContamination,
} from '../tenant.js';

import { Provenance, noDataMetric } from '../provenance.js';

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Tenant — Empty Organization', () => {
  test('createTenant produces a new empty org at BUSINESS_PROFILE', () => {
    const storage = makeStorage();
    const tenant = createTenant('org_001', storage);

    assert.equal(tenant.tenantId, 'org_001');
    assert.equal(tenant.onboardingState, OnboardingState.BUSINESS_PROFILE);
    assert.equal(tenant.isDemo, false);
    assert.equal(tenant.profile.organizationName, '');
    assert.equal(tenant.profile.provenance, Provenance.USER_DECLARED);
    assert.equal(tenant.dataSources.length, 0);
    assert.notEqual(tenant.createdAt, null);
  });

  test('empty org financials are all noDataMetric', () => {
    const storage = makeStorage();
    const tenant = createTenant('org_002', storage);

    for (const [key, metric] of Object.entries(tenant.financials)) {
      assert.equal(metric.reliable, false, `${key} should be unreliable`);
      assert.equal(metric.value, null, `${key} value should be null`);
      assert.equal(metric.provenance, Provenance.PENDING, `${key} should be PENDING`);
    }
  });

  test('getOrCreateTenant is idempotent', () => {
    const storage = makeStorage();
    const t1 = getOrCreateTenant('org_003', storage);
    const t2 = getOrCreateTenant('org_003', storage);

    assert.equal(t1.tenantId, t2.tenantId);
    assert.equal(t1.createdAt, t2.createdAt);
  });
});

describe('Tenant — State Machine Transitions', () => {
  let storage;
  let tenant;

  beforeEach(() => {
    storage = makeStorage();
    tenant = createTenant('org_sm_001', storage);
  });

  test('advances through all states in order', () => {
    const expected = [
      OnboardingState.RISK_PREFERENCES,
      OnboardingState.DATA_CONNECTIONS,
      OnboardingState.DATA_VALIDATION,
      OnboardingState.INITIAL_CALCULATION,
      OnboardingState.READY,
    ];

    for (const nextState of expected) {
      const updated = advanceOnboarding(tenant, storage);
      assert.equal(updated.onboardingState, nextState);
      tenant = updated;
    }
  });

  test('cannot advance past READY', () => {
    // Advance to READY
    for (let i = 0; i < 5; i++) tenant = advanceOnboarding(tenant, storage);
    assert.equal(tenant.onboardingState, OnboardingState.READY);
    assert.throws(() => advanceOnboarding(tenant, storage), /terminal state/i);
  });

  test('rewind to previous state is legal', () => {
    tenant = advanceOnboarding(tenant, storage);
    tenant = advanceOnboarding(tenant, storage);
    assert.equal(tenant.onboardingState, OnboardingState.DATA_CONNECTIONS);

    rewindOnboarding(tenant, OnboardingState.BUSINESS_PROFILE, storage);
    const reloaded = loadTenant('org_sm_001', storage);
    assert.equal(reloaded.onboardingState, OnboardingState.BUSINESS_PROFILE);
  });

  test('rewind forward is illegal', () => {
    // Currently at BUSINESS_PROFILE, cannot rewind "forward" to RISK_PREFERENCES
    assert.throws(
      () => rewindOnboarding(tenant, OnboardingState.DATA_CONNECTIONS, storage),
      /cannot rewind forward/i
    );
  });

  test('onboardingProgress is 0% at start', () => {
    assert.equal(onboardingProgress(tenant), 0);
  });

  test('onboardingProgress is 100% when READY', () => {
    for (let i = 0; i < 5; i++) tenant = advanceOnboarding(tenant, storage);
    assert.equal(onboardingProgress(tenant), 100);
  });

  test('isReady returns false until READY', () => {
    assert.equal(isReady(tenant), false);
    for (let i = 0; i < 4; i++) { tenant = advanceOnboarding(tenant, storage); assert.equal(isReady(tenant), false); }
    tenant = advanceOnboarding(tenant, storage);
    assert.equal(isReady(tenant), true);
  });
});

describe('Tenant — Resume (Partial Onboarding)', () => {
  test('can resume from any step', () => {
    const storage = makeStorage();
    let tenant = createTenant('org_resume_001', storage);

    // Advance 2 steps then "close browser" (simulated by reloading from storage)
    tenant = advanceOnboarding(tenant, storage);
    tenant = advanceOnboarding(tenant, storage);
    assert.equal(tenant.onboardingState, OnboardingState.DATA_CONNECTIONS);

    // Simulate resume: load fresh from storage
    const reloaded = loadTenant('org_resume_001', storage);
    assert.equal(reloaded.onboardingState, OnboardingState.DATA_CONNECTIONS);
    assert.equal(reloaded.tenantId, 'org_resume_001');
  });

  test('profile data persists across resume', () => {
    const storage = makeStorage();
    let tenant = createTenant('org_resume_002', storage);

    updateProfile(tenant, { organizationName: 'Test Corp', industry: 'Technology', currency: 'USD' }, storage);
    const reloaded = loadTenant('org_resume_002', storage);
    assert.equal(reloaded.profile.organizationName, 'Test Corp');
    assert.equal(reloaded.profile.provenance, Provenance.USER_DECLARED);
  });
});

describe('Tenant — Cross-Tenant Isolation', () => {
  test('two tenants have completely separate storage keys', () => {
    const storage = makeStorage();
    const t1 = createTenant('org_iso_001', storage);
    const t2 = createTenant('org_iso_002', storage);

    updateProfile(t1, { organizationName: 'Tenant One' }, storage);
    updateProfile(t2, { organizationName: 'Tenant Two' }, storage);

    const r1 = loadTenant('org_iso_001', storage);
    const r2 = loadTenant('org_iso_002', storage);
    assert.equal(r1.profile.organizationName, 'Tenant One');
    assert.equal(r2.profile.organizationName, 'Tenant Two');
    assert.notEqual(r1.profile.organizationName, r2.profile.organizationName);
  });

  test('deleting one tenant does not affect the other', () => {
    const storage = makeStorage();
    createTenant('org_del_001', storage);
    createTenant('org_del_002', storage);

    deleteTenant('org_del_001', storage);
    assert.equal(loadTenant('org_del_001', storage), null);
    assert.notEqual(loadTenant('org_del_002', storage), null);
  });

  test('listTenantIds excludes demo tenant', () => {
    const storage = makeStorage();
    createTenant('org_list_001', storage);
    createTenant('org_list_002', storage);
    // Manually add a demo key as the demo module would
    storage.setItem('fg:tenant:DEMO', JSON.stringify({ tenantId: 'DEMO' }));

    const ids = listTenantIds(storage);
    assert.ok(ids.includes('org_list_001'));
    assert.ok(ids.includes('org_list_002'));
    assert.ok(!ids.includes('DEMO'), 'DEMO should be excluded from live tenant list');
  });
});

describe('Tenant — Provenance Enforcement', () => {
  test('updateProfile always stamps USER_DECLARED', () => {
    const storage = makeStorage();
    const tenant = createTenant('org_prov_001', storage);
    updateProfile(tenant, { organizationName: 'Corp', payrollAmount: 100000 }, storage);

    const reloaded = loadTenant('org_prov_001', storage);
    assert.equal(reloaded.profile.provenance, Provenance.USER_DECLARED);
  });

  test('storeInitialAssessment rejects ACTUAL metric without source', () => {
    const storage = makeStorage();
    let tenant = createTenant('org_prov_002', storage);
    for (let i = 0; i < 4; i++) tenant = advanceOnboarding(tenant, storage);

    const badAssessment = {
      availableCash: { value: 50000, provenance: Provenance.ACTUAL, source: null, reliable: true },
    };
    assert.throws(
      () => storeInitialAssessment(tenant, badAssessment, storage),
      /claims ACTUAL provenance but has no source/i
    );
  });

  test('storeInitialAssessment accepts ACTUAL metric with source', () => {
    const storage = makeStorage();
    let tenant = createTenant('org_prov_003', storage);
    for (let i = 0; i < 4; i++) tenant = advanceOnboarding(tenant, storage);

    const goodAssessment = {
      availableCash: { value: 50000, provenance: Provenance.ACTUAL, source: 'bank_connect', reliable: true, asOf: new Date().toISOString() },
    };
    assert.doesNotThrow(() => storeInitialAssessment(tenant, goodAssessment, storage));
  });
});

describe('Tenant — Demo Contamination Guard', () => {
  test('assertNoDemoContamination blocks demo→live copy', () => {
    assert.throws(
      () => assertNoDemoContamination(DEMO_TENANT_ID, 'org_live_001'),
      /SECURITY.*demo.*blocked/i
    );
  });

  test('assertNoDemoContamination allows live→live copy', () => {
    assert.doesNotThrow(() => assertNoDemoContamination('org_a', 'org_b'));
  });

  test('assertNoDemoContamination allows demo→demo copy', () => {
    assert.doesNotThrow(() => assertNoDemoContamination(DEMO_TENANT_ID, DEMO_TENANT_ID));
  });
});
