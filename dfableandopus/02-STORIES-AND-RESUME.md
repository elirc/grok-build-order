# Stories, resume lines and the spoken summary

## STAR story 1: the stock column that was decorative

**Situation.** The scaffold accepted a cart and wrote an `Order` row, but never touched `Product.stock`. The system could confirm an order for a product it did not have, and nothing in the schema or the code noticed.

**Task.** Make reservation real, and make it survive two customers arriving at the same moment for the same last unit.

**Action.** Order creation became one interactive transaction (`backend/src/repositories/orderRepository.ts:10-29`). It reads all requested products in one query, then reserves each line with a single conditional write: `updateMany({ where: { id, version, stock: { gte: quantity } }, data: { stock: { decrement: quantity }, version: { increment: 1 } } })` at line 22. A zero row count becomes 409 "Inventory changed during checkout. Refresh and retry." at line 23, and because the order insert at line 28 is inside the same transaction, a failure there rolls back every reservation already made.

**Result.** "prevents two concurrent orders from reserving the same last unit" (`backend/src/__tests__/orderService.test.ts:75`) runs both requests concurrently and asserts exactly one order exists. "rolls back stock when the final order insert fails" (line 79) injects a failure at the last statement and asserts the stock is untouched. The delivery run passed all 37 cases, 24 of them against a real PostgreSQL cluster, with the per-case report kept as `astraupskill/evidence/backend.json`.

## STAR story 2: Alice renames a product and erases Bob's order

**Situation.** With reservation working, a second problem appeared. Alice opens the edit form for a product with stock 5. Bob orders one, leaving stock 4. Alice changes only the name and saves, but her form still carries stock 5, so a naive update by id would silently restore a unit that had already been sold.

**Task.** Refuse Alice's write without losing her typing, and make sure the refusal is not specific to one code path.

**Action.** `productUpdateSchema` requires the version Alice actually read (`backend/src/validation.ts:6`), and `productRepository.ts:12` makes the write conditional on `{ id, version }`. The part that takes an audit rather than a keystroke: every other writer of `stock` also increments `version`, both the reservation at `orderRepository.ts:22` and the cancellation restore at line 39, so any form loaded before either event is stale by construction. On zero rows, lines 13-16 re-read by id to answer 404 for a deleted product and 409 for a moved version.

**Result.** "prevents stale inventory forms from restoring reserved stock" (`orderService.test.ts:87`) covers the server side, and "preserves a conflicting draft and disables its stale write until explicit reload" (`frontend/src/__tests__/ProductsPage.test.tsx:36`) covers the recovery. The Playwright scenario "stale edit cannot overwrite inventory reserved by another client" (`e2e/orders.spec.ts:25`) runs the same race through a real browser and a separate HTTP client.

## STAR story 3: the failing run I kept

**Situation.** The first full backend run ended "Tests: 1 failed, 23 passed, 24 total". Deleting a product that appeared in order history returned a 500 rather than something a user could act on.

**Task.** Fix the response without weakening the constraint that produced it.

**Action.** The refusal itself was correct and came from the database: `OrderItem_productId_fkey` is `ON DELETE NO ACTION` (`backend/prisma/migrations/20260909000000_initial/migration.sql:21`). What was missing was translation, so I mapped Prisma's `P2003` in the one place that owns HTTP semantics, `backend/src/app.ts:22-23`, to a 409 with its own sentence: "This product is referenced by order history and cannot be deleted."

**Result.** "protects product records referenced by order history" (`orderService.test.ts:117`) passes, and `astraupskill/VERIFICATION.md` records the earlier failed run (23 passed, 1 failed). Recording it is the point: it is the difference between a constraint that was proved and one that was assumed.

## Resume bullets

- Implemented atomic stock reservation for a TypeScript and Express ordering service, using a single conditional Prisma `updateMany` carrying the product version and a `stock >= quantity` predicate so overselling fails as a 409 rather than a negative balance.
- Made every writer of the stock column increment an optimistic version so that product edit forms loaded before an order or a cancellation are refused, with the client keeping the user's draft for explicit reload.
- Sorted each cart by product id before reservation to give overlapping carts a common lock order, and mapped Prisma `P2034` write conflicts to 409 rather than claiming deadlocks were impossible.
- Kept money in decimal end to end: validated decimal strings on input, `DECIMAL(12,2)` and `DECIMAL(18,2)` columns, `Prisma.Decimal` arithmetic, fixed two-place strings on output, verified by a fractional-total test.
- Delivered 37 passing checks across three layers, 24 Jest cases against a disposable PostgreSQL 18 cluster, 8 Vitest component cases and 5 Playwright scenarios, with the unedited logs shipped in the repository.

## 60-second spoken summary

"It is a small order and inventory service: Express and Prisma over PostgreSQL with a React front end. Products have a price, a stock count and a version. Placing an order opens one transaction, sorts the cart by product id so overlapping carts take rows in the same order, reads the products in one query, and then for each line does a single update whose where clause says: this product, this version, and stock at least this quantity. If it changes zero rows that is a 409. The order insert is in the same transaction, so a failure anywhere rolls the reservations back. The second half is the interesting one. Cancelling an order restores stock and bumps the version, and ordering bumps it too, so a product edit form that was opened before either event is stale, and its save is refused. The UI keeps the typed draft and makes you reload explicitly rather than merging for you. What the service does not have is authentication, so `userId` is just a string in the body, and there is no idempotency, so a retried order creates a second one."

## What I would do next

Exercise 4 in `astraupskill/05-PRACTICE.md`: make order creation safe to retry. It is the only defect a user can cause by accident, by double-clicking or retrying after a timeout, and it commits real stock twice. The shape is a caller-supplied key stored with a canonical fingerprint of the sorted cart and the winning order id in the same transaction, a replay that returns the original order, and a 409 when the same key arrives with a different cart; `astraupskill/06-SOLUTIONS-AND-REVIEW.md` sketches it as an `IdempotencyKey` model with a `P2002`-only catch. After that, exercise 3, a stock movement ledger, because today the only way to explain why a product's stock changed is to read every order, and a direct catalog edit leaves no trace at all. Authentication is exercise 5 and is flagged as a stretch task; it is also the thing that makes "whose order is this" a question with an answer.
