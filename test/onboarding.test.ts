import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { handleRequest } from "../src/server/api.ts";
import { resetAuditForTests } from "../src/server/audit.ts";
import { listOrganizationEvents, resetLiveStoreForTests } from "../src/server/live-store.ts";
import { resetMetricsForTests } from "../src/server/metrics.ts";
import { resetRateLimitsForTests } from "../src/server/rate-limit.ts";

const BASE = "http://flowguard.test";

beforeEach(() => {
  resetLiveStoreForTests();
  resetAuditForTests();
  resetMetricsForTests();
  resetRateLimitsForTests();
});

describe("gated financial onboarding", () => {
  it("starts empty live organizations at BUSINESS_PROFILE with no dashboard metrics", async () => {
    const me = await json(await authed("/api/me"));
    const overview = await authed("/api/overview");
    const body = await json(overview);

    assert.equal(me.dataLabel, "LIVE DATA");
    assert.equal(me.onboarding.stage, "BUSINESS_PROFILE");
    assert.equal(overview.status, 409);
    assert.equal(body.error.code, "FG_ONBOARDING_REQUIRED");
    assert.equal(listOrganizationEvents("org_empty").length, 0);
  });

  it("persists partial onboarding and resumes at the saved stage", async () => {
    const saved = await json(await post("/api/onboarding/business-profile", businessProfile()));
    const resumed = await json(await authed("/api/onboarding"));

    assert.equal(saved.onboarding.stage, "RISK_PREFERENCES");
    assert.equal(resumed.onboarding.stage, "RISK_PREFERENCES");
    assert.equal(resumed.onboarding.businessProfile.provenance, "USER_DECLARED");
    assert.equal(resumed.onboarding.businessProfile.value.organizationName, "Acme Retail Pvt Ltd");
  });

  it("keeps demo selection explicit and isolated from live onboarding", async () => {
    const demo = await json(await authed("/api/overview", { session: "fg_demo_owner" }));
    const live = await json(await authed("/api/onboarding"));

    assert.equal(demo.dataLabel, "DEMO DATA");
    assert.equal(live.dataLabel, "LIVE DATA");
    assert.equal(live.onboarding.stage, "BUSINESS_PROFILE");
    assert.equal(listOrganizationEvents("org_empty").length, 0);
  });

  it("denies cross-tenant onboarding/dashboard access", async () => {
    const response = await authed("/api/onboarding?organizationId=org_company_a");
    const body = await json(response);

    assert.equal(response.status, 404);
    assert.equal(body.error.code, "FG_NOT_FOUND");
  });

  it("distinguishes USER_DECLARED configuration from ACTUAL financial data", async () => {
    await post("/api/onboarding/business-profile", businessProfile());
    await post("/api/onboarding/risk-preferences", riskPreferences());
    const profile = await json(await authed("/api/onboarding"));
    const validation = await json(await post("/api/onboarding/validate", {}));

    assert.equal(profile.onboarding.businessProfile.provenance, "USER_DECLARED");
    assert.equal(validation.readinessAudit.metricReadiness.availableCash.status, "INSUFFICIENT");
    assert.equal(validation.readinessAudit.metricReadiness.availableCash.reason, "No reliable bank cash source has been imported.");
  });

  it("completes onboarding without a reliable cash source and keeps metrics source-gated", async () => {
    await completeProfileAndRisk();
    await post("/api/onboarding/data-connections", { razorpay: "SKIPPED", bank: "NOT_CONNECTED", receivables: "SKIPPED" });
    await post("/api/onboarding/validate", {});
    const result = await json(await post("/api/onboarding/initial-calculation", {}));
    const overview = await authed("/api/overview");

    assert.equal(result.onboarding.stage, "READY");
    assert.equal(overview.status, 200);
    assert.equal(result.assessment.availableCash.value, "Not enough data");
  });

  it("allows legacy completed-questionnaire records to open the dashboard", async () => {
    await completeProfileAndRisk();
    await post("/api/onboarding/data-connections", { razorpay: "SKIPPED", bank: "NOT_CONNECTED", receivables: "SKIPPED" });
    const overview = await authed("/api/overview");

    assert.equal(overview.status, 200);
  });

  it("transitions to READY after reliable bank data and serves first assessment", async () => {
    await completeProfileAndRisk();
    await post("/api/ingest/bank-csv", {
      rows: [{ date: "2026-08-23T13:00:00.000Z", description: "Opening bank balance", amountMinor: 900000, type: "CREDIT", reference: "ONBOARDING-BANK-1" }],
    });
    await post("/api/onboarding/data-connections", { razorpay: "SKIPPED", bank: "IMPORTED", receivables: "SKIPPED" });
    const audit = await json(await post("/api/onboarding/validate", {}));
    const result = await json(await post("/api/onboarding/initial-calculation", {}));
    const overview = await json(await authed("/api/overview"));

    assert.equal(audit.readinessAudit.readyForDashboard, true);
    assert.equal(result.onboarding.stage, "READY");
    assert.equal(result.assessment.availableCash.state, "ACTUAL");
    assert.equal(result.assessment.upcomingObligations[0].amount.state, "USER_DECLARED");
    assert.equal(overview.metrics.availableCash.amountMinor, 900000);
    assert.equal(overview.metrics.availableCash.state, "ACTUAL");
  });
});

async function completeProfileAndRisk() {
  await post("/api/onboarding/business-profile", businessProfile());
  await post("/api/onboarding/risk-preferences", riskPreferences());
}

function businessProfile() {
  return {
    organizationName: "Acme Retail Pvt Ltd",
    industryType: "Retail commerce",
    timezone: "Asia/Kolkata",
    currency: "INR",
    payrollAmountMinor: 500000,
    payrollSchedule: "2026-08-29",
    minimumLiquidityBufferMinor: 200000,
    receivableTermsDays: 30,
    recurringObligations: [{ label: "Cloud tools", amountMinor: 40000, cadence: "MONTHLY" }],
    financingObligations: [{ lender: "Working capital lender", amountMinor: 120000, cadence: "MONTHLY" }],
    notificationPreferences: { inAppEnabled: true, emailEnabled: true, minimumSeverity: "HIGH" },
  };
}

function riskPreferences() {
  return {
    lateReceivableProbability: 0.6,
    materialAmountMinor: 100000,
    feeRateUpperBound: 0.08,
    concentrationThreshold: 0.5,
  };
}

async function post(path: string, body: unknown) {
  return authed(path, { method: "POST", body: JSON.stringify(body) });
}

async function authed(path: string, options: { method?: string; body?: string; session?: string } = {}) {
  return handleRequest(
    new Request(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-flowguard-session": options.session ?? "fg_empty_owner",
      },
      body: options.body,
    }),
  );
}

async function json(response: Response) {
  return response.json() as Promise<any>;
}
