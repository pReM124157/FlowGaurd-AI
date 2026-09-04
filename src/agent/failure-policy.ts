export type AgentFailureKind =
  | "MISSING_DATA"
  | "STALE_DATA"
  | "TOOL_TIMEOUT"
  | "TOOL_FAILURE"
  | "OPTIMIZER_NO_SOLUTION"
  | "FORECAST_FAILURE"
  | "MALFORMED_USER_INPUT"
  | "UNSUPPORTED_QUESTION";

export type AgentFailureResponse = Readonly<{
  kind: AgentFailureKind;
  answer: string;
  authoritativeNumbers: [];
  safe: true;
}>;

export function safeAgentFailure(kind: AgentFailureKind): AgentFailureResponse {
  const answerByKind: Record<AgentFailureKind, string> = {
    MISSING_DATA: "I cannot determine this from the available financial data.",
    STALE_DATA: "I cannot give confident advice because critical financial data is stale.",
    TOOL_TIMEOUT: "The required financial tool timed out. No authoritative answer was produced.",
    TOOL_FAILURE: "The required financial tool failed. No authoritative answer was produced.",
    OPTIMIZER_NO_SOLUTION: "NO SAFE PLAN FOUND under the current constraints.",
    FORECAST_FAILURE: "The forecast could not be calculated. No forecast-based advice was produced.",
    MALFORMED_USER_INPUT: "I could not understand the request. Please ask a specific finance-control question.",
    UNSUPPORTED_QUESTION: "I cannot determine this from the available financial data and approved tools.",
  };

  return Object.freeze({
    kind,
    answer: answerByKind[kind],
    authoritativeNumbers: [],
    safe: true,
  });
}
