# FlowGuard Financial Onboarding Gate Report

Verdict: `FLOWGUARD_ONBOARDING_GATE_PASS`

Report date: 2026-08-23

## Product Contract

New live organizations no longer land on a pre-populated dashboard. They enter a server-enforced onboarding state machine:

`BUSINESS_PROFILE -> RISK_PREFERENCES -> DATA_CONNECTIONS -> DATA_VALIDATION -> INITIAL_CALCULATION -> READY`

The dashboard API surface returns `FG_ONBOARDING_REQUIRED` until the tenant reaches `READY`.

## Demo Separation

Synthetic records are available only through the explicit `Explore Demo Company` path, which authenticates into the demo tenant and labels responses as `DEMO DATA`.

Live organizations do not inherit demo company events or dashboard defaults.

## User-Declared Provenance

Business profile and risk configuration fields are stored with `USER_DECLARED` provenance. These values tune risk configuration and obligations, but are not presented as `ACTUAL` financial facts.

Collected business context:

- Organization name
- Industry/business type
- Timezone
- Currency
- Payroll amount and schedule
- Minimum liquidity buffer
- Typical receivable terms
- Recurring obligations
- Financing obligations
- Notification preferences

## Readiness Audit

The readiness audit verifies a reliable cash source before Available Cash is shown. Missing inputs are surfaced as insufficient data. Metrics distinguish:

- `ACTUAL`
- `USER_DECLARED`
- `PENDING`
- `FORECAST`
- `PREDICTED`
- `SIMULATED`

## Automated Evidence

Added `test/onboarding.test.ts` covering:

- Empty organization first-run
- Partial onboarding resume
- Explicit demo selection
- No-data dashboard protection
- Cross-tenant isolation
- Derived-vs-declared provenance
- Failed READY transition without reliable cash
- Successful READY transition after bank import

## Manual QA

Manual server QA was performed without screenshots:

```text
live-login 200 fg_session=fg_empty_owner
me BUSINESS_PROFILE
blocked-overview 409
profile RISK_PREFERENCES
risk DATA_CONNECTIONS
bank 200
connections DATA_VALIDATION
validate true
calculate READY
ready-overview 200 ACTUAL 900000
```

## Gate Commands

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run demo
```

All passed.

