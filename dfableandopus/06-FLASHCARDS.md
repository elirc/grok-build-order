# Flashcards: order and inventory service

Cover the right column.

| Question | Answer |
|---|---|
| The reservation predicate? | `{ id, version, stock: { gte: quantity } }` in `updateMany` (`backend/src/repositories/orderRepository.ts:22`) |
| What does that write change? | `stock: { decrement }` and `version: { increment: 1 }`, both relative, no value computed in JavaScript |
| Message when it matches zero rows? | 409 "Inventory changed during checkout. Refresh and retry." (`orderRepository.ts:23`) |
| Message when the pre-read shows too little stock? | 409 "Insufficient stock for " plus the product name (`orderRepository.ts:20`) |
| Why keep both checks? | The pre-read gives a good message from possibly stale data; the predicate is the guarantee, evaluated at write time |
| Why is the cart sorted before reserving? | A common lock order for overlapping carts (`orderRepository.ts:11-12`); it reduces deadlocks, it does not eliminate them |
| What happens if the order insert fails? | Every earlier reservation rolls back; it is all one `db.$transaction` (`orderRepository.ts:10`, `:27-28`) |
| Transaction limits on order creation? | `{ maxWait: 10_000, timeout: 15_000 }` (`orderRepository.ts:29`); `transition` uses the defaults |
| Which test proves the last-unit race? | "prevents two concurrent orders from reserving the same last unit" (`backend/src/__tests__/orderService.test.ts:75`) |
| Which test proves rollback? | "rolls back stock when the final order insert fails" (`orderService.test.ts:79`) |
| Who else increments `Product.version`? | The product edit (`backend/src/repositories/productRepository.ts:12`) and the cancellation restore (`orderRepository.ts:39`) |
| Why does that matter? | Any product edit form loaded before a sale or a restock is stale, which is the subject of `astraupskill/03-WORKED-CHANGE.md` |
| Product update predicate? | `{ id, version }`, with `version: { increment: 1 }` in the data (`productRepository.ts:12`) |
| How does the product update tell 404 from 409? | On zero rows it re-reads by id inside the transaction (`productRepository.ts:13-16`) |
| Exact stale-edit message? | "Product changed. Refresh inventory before retrying." |
| Allowed order transitions? | PENDING to CANCELLED or FULFILLED only; anything else is 409 "Only pending orders can transition." (`orderRepository.ts:35`) |
| What decides a race between two cancellations? | `updateMany({ where: { id, status: PENDING } })` at `orderRepository.ts:36` |
| Why is the restock loop a plain `update`? | The conditional write above it is the mutual exclusion, so only one transaction reaches the loop |
| Does `Order` have a version column? | No. Both transitions are terminal, so the status predicate suffices; exercise 2 in `astraupskill/05-PRACTICE.md` adds one with notes |
| Deleting a purchased product? | 409 "This product is referenced by order history and cannot be deleted." via `P2003` (`backend/src/app.ts:22-23`) |
| Which constraint causes that? | `OrderItem_productId_fkey ... ON DELETE NO ACTION` (`backend/prisma/migrations/20260909000000_initial/migration.sql:21`) |
| Database guard against negative stock? | `Product_stock_nonnegative CHECK ("stock" >= 0)` (`migration.sql:7`) |
| Money on the wire? | Validated decimal strings in (`backend/src/validation.ts:3`), fixed two-place strings out (`backend/src/http.ts:5-6`) |
| Money in the database? | `DECIMAL(12,2)` for prices, `DECIMAL(18,2)` for order totals (`migration.sql:3`, `:12`) |
| Which test pins decimal arithmetic? | "calculates fractional decimal totals without binary floating-point drift" (`orderService.test.ts:55`) |
| Cart size and quantity limits? | 1 to 50 items, quantity 1 to 10000 (`validation.ts:10`) |
| What rejects a repeated product in a cart? | The `superRefine` at `validation.ts:11-17`, "Each product must appear only once." |
| Can a client send a price or a total? | No, both schemas are `.strict()` and neither field exists in them |
| Paging defaults and bounds? | `limit` 1 to 100 defaulting to 50, `offset` up to 100000 defaulting to 0 (`validation.ts:20`) |
| Why order by `createdAt, id`? | A stable tie-break when timestamps collide ("bounds list queries and orders equal timestamps by identity", `orderService.test.ts:126`) |
| Response envelope? | `{ data: ... }` on success, `{ error: { message, requestId } }` on failure (`app.ts:26`) |
| Status and header for a created order? | 201 with `Location: /api/orders/<id>` (`backend/src/routes/orderRoutes.ts:11`) |
| Status for a malformed JSON body? | 400 "Malformed JSON." from `entity.parse.failed` (`app.ts:20`) |
| Status for a body over 32 KiB? | 413 "Request body is too large." (`app.ts:21`) |
| Which Prisma codes become 409? | `P2002`, `P2003`, `P2034` (`app.ts:22`) |
| What does the server log? | Only unclassified errors, at `app.ts:25`; everything mapped is answered without a log line |
| Who owns an order? | Nobody: `userId` is a client-supplied string (`validation.ts:9`), with no authentication anywhere |
| Is `/health` a readiness check? | No, it returns a constant (`app.ts:13`); `astraupskill/VERIFICATION.md` says it reports process liveness only |
| Is CORS access control here? | No, `cors()` is unconfigured and allows every origin (`app.ts:12`) |
| Which tables exist but have no routes? | `Supplier` and `PurchaseOrder`, declared as future exercises (`backend/prisma/schema.prisma:50-64`) |
| How many checks passed on the delivery run? | 37: 24 backend, 8 frontend, 5 browser (`astraupskill/VERIFICATION.md`) |
| What does `astraupskill/evidence/backend-tests-first-run.log` show? | The earlier failing run, 1 failed of 24, on referenced-product deletion returning 500 |
| Command for the backend suite? | `npm run test:api`, which is `node scripts/test-database.mjs backend` |
| Two limits to volunteer in an interview? | No authentication or ownership, and no idempotency on order creation |
