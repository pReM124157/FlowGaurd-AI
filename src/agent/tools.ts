import type { LedgerState } from "../domain/types.ts";
import { getCashPosition } from "../ledger/cash-position.ts";
import { reconcileSettlements, tracePayment } from "../reconciliation/reconcile.ts";

export type AgentToolName = "get_cash_position" | "get_reconciliation_exceptions" | "trace_payment";

export type AgentToolRequest = Readonly<{
  organizationId: string;
  tool: AgentToolName;
  input?: Record<string, unknown>;
}>;

export function runAgentTool(state: LedgerState, request: AgentToolRequest) {
  if (request.organizationId !== state.organizationId) {
    throw new Error("Cross-tenant tool request rejected");
  }

  switch (request.tool) {
    case "get_cash_position":
      return getCashPosition(state);
    case "get_reconciliation_exceptions":
      return reconcileSettlements(state).filter((result) => result.status !== "MATCHED");
    case "trace_payment": {
      const paymentId = request.input?.paymentId;
      if (typeof paymentId !== "string") throw new Error("paymentId is required");
      return tracePayment(state, paymentId);
    }
    default:
      assertNever(request.tool);
  }
}

export function sanitizeUntrustedText(value: string): string {
  return value.replace(/[<>]/g, "").slice(0, 500);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled tool: ${value}`);
}
