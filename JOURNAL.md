# Implementation journal

The earlier scaffold described an order transaction while leaving stock updates as a TODO. The current implementation puts reservation, historical item snapshots and order creation in one PostgreSQL transaction. Product version checks also prevent a stale catalog form from restoring stock consumed by an order.

The original Jest configuration and Vitest imports disagreed. Backend tests now use Jest against a temporary real PostgreSQL cluster. Frontend tests use Vitest/jsdom; Playwright covers browser-to-database workflows. See [verification](astraupskill/VERIFICATION.md) for executed evidence and limitations.

The React catalog now supports CRUD and order workflows. Business transitions are PENDING to CANCELLED or FULFILLED. Cancellation restores stock once. Fulfillment is final, with no payment integration. Reference constraints protect historical products.

Follow-up learning work is in [practice](astraupskill/05-PRACTICE.md). Authentication, tenant ownership, idempotency, stock movement ledgers and existing-database migration are proposals, not delivered features.
