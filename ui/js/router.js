/**
 * FlowGuard — Client-Side Route Guard
 *
 * Runs synchronously before dashboard HTML is painted. If the active
 * tenant is not in state READY, redirects to onboarding immediately.
 *
 * This enforces the requirement that no financial metrics are ever
 * rendered for an organization that has not completed onboarding.
 */

import { loadTenant, isReady, DEMO_TENANT_ID } from './tenant.js';

const CURRENT_TENANT_KEY = 'fg:currentTenantId';

/**
 * Retrieve the currently active tenant ID from session storage.
 * Returns null if no session exists.
 */
export function getCurrentTenantId(storage = sessionStorage) {
  return storage.getItem(CURRENT_TENANT_KEY);
}

/**
 * Set the active tenant for this browser session.
 */
export function setCurrentTenantId(tenantId, storage = sessionStorage) {
  storage.setItem(CURRENT_TENANT_KEY, tenantId);
}

/**
 * Clear the session (logout).
 */
export function clearSession(storage = sessionStorage) {
  storage.removeItem(CURRENT_TENANT_KEY);
}

/**
 * Dashboard route guard.
 *
 * Call this at the top of dashboard.html before rendering any content.
 * If the tenant is not READY, performs a redirect and returns false.
 * The caller must abort rendering if this returns false.
 *
 * @param {object} opts
 * @param {Storage} [opts.sessionStorage]
 * @param {Storage} [opts.localStorage]
 * @param {object} [opts.location]   - window.location (injectable for testing)
 * @returns {boolean} true if dashboard may render
 */
export function guardDashboard(opts = {}) {
  const session = opts.sessionStorage ?? window.sessionStorage;
  const local   = opts.localStorage   ?? window.localStorage;
  const loc     = opts.location       ?? window.location;

  const tenantId = getCurrentTenantId(session);

  // No session at all — go to landing
  if (!tenantId) {
    loc.replace('/?reason=no_session');
    return false;
  }

  // Demo tenant always has its own dashboard — never passes through this guard
  if (tenantId === DEMO_TENANT_ID) {
    loc.replace('/pages/demo.html');
    return false;
  }

  const tenant = loadTenant(tenantId, local);

  // Tenant record missing — start fresh
  if (!tenant) {
    loc.replace('/?reason=tenant_not_found');
    return false;
  }

  // Not READY — resume onboarding at last saved step
  if (!isReady(tenant)) {
    loc.replace(`/pages/onboarding.html?tenantId=${encodeURIComponent(tenantId)}&resume=true`);
    return false;
  }

  return true;
}

/**
 * Onboarding entry guard.
 *
 * Called from the landing page. Checks if there's a tenant in progress
 * and offers resume. Returns routing intent.
 *
 * @returns {{ action: 'resume'|'new'|'none', tenantId?: string }}
 */
export function checkResumeOpportunity(opts = {}) {
  const session = opts.sessionStorage ?? window.sessionStorage;
  const local   = opts.localStorage   ?? window.localStorage;

  const tenantId = getCurrentTenantId(session);
  if (!tenantId || tenantId === DEMO_TENANT_ID) return { action: 'none' };

  const tenant = loadTenant(tenantId, local);
  if (!tenant) return { action: 'none' };
  if (isReady(tenant)) return { action: 'none' };

  return { action: 'resume', tenantId };
}
