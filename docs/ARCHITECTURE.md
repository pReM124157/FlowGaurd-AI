# Architecture

## Logical Architecture

- Finance Control UI: future Next.js/React interface.
- API Layer: future auth, validation, RBAC, rate limiting, and audit logging.
- Payment Data Adapter: canonicalizes gateway/order/refund/settlement events.
- Finance Ledger Engine: immutable event stream and deterministic state projection.
- Reconciliation Engine: matches payment, fee, tax, refund, settlement, and bank credit records.
- Forecast/Risk/Scenario/Optimization Engines: gated later phases.
- Controller Agent: natural-language interface over trusted tools only.

## Current Executable Foundation

- `src/domain`: money, event, and shared financial types.
- `src/ledger`: deterministic event projector.
- `src/reconciliation`: reconciliation, metrics, and lineage.
- `src/agent`: safe tool interface scaffold.
- `test`: node test suite covering Phase 2 and Phase 3 foundations.
