import type { LedgerState } from "../domain/types.ts";
import { runAgentTool, type AgentToolName } from "./tools.ts";

export type ControllerAnswer = Readonly<{
  answer: string;
  intent: "CASH" | "FORECAST" | "RECEIVABLES" | "RECONCILIATION" | "RISK" | "GENERAL" | "REJECTED";
  toolCalls: AgentToolName[];
  auditLog: ReadonlyArray<{
    organizationId: string;
    tool: AgentToolName;
    status: "OK" | "REJECTED";
  }>;
}>;

export type FinancialEvidenceContext = Readonly<{
  declaredContext: readonly string[];
  verifiedFindings: readonly string[];
  calculatedFindings: readonly string[];
  activeRisks: readonly string[];
}>;

export function answerFinanceQuestion(state: LedgerState, organizationId: string, question: string, context?: FinancialEvidenceContext): ControllerAnswer {
  if (organizationId !== state.organizationId) {
    return rejected(organizationId, "I cannot answer because the request is outside the authorized organization.");
  }

  if (looksLikePromptInjection(question)) {
    return rejected(organizationId, "I cannot follow instructions that attempt to bypass financial controls.");
  }

  if (isGreeting(question)) {
    return {
      answer: context?.declaredContext.length
        ? "Hi. I have your saved financial inputs ready. Ask me about cash, obligations, payment timing, risk, or what to connect next."
        : "Hi. I can help you review cash, obligations, payment timing, risk, or the next financial source to connect.",
      intent: "GENERAL",
      toolCalls: [],
      auditLog: [],
    };
  }

  const intent = classifyQuestion(question);
  if (intent === "CASH") {
    const declaredCashContext = [...(context?.declaredContext ?? []), ...(context?.calculatedFindings ?? [])];
    // An empty live ledger must not be presented as an actual zero balance.
    // Before a source is connected, answer only from the user's declared context.
    if (context && context.verifiedFindings.length === 0 && declaredCashContext.length > 0) {
      return {
        answer: declaredFinancialSummary(context, intent),
        intent,
        toolCalls: [],
        auditLog: [],
      };
    }
    const cash = runAgentTool(state, { organizationId, tool: "get_cash_position" }) as {
      actualBankCash: { amountMinor: number };
      pendingSettlements: { amountMinor: number };
      expectedReceivables: { amountMinor: number };
    };
    return {
      answer: `Calculated from ledger tools: Your connected ledger shows ${formatMinorUnits(cash.actualBankCash.amountMinor)} (${cash.actualBankCash.amountMinor} minor units) in bank cash, ` +
        `${formatMinorUnits(cash.pendingSettlements.amountMinor)} in pending settlements, and ` +
        `${formatMinorUnits(cash.expectedReceivables.amountMinor)} in expected receivables.`,
      intent,
      toolCalls: ["get_cash_position"],
      auditLog: [{ organizationId, tool: "get_cash_position", status: "OK" }],
    };
  }

  if (intent === "RECONCILIATION") {
    const exceptions = runAgentTool(state, { organizationId, tool: "get_reconciliation_exceptions" }) as unknown[];
    return {
      answer: `Reconciliation evidence: ${exceptions.length} exception(s) require investigation.`,
      intent,
      toolCalls: ["get_reconciliation_exceptions"],
      auditLog: [{ organizationId, tool: "get_reconciliation_exceptions", status: "OK" }],
    };
  }

  const findings = intent === "FORECAST" ? context?.calculatedFindings
    : intent === "RECEIVABLES" ? context?.verifiedFindings.filter((finding) => /receivable|invoice/i.test(finding))
      : intent === "RISK" ? context?.activeRisks
        : [...(context?.declaredContext ?? []), ...(context?.verifiedFindings ?? []), ...(context?.calculatedFindings ?? []), ...(context?.activeRisks ?? [])];
  const hasDeclaredValues = Boolean(context && [...context.declaredContext, ...context.calculatedFindings].length);
  return {
    answer: hasDeclaredValues && context?.verifiedFindings.length === 0
      ? declaredFinancialSummary(context, intent)
      : findings?.length
        ? customerFacingFinding(intent, findings)
        : "I do not yet have enough saved financial inputs or connected financial data to answer that reliably.",
    intent,
    toolCalls: [],
    auditLog: [],
  };
}

function declaredFinancialSummary(context: FinancialEvidenceContext | undefined, intent: ControllerAnswer["intent"]): string {
  const lines = [...(context?.declaredContext ?? []), ...(context?.calculatedFindings ?? [])];
  const cash = contextValue(lines, "Declared available cash: ");
  const obligations = contextValue(lines, "Declared 30-day obligations: ");
  const buffer = contextValue(lines, "Declared minimum liquidity buffer: ");
  const position = contextValue(lines, "Declared 30-day cash position: ");
  const paymentTerms = contextValue(lines, "Declared customer payment terms: ");

  const summary: string[] = [];
  if (intent === "RECEIVABLES") {
    summary.push(paymentTerms
      ? `You set customer payment terms at ${paymentTerms}. I do not yet have connected invoice data to identify specific overdue receivables.`
      : "I do not yet have connected invoice data to identify specific receivables.");
  } else if (intent === "RISK") {
    summary.push("I do not yet have source-verified risk signals. Based on the financial inputs you provided:");
  }

  if (cash) summary.push(`you reported ${cash} in available cash.`);
  if (obligations) summary.push(`Expected obligations over the next 30 days are ${obligations}.`);
  if (position) summary.push(`Your estimated 30-day cash position is ${position}, before any unreported inflows or outflows.`);
  if (buffer) summary.push(`Your minimum cash buffer is ${buffer}.`);
  if (!summary.length) return "I do not yet have enough saved financial inputs to answer that reliably.";

  summary.push("These figures are based on information you provided and have not yet been verified against a connected financial source.");
  return summary.join(" ");
}

function contextValue(lines: readonly string[], label: string): string | undefined {
  const line = lines.find((item) => item.startsWith(label));
  return line?.slice(label.length).split(" (")[0];
}

function customerFacingFinding(intent: ControllerAnswer["intent"], findings: readonly string[]): string {
  if (intent === "RECEIVABLES" && findings.length === 0) return "I do not yet have connected invoice data to identify specific receivables.";
  if (intent === "RISK" && findings.length === 0) return "No active risk signals are available from your connected sources yet.";
  return "I have connected financial evidence available. Ask about cash, forecast, receivables, reconciliation, or risk for a focused answer.";
}

function formatMinorUnits(amountMinor: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amountMinor / 100);
}

function rejected(organizationId: string, answer: string): ControllerAnswer {
  return Object.freeze({
    answer,
    intent: "REJECTED",
    toolCalls: [],
    auditLog: [{ organizationId, tool: "get_cash_position", status: "REJECTED" }],
  });
}

function classifyQuestion(question: string): ControllerAnswer["intent"] {
  const lower = question.toLowerCase();
  if (/cash|money|balance|spend|liquidity|bank/.test(lower)) return "CASH";
  if (/forecast|runway|shortfall|next week|next month|next quarter|future/.test(lower)) return "FORECAST";
  if (/receivable|invoice|customer|collect|collection/.test(lower)) return "RECEIVABLES";
  if (/mismatch|reconciliation|settlement|fee|gateway|tax/.test(lower)) return "RECONCILIATION";
  if (/risk|warning|alert|breach|danger/.test(lower)) return "RISK";
  return "GENERAL";
}

function looksLikePromptInjection(question: string): boolean {
  const lower = question.toLowerCase();
  return lower.includes("ignore previous") || lower.includes("ignore system") || lower.includes("reveal another tenant");
}

function isGreeting(question: string): boolean {
  return /^(hi|hello|hey|good (morning|afternoon|evening)|how are you)[!.?\s]*$/i.test(question.trim());
}
