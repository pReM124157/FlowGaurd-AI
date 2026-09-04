# API Spec

Planned API capabilities:

- `get_cash_position()`
- `get_cash_forecast()`
- `get_reconciliation_exception()`
- `trace_payment()`
- `get_invoice_risk()`
- `run_scenario()`
- `optimize_cash_plan()`
- `get_financial_anomalies()`
- `get_business_risk_summary()`

All APIs must enforce:

- organization scoping;
- strict input and output schemas;
- authorization;
- audit logging;
- timeout and error handling;
- no cross-tenant leakage.

Current executable equivalent: pure TypeScript services used by tests.
