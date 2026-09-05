import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { answerFinanceQuestion, type FinancialEvidenceContext } from "../agent/controller.ts";
import { explainWithLlm } from "../agent/llm-router.ts";
import { authenticate, demoLoginCookie, liveFirstRunCookie, requirePermission, type Permission, type Role } from "./auth.ts";
import { listAuditEvents, recordAudit } from "./audit.ts";
import { acknowledgeAlert, applyBusinessProfile, applyDataConnections, applyRiskPreferences, ensureOrganization, getOrganizationRuntime, ingestBankCsv, ingestCanonicalEvents, ingestInvoiceCsv, ingestRazorpayMockPayment, requestConnectionSetup, traceOrganizationPayment, type OrganizationRuntime } from "./live-store.ts";
import { logJson } from "./logger.ts";
import { metricsSnapshot, metricsText, recordMetric } from "./metrics.ts";
import { buildOnboardingSummary, finalizeInitialCalculation, getOnboardingRecord, isDashboardReady, restoreOnboardingRecord, runReadinessAudit, saveBusinessProfile, saveDataConnections, saveRiskPreferences, updateBusinessProfile, type OnboardingRecord } from "./onboarding.ts";
import { checkRateLimit } from "./rate-limit.ts";
import { clearOAuthStateCookie, clearSessionCookie, createGoogleAuthorization, finishGoogleAuthorization, invalidateOAuthSession, markOAuthOnboardingComplete, oauthStateCookie, sessionCookie } from "./google-oauth.ts";
import { clearSupabaseSessionCookie, createSupabaseGoogleAuthorization, exchangeSupabaseGoogleCode, getRazorpayOAuthConnection, getRazorpayOAuthStatus, getSupabaseOnboardingProgress, getSupabaseOnboardingStage, markRazorpayOAuthSynced, provisionSupabaseTenant, saveRazorpayOAuthConnection, saveSupabaseOnboardingProgress, signInWithSupabase, signUpWithSupabase, supabaseAuthConfigured, supabaseServiceConfigured, supabaseSessionCookie } from "./supabase-auth.ts";
import { buildDeclaredBaseline } from "./declared-baseline.ts";
import { createOAuthState, createRazorpayAuthorizationUrl, createRazorpayTestOrder, exchangeRazorpayAuthorizationCode, fetchRazorpayOAuthPayments, fetchRazorpayPayments, paymentsToCanonicalEvents, razorpayConfig, razorpayDirectConfig, verifyRazorpayWebhook, webhookOrganizationId, webhookToCanonicalEvents, type RazorpayWebhook } from "./razorpay-live.ts";

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; img-src 'self' data:; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

const restoredSupabaseTenants = new Set<string>();
const processedRazorpayWebhookIds = new Set<string>();
const MAX_WEBHOOK_DEDUPLICATION_IDS = 10_000;

async function restoreSupabaseTenantState(accessToken: string | undefined, organizationId: string): Promise<void> {
  if (!accessToken) return;
  const persisted = await getSupabaseOnboardingProgress(accessToken, organizationId);
  const record = restoreOnboardingRecord(organizationId, persisted);
  if (restoredSupabaseTenants.has(organizationId)) return;
  if (record.businessProfile) applyBusinessProfile(organizationId, record.businessProfile.value);
  if (record.riskPreferences) applyRiskPreferences(organizationId, record.riskPreferences.value);
  if (record.dataConnections) applyDataConnections(organizationId, record.dataConnections.value);
  restoredSupabaseTenants.add(organizationId);
}

export async function handleRequest(request: Request): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  const correlationId = request.headers.get("x-correlation-id") ?? `FG-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
  let failed = false;

  try {
    const response = url.pathname === "/webhooks/razorpay"
      ? await handleRazorpayWebhook(request, correlationId)
      : url.pathname.startsWith("/api/") || url.pathname === "/health" || url.pathname === "/readiness" || url.pathname === "/metrics"
      ? await handleApi(request, url, correlationId)
      : url.pathname.startsWith("/auth/") || (url.pathname === "/" && url.searchParams.has("code")) ? await handleAuth(request, url)
      : await handleStatic(request, url);
    return withHeaders(response, correlationId);
  } catch (error) {
    failed = true;
    return withHeaders(safeError(error, correlationId), correlationId);
  } finally {
    const durationMs = Date.now() - started;
    recordMetric("http_request", durationMs, failed);
    logJson({
      timestamp: new Date().toISOString(),
      level: failed ? "error" : "info",
      service: "flowguard-phase9",
      event: "request",
      correlationId,
      path: url.pathname,
      durationMs,
      status: failed ? "failed" : "ok",
    });
  }
}

/** Receives only signed Razorpay events. It intentionally does not use browser auth. */
async function handleRazorpayWebhook(request: Request, correlationId: string): Promise<Response> {
  if (request.method !== "POST") throw Object.assign(new Error("Method not allowed"), { statusCode: 404, code: "FG_NOT_FOUND" });
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw Object.assign(new Error("Webhook unavailable"), { statusCode: 503, code: "FG_RAZORPAY_UNAVAILABLE" });

  const rawBody = await request.text();
  if (!verifyRazorpayWebhook(rawBody, request.headers.get("x-razorpay-signature"), secret)) {
    throw Object.assign(new Error("Invalid webhook signature"), { statusCode: 401, code: "FG_INVALID_WEBHOOK_SIGNATURE" });
  }

  const webhookEventId = request.headers.get("x-razorpay-event-id");
  if (!webhookEventId || webhookEventId.length > 200) {
    throw Object.assign(new Error("Invalid webhook event"), { statusCode: 400, code: "FG_INVALID_WEBHOOK_EVENT" });
  }
  if (processedRazorpayWebhookIds.has(webhookEventId)) return json({ accepted: true, duplicate: true });

  let payload: RazorpayWebhook;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Invalid webhook JSON");
    payload = parsed as RazorpayWebhook;
  } catch {
    throw Object.assign(new Error("Invalid webhook JSON"), { statusCode: 400, code: "FG_INVALID_WEBHOOK_EVENT" });
  }

  const organizationId = webhookOrganizationId(payload);
  if (!organizationId) {
    // Razorpay may retry non-2xx responses. A missing tenant note is a merchant
    // configuration error and must never silently route data to a default org.
    throw Object.assign(new Error("Webhook has no FlowGuard organization"), { statusCode: 422, code: "FG_WEBHOOK_ORGANIZATION_REQUIRED" });
  }

  ensureOrganization(organizationId, "Razorpay connected organization");
  const events = webhookToCanonicalEvents(organizationId, webhookEventId, payload);
  if (events.length > 0) ingestCanonicalEvents(organizationId, events, `Razorpay webhook: ${String(payload.event ?? "event")}`);
  processedRazorpayWebhookIds.add(webhookEventId);
  if (processedRazorpayWebhookIds.size > MAX_WEBHOOK_DEDUPLICATION_IDS) processedRazorpayWebhookIds.delete(processedRazorpayWebhookIds.values().next().value as string);
  recordAudit({ organizationId, userId: "razorpay_webhook", action: "razorpay_webhook_ingested", entityType: "WebhookEvent", entityId: webhookEventId, correlationId, metadata: { event: typeof payload.event === "string" ? payload.event : "unknown", ingestedEvents: events.length } });
  return json({ accepted: true, ingestedEvents: events.length });
}

async function handleAuth(request: Request, url: URL): Promise<Response> {
  if (url.pathname === "/auth/razorpay/callback" && request.method === "GET") {
    const config = razorpayConfig();
    const user = await authenticate(request);
    const cookies = parseCookieHeader(request.headers.get("cookie") ?? "");
    const state = verifyRazorpayOAuthState(cookies.fg_razorpay_oauth, url.searchParams.get("state"));
    if (!config || !supabaseServiceConfigured() || !user || !state || state.organizationId !== user.organizationId || state.userId !== user.userId) {
      return redirect("/pages/connections.html?razorpay=connection_failed", { "set-cookie": clearTemporaryCookie("fg_razorpay_oauth") });
    }
    const code = url.searchParams.get("code");
    if (url.searchParams.get("error") || !code) return redirect("/pages/connections.html?razorpay=denied", { "set-cookie": clearTemporaryCookie("fg_razorpay_oauth") });
    const token = await exchangeRazorpayAuthorizationCode(config, code);
    await saveRazorpayOAuthConnection({ organizationId: user.organizationId, accountId: token.accountId, accessToken: token.accessToken, refreshToken: token.refreshToken, accessTokenExpiresAt: token.accessTokenExpiresAt, refreshTokenExpiresAt: token.refreshTokenExpiresAt, userId: user.userId });
    ensureOrganization(user.organizationId, user.displayName ?? user.email.split("@")[0]);
    recordAudit({ organizationId: user.organizationId, userId: user.userId, action: "razorpay_oauth_connected", entityType: "RazorpayConnection", entityId: token.accountId, correlationId: "oauth_callback" });
    return redirect("/pages/connections.html?razorpay=connected", { "set-cookie": clearTemporaryCookie("fg_razorpay_oauth") });
  }
  if (url.pathname === "/auth/google" && request.method === "GET") {
    if (!supabaseAuthConfigured()) {
      const authorization = createGoogleAuthorization();
      return redirect(authorization.url, { "set-cookie": oauthStateCookie(authorization.state) });
    }
    // Supabase permits the configured Site URL even when additional redirect
    // URLs have not yet been configured. The root handler completes PKCE.
    const authorization = createSupabaseGoogleAuthorization(`${url.origin}/`);
    return redirect(authorization.url, { "set-cookie": temporaryCookie("fg_supabase_pkce", authorization.verifier) });
  }
  if ((url.pathname === "/auth/google/callback" || url.pathname === "/") && request.method === "GET") {
    const cookies = parseCookieHeader(request.headers.get("cookie") ?? "");
    if (!supabaseAuthConfigured()) {
      const completed = await finishGoogleAuthorization(url.searchParams.get("code") ?? "", url.searchParams.get("state") ?? "", cookies.fg_oauth_state);
      return redirect(completed.user.onboardingComplete ? "/pages/dashboard.html" : completed.returnTo, { "set-cookie": [sessionCookie(completed.sessionId), clearOAuthStateCookie()] });
    }
    const code = url.searchParams.get("code") ?? "";
    if (url.searchParams.get("error") || !code || !cookies.fg_supabase_pkce) {
      return redirect("/pages/login.html?error=google_denied", { "set-cookie": clearTemporaryCookie("fg_supabase_pkce") });
    }
    const session = await exchangeSupabaseGoogleCode(code, cookies.fg_supabase_pkce);
    await provisionSupabaseTenant(session.access_token);
    const organizationId = typeof session.user.user_metadata?.organization_id === "string" ? session.user.user_metadata.organization_id : `org_${session.user.id.replaceAll("-", "").slice(0, 16)}`;
    const stage = await getSupabaseOnboardingStage(session.access_token, organizationId);
    return redirect(stage === "READY" ? "/pages/dashboard.html" : "/pages/onboarding.html", { "set-cookie": [supabaseSessionCookie(session.access_token), clearTemporaryCookie("fg_supabase_pkce")] });
  }
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    invalidateOAuthSession(parseCookieHeader(request.headers.get("cookie") ?? "").fg_session);
    return new Response(null, { status: 204, headers: { "set-cookie": [clearSessionCookie(), clearSupabaseSessionCookie()] } });
  }
  throw Object.assign(new Error("Not found"), { statusCode: 404, code: "FG_NOT_FOUND" });
}

async function handleApi(request: Request, url: URL, correlationId: string): Promise<Response> {
  if (url.pathname === "/health") return json({ status: "ok" });
  if (url.pathname === "/readiness") return json({ status: "ready" });
  if (url.pathname === "/metrics") return new Response(metricsText(), { headers: { "content-type": "text/plain; charset=utf-8" } });

  if (url.pathname === "/api/session/demo-login") {
    const role = parseRole(url.searchParams.get("role"));
    return json({ status: "authenticated", role }, { headers: { "set-cookie": demoLoginCookie(role) } });
  }

  if (url.pathname === "/api/session/live-login") {
    return json({ status: "authenticated", role: "OWNER", mode: "LIVE" }, { headers: { "set-cookie": liveFirstRunCookie() } });
  }

  if (url.pathname === "/api/auth/signup" && request.method === "POST") {
    if (!supabaseAuthConfigured()) throw Object.assign(new Error("Authentication unavailable"), { statusCode: 503, code: "FG_AUTH_UNAVAILABLE" });
    const body = await readJson(request);
    const password = readString(body, "password");
    if (password.length < 8) throw Object.assign(new Error("Invalid password"), { statusCode: 400, code: "FG_INVALID_PAYLOAD" });
    const email = readString(body, "email");
    const result = await signUpWithSupabase({ name: readString(body, "name"), email, password });
    // Supabase can occasionally return a user without the session immediately
    // after signup. Verify by signing in once; a genuinely unconfirmed account
    // still returns FG_EMAIL_NOT_CONFIRMED and remains on the confirmation path.
    let session = result.session;
    if (!session) {
      try {
        session = await signInWithSupabase({ email, password });
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "FG_EMAIL_NOT_CONFIRMED")) throw error;
      }
    }
    if (session) await provisionSupabaseTenant(session.access_token);
    return json({ confirmationRequired: !session, destination: "/pages/onboarding.html" }, { status: session ? 201 : 202, headers: session ? { "set-cookie": supabaseSessionCookie(session.access_token) } : {} });
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    if (!supabaseAuthConfigured()) throw Object.assign(new Error("Authentication unavailable"), { statusCode: 503, code: "FG_AUTH_UNAVAILABLE" });
    const body = await readJson(request);
    const session = await signInWithSupabase({ email: readString(body, "email"), password: readString(body, "password") });
    await provisionSupabaseTenant(session.access_token);
    const organizationId = typeof session.user.user_metadata?.organization_id === "string" ? session.user.user_metadata.organization_id : `org_${session.user.id.replaceAll("-", "").slice(0, 16)}`;
    const stage = await getSupabaseOnboardingStage(session.access_token, organizationId);
    return json({ destination: stage === "READY" ? "/pages/dashboard.html" : "/pages/onboarding.html" }, { headers: { "set-cookie": supabaseSessionCookie(session.access_token) } });
  }

  const user = await authenticate(request);
  if (!user) throw Object.assign(new Error("Authentication required"), { statusCode: 401, code: "FG_UNAUTHENTICATED" });

  ensureOrganization(user.organizationId, user.displayName ?? user.email.split("@")[0]);
  const sessionToken = parseCookieHeader(request.headers.get("cookie") ?? "").fg_supabase_session;
  await restoreSupabaseTenantState(sessionToken, user.organizationId);

  if (url.searchParams.has("organizationId") && url.searchParams.get("organizationId") !== user.organizationId) {
    throw Object.assign(new Error("Not found"), { statusCode: 404, code: "FG_NOT_FOUND" });
  }

  const runtime = getOrganizationRuntime(user.organizationId);
  const routeStarted = Date.now();
  const key = routeKey(request.method, url.pathname);

  if (requiresReadyDashboard(key) && !isDashboardReady(user.organizationId, runtime.profile.mode)) {
    throw Object.assign(new Error("Onboarding required"), { statusCode: 409, code: "FG_ONBOARDING_REQUIRED", onboarding: buildOnboardingSummary(user.organizationId) });
  }

  switch (key) {
    case "GET /api/razorpay/oauth/status": {
      requirePermission(user, "view_settings");
      const config = razorpayConfig();
      const connection = await getRazorpayOAuthStatus(user.organizationId);
      return json({ configured: Boolean(config && supabaseServiceConfigured()), testModeConfigured: Boolean(razorpayDirectConfig()), connected: connection.connected, accountId: connection.accountId, connectedAt: connection.connectedAt, lastSyncedAt: connection.lastSyncedAt, webhookUrl: `${url.origin}/webhooks/razorpay`, webhookReady: url.protocol === "https:" });
    }
    case "GET /api/razorpay/oauth/start": {
      requirePermission(user, "view_settings");
      const config = razorpayConfig();
      if (!config || !supabaseServiceConfigured()) throw Object.assign(new Error("Razorpay OAuth is not configured on this deployment"), { statusCode: 503, code: "FG_RAZORPAY_OAUTH_UNAVAILABLE" });
      const state = createOAuthState();
      const value = signRazorpayOAuthState({ state, organizationId: user.organizationId, userId: user.userId, expiresAt: Date.now() + 10 * 60_000 });
      recordAuditEvent(user, "razorpay_oauth_started", "RazorpayConnection", user.organizationId, correlationId);
      return redirect(createRazorpayAuthorizationUrl(config, state), { "set-cookie": temporaryCookie("fg_razorpay_oauth", value) });
    }
    case "POST /api/razorpay/oauth/sync": {
      requirePermission(user, "view_settings");
      checkRateLimit(`razorpay-oauth-sync:${user.userId}`, 3, 60_000);
      const connection = await getRazorpayOAuthConnection(user.organizationId);
      if (!connection) throw Object.assign(new Error("Connect Razorpay before syncing"), { statusCode: 409, code: "FG_RAZORPAY_NOT_CONNECTED" });
      const payments = await fetchRazorpayOAuthPayments(connection.accessToken);
      const events = paymentsToCanonicalEvents(user.organizationId, payments);
      const updated = ingestCanonicalEvents(user.organizationId, events, "Razorpay OAuth payments synchronized");
      await markRazorpayOAuthSynced(user.organizationId);
      recordAuditEvent(user, "razorpay_oauth_sync", "RazorpayConnection", connection.accountId, correlationId);
      return json({ dataLabel: updated.dataLabel, syncedPayments: payments.length, ingestedEvents: events.length, cash: updated.cash, alerts: updated.alerts, timeline: updated.timeline });
    }
    case "POST /api/razorpay/test-checkout": {
      requirePermission(user, "view_settings");
      checkRateLimit(`razorpay-test-order:${user.userId}`, 5, 60_000);
      const config = razorpayDirectConfig();
      if (!config) throw Object.assign(new Error("Razorpay Test Mode is not configured"), { statusCode: 503, code: "FG_RAZORPAY_UNAVAILABLE" });
      const order = await createRazorpayTestOrder(config, { organizationId: user.organizationId, amountMinor: 10_000 });
      recordAuditEvent(user, "razorpay_test_order_created", "RazorpayOrder", order.id, correlationId);
      return json({ keyId: config.keyId, orderId: order.id, amountMinor: order.amountMinor, currency: order.currency, organizationId: user.organizationId });
    }
    case "GET /api/me":
      recordAuditEvent(user, "session_resolved", "User", user.userId, correlationId);
      return json({ user, dataLabel: runtime.dataLabel, organization: runtime.profile, onboarding: buildOnboardingSummary(user.organizationId) });
    case "GET /api/onboarding":
      return json({ dataLabel: runtime.dataLabel, organization: runtime.profile, onboarding: buildOnboardingSummary(user.organizationId), assessment: getOnboardingRecord(user.organizationId).firstAssessment ?? null });
    case "POST /api/onboarding/business-profile": {
      requirePermission(user, "view_settings");
      const body = await readJson(request);
      const input = body as never;
      const record = saveBusinessProfile(user.organizationId, input);
      applyBusinessProfile(user.organizationId, input);
      if (sessionToken) await saveSupabaseOnboardingProgress(sessionToken, user.organizationId, record);
      recordAuditEvent(user, "onboarding_business_profile", "Organization", user.organizationId, correlationId);
      return json({ dataLabel: runtime.dataLabel, onboarding: record });
    }
    case "PATCH /api/financial-inputs": {
      requirePermission(user, "view_settings");
      const input = await readJson(request) as never;
      const record = updateBusinessProfile(user.organizationId, input);
      applyBusinessProfile(user.organizationId, input);
      if (sessionToken) await saveSupabaseOnboardingProgress(sessionToken, user.organizationId, record);
      const updated = getOrganizationRuntime(user.organizationId);
      recordAuditEvent(user, "financial_inputs_updated", "Organization", user.organizationId, correlationId);
      return json({ onboarding: record, dataLabel: updated.dataLabel, metrics: updated.metrics, cash: updated.cash });
    }
    case "POST /api/onboarding/risk-preferences": {
      requirePermission(user, "view_settings");
      const body = await readJson(request);
      const input = body as never;
      const record = saveRiskPreferences(user.organizationId, input);
      applyRiskPreferences(user.organizationId, input);
      if (sessionToken) await saveSupabaseOnboardingProgress(sessionToken, user.organizationId, record);
      recordAuditEvent(user, "onboarding_risk_preferences", "Organization", user.organizationId, correlationId);
      return json({ dataLabel: runtime.dataLabel, onboarding: record });
    }
    case "POST /api/onboarding/data-connections": {
      requirePermission(user, "view_settings");
      const body = await readJson(request);
      const input = body as never;
      const record = saveDataConnections(user.organizationId, input);
      applyDataConnections(user.organizationId, input);
      if (sessionToken) await saveSupabaseOnboardingProgress(sessionToken, user.organizationId, record);
      recordAuditEvent(user, "onboarding_data_connections", "Organization", user.organizationId, correlationId);
      return json({ dataLabel: runtime.dataLabel, onboarding: record });
    }
    case "POST /api/onboarding/validate": {
      requirePermission(user, "view_settings");
      const updatedRuntime = getOrganizationRuntime(user.organizationId);
      const record = runReadinessAudit(user.organizationId, updatedRuntime);
      if (sessionToken) await saveSupabaseOnboardingProgress(sessionToken, user.organizationId, record);
      recordAuditEvent(user, "onboarding_readiness_audit", "Organization", user.organizationId, correlationId);
      return json({ dataLabel: updatedRuntime.dataLabel, onboarding: record, readinessAudit: record.readinessAudit });
    }
    case "POST /api/onboarding/initial-calculation": {
      requirePermission(user, "view_settings");
      const updatedRuntime = getOrganizationRuntime(user.organizationId);
      const record = finalizeInitialCalculation(user.organizationId, updatedRuntime);
      if (sessionToken) await saveSupabaseOnboardingProgress(sessionToken, user.organizationId, record);
      if (record.stage === "READY") markOAuthOnboardingComplete(user.userId);
      recordAuditEvent(user, "onboarding_initial_calculation", "Organization", user.organizationId, correlationId);
      return json({ dataLabel: updatedRuntime.dataLabel, onboarding: record, assessment: record.firstAssessment ?? null });
    }
    case "GET /api/overview":
      requirePermission(user, "view_dashboard");
      recordMetric("overview_api", Date.now() - routeStarted);
      const declaredBaseline = buildDeclaredBaseline(getOnboardingRecord(user.organizationId));
      return json({
        dataLabel: runtime.dataLabel,
        dataState: runtime.dataState === "EMPTY" && declaredBaseline.hasContext ? "DECLARED" : runtime.dataState,
        updatedAt: new Date().toISOString(),
        organization: runtime.profile.name,
        freshness: runtime.freshness,
        metrics:
          runtime.dataState === "EMPTY"
            ? {
                availableCash: declaredBaseline.availableCash,
                pendingSettlement: { state: "UNKNOWN", note: "Connect Razorpay to track pending settlements" },
                forecast30Day: declaredBaseline.position30Day,
                receivables: { state: "UNKNOWN", note: "Import receivables to include expected inflows" },
                obligations30Day: declaredBaseline.obligations30Day,
                liquidityBuffer: declaredBaseline.liquidityBuffer,
                cashRunway: declaredBaseline.runway,
              }
            : {
                availableCash: { ...runtime.cash.actualBankCash, state: "ACTUAL" },
                pendingSettlement: { ...runtime.cash.pendingSettlements, state: "PENDING" },
                forecast30Day: { ...runtime.forecast.days[29].closingCash, state: "FORECAST" },
                receivables: { ...runtime.cash.expectedReceivables, state: "FORECAST" },
                atRiskReceivables: { amountMinor: Math.max(0, ...[...runtime.state.invoices.values()].map((invoice) => invoice.amount.amountMinor - invoice.paidAmount.amountMinor)), currency: "INR", state: "PREDICTED", probabilityLate: runtime.receivableRisk.probabilityLate },
                cashRunway: { days: runtime.forecast.runwayDays, state: "FORECAST" },
                reconciliationHealth: { rate: runtime.metrics.reconciliationRate, exceptions: runtime.metrics.unreconciledCount, state: "ACTUAL" },
              },
        activeAlerts: summarizeAlerts(runtime.alerts),
        timeline: runtime.timeline,
        declaredBaseline,
      });
    case "GET /api/cash-position":
      requirePermission(user, "view_dashboard");
      recordMetric("cash_api", Date.now() - routeStarted);
      return json({ dataLabel: runtime.dataLabel, dataState: runtime.dataState, freshness: runtime.freshness, ...runtime.cash });
    case "GET /api/payments":
      requirePermission(user, "view_payments");
      return json({ dataLabel: runtime.dataLabel, dataState: runtime.dataState, payments: [...runtime.state.payments.values()], refunds: [...runtime.state.refunds.values()] });
    case "GET /api/payments/:id/lineage":
      requirePermission(user, "view_payments");
      return json({ dataLabel: runtime.dataLabel, lineage: traceOrganizationPayment(user.organizationId, url.pathname.split("/")[3]) });
    case "GET /api/settlements":
      requirePermission(user, "view_payments");
      return json({ dataLabel: runtime.dataLabel, dataState: runtime.dataState, settlements: [...runtime.state.settlements.values()], bankTransactions: [...runtime.state.bankTransactions.values()] });
    case "GET /api/reconciliation":
      requirePermission(user, "view_reconciliation");
      recordMetric("reconciliation_api", Date.now() - routeStarted);
      return json({ dataLabel: runtime.dataLabel, dataState: runtime.dataState, results: runtime.reconciliation, metrics: runtime.metrics });
    case "GET /api/reconciliation/:id":
      requirePermission(user, "view_reconciliation");
      return json({ dataLabel: runtime.dataLabel, result: runtime.reconciliation.find((item) => item.settlementId === url.pathname.split("/")[3]) ?? null });
    case "GET /api/receivables":
      requirePermission(user, "view_receivables");
      return json({ dataLabel: runtime.dataLabel, dataState: runtime.dataState, invoices: [...runtime.state.invoices.values()], risk: runtime.receivableRisk });
    case "GET /api/forecast":
      requirePermission(user, "view_forecast");
      recordMetric("forecast_api", Date.now() - routeStarted);
      return json({ dataLabel: runtime.dataLabel, dataState: runtime.dataState, forecast: runtime.forecast });
    case "POST /api/scenarios":
      requirePermission(user, "run_scenario");
      checkRateLimit(`scenario:${user.userId}`, 5, 60_000);
      recordAuditEvent(user, "scenario_execution", "Scenario", "demo_marketing_spend", correlationId);
      recordMetric("scenario_api", Date.now() - routeStarted);
      return json({ dataLabel: runtime.dataLabel, scenario: runtime.scenario });
    case "GET /api/scenarios/:id":
      requirePermission(user, "run_scenario");
      return json({ dataLabel: runtime.dataLabel, scenario: runtime.scenario });
    case "POST /api/controller/query": {
      requirePermission(user, "ask_controller");
      checkRateLimit(`controller:${user.userId}`, 8, 60_000);
      const body = await readJson(request);
      if (typeof body.question !== "string" || body.question.length > 500) {
        throw Object.assign(new Error("Invalid controller payload"), { statusCode: 400, code: "FG_INVALID_PAYLOAD" });
      }
      const financialContext = buildControllerEvidence(runtime, getOnboardingRecord(user.organizationId));
      const deterministic = answerFinanceQuestion(runtime.state, user.organizationId, body.question, financialContext);
      const insight = await explainWithLlm({ question: body.question, deterministicAnswer: deterministic.answer, toolCalls: deterministic.toolCalls, financialContext });
      recordAuditEvent(user, "controller_query", "Controller", "demo_controller", correlationId);
      recordMetric("controller_api", Date.now() - routeStarted);
      return json({ dataLabel: runtime.dataLabel, ...deterministic, insight });
    }
    case "GET /api/risks":
      requirePermission(user, "view_dashboard");
      return json({ dataLabel: runtime.dataLabel, risks: runtime.alerts.map(alertToRisk) });
    case "GET /api/alerts":
      requirePermission(user, "view_dashboard");
      return json({ dataLabel: runtime.dataLabel, alerts: runtime.alerts });
    case "POST /api/alerts/:id/acknowledge": {
      requirePermission(user, "view_dashboard");
      const alert = acknowledgeAlert(user.organizationId, url.pathname.split("/")[3]);
      return json({ dataLabel: runtime.dataLabel, alert: alert ?? null });
    }
    case "GET /api/notifications":
      requirePermission(user, "view_dashboard");
      return json({ dataLabel: runtime.dataLabel, notifications: runtime.notifications });
    case "GET /api/audit":
      requirePermission(user, "view_audit");
      return json({ dataLabel: runtime.dataLabel, audit: listAuditEvents(user.organizationId) });
    case "GET /api/settings":
      requirePermission(user, "view_settings");
      return json({ dataLabel: runtime.dataLabel, dataState: runtime.dataState, connections: runtime.profile.dataConnections, organizationProfile: runtime.profile });
    case "POST /api/ingest/razorpay-mock": {
      requirePermission(user, "run_scenario");
      const body = await readJson(request);
      const updated = ingestRazorpayMockPayment(user.organizationId, {
        orderId: readString(body, "orderId"),
        paymentId: readString(body, "paymentId"),
        customerId: readString(body, "customerId"),
        amountMinor: readInteger(body, "amountMinor"),
        occurredAt: readString(body, "occurredAt"),
      });
      return json({ dataLabel: updated.dataLabel, cash: updated.cash, alerts: updated.alerts, timeline: updated.timeline });
    }
    case "POST /api/razorpay/direct-sync": {
      requirePermission(user, "view_settings");
      checkRateLimit(`razorpay-sync:${user.userId}`, 3, 60_000);
      const config = razorpayDirectConfig();
      if (!config) throw Object.assign(new Error("Razorpay Test Mode is not configured"), { statusCode: 503, code: "FG_RAZORPAY_UNAVAILABLE" });
      const payments = await fetchRazorpayPayments(config);
      const events = paymentsToCanonicalEvents(user.organizationId, payments);
      const updated = ingestCanonicalEvents(user.organizationId, events, "Razorpay Test Mode payments synchronized");
      recordAuditEvent(user, "razorpay_direct_sync", "RazorpayConnection", user.organizationId, correlationId);
      return json({ dataLabel: updated.dataLabel, syncedPayments: payments.length, ingestedEvents: events.length, cash: updated.cash, alerts: updated.alerts, timeline: updated.timeline });
    }
    case "POST /api/connections/configure": {
      requirePermission(user, "view_settings");
      const body = await readJson(request);
      const kind = readString(body, "kind");
      const provider = readString(body, "provider");
      if ((kind !== "BANK" && kind !== "ACCOUNTING") || provider.length > 80) {
        throw Object.assign(new Error("Invalid provider configuration"), { statusCode: 400, code: "FG_INVALID_PAYLOAD" });
      }
      const profile = requestConnectionSetup(user.organizationId, kind, provider);
      recordAuditEvent(user, "connection_setup_requested", "DataConnection", `${kind}:${provider}`, correlationId);
      return json({ connection: profile.dataConnections.find((connection) => connection.kind.includes(provider)) ?? null });
    }
    case "POST /api/ingest/bank-csv": {
      requirePermission(user, "run_scenario");
      const body = await readJson(request);
      if (!Array.isArray(body.rows)) throw Object.assign(new Error("Invalid rows"), { statusCode: 400, code: "FG_INVALID_PAYLOAD" });
      const updated = ingestBankCsv(user.organizationId, body.rows as never);
      return json({ dataLabel: updated.dataLabel, cash: updated.cash, alerts: updated.alerts, timeline: updated.timeline });
    }
    case "POST /api/ingest/invoices": {
      requirePermission(user, "run_scenario");
      const body = await readJson(request);
      if (!Array.isArray(body.rows)) throw Object.assign(new Error("Invalid rows"), { statusCode: 400, code: "FG_INVALID_PAYLOAD" });
      const updated = ingestInvoiceCsv(user.organizationId, body.rows as never);
      return json({ dataLabel: updated.dataLabel, receivables: [...updated.state.invoices.values()], alerts: updated.alerts, timeline: updated.timeline });
    }
    case "GET /api/metrics-json":
      return json({ metrics: metricsSnapshot() });
    default:
      throw Object.assign(new Error("Not found"), { statusCode: 404, code: "FG_NOT_FOUND" });
  }
}

async function handleStatic(request: Request, url: URL): Promise<Response> {
  if (url.pathname === "/") {
    const user = await authenticate(request);
    if (user) {
      ensureOrganization(user.organizationId, user.displayName ?? user.email.split("@")[0]);
      const sessionToken = parseCookieHeader(request.headers.get("cookie") ?? "").fg_supabase_session;
      await restoreSupabaseTenantState(sessionToken, user.organizationId);
      const runtime = getOrganizationRuntime(user.organizationId);
      return redirect(isDashboardReady(user.organizationId, runtime.profile.mode) ? "/pages/dashboard.html" : "/pages/onboarding.html");
    }
  }
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  if (pathname === "/pages/dashboard.html") {
    const user = await authenticate(request);
    if (!user) return redirect(`/pages/login.html?next=${encodeURIComponent(pathname)}`);
    ensureOrganization(user.organizationId, user.displayName ?? user.email.split("@")[0]);
    const sessionToken = parseCookieHeader(request.headers.get("cookie") ?? "").fg_supabase_session;
    await restoreSupabaseTenantState(sessionToken, user.organizationId);
    if (!isDashboardReady(user.organizationId, getOrganizationRuntime(user.organizationId).profile.mode)) return redirect("/pages/onboarding.html");
  }
  const root = join(process.cwd(), "ui");
  const path = join(root, pathname.replace(/^\/+/, ""));
  if (!path.startsWith(root)) throw Object.assign(new Error("Not found"), { statusCode: 404, code: "FG_NOT_FOUND" });
  const content = await readFile(path);
  return new Response(content, { headers: { "content-type": contentType(path) } });
}

function routeKey(method: string, pathname: string): string {
  if (/^\/api\/payments\/[^/]+\/lineage$/.test(pathname)) return `${method} /api/payments/:id/lineage`;
  if (/^\/api\/reconciliation\/[^/]+$/.test(pathname)) return `${method} /api/reconciliation/:id`;
  if (/^\/api\/scenarios\/[^/]+$/.test(pathname)) return `${method} /api/scenarios/:id`;
  if (/^\/api\/alerts\/[^/]+\/acknowledge$/.test(pathname)) return `${method} /api/alerts/:id/acknowledge`;
  return `${method} ${pathname}`;
}

function json(value: JsonValue | Record<string, unknown>, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { ...init, headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) } });
}

function redirect(location: string, headers: Record<string, string | string[]> = {}): Response {
  const responseHeaders = new Headers({ location });
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
    else responseHeaders.set(name, value);
  }
  return new Response(null, { status: 302, headers: responseHeaders });
}
function parseCookieHeader(value: string): Record<string, string> { return Object.fromEntries(value.split(";").map((part) => part.trim().split("=")).filter((pair): pair is [string, string] => pair.length === 2)); }
function temporaryCookie(name: string, value: string): string { return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${process.env.NODE_ENV === "production" ? "; Secure" : ""}`; }
function clearTemporaryCookie(name: string): string { return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`; }
type RazorpayOAuthState = Readonly<{ state: string; organizationId: string; userId: string; expiresAt: number }>;
function signRazorpayOAuthState(state: RazorpayOAuthState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", razorpayStateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function verifyRazorpayOAuthState(value: string | undefined, expectedState: string | null): RazorpayOAuthState | undefined {
  if (!value || !expectedState) return undefined;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return undefined;
  const expected = createHmac("sha256", razorpayStateSecret()).update(payload).digest("base64url");
  const left = Buffer.from(expected); const right = Buffer.from(signature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<RazorpayOAuthState>;
    return typeof parsed.state === "string" && typeof parsed.organizationId === "string" && typeof parsed.userId === "string" && typeof parsed.expiresAt === "number" && parsed.state === expectedState && parsed.expiresAt > Date.now()
      ? { state: parsed.state, organizationId: parsed.organizationId, userId: parsed.userId, expiresAt: parsed.expiresAt }
      : undefined;
  } catch { return undefined; }
}
function razorpayStateSecret(): string {
  const secret = process.env.RAZORPAY_TOKEN_ENCRYPTION_KEY;
  if (!secret) throw Object.assign(new Error("Razorpay OAuth is not configured"), { statusCode: 503, code: "FG_RAZORPAY_OAUTH_UNAVAILABLE" });
  return secret;
}

function withHeaders(response: Response, correlationId: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  headers.set("x-correlation-id", correlationId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function safeError(error: unknown, correlationId: string): Response {
  const status = typeof error === "object" && error !== null && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : 500;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "FG_INTERNAL_ERROR";
  const onboarding = typeof error === "object" && error !== null && "onboarding" in error ? (error as { onboarding: unknown }).onboarding : undefined;
  return json({ error: { code, message: safeMessage(status), correlationId }, onboarding }, { status });
}

function safeMessage(status: number): string {
  if (status === 401) return "Authentication is required.";
  if (status === 403) return "You are not authorized to perform this action.";
  if (status === 404) return "The requested resource was not found.";
  if (status === 409) return "Complete onboarding before viewing financial dashboards.";
  if (status === 429) return "Too many requests. Try again shortly.";
  if (status === 400) return "The request was invalid.";
  return "Unable to complete this request right now.";
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid JSON");
    return value as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { statusCode: 400, code: "FG_INVALID_JSON" });
  }
}

function recordAuditEvent(user: { organizationId: string; userId: string }, action: string, entityType: string, entityId: string, correlationId: string): void {
  recordAudit({ organizationId: user.organizationId, userId: user.userId, action, entityType, entityId, correlationId, metadata: { demo: true } });
}

function summarizeAlerts(alerts: Array<{ severity: string; lifecycleStatus: string }>) {
  return {
    critical: alerts.filter((alert) => alert.severity === "CRITICAL" && alert.lifecycleStatus !== "RESOLVED").length,
    high: alerts.filter((alert) => alert.severity === "HIGH" && alert.lifecycleStatus !== "RESOLVED").length,
    warning: alerts.filter((alert) => alert.severity === "WARNING" && alert.lifecycleStatus !== "RESOLVED").length,
  };
}

/**
 * This is the only finance packet made available to the explanation model.
 * Values stay deterministic and retain their provenance throughout the answer.
 */
function buildControllerEvidence(runtime: OrganizationRuntime, record: OnboardingRecord): FinancialEvidenceContext {
  const baseline = buildDeclaredBaseline(record);
  const profile = record.businessProfile?.value;
  const declaredContext: string[] = [];
  if (profile) {
    declaredContext.push(`Organization context: ${profile.organizationName} (${profile.industryType}), USER_DECLARED.`);
    if (profile.revenueChannels?.length) declaredContext.push(`Declared revenue channels: ${profile.revenueChannels.join(", ")} (USER_DECLARED).`);
    if (profile.cashPressureSources?.length) declaredContext.push(`Declared cash-pressure factors: ${profile.cashPressureSources.join(", ")} (USER_DECLARED).`);
    declaredContext.push(`Declared customer payment terms: ${profile.receivableTermsDays} days (USER_DECLARED).`);
  }
  if (baseline.availableCash.amountMinor !== undefined) {
    declaredContext.push(`Declared available cash: ${formatInr(baseline.availableCash.amountMinor)} (USER_DECLARED).`);
  }
  if (baseline.obligations30Day.amountMinor !== undefined) {
    declaredContext.push(`Declared 30-day obligations: ${formatInr(baseline.obligations30Day.amountMinor)} (USER_DECLARED).`);
  }
  if (baseline.liquidityBuffer.amountMinor !== undefined) {
    declaredContext.push(`Declared minimum liquidity buffer: ${formatInr(baseline.liquidityBuffer.amountMinor)} (USER_DECLARED).`);
  }

  const verifiedFindings: string[] = [];
  const calculatedFindings: string[] = [];
  if (runtime.dataState === "READY") {
    verifiedFindings.push(`Bank cash: ${formatInr(runtime.cash.actualBankCash.amountMinor)} (ACTUAL).`);
    verifiedFindings.push(`Unsettled payment amount: ${formatInr(runtime.cash.pendingSettlements.amountMinor)} (PENDING).`);
    verifiedFindings.push(`Open receivables: ${formatInr(runtime.cash.expectedReceivables.amountMinor)} (FORECAST).`);
    calculatedFindings.push(`30-day deterministic forecast minimum: ${formatInr(runtime.forecast.minimumBalance.amountMinor)} (FORECAST).`);
    calculatedFindings.push(runtime.forecast.shortfallDate
      ? `Forecast shortfall date: ${runtime.forecast.shortfallDate} (FORECAST).`
      : `No forecast shortfall is present in the next ${runtime.forecast.horizonDays} days (FORECAST).`);
  } else if (baseline.position30Day.amountMinor !== undefined) {
    calculatedFindings.push(`Declared 30-day cash position: ${formatInr(baseline.position30Day.amountMinor)} (ESTIMATED from USER_DECLARED inputs; no unprovided inflows assumed).`);
  } else {
    calculatedFindings.push("No source-verified financial data is connected yet. Connect a bank, payment, or receivables source for ACTUAL and FORECAST metrics.");
  }

  const activeRisks = runtime.alerts
    .filter((alert) => alert.lifecycleStatus !== "RESOLVED")
    .slice(0, 5)
    .map((alert) => `${alert.severity} ${alert.riskType}: ${alert.reason} Recommended next step: ${alert.recommendedNextStep}`);

  return { declaredContext, verifiedFindings, calculatedFindings, activeRisks };
}

function formatInr(amountMinor: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amountMinor / 100);
}

function alertToRisk(alert: { severity: string; detectedAt: string; reason: string; affectedAmountMinor: number; riskType: string; lifecycleStatus: string }) {
  return {
    severity: alert.severity,
    detectedAt: alert.detectedAt,
    reason: alert.reason,
    affectedAmount: { amountMinor: alert.affectedAmountMinor, currency: "INR" },
    source: alert.riskType,
    status: alert.lifecycleStatus,
  };
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw Object.assign(new Error(`Invalid ${key}`), { statusCode: 400, code: "FG_INVALID_PAYLOAD" });
  return value;
}

function readInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value)) throw Object.assign(new Error(`Invalid ${key}`), { statusCode: 400, code: "FG_INVALID_PAYLOAD" });
  return value;
}

function parseRole(value: string | null): Role {
  return value === "VIEWER" || value === "ANALYST" || value === "FINANCE_ADMIN" || value === "OWNER" ? value : "OWNER";
}

function requiresReadyDashboard(key: string): boolean {
  return new Set([
    "GET /api/overview",
    "GET /api/cash-position",
    "GET /api/payments",
    "GET /api/payments/:id/lineage",
    "GET /api/settlements",
    "GET /api/reconciliation",
    "GET /api/reconciliation/:id",
    "GET /api/receivables",
    "GET /api/forecast",
    "POST /api/scenarios",
    "GET /api/scenarios/:id",
    "GET /api/risks",
    "GET /api/alerts",
    "POST /api/alerts/:id/acknowledge",
    "GET /api/notifications",
  ]).has(key);
}

function contentType(path: string): string {
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}
