# Data Model

Core entities planned for persistent storage:

- Organization
- User
- Customer
- Order
- Payment
- Refund
- Settlement
- SettlementLine
- Fee
- Tax
- BankAccount
- BankTransaction
- Invoice
- InvoicePayment
- Vendor
- Payable
- RecurringExpense
- PayrollObligation
- FinancialEvent
- ReconciliationMatch
- ReconciliationException
- ForecastSnapshot
- RiskSignal
- Recommendation
- Scenario
- AuditLog

Every monetary/source object includes, where applicable:

- `amountMinor`
- `currency`
- `organizationId`
- `source`
- `sourceExternalId`
- `occurredAt`
- `createdAt`

The executable v1 domain model lives in `src/domain/types.ts`.
