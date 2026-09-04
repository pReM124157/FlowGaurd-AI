import test from "node:test";
import assert from "node:assert/strict";

// Mathematical state evaluator simulating the deterministic scroll engine
function evaluateReconState(progress: number) {
  if (progress < 0.15) {
    return {
      stage: 'HEADLINE_REVEAL',
      titleOpacity: 1 - progress / 0.15,
      amount: '₹50,000',
      feeVisible: false,
      taxVisible: false,
      expectedVisible: false,
      mismatchVisible: false,
      scanActive: false,
      lineageVisible: false
    };
  } else if (progress < 0.30) {
    return {
      stage: 'PAYMENT_CAPTURED',
      titleOpacity: 0,
      amount: '₹50,000',
      status: 'PAYMENT CAPTURED · ₹50,000',
      feeVisible: false,
      taxVisible: false,
      expectedVisible: false,
      mismatchVisible: false,
      scanActive: false,
      lineageVisible: false
    };
  } else if (progress < 0.42) {
    const p = (progress - 0.30) / 0.12;
    const currentVal = Math.round(50000 - p * 1000);
    return {
      stage: 'FEE_DETACHED',
      titleOpacity: 0,
      amount: `₹${currentVal.toLocaleString('en-IN')}`,
      status: 'GATEWAY PROCESSING · FEE DEDUCTED',
      feeVisible: true,
      taxVisible: false,
      expectedVisible: false,
      mismatchVisible: false,
      scanActive: false,
      lineageVisible: false
    };
  } else if (progress < 0.52) {
    const p = (progress - 0.42) / 0.10;
    const currentVal = Math.round(49000 - p * 180);
    return {
      stage: 'TAX_DETACHED',
      titleOpacity: 0,
      amount: `₹${currentVal.toLocaleString('en-IN')}`,
      status: 'TAX WITHHOLDING APPLIED',
      feeVisible: true,
      taxVisible: true,
      expectedVisible: false,
      mismatchVisible: false,
      scanActive: false,
      lineageVisible: false
    };
  } else if (progress < 0.65) {
    return {
      stage: 'EXPECTED_SETTLEMENT',
      titleOpacity: 0,
      amount: '₹48,820',
      status: 'EXPECTED SETTLEMENT · ₹48,820',
      feeVisible: true,
      taxVisible: true,
      expectedVisible: true,
      mismatchVisible: false,
      scanActive: false,
      lineageVisible: false
    };
  } else if (progress < 0.75) {
    return {
      stage: 'ACTUAL_CREDIT_RECEIVED',
      titleOpacity: 0,
      amount: '₹48,220',
      status: 'ACTUAL BANK CREDIT · ₹48,220',
      feeVisible: false,
      taxVisible: false,
      expectedVisible: true,
      mismatchVisible: false,
      scanActive: false,
      lineageVisible: false
    };
  } else if (progress < 0.85) {
    const p = (progress - 0.75) / 0.10;
    const varianceVal = Math.round(p * 600);
    return {
      stage: 'VARIANCE_EMERGED',
      titleOpacity: 0,
      amount: '₹48,220',
      varianceAmount: `₹${varianceVal}`,
      status: 'UNACCOUNTED FOR · VARIANCE DETECTED',
      feeVisible: false,
      taxVisible: false,
      expectedVisible: true,
      mismatchVisible: true,
      scanActive: true,
      lineageVisible: false
    };
  } else {
    return {
      stage: 'DETECTION_AND_LINEAGE',
      titleOpacity: 0,
      amount: '₹48,220',
      varianceAmount: '₹600',
      status: 'SETTLEMENT MISMATCH DETECTED',
      feeVisible: false,
      taxVisible: false,
      expectedVisible: true,
      mismatchVisible: true,
      scanActive: true,
      lineageVisible: true
    };
  }
}

test("Reconciliation Motion — Scroll Threshold Stage Mapping", async (t) => {
  await t.test("progress 0.05 evaluates to HEADLINE_REVEAL", () => {
    const state = evaluateReconState(0.05);
    assert.equal(state.stage, "HEADLINE_REVEAL");
    assert.equal(state.amount, "₹50,000");
    assert.ok(state.titleOpacity > 0);
  });

  await t.test("progress 0.20 evaluates to PAYMENT_CAPTURED (₹50,000)", () => {
    const state = evaluateReconState(0.20);
    assert.equal(state.stage, "PAYMENT_CAPTURED");
    assert.equal(state.amount, "₹50,000");
  });

  await t.test("progress 0.35 evaluates to FEE_DETACHED with smooth deduction", () => {
    const state = evaluateReconState(0.35);
    assert.equal(state.stage, "FEE_DETACHED");
    assert.equal(state.feeVisible, true);
    // 50000 - (0.05 / 0.12) * 1000 = approx 49583
    assert.match(state.amount, /^₹49,/);
  });

  await t.test("progress 0.47 evaluates to TAX_DETACHED with withholding", () => {
    const state = evaluateReconState(0.47);
    assert.equal(state.stage, "TAX_DETACHED");
    assert.equal(state.taxVisible, true);
    assert.match(state.amount, /^₹48,/);
  });

  await t.test("progress 0.60 evaluates to EXPECTED_SETTLEMENT (₹48,820)", () => {
    const state = evaluateReconState(0.60);
    assert.equal(state.stage, "EXPECTED_SETTLEMENT");
    assert.equal(state.amount, "₹48,820");
  });

  await t.test("progress 0.70 evaluates to ACTUAL_CREDIT_RECEIVED (₹48,220)", () => {
    const state = evaluateReconState(0.70);
    assert.equal(state.stage, "ACTUAL_CREDIT_RECEIVED");
    assert.equal(state.amount, "₹48,220");
  });

  await t.test("progress 0.80 evaluates to VARIANCE_EMERGED (₹600 count up)", () => {
    const state = evaluateReconState(0.80);
    assert.equal(state.stage, "VARIANCE_EMERGED");
    assert.equal(state.mismatchVisible, true);
    assert.equal(state.varianceAmount, "₹300"); // halfway through ₹600
  });

  await t.test("progress 0.92 evaluates to DETECTION_AND_LINEAGE with full ₹600 discrepancy", () => {
    const state = evaluateReconState(0.92);
    assert.equal(state.stage, "DETECTION_AND_LINEAGE");
    assert.equal(state.lineageVisible, true);
    assert.equal(state.varianceAmount, "₹600");
  });
});
