import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getOnboardingRecord, resetOnboardingForTests, restoreOnboardingRecord } from "../src/server/onboarding.ts";

describe("persisted Supabase onboarding", () => {
  it("restores declared tenant context rather than only its stage", () => {
    resetOnboardingForTests();
    restoreOnboardingRecord("org_resume", {
      stage: "DATA_VALIDATION",
      updated_at: "2026-09-02T00:00:00.000Z",
      profile: {
        provenance: "USER_DECLARED",
        declaredAt: "2026-09-01T00:00:00.000Z",
        value: { organizationName: "Saved Company", currency: "INR" },
      },
      risk_preferences: {
        provenance: "USER_DECLARED",
        value: { materialAmountMinor: 100000 },
      },
      data_connections: {
        provenance: "USER_DECLARED",
        value: { bank: "NOT_CONNECTED" },
      },
    });

    const record = getOnboardingRecord("org_resume");
    assert.equal(record.stage, "DATA_VALIDATION");
    assert.equal(record.businessProfile?.provenance, "USER_DECLARED");
    assert.equal(record.businessProfile?.value.organizationName, "Saved Company");
    assert.equal(record.riskPreferences?.value.materialAmountMinor, 100000);
    assert.equal(record.dataConnections?.value.bank, "NOT_CONNECTED");
  });
});
