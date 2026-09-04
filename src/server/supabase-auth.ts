import { createHash, randomBytes, randomUUID } from "node:crypto";

type SupabaseUser = { id: string; email?: string; user_metadata?: Record<string, unknown> };
type AuthSession = { access_token: string; user: SupabaseUser };
export type PersistedOnboarding = {
  stage?: unknown;
  profile?: unknown;
  risk_preferences?: unknown;
  data_connections?: unknown;
  updated_at?: unknown;
};

const baseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const publishableKey = () => process.env.FLOWGUARD_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

export function supabaseAuthConfigured(): boolean { return Boolean(baseUrl() && publishableKey()); }

export async function signUpWithSupabase(input: { name: string; email: string; password: string }): Promise<{ session?: AuthSession; confirmationRequired: boolean }> {
  const organizationId = `org_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const response = await authFetch("/auth/v1/signup", { method: "POST", body: JSON.stringify({ email: input.email, password: input.password, data: { name: input.name, organization_id: organizationId, role: "OWNER" } }) });
  const payload = await readAuthResponse(response);
  return { session: payload.session ? normalizeSession(payload.session) : undefined, confirmationRequired: !payload.session };
}

export async function signInWithSupabase(input: { email: string; password: string }): Promise<AuthSession> {
  const response = await authFetch("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify(input) });
  return normalizeSession(await readAuthResponse(response));
}

export function createSupabaseGoogleAuthorization(redirectTo: string): { url: string; verifier: string } {
  const url = baseUrl();
  if (!url || !publishableKey()) throw Object.assign(new Error("Supabase authentication is not configured"), { statusCode: 503, code: "FG_AUTH_UNAVAILABLE" });
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorization = new URL(`${url}/auth/v1/authorize`);
  authorization.searchParams.set("provider", "google");
  authorization.searchParams.set("redirect_to", redirectTo);
  authorization.searchParams.set("flow_type", "pkce");
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "s256");
  return { url: authorization.toString(), verifier };
}

export async function exchangeSupabaseGoogleCode(code: string, verifier: string): Promise<AuthSession> {
  const response = await authFetch("/auth/v1/token?grant_type=pkce", {
    method: "POST",
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  return normalizeSession(await readAuthResponse(response));
}

/** Idempotently repairs/provisions the current authenticated user's tenant. */
export async function provisionSupabaseTenant(accessToken: string): Promise<void> {
  const response = await dataFetch("/rest/v1/rpc/provision_current_flowguard_tenant", accessToken, { method: "POST", body: "{}" });
  if (!response.ok) throw Object.assign(new Error("Unable to provision FlowGuard organization"), { statusCode: 503, code: "FG_TENANT_PROVISIONING_FAILED" });
}

export async function getSupabaseOnboardingStage(accessToken: string, organizationId: string): Promise<string | undefined> {
  const progress = await getSupabaseOnboardingProgress(accessToken, organizationId);
  return typeof progress?.stage === "string" ? progress.stage : undefined;
}

export async function getSupabaseOnboardingProgress(accessToken: string, organizationId: string): Promise<PersistedOnboarding | undefined> {
  if (!supabaseAuthConfigured()) return undefined;
  const response = await dataFetch(`/rest/v1/onboarding_progress?organization_id=eq.${encodeURIComponent(organizationId)}&select=stage,profile,risk_preferences,data_connections,updated_at`, accessToken);
  if (!response.ok) return undefined;
  const rows = await response.json() as PersistedOnboarding[];
  return rows[0];
}

export async function saveSupabaseOnboardingProgress(accessToken: string, organizationId: string, record: { stage: string; businessProfile?: unknown; riskPreferences?: unknown; dataConnections?: unknown; updatedAt: string }): Promise<void> {
  const response = await dataFetch(`/rest/v1/onboarding_progress?organization_id=eq.${encodeURIComponent(organizationId)}`, accessToken, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      stage: record.stage,
      profile: record.businessProfile ?? {},
      risk_preferences: record.riskPreferences ?? {},
      data_connections: record.dataConnections ?? {},
      updated_at: record.updatedAt,
    }),
  });
  const saved = response.ok ? await response.json().catch(() => []) as unknown[] : [];
  if (!response.ok || saved.length !== 1) throw Object.assign(new Error("Unable to persist onboarding progress"), { statusCode: 503, code: "FG_ONBOARDING_PERSISTENCE_FAILED" });
}

export async function resolveSupabaseSession(accessToken: string | undefined): Promise<{ userId: string; email: string; organizationId: string; role: "OWNER" } | undefined> {
  if (!accessToken || !supabaseAuthConfigured()) return undefined;
  const response = await authFetch("/auth/v1/user", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return undefined;
  const user = await response.json() as SupabaseUser;
  if (!user.email) return undefined;
  const metadata = user.user_metadata ?? {};
  const organizationId = typeof metadata.organization_id === "string" ? metadata.organization_id : `org_${user.id.replaceAll("-", "").slice(0, 16)}`;
  return { userId: user.id, email: user.email.toLowerCase(), organizationId, role: "OWNER" };
}

export function supabaseSessionCookie(accessToken: string): string { return `fg_supabase_session=${accessToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${process.env.NODE_ENV === "production" ? "; Secure" : ""}`; }
export function clearSupabaseSessionCookie(): string { return `fg_supabase_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`; }

async function authFetch(path: string, init: RequestInit): Promise<Response> {
  const url = baseUrl(); const key = publishableKey();
  if (!url || !key) throw Object.assign(new Error("Supabase authentication is not configured"), { statusCode: 503, code: "FG_AUTH_UNAVAILABLE" });
  return fetch(`${url}${path}`, { ...init, headers: { apikey: key, "content-type": "application/json", ...(init.headers ?? {}) } });
}
async function dataFetch(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const url = baseUrl(); const key = publishableKey();
  if (!url || !key) throw Object.assign(new Error("Supabase authentication is not configured"), { statusCode: 503, code: "FG_AUTH_UNAVAILABLE" });
  return fetch(`${url}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...(init.headers ?? {}) } });
}
async function readAuthResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const providerCode = typeof payload.error_code === "string" ? payload.error_code : "";
    if (response.status === 429 || providerCode === "over_email_send_rate_limit") {
      throw Object.assign(new Error("Supabase email confirmation rate limit reached"), { statusCode: 429, code: "FG_AUTH_RATE_LIMIT" });
    }
    if (providerCode === "email_not_confirmed") {
      throw Object.assign(new Error("Email confirmation is required"), { statusCode: 403, code: "FG_EMAIL_NOT_CONFIRMED" });
    }
    if (providerCode === "user_already_exists" || providerCode === "email_exists") {
      throw Object.assign(new Error("An account already exists for this email"), { statusCode: 409, code: "FG_EMAIL_ALREADY_REGISTERED" });
    }
    if (providerCode === "invalid_credentials") {
      throw Object.assign(new Error("Invalid email or password"), { statusCode: 401, code: "FG_INVALID_CREDENTIALS" });
    }
    throw Object.assign(new Error("Supabase authentication failed"), { statusCode: response.status === 400 ? 400 : 401, code: "FG_AUTH_FAILED" });
  }
  return payload;
}
function normalizeSession(value: unknown): AuthSession {
  if (!value || typeof value !== "object") throw Object.assign(new Error("Invalid authentication response"), { statusCode: 401, code: "FG_AUTH_FAILED" });
  const session = value as { access_token?: unknown; user?: unknown };
  if (typeof session.access_token !== "string" || !session.user || typeof session.user !== "object") throw Object.assign(new Error("Invalid authentication response"), { statusCode: 401, code: "FG_AUTH_FAILED" });
  return { access_token: session.access_token, user: session.user as SupabaseUser };
}
