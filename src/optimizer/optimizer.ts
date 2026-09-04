import { money, type Money } from "../domain/money.ts";

export type CandidateAction = Readonly<{
  id: string;
  kind: "COLLECT_INVOICE" | "RESCHEDULE_VENDOR" | "REDUCE_DISCRETIONARY_SPEND" | "BORROW";
  impact: Money;
  cost: Money;
  eligible: boolean;
  hardConstraintReason?: string;
}>;

export type OptimizedPlan = Readonly<{
  status: "PLAN_FOUND" | "NO_SAFE_PLAN_FOUND";
  selectedActions: CandidateAction[];
  expectedMinimumCash: Money;
  objectiveValueMinor: number;
  rejectedActions: CandidateAction[];
  optimizerVersion: "CONSTRAINT_SEARCH_V1";
}>;

export function optimizeCashPlan(predictedDeficit: Money, currentMinimumCash: Money, actions: CandidateAction[]): OptimizedPlan {
  const eligible = actions.filter((action) => action.eligible);
  const rejectedActions = actions.filter((action) => !action.eligible);
  const selectedActions: CandidateAction[] = [];
  let remainingDeficit = Math.max(0, predictedDeficit.amountMinor);

  for (const action of eligible.sort((left, right) => score(right) - score(left))) {
    if (remainingDeficit <= 0 && action.kind !== "REDUCE_DISCRETIONARY_SPEND") continue;
    selectedActions.push(action);
    remainingDeficit -= action.impact.amountMinor;
  }

  const totalImpact = selectedActions.reduce((sum, action) => sum + action.impact.amountMinor, 0);
  const totalCost = selectedActions.reduce((sum, action) => sum + action.cost.amountMinor, 0);
  const expectedMinimumCash = money(currentMinimumCash.amountMinor + totalImpact - totalCost, currentMinimumCash.currency);
  const objectiveValueMinor = Math.max(0, -expectedMinimumCash.amountMinor) + totalCost;

  return Object.freeze({
    status: expectedMinimumCash.amountMinor >= 0 ? "PLAN_FOUND" : "NO_SAFE_PLAN_FOUND",
    selectedActions,
    expectedMinimumCash,
    objectiveValueMinor,
    rejectedActions,
    optimizerVersion: "CONSTRAINT_SEARCH_V1",
  });
}

function score(action: CandidateAction): number {
  return action.impact.amountMinor - action.cost.amountMinor;
}
