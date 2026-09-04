/**
 * FlowGuard Tests — Onboarding State Machine (UI orchestrator layer)
 * 
 * Covers: step validation gates, partial save + resume, demo does not pollute live.
 */
import { strict as assert } from 'assert';
import { test, describe, beforeEach } from 'node:test';

import {
  OnboardingState,
  createTenant,
  loadTenant,
  advanceOnboarding,
} from '../tenant.js';
import { Provenance } from '../provenance.js';
import { OnboardingStateMachine } from '../onboarding/state-machine.js';

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

const VALID_PROFILE = {
  organizationName: 'Test Corp',
  industry: 'Technology',
  timezone: 'America/New_York',
  currency: 'USD',
  payrollAmount: 100000,
  payrollSchedule: 'bi-weekly',
  minimumLiquidityBuffer: 200000,
  receivableTermsDays: 30,
  recurringObligations: [],
  financingObligations: [],
  notifications: { email: true },
};

const VALID_RISK = {
  riskTolerance: 'moderate',
  forecastHorizonDays: 30,
  cashReserveTargetMultiplier: 2,
  alertSensitivity: 'medium',
};

describe('OnboardingStateMachine — Step Validation Gates', () => {
  test('advance fails at BUSINESS_PROFILE with empty profile', () => {
    const storage = makeStorage();
    createTenant('org_sm_val_001', storage);
    const sm = new OnboardingStateMachine('org_sm_val_001', storage);

    const result = sm.advance();
    assert.equal(result.success, false);
    assert.ok(result.error, 'Should return an error message');
    assert.equal(sm.currentState, OnboardingState.BUSINESS_PROFILE, 'State must not change on failure');
  });

  test('advance succeeds at BUSINESS_PROFILE with valid profile', () => {
    const storage = makeStorage();
    createTenant('org_sm_val_002', storage);
    const sm = new OnboardingStateMachine('org_sm_val_002', storage);

    sm.saveProfile(VALID_PROFILE);
    const result = sm.advance();
    assert.equal(result.success, true);
    assert.equal(sm.currentState, OnboardingState.RISK_PREFERENCES);
  });

  test('advance fails at BUSINESS_PROFILE with missing required fields', () => {
    const storage = makeStorage();
    createTenant('org_sm_val_003', storage);
    const sm = new OnboardingStateMachine('org_sm_val_003', storage);

    // Missing industry
    sm.saveProfile({ ...VALID_PROFILE, industry: '' });
    const result = sm.advance();
    assert.equal(result.success, false);
    assert.ok(result.error?.toLowerCase().includes('industry'));
  });

  test('advance fails at RISK_PREFERENCES with empty prefs', () => {
    const storage = makeStorage();
    createTenant('org_sm_val_004', storage);
    const sm = new OnboardingStateMachine('org_sm_val_004', storage);

    sm.saveProfile(VALID_PROFILE);
    sm.advance(); // to RISK_PREFERENCES
    
    // Clear risk prefs
    sm.saveRiskPreferences({ riskTolerance: '', forecastHorizonDays: 0, alertSensitivity: '' });
    const result = sm.advance();
    assert.equal(result.success, false);
  });

  test('advance succeeds at RISK_PREFERENCES with valid prefs', () => {
    const storage = makeStorage();
    createTenant('org_sm_val_005', storage);
    const sm = new OnboardingStateMachine('org_sm_val_005', storage);

    sm.saveProfile(VALID_PROFILE);
    sm.advance();
    sm.saveRiskPreferences(VALID_RISK);
    const result = sm.advance();
    assert.equal(result.success, true);
    assert.equal(sm.currentState, OnboardingState.DATA_CONNECTIONS);
  });

  test('DATA_CONNECTIONS step allows skip (no validation)', () => {
    const storage = makeStorage();
    createTenant('org_sm_val_006', storage);
    const sm = new OnboardingStateMachine('org_sm_val_006', storage);

    sm.saveProfile(VALID_PROFILE);
    sm.advance();
    sm.saveRiskPreferences(VALID_RISK);
    sm.advance();

    // Skip with no sources
    const result = sm.advance();
    assert.equal(result.success, true);
    assert.equal(sm.currentState, OnboardingState.DATA_VALIDATION);
  });
});

describe('OnboardingStateMachine — Partial Save + Resume', () => {
  test('saveProfile persists data that survives re-instantiation', () => {
    const storage = makeStorage();
    createTenant('org_resume_sm_001', storage);

    const sm1 = new OnboardingStateMachine('org_resume_sm_001', storage);
    sm1.saveProfile(VALID_PROFILE);

    // Simulate browser close / reload — create new SM instance
    const sm2 = new OnboardingStateMachine('org_resume_sm_001', storage);
    const reloaded = sm2.tenant;
    assert.equal(reloaded.profile.organizationName, 'Test Corp');
    assert.equal(reloaded.profile.payrollAmount, 100000);
  });

  test('partial profile save preserves previously entered fields', () => {
    const storage = makeStorage();
    createTenant('org_partial_001', storage);
    const sm = new OnboardingStateMachine('org_partial_001', storage);

    sm.saveProfile({ organizationName: 'First Save', industry: 'Technology', currency: 'USD' });
    // Second partial save — only updating one field
    sm.saveProfile({ organizationName: 'Updated Name' });

    const tenant = loadTenant('org_partial_001', storage);
    assert.equal(tenant.profile.organizationName, 'Updated Name');
    // Industry should still be preserved from first save
    assert.equal(tenant.profile.industry, 'Technology');
  });

  test('sm.stepIndex correctly reflects current state', () => {
    const storage = makeStorage();
    createTenant('org_idx_001', storage);
    const sm = new OnboardingStateMachine('org_idx_001', storage);
    
    assert.equal(sm.stepIndex, 0);
    sm.saveProfile(VALID_PROFILE);
    sm.advance();
    assert.equal(sm.stepIndex, 1);
  });

  test('goBack allows editing a previous step', () => {
    const storage = makeStorage();
    createTenant('org_goback_001', storage);
    const sm = new OnboardingStateMachine('org_goback_001', storage);

    sm.saveProfile(VALID_PROFILE);
    sm.advance();
    assert.equal(sm.currentState, OnboardingState.RISK_PREFERENCES);

    sm.goBack(OnboardingState.BUSINESS_PROFILE);
    assert.equal(sm.currentState, OnboardingState.BUSINESS_PROFILE);
  });
});

describe('OnboardingStateMachine — Provenance Integrity', () => {
  test('profile saved via SM always has USER_DECLARED provenance', () => {
    const storage = makeStorage();
    createTenant('org_prov_sm_001', storage);
    const sm = new OnboardingStateMachine('org_prov_sm_001', storage);

    sm.saveProfile(VALID_PROFILE);
    const tenant = loadTenant('org_prov_sm_001', storage);
    assert.equal(tenant.profile.provenance, Provenance.USER_DECLARED);
  });

  test('risk preferences saved via SM always have USER_DECLARED provenance', () => {
    const storage = makeStorage();
    createTenant('org_prov_sm_002', storage);
    const sm = new OnboardingStateMachine('org_prov_sm_002', storage);

    sm.saveProfile(VALID_PROFILE);
    sm.advance();
    sm.saveRiskPreferences(VALID_RISK);

    const tenant = loadTenant('org_prov_sm_002', storage);
    assert.equal(tenant.riskPreferences.provenance, Provenance.USER_DECLARED);
  });
});

describe('OnboardingStateMachine — Data Source Registration', () => {
  test('addDataSource registers in tenant storage', () => {
    const storage = makeStorage();
    createTenant('org_ds_001', storage);
    const sm = new OnboardingStateMachine('org_ds_001', storage);

    sm.addDataSource({ id: 'ds_bank_01', type: 'bank', name: 'My Bank', status: 'connected' });
    const tenant = loadTenant('org_ds_001', storage);

    assert.equal(tenant.dataSources.length, 1);
    assert.equal(tenant.dataSources[0].id, 'ds_bank_01');
    assert.equal(tenant.dataSources[0].type, 'bank');
  });

  test('addDataSource updates existing source by ID', () => {
    const storage = makeStorage();
    createTenant('org_ds_002', storage);
    const sm = new OnboardingStateMachine('org_ds_002', storage);

    sm.addDataSource({ id: 'ds_bank_01', type: 'bank', name: 'My Bank', status: 'pending' });
    sm.addDataSource({ id: 'ds_bank_01', type: 'bank', name: 'My Bank', status: 'connected' });

    const tenant = loadTenant('org_ds_002', storage);
    assert.equal(tenant.dataSources.length, 1, 'Should upsert, not duplicate');
    assert.equal(tenant.dataSources[0].status, 'connected');
  });
});

describe('OnboardingStateMachine — Transition to READY', () => {
  test('full onboarding flow completes to READY', () => {
    const storage = makeStorage();
    createTenant('org_full_001', storage);
    const sm = new OnboardingStateMachine('org_full_001', storage);

    sm.saveProfile(VALID_PROFILE);
    let r;
    r = sm.advance(); assert.equal(r.success, true); // → RISK_PREFERENCES
    sm.saveRiskPreferences(VALID_RISK);
    r = sm.advance(); assert.equal(r.success, true); // → DATA_CONNECTIONS
    r = sm.advance(); assert.equal(r.success, true); // → DATA_VALIDATION
    r = sm.advance(); assert.equal(r.success, true); // → INITIAL_CALCULATION
    r = sm.advance(); assert.equal(r.success, true); // → READY

    const tenant = loadTenant('org_full_001', storage);
    assert.equal(tenant.onboardingState, OnboardingState.READY);
  });
});
