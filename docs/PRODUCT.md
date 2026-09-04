# FlowGuard AI Product Contract

## Product

FlowGuard AI is a finance control layer for Indian digital-first SMBs and MSMEs that accept online payments and need to understand true cash, settlement movement, receivable risk, and safe next actions.

## Primary ICP

Indian digital-first SMB / MSME with:

- online orders and gateway payments;
- refunds, fees, GST/tax-on-fee, settlements, and bank credits;
- recurring expenses, payroll, vendors, and receivables;
- limited finance operations staff;
- enough transaction volume that spreadsheet reconciliation is fragile.

## Personas

- Founder / Owner: wants to know whether the business can safely spend, hire, or borrow.
- Finance Manager: needs reconciled cash state, exceptions, runway, and forecast confidence.
- Operations Manager: needs payment/refund/settlement traceability and exception queues.
- Accountant: needs provenance, auditability, and clean financial terminology.

## Product Boundary

FlowGuard answers: what cash exists now, what is pending, what may arrive, what risks are forming, and what actions are financially safe.

FlowGuard does not:

- act as a bookkeeping clone;
- execute real external money movement in this prototype;
- let an LLM calculate authoritative financial numbers;
- fabricate integrations, metrics, transaction volume, or model performance.

## Success Metrics

Primary:

- financial-state correctness.

Secondary:

- reconciliation accuracy;
- forecast error and shortfall recall;
- late-payment prediction quality;
- anomaly precision;
- recommendation usefulness;
- latency and audit completeness.

## AI Boundary

The AI controller may explain, summarize, route questions to tools, and rephrase deterministic results. It must not invent balances, variances, forecasts, model drivers, or recommendations.
