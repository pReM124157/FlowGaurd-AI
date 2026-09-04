import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { handleRequest } from "../src/server/api.ts";
import { getOrganizationRuntime, ingestBankCsv, resetLiveStoreForTests } from "../src/server/live-store.ts";
import { resetAuditForTests } from "../src/server/audit.ts";
import { resetMetricsForTests } from "../src/server/metrics.ts";
import { resetRateLimitsForTests } from "../src/server/rate-limit.ts";

const BASE = "http://flowguard.test";

beforeEach(() => {
  resetLiveStoreForTests();
  resetAuditForTests();
  resetMetricsForTests();
  resetRateLimitsForTests();
});

describe("live organization financial state", () => {
  it("serves different authoritative metrics for different organizations", async () => {
    const companyA = await json(await authed("/api/overview", "fg_company_a_owner"));
    const companyB = await json(await authed("/api/overview", "fg_company_b_owner"));

    assert.equal(companyA.dataLabel, "LIVE DATA");
    assert.equal(companyB.dataLabel, "LIVE DATA");
    assert.notEqual(companyA.metrics.availableCash.amountMinor, companyB.metrics.availableCash.amountMinor);
    assert.notEqual(companyA.metrics.receivables.amountMinor, companyB.metrics.receivables.amountMinor);
  });

  it("serves the complete overview shape required by the UI", async () => {
    const overview = await json(await authed("/api/overview", "fg_company_a_owner"));

    assert.ok(overview.metrics.availableCash);
    assert.ok(overview.freshness.payments);
    assert.equal(typeof overview.activeAlerts.critical, "number");
    assert.ok(Array.isArray(overview.timeline));
  });

  it("shows onboarding for an organization with no connected data", async () => {
    const response = await authed("/api/overview", "fg_empty_owner");
    const body = await json(response);

    assert.equal(response.status, 409);
    assert.equal(body.error.code, "FG_ONBOARDING_REQUIRED");
    assert.equal(body.onboarding.stage, "BUSINESS_PROFILE");
  });

  it("ingests Razorpay-style mock data and recalculates cash independently", async () => {
    const beforeA = await json(await authed("/api/overview", "fg_company_a_owner"));
    const beforeB = await json(await authed("/api/overview", "fg_company_b_owner"));

    await authed("/api/ingest/razorpay-mock", "fg_company_a_owner", {
      method: "POST",
      body: JSON.stringify({ orderId: "A-NEW-ORDER", paymentId: "A-NEW-PAY", customerId: "CUS-LIVE", amountMinor: 200000, occurredAt: "2026-08-23T12:00:00.000Z" }),
    });

    const afterA = await json(await authed("/api/payments", "fg_company_a_owner"));
    const afterB = await json(await authed("/api/overview", "fg_company_b_owner"));

    assert.ok(afterA.payments.some((payment: { id: string }) => payment.id === "A-NEW-PAY"));
    assert.equal(afterB.metrics.availableCash.amountMinor, beforeB.metrics.availableCash.amountMinor);
    assert.equal(beforeA.metrics.availableCash.amountMinor, getOrganizationRuntime("org_company_a").cash.actualBankCash.amountMinor);
  });

  it("imports bank CSV data and recalculates cash", async () => {
    const before = await json(await authed("/api/cash-position", "fg_company_a_owner"));
    const response = await authed("/api/ingest/bank-csv", "fg_company_a_owner", {
      method: "POST",
      body: JSON.stringify({ rows: [{ date: "2026-08-23T13:00:00.000Z", description: "Settlement received", amountMinor: 200000, type: "CREDIT", reference: "A-LIVE-BANK", settlementId: "org_company_a-SET-2" }] }),
    });
    const after = await json(response);

    assert.equal(after.cash.actualBankCash.amountMinor, before.actualBankCash.amountMinor + 200000);
  });

  it("imports receivables and changes receivable state", async () => {
    const before = await json(await authed("/api/receivables", "fg_company_a_owner"));
    const response = await authed("/api/ingest/invoices", "fg_company_a_owner", {
      method: "POST",
      body: JSON.stringify({ rows: [{ customer: "New Customer", invoiceAmountMinor: 300000, issueDate: "2026-08-23T00:00:00.000Z", dueDate: "2026-09-15T00:00:00.000Z", status: "OPEN", reference: "A-LIVE-INV" }] }),
    });
    const after = await json(response);

    assert.equal(after.receivables.length, before.invoices.length + 1);
  });
});

describe("early-warning alerts and notifications", () => {
  it("creates deterministic alerts and deduplicates repeated evaluation", () => {
    const first = getOrganizationRuntime("org_company_b");
    const second = getOrganizationRuntime("org_company_b");

    assert.ok(first.alerts.length > 0);
    assert.equal(new Set(first.alerts.map((alert) => alert.fingerprint)).size, first.alerts.length);
    assert.equal(second.alerts.length, first.alerts.length);
    assert.equal(second.notifications.length, first.notifications.length);
  });

  it("queues notifications for material alert transitions", () => {
    const runtime = getOrganizationRuntime("org_company_b");

    assert.ok(runtime.notifications.length > 0);
    assert.ok(runtime.notifications.every((notification) => notification.organizationId === "org_company_b"));
  });

  it("resolves alerts when fresh live data removes the risk condition", () => {
    const before = getOrganizationRuntime("org_company_b");

    assert.ok(before.alerts.some((alert) => alert.riskType === "LOW_LIQUIDITY" && alert.lifecycleStatus === "OPEN"));

    const after = ingestBankCsv("org_company_b", [
      {
        date: "2026-08-23T14:00:00.000Z",
        description: "Emergency bank credit",
        amountMinor: 1000000,
        type: "CREDIT",
        reference: "B-RECOVERY-CREDIT",
      },
    ]);

    assert.ok(after.alerts.some((alert) => alert.riskType === "LOW_LIQUIDITY" && alert.lifecycleStatus === "RESOLVED"));
  });

  it("keeps alerts and notifications tenant-isolated", async () => {
    const companyBAlerts = await json(await authed("/api/alerts", "fg_company_b_owner"));
    const companyANotifications = await json(await authed("/api/notifications", "fg_company_a_owner"));

    assert.ok(companyBAlerts.alerts.every((alert: { organizationId: string }) => alert.organizationId === "org_company_b"));
    assert.ok(companyANotifications.notifications.every((notification: { organizationId: string }) => notification.organizationId === "org_company_a"));
  });
});

describe("live-data security and no static UI financial constants", () => {
  it("does not leak Company B metrics through Company A tenant", async () => {
    const response = await authed("/api/alerts?organizationId=org_company_b", "fg_company_a_owner");
    const body = await json(response);

    assert.equal(response.status, 404);
    assert.equal(body.error.code, "FG_NOT_FOUND");
  });

  it("uses organization payment id for lineage instead of a fixed demo id", async () => {
    const payments = await json(await authed("/api/payments", "fg_company_a_owner"));
    const firstPaymentId = payments.payments[0].id;
    const lineage = await json(await authed(`/api/payments/${encodeURIComponent(firstPaymentId)}/lineage`, "fg_company_a_owner"));

    assert.ok(lineage.lineage.includes(firstPaymentId));
    assert.doesNotMatch(firstPaymentId, /^PAY-8821$/);
  });
});

async function authed(path: string, session: string, options: { method?: string; body?: string } = {}) {
  return handleRequest(
    new Request(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-flowguard-session": session,
      },
      body: options.body,
    }),
  );
}

async function json(response: Response) {
  return response.json() as Promise<any>;
}
