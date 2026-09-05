import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { money } from "../domain/money.ts";
import type { CanonicalEvent } from "../domain/types.ts";

export type RazorpayConnectionConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webhookSecret: string;
}>;

export type RazorpayDirectConfig = Readonly<{ keyId: string; keySecret: string }>;
export type RazorpayOAuthToken = Readonly<{ accessToken: string; refreshToken: string; accessTokenExpiresAt: string; refreshTokenExpiresAt?: string; accountId: string }>;
export type RazorpayOrder = Readonly<{ id: string; amountMinor: number; currency: string }>;

type RazorpayEntity = Record<string, unknown>;
export type RazorpayWebhook = Readonly<{ event?: unknown; payload?: unknown; created_at?: unknown }>;

/** Reads only server environment values. Nothing in this module is exposed to static UI assets. */
export function razorpayConfig(): RazorpayConnectionConfig | undefined {
  const clientId = process.env.RAZORPAY_CLIENT_ID;
  const clientSecret = process.env.RAZORPAY_CLIENT_SECRET;
  const redirectUri = process.env.RAZORPAY_OAUTH_REDIRECT_URI;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  return clientId && clientSecret && redirectUri && webhookSecret ? { clientId, clientSecret, redirectUri, webhookSecret } : undefined;
}

/** Direct account credentials are for this merchant's Test/Live account only, never customer OAuth. */
export function razorpayDirectConfig(): RazorpayDirectConfig | undefined {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  return keyId && keySecret ? { keyId, keySecret } : undefined;
}

export async function fetchRazorpayPayments(config: RazorpayDirectConfig): Promise<RazorpayEntity[]> {
  const authorization = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payments?count=100", {
    headers: { authorization: `Basic ${authorization}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Object.assign(new Error("Razorpay payments sync failed"), { statusCode: 502, code: "FG_RAZORPAY_SYNC_FAILED" });
  const payload = await response.json() as { items?: unknown };
  return Array.isArray(payload.items) ? payload.items.filter(isRecord) : [];
}

/** Creates a Test Mode order server-side so the browser receives only the public key id. */
export async function createRazorpayTestOrder(config: RazorpayDirectConfig, input: { organizationId: string; amountMinor: number }): Promise<RazorpayOrder> {
  const authorization = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { authorization: `Basic ${authorization}`, "content-type": "application/json" },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: "INR",
      receipt: `fg_${input.organizationId.slice(-12)}_${Date.now().toString(36)}`.slice(0, 40),
      notes: { flowguard_organization_id: input.organizationId, flowguard_source: "test_checkout" },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const id = typeof payload.id === "string" ? payload.id : "";
  const amountMinor = integer(payload, "amount");
  const currency = string(payload, "currency") ?? "";
  if (!response.ok || !id || amountMinor !== input.amountMinor || currency !== "INR") {
    throw Object.assign(new Error("Razorpay test order creation failed"), { statusCode: 502, code: "FG_RAZORPAY_ORDER_FAILED" });
  }
  return Object.freeze({ id, amountMinor, currency });
}

export function paymentsToCanonicalEvents(organizationId: string, payments: RazorpayEntity[]): CanonicalEvent[] {
  return payments.flatMap((payment) => {
    if (string(payment, "status") !== "captured") return [];
    const paymentId = string(payment, "id");
    const orderId = string(payment, "order_id");
    const amountMinor = integer(payment, "amount");
    if (!paymentId || !orderId || amountMinor === undefined) return [];
    const occurredAt = timestamp(payment.created_at);
    const customerId = string(payment, "customer_id") ?? string(payment, "email") ?? "razorpay_customer_unknown";
    return [
      canonical(organizationId, "ORDER_CREATED", `api_order_${orderId}`, `order:${orderId}`, occurredAt, { orderId, customerId, amount: money(amountMinor) }),
      canonical(organizationId, "PAYMENT_CAPTURED", `api_payment_${paymentId}`, `payment:${paymentId}`, occurredAt, { paymentId, orderId, amount: money(amountMinor) }),
    ];
  });
}

export function createOAuthState(): string { return randomBytes(32).toString("base64url"); }

export function createRazorpayAuthorizationUrl(config: RazorpayConnectionConfig, state: string): string {
  const url = new URL("https://auth.razorpay.com/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "read_only");
  url.searchParams.set("state", state);
  return url.toString();
}

/** Exchanges an OAuth authorization code on the server. The browser never sees these tokens. */
export async function exchangeRazorpayAuthorizationCode(config: RazorpayConnectionConfig, code: string): Promise<RazorpayOAuthToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
  });
  const response = await fetch("https://auth.razorpay.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
  const accountId = typeof payload.razorpay_account_id === "string" ? payload.razorpay_account_id
    : typeof payload.account_id === "string" ? payload.account_id : "";
  const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) ? payload.expires_in : 0;
  if (!response.ok || !accessToken || !refreshToken || !accountId || expiresIn <= 0) {
    throw Object.assign(new Error("Razorpay OAuth token exchange failed"), { statusCode: 502, code: "FG_RAZORPAY_OAUTH_EXCHANGE_FAILED" });
  }
  return Object.freeze({
    accessToken,
    refreshToken,
    accountId,
    accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    refreshTokenExpiresAt: typeof payload.refresh_token_expires_in === "number" && Number.isFinite(payload.refresh_token_expires_in)
      ? new Date(Date.now() + payload.refresh_token_expires_in * 1_000).toISOString()
      : undefined,
  });
}

export async function fetchRazorpayOAuthPayments(accessToken: string): Promise<RazorpayEntity[]> {
  const response = await fetch("https://api.razorpay.com/v1/payments?count=100", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Object.assign(new Error("Razorpay OAuth payments sync failed"), { statusCode: 502, code: "FG_RAZORPAY_OAUTH_SYNC_FAILED" });
  const payload = await response.json() as { items?: unknown };
  return Array.isArray(payload.items) ? payload.items.filter(isRecord) : [];
}

/** Razorpay signs the exact raw webhook body; parsed/re-serialized JSON is unsafe here. */
export function verifyRazorpayWebhook(rawBody: string, signature: string | null, webhookSecret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Converts the factual parts of a Razorpay webhook into immutable ledger events.
 * Settlements require reconciliation-line detail and are intentionally handled by
 * `settlementEvents` after a server-to-server reconciliation API fetch.
 */
export function webhookToCanonicalEvents(organizationId: string, webhookEventId: string, raw: RazorpayWebhook): CanonicalEvent[] {
  const event = typeof raw.event === "string" ? raw.event : "";
  const occurredAt = timestamp(raw.created_at);
  if (event === "payment.captured") {
    const payment = entity(raw, "payment");
    const paymentId = string(payment, "id");
    const orderId = string(payment, "order_id");
    const amountMinor = integer(payment, "amount");
    if (!paymentId || !orderId || amountMinor === undefined) return [];
    const customerId = string(payment, "customer_id") ?? string(payment, "email") ?? "razorpay_customer_unknown";
    return [
      canonical(organizationId, "ORDER_CREATED", `${webhookEventId}:order`, `order:${orderId}`, occurredAt, { orderId, customerId, amount: money(amountMinor) }),
      canonical(organizationId, "PAYMENT_CAPTURED", `${webhookEventId}:payment`, `payment:${paymentId}`, occurredAt, { paymentId, orderId, amount: money(amountMinor) }),
    ];
  }
  if (event === "refund.created" || event === "refund.processed") {
    const refund = entity(raw, "refund");
    const refundId = string(refund, "id");
    const paymentId = string(refund, "payment_id");
    const amountMinor = integer(refund, "amount");
    if (!refundId || !paymentId || amountMinor === undefined) return [];
    return [canonical(organizationId, event === "refund.processed" ? "REFUND_PROCESSED" : "REFUND_CREATED", `${webhookEventId}:refund`, `refund:${refundId}`, occurredAt, { refundId, paymentId, amount: money(amountMinor) })];
  }
  return [];
}

/**
 * A webhook has no FlowGuard session. We accept a tenant only when Razorpay
 * sends it back in the payment/refund notes that FlowGuard supplied at payment
 * creation time. This prevents a signed event for one tenant being attributed
 * to another tenant.
 */
export function webhookOrganizationId(raw: RazorpayWebhook): string | undefined {
  for (const key of ["payment", "refund", "order"]) {
    const notes = entity(raw, key).notes;
    if (!isRecord(notes)) continue;
    const organizationId = notes.flowguard_organization_id;
    if (typeof organizationId === "string" && /^org_[A-Za-z0-9_-]{6,128}$/.test(organizationId)) return organizationId;
  }
  return undefined;
}

export function settlementEvents(organizationId: string, settlementId: string, createdAt: string, rows: unknown[]): CanonicalEvent[] {
  const lines = rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const paymentId = string(row, "payment_id");
    const gross = integer(row, "amount");
    if (!paymentId || gross === undefined) return [];
    return [{ paymentId, gross: money(gross), fee: money(integer(row, "fee") ?? 0), tax: money(integer(row, "tax") ?? 0), refund: money(integer(row, "refund_amount") ?? 0) }];
  });
  if (lines.length === 0) return [];
  return [canonical(organizationId, "SETTLEMENT_PROCESSED", `settlement:${settlementId}`, `settlement:${settlementId}`, createdAt, { settlementId, lines })];
}

function canonical(organizationId: string, type: CanonicalEvent["type"], id: string, sourceExternalId: string, occurredAt: string, payload: Record<string, unknown>): CanonicalEvent {
  return Object.freeze({ id: `rzp_live_${id}`, type, provenance: { organizationId, source: "RAZORPAY_LIVE", sourceExternalId, occurredAt, createdAt: new Date().toISOString() }, payload: Object.freeze(payload) });
}

function entity(raw: RazorpayWebhook, key: string): RazorpayEntity {
  if (!isRecord(raw.payload) || !isRecord(raw.payload[key]) || !isRecord(raw.payload[key].entity)) return {};
  return raw.payload[key].entity;
}
function string(record: RazorpayEntity, key: string): string | undefined { const value = record[key]; return typeof value === "string" && value.length > 0 ? value : undefined; }
function integer(record: RazorpayEntity, key: string): number | undefined { const value = record[key]; return Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function timestamp(value: unknown): string { return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : new Date().toISOString(); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
