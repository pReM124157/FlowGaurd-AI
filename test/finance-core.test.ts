import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addMoney, money, subtractMoney } from "../src/domain/money.ts";
import { getCashPosition } from "../src/ledger/cash-position.ts";
import { replayLedger } from "../src/ledger/projector.ts";
import { baseEvents, event, ORG } from "./fixtures.ts";

describe("money", () => {
  it("uses safe integer minor units and rejects unsafe amounts", () => {
    assert.deepEqual(addMoney(money(100), money(25)), money(125));
    assert.deepEqual(subtractMoney(money(100), money(25)), money(75));
    assert.throws(() => money(1.23), /safe integer/);
  });
});

describe("ledger replay", () => {
  it("reconstructs the same state from ordered or out-of-order events", () => {
    const events = baseEvents();
    const ordered = replayLedger(ORG, events);
    const shuffled = replayLedger(ORG, [...events].reverse());

    assert.equal(ordered.payments.get("PAY-8821")?.status, "CAPTURED");
    assert.equal(shuffled.payments.get("PAY-8821")?.status, "CAPTURED");
    assert.deepEqual(getCashPosition(ordered), getCashPosition(shuffled));
  });

  it("deduplicates repeated external events and event ids", () => {
    const events = baseEvents();
    const duplicateSource = {
      ...events[5],
      id: "evt_duplicate_different_transport",
    };
    const state = replayLedger(ORG, [...events, events[5], duplicateSource]);

    assert.equal(state.bankTransactions.size, 1);
    assert.equal(getCashPosition(state).actualBankCash.amountMinor, 1652800);
  });

  it("rejects invalid money and cross-tenant events", () => {
    assert.throws(
      () =>
        replayLedger(ORG, [
          event("PAYMENT_CAPTURED", "bad_negative_payment", {
            paymentId: "PAY-BAD",
            orderId: "ORD-BAD",
            amount: money(-1),
          }),
        ]),
      /cannot be negative/,
    );

    const [valid] = baseEvents();
    const crossTenant = {
      ...valid,
      id: "evt_cross_tenant",
      provenance: {
        ...valid.provenance,
        organizationId: "org_other",
        sourceExternalId: "cross_tenant",
      },
    };
    assert.throws(() => replayLedger(ORG, [crossTenant]), /Cross-organization/);
  });

  it("keeps actual, pending, and forecast cash state separate", () => {
    const state = replayLedger(ORG, baseEvents());
    const cash = getCashPosition(state);

    assert.equal(cash.actualBankCash.amountMinor, 1652800);
    assert.equal(cash.pendingSettlements.amountMinor, 0);
    assert.equal(cash.expectedReceivables.amountMinor, 400000);
    assert.equal(cash.labels.actualBankCash, "ACTUAL");
    assert.equal(cash.labels.expectedReceivables, "FORECAST");
  });

  it("supports partial invoice payment without marking predicted cash as actual", () => {
    const state = replayLedger(ORG, baseEvents());
    const invoice = state.invoices.get("INV-204");

    assert.equal(invoice?.amount.amountMinor, 680000);
    assert.equal(invoice?.paidAmount.amountMinor, 280000);
    assert.equal(getCashPosition(state).expectedReceivables.amountMinor, 400000);
  });
});
