/**
 * FlowGuard Tests — Auth & Session Module
 * 
 * Covers: signup, login, password checks, tenant isolation at signup, session persistence.
 */
import { strict as assert } from 'assert';
import { test, describe, beforeEach } from 'node:test';

// Mock localStorage and sessionStorage
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

// Inline pure logic test for auth logic to ensure deterministic headless verification
describe('Auth & Session System', () => {
  let localStore, sessionStore;

  beforeEach(() => {
    localStore = makeStorage();
    sessionStore = makeStorage();
    globalThis.localStorage = localStore;
    globalThis.sessionStorage = sessionStore;
  });

  test('signup creates isolated tenant and user record', async () => {
    const { signup, getActiveSession } = await import('../auth/session.js');
    const res = signup({ name: 'Prem Ganatra', email: 'prem@example.com', password: 'password123' });
    
    assert.equal(res.ok, true);
    assert.ok(res.tenantId.startsWith('org_'));
    assert.equal(res.session.email, 'prem@example.com');
    assert.equal(res.session.name, 'Prem Ganatra');

    const session = getActiveSession();
    assert.equal(session.tenantId, res.tenantId);
  });

  test('signup rejects duplicate email', async () => {
    const { signup } = await import('../auth/session.js');
    signup({ name: 'User 1', email: 'dup@example.com', password: 'password123' });
    const res2 = signup({ name: 'User 2', email: 'dup@example.com', password: 'password456' });

    assert.equal(res2.ok, false);
    assert.ok(res2.error.includes('already exists'));
  });

  test('login authenticates with valid credentials', async () => {
    const { signup, login } = await import('../auth/session.js');
    signup({ name: 'User', email: 'login@example.com', password: 'validPassword' });

    const res = login({ email: 'login@example.com', password: 'validPassword' });
    assert.equal(res.ok, true);
    assert.equal(res.session.email, 'login@example.com');
  });

  test('login rejects invalid password', async () => {
    const { signup, login } = await import('../auth/session.js');
    signup({ name: 'User', email: 'badpass@example.com', password: 'correctPassword' });

    const res = login({ email: 'badpass@example.com', password: 'wrongPassword' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'Incorrect password.');
  });

  test('login rejects unknown email', async () => {
    const { login } = await import('../auth/session.js');
    const res = login({ email: 'unknown@example.com', password: 'somePassword' });
    assert.equal(res.ok, false);
    assert.ok(res.error.includes('No account found'));
  });

  test('markOnboardingComplete flags tenant correctly', async () => {
    const { signup, markOnboardingComplete, isOnboardingComplete } = await import('../auth/session.js');
    const { tenantId } = signup({ name: 'Prem', email: 'complete@example.com', password: 'password123' });

    assert.equal(isOnboardingComplete(tenantId), false);
    markOnboardingComplete(tenantId);
    assert.equal(isOnboardingComplete(tenantId), true);
  });
});
