# FlowGuard Live Data & Alert System Report

Final verdict: `FLOWGUARD_LIVE_FINANCIAL_CONTROL_PASS`

Report date: 2026-08-23

## 1. Previous Architecture

FlowGuard previously proved the finance engines with a controlled synthetic demo company. The core ledger, reconciliation, forecasting, receivables risk, optimizer, and controller surfaces were deterministic, but the product shell still depended on demo-shaped data for dashboard presentation.

## 2. Static/Demo Dependencies Found

- Production API/UI dependency removed: fixed lineage lookup no longer depends on `PAY-8821`.
- Production API dependency removed: overview receivable risk no longer uses the demo `680000` invoice amount.
- Demo-only fixtures remain in `src/server/demo-data.ts`, `src/demo/demo-company.ts`, and finance tests. These are intentionally scoped to repeatable evidence and are not the live tenant dashboard source.

## 3. Live Data Architecture

Phase upgrade adds a tenant runtime store in `src/server/live-store.ts`. Each authenticated organization has its own profile, event stream, runtime projection, alerts, notifications, and financial timeline.

The runtime is recomputed from canonical events through the existing authoritative finance engines:

- Ledger replay
- Cash position
- Settlement reconciliation
- Forecast
- Receivables risk scoring
- Scenario runner
- Optimizer
- Alert evaluation

## 4. Organization Data Model

Each organization profile includes:

- `organizationId`
- `name`
- `mode`: `LIVE` or `DEMO`
- `currency`
- `timezone`
- liquidity buffer
- payroll schedule
- alert thresholds
- notification preferences
- data connection status

The API resolves the organization from the authenticated session only. Client-supplied organization IDs are not trusted.

## 5. Razorpay Adapter

`POST /api/ingest/razorpay-mock` accepts Razorpay-style payment payloads and converts them into immutable canonical order/payment events for the authenticated tenant.

No live Razorpay credentials or money movement are used in this prototype.

## 6. Bank Import

`POST /api/ingest/bank-csv` accepts bank CSV-shaped rows and converts credit rows into canonical bank-credit events. Cash, reconciliation, forecast, alerts, and timeline entries update after import.

## 7. Receivables Import

`POST /api/ingest/invoices` accepts invoice rows and creates canonical invoice events. Receivables, forecast, invoice risk, concentration risk, and alerts update from the new tenant event stream.

## 8. Event Pipeline

All ingested financial facts enter the same canonical event model used by earlier phases. Events keep organization, source, source external ID, occurrence time, creation time, and typed payloads.

## 9. Automatic Recalculation

Every ingest call returns a freshly recomputed runtime. The frontend displays server-provided values and does not recalculate cash, variance, forecast, invoice risk, or recommendations.

## 10. Real-Time UI

The shell now handles:

- `LIVE DATA` vs `DEMO DATA` banners
- Empty-tenant onboarding state
- Active alert summary
- Financial timeline
- Data freshness
- Tenant-specific payment lineage
- Settings/data-connection actions

Manual screenshot QA was intentionally not repeated per user instruction; validation used automated tests plus `npm run build`.

## 11. Alert Engine

`src/server/risk-alerts.ts` implements deterministic financial early-warning alerts. It does not use an LLM and does not invent financial numbers.

## 12. Alert Types

Implemented alert types:

- `CASH_SHORTFALL`
- `PAYROLL_RISK`
- `LATE_RECEIVABLE_RISK`
- `SETTLEMENT_MISMATCH`
- `REFUND_SPIKE`
- `FEE_ANOMALY`
- `CUSTOMER_CONCENTRATION`
- `LOW_LIQUIDITY`

## 13. Threshold Logic

Thresholds are organization-specific and include liquidity buffer, materiality amount, late-receivable probability, fee-rate ceiling, refund-spike multiple, and customer-concentration threshold.

## 14. Alert Lifecycle

Lifecycle statuses:

- `OPEN`
- `ACKNOWLEDGED`
- `RESOLVED`

The evaluation loop resolves active alerts when the underlying risk condition is no longer present.

## 15. Deduplication

Alerts use stable fingerprints derived from organization, risk type, source, and risk date/window. Repeated evaluation does not create duplicate active alerts.

## 16. Notification System

Material alert transitions queue in-app and email-shaped notification records according to tenant preferences. Delivery is simulated and remains internal to the prototype.

## 17. User Preferences

Each organization profile includes in-app/email enablement, minimum notification severity, quiet-hours shape, and escalation delay configuration.

## 18. Escalation

Escalation policy fields are modeled, but actual delayed escalation workers are not implemented in this in-memory prototype. This is a known limitation, not hidden behavior.

## 19. Controller Integration

The controller endpoint now uses the authenticated tenant runtime, including tenant alerts, cash state, scenario output, optimizer output, and data-state guards.

Unsupported questions remain safely answered without fabricated finance values.

## 20. Security

Security controls retained or added:

- Server-side tenant resolution
- Cross-tenant query denial
- RBAC on write/controller/scenario actions
- Audit records for sensitive requests
- Safe JSON errors
- Security headers
- Rate limiting for sensitive routes
- No secrets exposed through frontend config tests

## 21. Tests

New/updated live-control tests prove:

- Company A and Company B produce different authoritative metrics
- Empty organizations show onboarding with no fake critical alerts
- Razorpay-style payment ingest is tenant-scoped
- Bank import recalculates cash
- Receivables import changes receivable state
- Alerts are deterministic and deduplicated
- Notifications are queued for material transitions
- Alerts resolve when fresh data removes the risk
- Alerts/notifications are tenant-isolated
- Cross-tenant object access is denied
- Payment lineage uses organization-specific payment IDs, not a fixed demo ID

## 22. Performance

The live-control suite completed in about 123 ms locally for 11 tests. Production build completed successfully and emitted `dist/`.

## 23. UI QA

UI QA for this upgrade was limited to build validation by user instruction. The shell compiles with the live-data UI paths and onboarding states.

## 24. Known Limitations

- Runtime storage is in-memory; it resets on process restart.
- Razorpay and bank integrations are mock/import adapters only.
- Notification delivery is queued/simulated, not sent externally.
- Delayed escalation workers are modeled but not executed.
- No external database migration was added in this upgrade.

## 25. Final Verdict

`FLOWGUARD_LIVE_FINANCIAL_CONTROL_PASS`

Evidence commands:

```bash
node --test test/live-control.test.ts
npm run lint
npm run build
```

