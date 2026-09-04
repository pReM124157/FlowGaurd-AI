/**
 * FlowGuard Tests — Provenance Model
 * 
 * Covers: metric creation, no-data guard, derived vs declared distinction.
 */
import { strict as assert } from 'assert';
import { test, describe } from 'node:test';

import {
  Provenance,
  createMetric,
  noDataMetric,
  pendingMetric,
  simulatedMetric,
  isReliableForDashboard,
  provenanceBadgeClass,
  provenanceLabel,
} from '../provenance.js';

describe('Provenance — createMetric', () => {
  test('creates a valid ACTUAL metric', () => {
    const m = createMetric(12345.67, Provenance.ACTUAL, { source: 'bank_api', asOf: '2024-01-01T00:00:00Z', reliable: true });
    assert.equal(m.value, 12345.67);
    assert.equal(m.provenance, Provenance.ACTUAL);
    assert.equal(m.source, 'bank_api');
    assert.equal(m.reliable, true);
  });

  test('auto-sets reliable=true when value is not null', () => {
    const m = createMetric(500, Provenance.FORECAST);
    assert.equal(m.reliable, true);
  });

  test('auto-sets reliable=false when value is null', () => {
    const m = createMetric(null, Provenance.PENDING);
    assert.equal(m.reliable, false);
  });

  test('rejects invalid provenance type', () => {
    assert.throws(() => createMetric(100, 'MADE_UP'), /invalid provenance/i);
  });

  test('metric is frozen (immutable)', () => {
    const m = createMetric(100, Provenance.ACTUAL, { source: 'bank' });
    assert.throws(() => { m.value = 999; }, TypeError);
  });
});

describe('Provenance — noDataMetric', () => {
  test('is always unreliable', () => {
    const m = noDataMetric();
    assert.equal(m.reliable, false);
    assert.equal(m.value, null);
    assert.equal(m.provenance, Provenance.PENDING);
  });

  test('carries reason as source', () => {
    const m = noDataMetric('No bank connected');
    assert.equal(m.source, 'No bank connected');
  });
});

describe('Provenance — pendingMetric', () => {
  test('is unreliable', () => {
    const m = pendingMetric('quickbooks_api');
    assert.equal(m.reliable, false);
    assert.equal(m.provenance, Provenance.PENDING);
    assert.equal(m.source, 'quickbooks_api');
  });
});

describe('Provenance — simulatedMetric', () => {
  test('is reliable with SIMULATED provenance', () => {
    const m = simulatedMetric(100000, 'demo_bank');
    assert.equal(m.reliable, true);
    assert.equal(m.provenance, Provenance.SIMULATED);
    assert.equal(m.value, 100000);
  });
});

describe('Provenance — isReliableForDashboard', () => {
  test('ACTUAL, FORECAST, PREDICTED are dashboard-reliable', () => {
    assert.equal(isReliableForDashboard(Provenance.ACTUAL),    true);
    assert.equal(isReliableForDashboard(Provenance.FORECAST),  true);
    assert.equal(isReliableForDashboard(Provenance.PREDICTED), true);
  });

  test('USER_DECLARED is NOT dashboard-reliable', () => {
    assert.equal(isReliableForDashboard(Provenance.USER_DECLARED), false);
  });

  test('PENDING is NOT dashboard-reliable', () => {
    assert.equal(isReliableForDashboard(Provenance.PENDING), false);
  });

  test('SIMULATED is NOT dashboard-reliable (demo only)', () => {
    assert.equal(isReliableForDashboard(Provenance.SIMULATED), false);
  });
});

describe('Provenance — Derived vs Declared distinction', () => {
  test('USER_DECLARED metric is never promoted to ACTUAL', () => {
    // A declared payroll amount stored as USER_DECLARED should never become ACTUAL
    const declared = createMetric(50000, Provenance.USER_DECLARED, { source: 'onboarding_form' });
    assert.equal(declared.provenance, Provenance.USER_DECLARED);
    assert.notEqual(declared.provenance, Provenance.ACTUAL);
    assert.equal(isReliableForDashboard(declared.provenance), false);
  });

  test('ACTUAL metric requires external source claim', () => {
    // An ACTUAL metric without source would be caught at storage time — test the metric type itself
    const actual = createMetric(75000, Provenance.ACTUAL, { source: 'plaid_api' });
    assert.equal(actual.provenance, Provenance.ACTUAL);
    assert.equal(actual.source, 'plaid_api');
    assert.equal(isReliableForDashboard(actual.provenance), true);
  });

  test('provenance badge classes are distinct', () => {
    const classes = Object.values(Provenance).map(p => provenanceBadgeClass(p));
    const unique  = new Set(classes);
    assert.equal(unique.size, classes.length, 'Each provenance type must have a distinct badge class');
  });

  test('provenance labels are human-readable strings', () => {
    for (const p of Object.values(Provenance)) {
      const label = provenanceLabel(p);
      assert.ok(typeof label === 'string' && label.length > 0, `${p} has no label`);
    }
  });
});
