# Test Strategy

## Finance Foundation

Tests must cover:

- duplicate webhook/import;
- out-of-order events;
- partial refund;
- multiple refunds;
- settlement with multiple payments;
- fee/tax deduction;
- bank credit mismatch;
- late invoice;
- partial invoice payment;
- duplicate bank import;
- timezone boundary;
- currency mismatch rejection;
- negative/invalid amount rejection.

## Later Gates

- Forecasting: temporal splits, no leakage, baseline comparison, uncertainty.
- Receivables: leakage audit, calibration, explanation traceability.
- Scenario: immutable production ledger, reproducible seed.
- Optimizer: hard constraints never violated.
- Agent: no fabricated numbers, no cross-tenant leakage, prompt injection rejection.
