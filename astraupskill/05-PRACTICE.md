# Progressive work toward mid-level CRUD ownership

Complete these exercises in order. Each asks for a behavior, an invariant and evidence. The features below are proposed learner work, not features already implemented. Keep changes small enough that another person can review the reasoning and the failing test together.

Exercises 1 to 4 are ordinary homework and each is roughly one evening. Exercises 5 to 7 are marked *stretch*: they are mid-to-senior design tasks, and the honest way to do them is to write the design note and walk a senior through it rather than to sit alone until they compile.

## 0. Break the guard on purpose, then put it back (red first, 20 minutes)

Do this before writing any new code. It takes a working system and shows you the exact line that is holding the invariant up.

1. Make sure the suite is green first: `npm run test:api` should report 24 passing cases. If it does not, fix your environment before continuing.
2. Open [orderRepository.ts](../backend/src/repositories/orderRepository.ts) and, in the `updateMany` call inside `create`, delete `version: product.version,` from the `where` clause so the condition is only `{ id: product.id, stock: { gte: item.quantity } }`.
3. Run `npm run test:api` again. Write down, by name, which cases fail and the exact assertion message. (Expect `'prevents two concurrent orders from reserving the same last unit'` to be among them.) Predict *before* you look: does removing the version but keeping `stock: { gte: ... }` still prevent overselling? Your notes should record what you predicted and what actually happened.
4. Now restore that clause and instead delete `stock: { gte: item.quantity }`. Run the suite again and record which cases fail this time. The two conditions defend different things; the failure lists prove which is which.
5. Restore the file exactly (`git diff -w backend/src/repositories/orderRepository.ts` should be empty, or paste the original line back), rerun `npm run test:api`, and confirm 24 passing again before you move on.

The point of the exercise is not the edit; it is that you can now name the test that would catch a regression in each guard. When you add a guard of your own in the exercises below, write the test that goes red without it first.

## 1. Filter the catalog without breaking paging

Add a name filter with a maximum length and explicit empty-string behavior. Extend the server query schema rather than accepting arbitrary Prisma filters. Include the filter in the QueryClient key and reset the page when it changes. Seed more than twenty products and prove the second page belongs to the same filter. Test rapid filter changes with delayed responses so an older request cannot overwrite the current result. Explain whether case sensitivity is defined by your query or database collation.

## 2. Add order notes behind a version check (write the test first)

This is the same shape as the delivered change, one size smaller, so do it before the bigger ones. Add a free-text `notes` field to Order that a user can edit after placing the order, and protect it the way products are protected.

Work in this order and do not skip the first step. **Write the failing test first**: a case in [orderService.test.ts](../backend/src/__tests__/orderService.test.ts) that creates an order, PATCHes `{ "notes": "leave at reception", "version": 1 }`, expects 200 and the stored note; then PATCHes the *same* version again with different text and expects 409. Run `npm run test:api` and watch it fail with a 404 on an unimplemented route — that failure is your specification.

Then implement: add `notes String?` and `version Int @default(1)` to `model Order` in [schema.prisma](../backend/prisma/schema.prisma) and a matching SQL migration; add an `orderNotesSchema` to [validation.ts](../backend/src/validation.ts) that is `.strict()` and bounds the note length; add a repository method that does a conditional `updateMany` on `{ id, version }` and distinguishes a missing order (404) from a moved version (409) exactly as [productRepository.ts](../backend/src/repositories/productRepository.ts) does; expose `PATCH /api/orders/:id` in [orderRoutes.ts](../backend/src/routes/orderRoutes.ts).

Three decisions you must make explicitly, because the tests differ depending on the answer: does the status transition in `transition()` also bump `Order.version` (if not, a note editor can be stale about status without noticing)? May a CANCELLED order still take a note? Does an empty string clear the note or is that a 400?

## 3. Add an inventory movement ledger

Create a StockMovement model recording product, signed quantity, reason, timestamp and an order reference where appropriate. Write reservation and cancellation movements in their existing transactions. A failed order insert must leave neither stock changes nor movement rows. A repeated cancellation must not create another restoration movement. Decide how direct catalog stock edits appear in the ledger; a journal that ignores adjustments cannot explain the balance. Build a read-only product history view and compare its sum with the stored quantity using a known opening balance.

## 4. Make order creation safe to retry

Add a caller-supplied idempotency key scoped to a future account or an explicitly documented local namespace. Store the key, canonical request fingerprint and winning order in the same transaction. Two concurrent equivalent requests should return one order; the same key with a different cart should conflict. Simulate the client losing the first successful response and retrying. Demonstrate that stock is reserved once. Do not merely disable the Place order button: that protects one mounted browser event path, not network retries or another tab.

## 5. Introduce authenticated ownership *(stretch — pair with a senior)*

Design an Account or Tenant boundary and derive it from verified server identity. Replace trust in the customer reference as a security mechanism. Scope every read, update, delete and transition, including nested product IDs in a cart. Test two users who know each other's resource IDs. An order belonging to one tenant must not reserve another tenant's product. Explain how unique constraints and idempotency scopes incorporate the owner. This exercise requires a complete authorization design, not just adding a login screen.

## 6. Implement supplier purchasing *(stretch — pair with a senior)*

Use the retained Supplier and PurchaseOrder models as a starting point. Specify draft, ordered and received states and whether partial receipt is supported. Receiving stock must update products and receipt history atomically. Repeat receipt commands need a defined conflict or replay rule. Add API validation, UI errors and transaction failure tests before expanding the dashboard. Do not claim procurement is complete because a model exists.

## 7. Plan a safe release *(stretch — pair with a senior)*

Write a migration plan for the previous schema's existing records, including historical names, decimal precision and invalid status values. Work on a disposable copy and preserve the original. Add separate process-liveness and database-readiness checks, bounded structured logs, graceful shutdown verification and an operational recovery note. State your expected workload before choosing indexes or caching. Finish with a short review document showing which invariants each test protects and what remains uncertain.
