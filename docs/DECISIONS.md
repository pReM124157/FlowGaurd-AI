# Architecture Decision Record

## ADR-001: TypeScript-first monorepo

Decision: Use a TypeScript-first implementation with pure domain modules for money, ledger, reconciliation, forecasting contracts, scenarios, optimizer contracts, and agent tools.

Rationale: Buildathon speed improves when UI/API/domain contracts share types. Deterministic finance code remains testable without external services.

Consequence: ML-heavy work may use Python only where evaluation materially benefits.

## ADR-002: Integer minor units for money

Decision: Store and calculate authoritative amounts as integer minor units with explicit currency.

Rationale: Binary floating point is unsafe for money.

Consequence: All APIs expose `amountMinor` and `currency`.

## ADR-003: Gated implementation

Decision: Phase status is documented in `docs/PHASE_STATUS.md`, with evidence stored under `docs/evidence/phase-*`.

Rationale: The buildathon prompt requires evidence before progression.
