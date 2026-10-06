# Learning phases

1. **Delivered foundation:** typed API client, explicit product inputs, list pagination, CRUD UI, version checks and readable errors.
2. **Delivered domain consistency:** database transactions, server decimal prices, historical item snapshots, stock reservation, cancellation and fulfillment.
3. **Delivered verification:** guarded temporary PostgreSQL cluster, real database tests, frontend boundary tests and Chromium workflows. Read [the evidence](astraupskill/VERIFICATION.md).
4. **Learner extension:** add stock-movement records and order request idempotency with concurrent retry tests.
5. **Learner extension:** add authenticated ownership, tenant-scoped queries, authorization tests and operational readiness. Supplier/purchase-order workflows also remain exercises.

> **Status (2026-10-06, verified against code):** Phases 1-3 are present as described. Phases 4 and 5 have not been started: `backend/prisma/schema.prisma` has no stock-movement or idempotency model, the backend has no authentication middleware, and `Supplier`/`PurchaseOrder` still have no routes.

Use [the detailed practice sequence](astraupskill/05-PRACTICE.md) and [review guidance](astraupskill/06-SOLUTIONS-AND-REVIEW.md). A deployment should not be inferred from local verification.
