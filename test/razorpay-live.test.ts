import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { settlementEvents, verifyRazorpayWebhook, webhookOrganizationId, webhookToCanonicalEvents } from "../src/server/razorpay-live.ts";
import { handleRequest } from "../src/server/api.ts";

describe("Razorpay live ingestion boundary", () => {
  it("validates the raw webhook HMAC without accepting altered payloads", () => {
    const raw = '{"event":"payment.captured"}';
    const signature = createHmac("sha256", "webhook-secret").update(raw).digest("hex");

    assert.equal(verifyRazorpayWebhook(raw, signature, "webhook-secret"), true);
    assert.equal(verifyRazorpayWebhook(`${raw} `, signature, "webhook-secret"), false);
    assert.equal(verifyRazorpayWebhook(raw, null, "webhook-secret"), false);
  });

  it("maps captured payments and refunds to tenant-scoped canonical events", () => {
    const payment = webhookToCanonicalEvents("org_a", "evt_payment", {
      event: "payment.captured",
      created_at: 1_700_000_000,
      payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 12_500, customer_id: "cust_1" } } },
    });
    const refund = webhookToCanonicalEvents("org_a", "evt_refund", {
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 500 } } },
    });

    assert.deepEqual(payment.map((event) => event.type), ["ORDER_CREATED", "PAYMENT_CAPTURED"]);
    assert.equal(payment[1].provenance.organizationId, "org_a");
    assert.equal(payment[1].provenance.source, "RAZORPAY_LIVE");
    assert.equal(refund[0].type, "REFUND_PROCESSED");
  });

  it("only resolves a tenant from FlowGuard-owned Razorpay notes", () => {
    assert.equal(webhookOrganizationId({ payload: { payment: { entity: { notes: { flowguard_organization_id: "org_safe_tenant" } } } } }), "org_safe_tenant");
    assert.equal(webhookOrganizationId({ payload: { payment: { entity: { notes: { organization_id: "org_other" } } } } }), undefined);
  });

  it("only creates a settlement when reconciliation lines are available", () => {
    assert.deepEqual(settlementEvents("org_a", "setl_empty", "2026-09-03T00:00:00.000Z", []), []);
    const events = settlementEvents("org_a", "setl_1", "2026-09-03T00:00:00.000Z", [{ payment_id: "pay_1", amount: 10_000, fee: 200, tax: 36, refund_amount: 500 }]);
    assert.equal(events[0].type, "SETTLEMENT_PROCESSED");
    assert.equal((events[0].payload.lines as Array<{ fee: { amountMinor: number } }>)[0].fee.amountMinor, 200);
  });

  it("accepts one signed webhook and rejects duplicate or unsigned delivery", async () => {
    const secret = "webhook-test-secret";
    const originalSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = secret;
    const raw = JSON.stringify({
      event: "payment.captured",
      created_at: 1_700_000_000,
      payload: { payment: { entity: { id: "pay_hook_1", order_id: "order_hook_1", amount: 25_000, notes: { flowguard_organization_id: "org_webhook_test" } } } },
    });
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    const request = () => new Request("http://flowguard.test/webhooks/razorpay", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_webhook_test_1" }, body: raw });

    try {
      assert.equal((await handleRequest(request())).status, 200);
      const duplicate = await handleRequest(request());
      assert.equal(duplicate.status, 200);
      assert.equal((await duplicate.json() as { duplicate: boolean }).duplicate, true);
      const invalid = await handleRequest(new Request("http://flowguard.test/webhooks/razorpay", { method: "POST", headers: { "x-razorpay-event-id": "evt_webhook_test_invalid" }, body: raw }));
      assert.equal(invalid.status, 401);
    } finally {
      if (originalSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
      else process.env.RAZORPAY_WEBHOOK_SECRET = originalSecret;
    }
  });
});
