/**
 * FlowGuard Tests — Dashboard Route Guard
 * 
 * Covers: redirect for non-READY, pass-through for READY, demo redirect, no-session.
 */
import { strict as assert } from 'assert';
import { test, describe, beforeEach } from 'node:test';

import {
  OnboardingState,
  createTenant,
  advanceOnboarding,
  DEMO_TENANT_ID,
} from '../tenant.js';

import { guardDashboard, getCurrentTenantId, setCurrentTenantId, clearSession } from '../router.js';

// ── Mocks ───────────────────────────────────────────────────────────────────
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

function makeLocation() {
  let replaced = null;
  return {
    replaced: () => replaced,
    replace: (url) => { replaced = url; },
  };
}

describe('Route Guard — No Session', () => {
  test('redirects to landing when no session exists', () => {
    const session  = makeStorage();
    const local    = makeStorage();
    const location = makeLocation();

    const result = guardDashboard({ sessionStorage: session, localStorage: local, location });
    assert.equal(result, false);
    assert.ok(location.replaced()?.includes('reason=no_session'), 'should redirect with no_session reason');
  });
});

describe('Route Guard — Non-READY Tenant', () => {
  test('redirects to onboarding when tenant is at BUSINESS_PROFILE', () => {
    const session  = makeStorage();
    const local    = makeStorage();
    const location = makeLocation();

    const tenant = createTenant('org_guard_001', local);
    setCurrentTenantId('org_guard_001', session);

    const result = guardDashboard({ sessionStorage: session, localStorage: local, location });
    assert.equal(result, false);
    assert.ok(location.replaced()?.includes('/pages/onboarding.html'), 'should redirect to onboarding');
    assert.ok(location.replaced()?.includes('org_guard_001'), 'should include tenantId in redirect');
  });

  test('redirects to onboarding at every non-READY state', () => {
    const states = [
      OnboardingState.BUSINESS_PROFILE,
      OnboardingState.RISK_PREFERENCES,
      OnboardingState.DATA_CONNECTIONS,
      OnboardingState.DATA_VALIDATION,
      OnboardingState.INITIAL_CALCULATION,
    ];

    for (const _state of states) {
      const session  = makeStorage();
      const local    = makeStorage();
      const location = makeLocation();
      
      let tenant = createTenant('org_guard_002', local);
      // Advance to target state
      const targetIdx = states.indexOf(_state);
      for (let i = 0; i < targetIdx; i++) tenant = advanceOnboarding(tenant, local);
      
      setCurrentTenantId('org_guard_002', session);
      const result = guardDashboard({ sessionStorage: session, localStorage: local, location });
      assert.equal(result, false, `Should block at ${_state}`);
    }
  });
});

describe('Route Guard — READY Tenant', () => {
  test('allows dashboard rendering when tenant is READY', () => {
    const session  = makeStorage();
    const local    = makeStorage();
    const location = makeLocation();

    let tenant = createTenant('org_ready_001', local);
    for (let i = 0; i < 5; i++) tenant = advanceOnboarding(tenant, local);
    setCurrentTenantId('org_ready_001', session);

    const result = guardDashboard({ sessionStorage: session, localStorage: local, location });
    assert.equal(result, true);
    assert.equal(location.replaced(), null, 'Should not redirect a READY tenant');
  });
});

describe('Route Guard — Demo Tenant', () => {
  test('demo tenant is redirected to demo.html, not the main dashboard', () => {
    const session  = makeStorage();
    const local    = makeStorage();
    const location = makeLocation();

    setCurrentTenantId(DEMO_TENANT_ID, session);

    const result = guardDashboard({ sessionStorage: session, localStorage: local, location });
    assert.equal(result, false);
    assert.ok(location.replaced()?.includes('demo.html'), 'Demo should go to demo.html');
  });
});

describe('Route Guard — Missing Tenant Record', () => {
  test('redirects to landing if tenant ID is in session but record is missing', () => {
    const session  = makeStorage();
    const local    = makeStorage();
    const location = makeLocation();

    // Set session ID without creating a tenant record
    setCurrentTenantId('org_missing_001', session);

    const result = guardDashboard({ sessionStorage: session, localStorage: local, location });
    assert.equal(result, false);
    assert.ok(location.replaced()?.includes('tenant_not_found'), 'should cite tenant_not_found');
  });
});

describe('Route Guard — Session Management', () => {
  test('setCurrentTenantId / getCurrentTenantId round-trip', () => {
    const session = makeStorage();
    setCurrentTenantId('org_session_001', session);
    assert.equal(getCurrentTenantId(session), 'org_session_001');
  });

  test('clearSession removes tenantId', () => {
    const session = makeStorage();
    setCurrentTenantId('org_session_002', session);
    clearSession(session);
    assert.equal(getCurrentTenantId(session), null);
  });
});
