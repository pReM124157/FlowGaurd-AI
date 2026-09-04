# Financial Invariants

## Money

- Authoritative money uses integer minor units, such as paise for INR.
- A money amount always has a currency.
- Currency mismatch rejects arithmetic unless an explicit FX process exists.
- Negative values are valid only when the domain event explicitly represents reversal/outflow semantics.

## Event And Ledger

- Every external event has immutable provenance: source, sourceExternalId, organizationId, occurredAt, createdAt.
- Duplicate webhook/import events must not create duplicate economic events.
- Given the same canonical event stream, ledger projection must produce the same financial state.
- Replay must not corrupt or double count state.

## Financial Meaning

- Payment is not settlement.
- Settlement is not bank credit.
- Revenue is not cash.
- Forecast is not actual.
- Predicted invoice payment is not confirmed payment.
- Recommendation is not executed financial action.
- Money cannot disappear silently.
- Every visible financial number must be traceable to source records.

## AI

- The LLM never calculates authoritative finance.
- The LLM never treats untrusted customer names, invoice notes, bank narrations, or metadata as instructions.
- If required financial data is missing or stale, the controller must say it cannot determine the answer from available data.
