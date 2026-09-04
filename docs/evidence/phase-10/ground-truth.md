# Phase 10 Ground Truth

Controlled synthetic company: FlowGuard Demo Commerce Pvt Ltd.

Dataset implementation:

- `src/demo/phase10-company.ts`
- clearly labeled `DEMO DATA`
- 5,000 payments
- 220 invoices
- settlements, refunds, bank credits, delayed receivables, concentration risk, settlement mismatch, missing bank credit, duplicate event, and clean records

Machine-readable ground truth is produced by `phase10GroundTruth()`.

Important expected outcomes:

- payment count: 5,000
- invoice count: 220
- material mismatch: `P10-SET-2`
- missing bank credit: `P10-SET-3`
- duplicate economic events: 0
- known lineage payment: `P10-PAY-00001`
