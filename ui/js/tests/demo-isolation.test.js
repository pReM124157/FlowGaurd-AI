/**
 * FlowGuard Tests — Demo Isolation
 * 
 * Covers: demo records never bleed into live namespaces,
 * SIMULATED provenance on all demo metrics, live org never inherits demo defaults.
 */
import { strict as assert } from 'assert';
import { test, describe, beforeEach } from 'node:test';

import {
  DEMO_TENANT_ID,
  createTenant,
  loadTenant,
  assertNoDemoContamination,
} from '../tenant.js';
import { Provenance, simulatedMetric } from '../provenance.js';
import { activateDemoMode, isDemoTenant, getDemoTenantSnapshot } from '../onboarding/demo-mode.js';

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

describe('Demo Isolation — Storage Namespacing', () => {
  test('demo tenant key is distinct from live tenant keys', () => {
    const storage = makeStorage();
    const session = makeStorage();

    const liveTenant = createTenant('org_demo_test_001', storage);
    activateDemoMode(storage, session);

    const liveKey = 'fg:tenant:org_demo_test_001';
    const demoKey = 'fg:tenant:DEMO';

    assert.notEqual(liveKey, demoKey);
    assert.ok(storage.getItem(liveKey) !== null, 'Live tenant key should exist');
    assert.ok(storage.getItem(demoKey) !== null, 'Demo tenant key should exist');
  });

  test('activating demo mode does not overwrite live tenant records', () => {
    const storage = makeStorage();
    const session = makeStorage();

    const live = createTenant('org_demo_test_002', storage);
    const originalUpdatedAt = live.updatedAt;

    activateDemoMode(storage, session);

    const reloaded = loadTenant('org_demo_test_002', storage);
    assert.ok(reloaded !== null, 'Live tenant should still exist after demo activation');
    assert.equal(reloaded.tenantId, 'org_demo_test_002');
  });

  test('demo tenant record has isDemo=true', () => {
    const storage = makeStorage();
    const session = makeStorage();
    activateDemoMode(storage, session);

    const demo = loadTenant(DEMO_TENANT_ID, storage);
    assert.equal(demo.isDemo, true);
  });
});

describe('Demo Isolation — Provenance', () => {
  test('all demo financials have SIMULATED provenance', () => {
    const storage = makeStorage();
    const session = makeStorage();
    activateDemoMode(storage, session);

    const demo = loadTenant(DEMO_TENANT_ID, storage);
    for (const [key, metric] of Object.entries(demo.financials)) {
      assert.equal(
        metric.provenance,
        Provenance.SIMULATED,
        `Demo financial metric "${key}" must be SIMULATED, got: ${metric.provenance}`
      );
    }
  });

  test('demo profile has SIMULATED provenance', () => {
    const storage = makeStorage();
    const session = makeStorage();
    activateDemoMode(storage, session);

    const demo = loadTenant(DEMO_TENANT_ID, storage);
    assert.equal(demo.profile.provenance, Provenance.SIMULATED);
  });

  test('demo risks carry SIMULATED provenance', () => {
    const storage = makeStorage();
    const session = makeStorage();
    activateDemoMode(storage, session);

    const demo = loadTenant(DEMO_TENANT_ID, storage);
    for (const risk of (demo.initialAssessment?.risks ?? [])) {
      assert.equal(risk.provenance, Provenance.SIMULATED, `Risk "${risk.title}" must be SIMULATED`);
    }
  });

  test('simulatedMetric is always SIMULATED provenance', () => {
    const m = simulatedMetric(12345);
    assert.equal(m.provenance, Provenance.SIMULATED);
    assert.equal(m.reliable, true);
  });
});

describe('Demo Isolation — Live Org Never Inherits Demo', () => {
  test('live org profile is empty (not copied from demo)', () => {
    const storage = makeStorage();
    const session = makeStorage();

    activateDemoMode(storage, session);
    const liveTenant = createTenant('org_no_demo_001', storage);

    // Live tenant must NOT have demo org name
    assert.notEqual(liveTenant.profile.organizationName, 'Acme Corp (Demo)');
    assert.equal(liveTenant.profile.organizationName, '');
  });

  test('live org financials are noData (not demo values)', () => {
    const storage = makeStorage();
    const session = makeStorage();

    activateDemoMode(storage, session);
    const liveTenant = createTenant('org_no_demo_002', storage);

    for (const [key, metric] of Object.entries(liveTenant.financials)) {
      assert.equal(metric.value, null, `Live org metric "${key}" must start as null, not from demo`);
      assert.equal(metric.provenance, Provenance.PENDING, `Live org metric "${key}" must be PENDING`);
    }
  });

  test('live org data sources are empty (not demo sources)', () => {
    const storage = makeStorage();
    const session = makeStorage();

    activateDemoMode(storage, session);
    const liveTenant = createTenant('org_no_demo_003', storage);

    assert.equal(liveTenant.dataSources.length, 0, 'Live org must not inherit demo data sources');
  });
});

describe('Demo Isolation — assertNoDemoContamination', () => {
  test('throws if any attempt to copy DEMO data to a live tenant', () => {
    assert.throws(
      () => assertNoDemoContamination(DEMO_TENANT_ID, 'org_live'),
      /SECURITY/
    );
  });

  test('passes for live-to-live transfers', () => {
    assert.doesNotThrow(() => assertNoDemoContamination('org_a', 'org_b'));
  });
});

describe('Demo Isolation — isDemoTenant helper', () => {
  test('DEMO tenantId is correctly identified', () => {
    assert.equal(isDemoTenant(DEMO_TENANT_ID), true);
    assert.equal(isDemoTenant('org_live_001'), false);
    assert.equal(isDemoTenant(''), false);
    assert.equal(isDemoTenant(null), false);
  });
});
