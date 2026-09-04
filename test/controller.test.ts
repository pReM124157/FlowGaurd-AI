import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerFinanceQuestion, type FinancialEvidenceContext } from "../src/agent/controller.ts";

const declaredContext: FinancialEvidenceContext = {
  declaredContext: [
    "Organization context: Nexa AI (Other), USER_DECLARED.",
    "Declared customer payment terms: 2 days (USER_DECLARED).",
    "Declared available cash: ₹10,00,000 (USER_DECLARED).",
    "Declared 30-day obligations: ₹10,000 (USER_DECLARED).",
    "Declared minimum liquidity buffer: ₹10,000 (USER_DECLARED).",
  ],
  verifiedFindings: [],
  calculatedFindings: ["Declared 30-day cash position: ₹9,90,000 (ESTIMATED from USER_DECLARED inputs; no unprovided inflows assumed)."],
  activeRisks: [],
};

describe("financial answer presentation", () => {
  it("turns declared context into a customer-facing summary", () => {
    const result = answerFinanceQuestion({ organizationId: "org-1" } as never, "org-1", "Summarize my saved financial inputs", declaredContext);

    assert.match(result.answer, /₹10,00,000/);
    assert.match(result.answer, /estimated 30-day cash position/i);
    assert.doesNotMatch(result.answer, /USER_DECLARED|Organization context|Declared available cash/i);
  });

  it("never includes internal context in a greeting", () => {
    const result = answerFinanceQuestion({ organizationId: "org-1" } as never, "org-1", "hi", declaredContext);

    assert.doesNotMatch(result.answer, /USER_DECLARED|Organization context/i);
  });
});
