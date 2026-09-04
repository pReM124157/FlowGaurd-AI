# Razorpay Production Integration Setup

FlowGuard uses Razorpay Technology Partner OAuth with the `read_only` scope. It never asks a merchant for a Razorpay API key or secret.

## Server-only environment

Set these only on the server/deployment platform, never in frontend JavaScript:

```text
RAZORPAY_CLIENT_ID=
RAZORPAY_CLIENT_SECRET=
RAZORPAY_OAUTH_REDIRECT_URI=https://app.example.com/auth/razorpay/callback
RAZORPAY_WEBHOOK_SECRET=
RAZORPAY_TOKEN_ENCRYPTION_KEY=<32-byte base64 key>
SUPABASE_SERVICE_ROLE_KEY=
```

Create development and production OAuth clients in the Razorpay Partner Dashboard. Whitelist the exact HTTPS callback URL above. Configure the webhook endpoint as `https://app.example.com/webhooks/razorpay` and subscribe to `payment.captured`, `refund.created`, and `refund.processed`. Settlement summaries are followed by a server-to-server reconciliation fetch before ledger settlement lines are created.

## Safety rules

- Verify `X-Razorpay-Signature` against the unmodified raw request body using HMAC-SHA256.
- Deduplicate with `x-razorpay-event-id`; webhook delivery may be repeated or out of order.
- Include `flowguard_organization_id` in the Razorpay payment or refund `notes`. FlowGuard rejects signed events without this tenant marker instead of routing them to a default organization.
- Store OAuth access and refresh tokens encrypted at rest, with encryption keys held only by the deployment secret manager.
- Ingest payment/refund events immediately. Fetch settlement reconciliation detail server-to-server before creating settlement lines; do not invent fee, tax, or refund allocations from a summary webhook.
- Record connection consent before redirecting to OAuth. On disconnect or deletion, revoke/remove tokens, remove webhook payloads and imported Razorpay records, and retain only the minimum immutable audit record required by law.

## Deployment verification

1. Run `supabase/migrations/20260903_razorpay_live.sql`.
2. Configure Supabase Auth Site URL and redirect allow-list for the production domain.
3. Add the same production origin to Google OAuth redirect configuration.
4. Complete a Razorpay test-mode OAuth connection and test webhooks over HTTPS.
5. Confirm the resulting ledger events alter reconciliation, forecast, alerts, and Ask FlowGuard evidence with `RAZORPAY_LIVE` provenance.
