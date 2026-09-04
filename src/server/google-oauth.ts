import { randomBytes, randomUUID } from "node:crypto";
import { ensureOrganization } from "./live-store.ts";

type PendingState = { expiresAt: number; returnTo: string };
type GoogleIdentity = { sub: string; email: string; emailVerified: boolean; name?: string };
type OAuthUser = { userId: string; email: string; organizationId: string; name: string; onboardingComplete: boolean; googleSub?: string };
type Session = { userId: string; expiresAt: number };

const pendingStates = new Map<string, PendingState>();
const usersByEmail = new Map<string, OAuthUser>();
const usersByGoogleSub = new Map<string, OAuthUser>();
const sessions = new Map<string, Session>();
const STATE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 8 * 60 * 60_000;

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

export function createGoogleAuthorization(returnTo = "/pages/onboarding.html"): { url: string; state: string } {
  if (!googleConfigured()) throw oauthError(503, "FG_OAUTH_UNAVAILABLE");
  const state = randomBytes(32).toString("base64url");
  pendingStates.set(state, { expiresAt: Date.now() + STATE_TTL_MS, returnTo: safeReturnTo(returnTo) });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", requiredEnv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", requiredEnv("GOOGLE_REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return { url: url.toString(), state };
}

export async function finishGoogleAuthorization(code: string, state: string, browserState: string | undefined): Promise<{ sessionId: string; user: OAuthUser; isNew: boolean; returnTo: string }> {
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending || pending.expiresAt < Date.now() || !browserState || browserState !== state) throw oauthError(400, "FG_OAUTH_INVALID_STATE");
  if (!code || code.length > 4096) throw oauthError(400, "FG_OAUTH_INVALID_CODE");
  const identity = await exchangeAndVerify(code);
  if (!identity.emailVerified || !identity.email) throw oauthError(400, "FG_OAUTH_EMAIL_REQUIRED");
  const email = identity.email.toLowerCase().trim();
  let user = usersByEmail.get(email) ?? usersByGoogleSub.get(identity.sub);
  const isNew = !user;
  if (!user) {
    user = { userId: `user_${randomUUID().replaceAll("-", "")}`, email, organizationId: `org_${randomUUID().replaceAll("-", "").slice(0, 16)}`, name: identity.name?.trim() || email.split("@")[0], onboardingComplete: false, googleSub: identity.sub };
    ensureOrganization(user.organizationId, user.name);
  } else if (user.googleSub && user.googleSub !== identity.sub) {
    throw oauthError(409, "FG_OAUTH_ACCOUNT_CONFLICT");
  } else {
    user.googleSub = identity.sub;
  }
  usersByEmail.set(email, user); usersByGoogleSub.set(identity.sub, user);
  const sessionId = randomBytes(32).toString("base64url");
  sessions.set(sessionId, { userId: user.userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return { sessionId, user, isNew, returnTo: pending.returnTo };
}

export function resolveOAuthSession(sessionId: string | undefined): OAuthUser | undefined {
  if (!sessionId) return undefined;
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) { sessions.delete(sessionId); return undefined; }
  return [...usersByEmail.values()].find((user) => user.userId === session.userId);
}

export function invalidateOAuthSession(sessionId: string | undefined): void { if (sessionId) sessions.delete(sessionId); }
export function markOAuthOnboardingComplete(userId: string): void {
  for (const user of usersByEmail.values()) {
    if (user.userId === userId) user.onboardingComplete = true;
  }
}
export function sessionCookie(sessionId: string, secure = process.env.NODE_ENV === "production"): string { return `fg_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`; }
export function clearSessionCookie(secure = process.env.NODE_ENV === "production"): string { return `fg_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`; }
export function oauthStateCookie(state: string, secure = process.env.NODE_ENV === "production"): string { return `fg_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=${STATE_TTL_MS / 1000}${secure ? "; Secure" : ""}`; }
export function clearOAuthStateCookie(secure = process.env.NODE_ENV === "production"): string { return `fg_oauth_state=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0${secure ? "; Secure" : ""}`; }

async function exchangeAndVerify(code: string): Promise<GoogleIdentity> {
  const body = new URLSearchParams({ code, client_id: requiredEnv("GOOGLE_CLIENT_ID"), client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"), redirect_uri: requiredEnv("GOOGLE_REDIRECT_URI"), grant_type: "authorization_code" });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!tokenResponse.ok) throw oauthError(401, "FG_OAUTH_EXCHANGE_FAILED");
  const token = await tokenResponse.json() as { id_token?: string };
  if (!token.id_token) throw oauthError(401, "FG_OAUTH_EXCHANGE_FAILED");
  const infoResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token.id_token)}`);
  if (!infoResponse.ok) throw oauthError(401, "FG_OAUTH_IDENTITY_FAILED");
  const profile = await infoResponse.json() as { sub?: string; email?: string; email_verified?: string | boolean; name?: string; aud?: string; iss?: string };
  if (profile.aud !== requiredEnv("GOOGLE_CLIENT_ID") || !["accounts.google.com", "https://accounts.google.com"].includes(profile.iss ?? "")) {
    throw oauthError(401, "FG_OAUTH_IDENTITY_FAILED");
  }
  if (!profile.sub || !profile.email) throw oauthError(400, "FG_OAUTH_EMAIL_REQUIRED");
  return { sub: profile.sub, email: profile.email, emailVerified: profile.email_verified === true || profile.email_verified === "true", name: profile.name };
}

function requiredEnv(name: string): string { const value = process.env[name]; if (!value) throw oauthError(503, "FG_OAUTH_UNAVAILABLE"); return value; }
function safeReturnTo(value: string): string { return value.startsWith("/") && !value.startsWith("//") ? value : "/pages/onboarding.html"; }
function oauthError(statusCode: number, code: string) { return Object.assign(new Error(code), { statusCode, code }); }
export function resetGoogleOAuthForTests() { pendingStates.clear(); usersByEmail.clear(); usersByGoogleSub.clear(); sessions.clear(); }
