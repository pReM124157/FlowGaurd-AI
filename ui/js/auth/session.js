/**
 * FlowGuard Auth Session
 * Mock authentication backed by localStorage.
 * Drop-in replaceable with real backend calls.
 */

const USERS_KEY    = 'fg:auth:users';
const SESSION_KEY  = 'fg:auth:session';

function getUsers()      { try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); } catch { return {}; } }
function saveUsers(u)    { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }
function getSession()    { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function saveSession(s)  { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession()  { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem('fg:currentTenantId'); }

function hashish(str) {
  // Tiny deterministic hash — NOT for real security
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

export function signup({ name, email, password }) {
  const users = getUsers();
  const key   = email.toLowerCase().trim();
  if (users[key]) return { ok: false, error: 'An account with this email already exists.' };

  const tenantId = 'org_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  users[key] = {
    name,
    email: key,
    passwordHash: hashish(password),
    tenantId,
    createdAt: new Date().toISOString(),
    onboardingComplete: false,
  };
  saveUsers(users);

  const session = { userId: key, tenantId, name, email: key };
  saveSession(session);
  localStorage.setItem('fg:currentTenantId', tenantId);

  return { ok: true, session, tenantId };
}

export function login({ email, password }) {
  const users = getUsers();
  const key   = email.toLowerCase().trim();
  const user  = users[key];

  if (!user) return { ok: false, error: 'No account found with that email.' };
  if (user.passwordHash !== hashish(password)) return { ok: false, error: 'Incorrect password.' };

  const session = { userId: key, tenantId: user.tenantId, name: user.name, email: key };
  saveSession(session);
  localStorage.setItem('fg:currentTenantId', user.tenantId);

  return { ok: true, session, tenantId: user.tenantId };
}

export async function logout() {
  try {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // The local browser session is still cleared even if the network is unavailable.
  }
  clearSession();
  window.location.replace('/');
}

export function getActiveSession() { return getSession(); }

export function isAuthenticated() { return getSession() !== null; }

export function requireAuth(redirectUrl = '/pages/login.html') {
  if (!isAuthenticated()) {
    const current = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`${redirectUrl}?next=${current}`);
    return null;
  }
  return getSession();
}

export function markOnboardingComplete(tenantId) {
  const users = getUsers();
  for (const key of Object.keys(users)) {
    if (users[key].tenantId === tenantId) {
      users[key].onboardingComplete = true;
      saveUsers(users);
      break;
    }
  }
}

export function isOnboardingComplete(tenantId) {
  const users = getUsers();
  for (const u of Object.values(users)) {
    if (u.tenantId === tenantId) return u.onboardingComplete;
  }
  return false;
}

/**
 * Resolves the authoritative server session. OAuth uses only the HttpOnly
 * fg_session cookie; no credential or session identifier is exposed to JS.
 */
export async function getServerSession() {
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const payload = await response.json();
    return {
      userId: payload.user.userId,
      tenantId: payload.user.organizationId,
      name: payload.user.email.split('@')[0],
      email: payload.user.email,
      onboardingComplete: payload.onboarding?.stage === 'READY',
      serverManaged: true,
    };
  } catch {
    return null;
  }
}
