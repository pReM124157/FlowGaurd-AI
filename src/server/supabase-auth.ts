import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

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
export function supabaseServiceConfigured(): boolean { return Boolean(baseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.RAZORPAY_TOKEN_ENCRYPTION_KEY); }

type RazorpayConnectionRow = Readonly<{
  organization_id: string;
  razorpay_account_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  access_token_expires_at: string;
  refresh_token_expires_at?: string | null;
  connected_at: string;
  last_synced_at?: string | null;
  revoked_at?: string | null;
}>;

export async function saveRazorpayOAuthConnection(input: { organizationId: string; accountId: string; accessToken: string; refreshToken: string; accessTokenExpiresAt: string; refreshTokenExpiresAt?: string; userId: string }): Promise<void> {
  const response = await serviceDataFetch("/rest/v1/razorpay_connections?on_conflict=organization_id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      organization_id: input.organizationId,
      razorpay_account_id: input.accountId,
      access_token_ciphertext: encryptRazorpayToken(input.accessToken),
      refresh_token_ciphertext: encryptRazorpayToken(input.refreshToken),
      access_token_expires_at: input.accessTokenExpiresAt,
      refresh_token_expires_at: input.refreshTokenExpiresAt ?? null,
      consent_version: "2026-09-05",
      consented_at: new Date().toISOString(),
      connected_by: input.userId,
      connected_at: new Date().toISOString(),
      revoked_at: null,
    }),
  });
  if (!response.ok) throw Object.assign(new Error("Unable to save Razorpay connection"), { statusCode: 503, code: "FG_RAZORPAY_CONNECTION_PERSISTENCE_FAILED" });
}

export async function getRazorpayOAuthConnection(organizationId: string): Promise<{ accountId: string; accessToken: string; lastSyncedAt?: string } | undefined> {
  const response = await serviceDataFetch(`/rest/v1/razorpay_connections?organization_id=eq.${encodeURIComponent(organizationId)}&revoked_at=is.null&select=razorpay_account_id,access_token_ciphertext,last_synced_at`, { method: "GET" });
  if (!response.ok) throw Object.assign(new Error("Unable to load Razorpay connection"), { statusCode: 503, code: "FG_RAZORPAY_CONNECTION_UNAVAILABLE" });
  const rows = await response.json() as Array<Pick<RazorpayConnectionRow, "razorpay_account_id" | "access_token_ciphertext" | "last_synced_at">>;
  const row = rows[0];
  return row ? { accountId: row.razorpay_account_id, accessToken: decryptRazorpayToken(row.access_token_ciphertext), lastSyncedAt: row.last_synced_at ?? undefined } : undefined;
}

export async function getRazorpayOAuthStatus(organizationId: string): Promise<{ connected: boolean; accountId?: string; connectedAt?: string; lastSyncedAt?: string }> {
  if (!supabaseServiceConfigured()) return { connected: false };
  const response = await serviceDataFetch(`/rest/v1/razorpay_connections?organization_id=eq.${encodeURIComponent(organizationId)}&revoked_at=is.null&select=razorpay_account_id,connected_at,last_synced_at`, { method: "GET" });
  if (!response.ok) return { connected: false };
  const rows = await response.json() as Array<Pick<RazorpayConnectionRow, "razorpay_account_id" | "connected_at" | "last_synced_at">>;
  const row = rows[0];
  return row ? { connected: true, accountId: row.razorpay_account_id, connectedAt: row.connected_at, lastSyncedAt: row.last_synced_at ?? undefined } : { connected: false };
}

export async function markRazorpayOAuthSynced(organizationId: string): Promise<void> {
  const response = await serviceDataFetch(`/rest/v1/razorpay_connections?organization_id=eq.${encodeURIComponent(organizationId)}`, { method: "PATCH", body: JSON.stringify({ last_synced_at: new Date().toISOString() }) });
  if (!response.ok) throw Object.assign(new Error("Unable to record Razorpay sync"), { statusCode: 503, code: "FG_RAZORPAY_CONNECTION_PERSISTENCE_FAILED" });
}

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
async function serviceDataFetch(path: string, init: RequestInit): Promise<Response> {
  const url = baseUrl(); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.RAZORPAY_TOKEN_ENCRYPTION_KEY) throw Object.assign(new Error("Razorpay OAuth storage is not configured"), { statusCode: 503, code: "FG_RAZORPAY_OAUTH_UNAVAILABLE" });
  return fetch(`${url}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) } });
}
function tokenEncryptionKey(): Buffer {
  const value = process.env.RAZORPAY_TOKEN_ENCRYPTION_KEY;
  if (!value) throw Object.assign(new Error("Razorpay token encryption is not configured"), { statusCode: 503, code: "FG_RAZORPAY_OAUTH_UNAVAILABLE" });
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw Object.assign(new Error("Razorpay token encryption key is invalid"), { statusCode: 503, code: "FG_RAZORPAY_OAUTH_UNAVAILABLE" });
  return key;
}
function encryptRazorpayToken(token: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
function decryptRazorpayToken(value: string): string {
  const [ivText, tagText, ciphertextText] = value.split(".");
  if (!ivText || !tagText || !ciphertextText) throw Object.assign(new Error("Stored Razorpay token is invalid"), { statusCode: 503, code: "FG_RAZORPAY_CONNECTION_UNAVAILABLE" });
  const decipher = createDecipheriv("aes-256-gcm", tokenEncryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
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
