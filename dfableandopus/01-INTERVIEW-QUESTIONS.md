# Interview questions: order and inventory service

Tags are **[junior]** and **[mid]**. Line numbers were checked against the files.

## Screening

**S1. What is in the database? [junior]**
`backend/prisma/schema.prisma`. `Product` with `price Decimal @db.Decimal(12,2)`, `stock`, and `version Int @default(1)` (lines 16-25). `Order` with a `OrderStatus` of PENDING, CANCELLED or FULFILLED, a `total Decimal @db.Decimal(18,2)` and a `userId` string (lines 27-35). `OrderItem` snapshots `productName` and `price` and is `@@unique([orderId, productId])` (lines 37-48). `Supplier` and `PurchaseOrder` exist with a comment at line 50 saying they are future exercises; nothing routes to them.

**S2. Why does `OrderItem` copy the product name and price? [junior]**
Because the order is a record of what was bought at that moment and the product is mutable. The snapshot is written at `backend/src/repositories/orderRepository.ts:25` from the row read inside the transaction. The test is "keeps historical product name and price after catalog changes" (`backend/src/__tests__/orderService.test.ts:121`).

**S3. Walk through `POST /api/orders`. [junior]**
`backend/src/routes/orderRoutes.ts:9-12` calls `service.createOrder`, which parses the body with `orderSchema` (`backend/src/services/orderService.ts:10`) and hands it to the repository. On success the route sets `Location: /api/orders/<id>`, returns 201, and wraps the body as `{ data: ... }` after `presentOrder` converts every `Decimal` to a fixed two-place string (`backend/src/http.ts:6`). Everything is registered in `backend/src/app.ts:14`, behind a request id header set at line 11 and a 32 KiB JSON limit at line 12.

**S4. Where is the validation boundary? [junior]**
`backend/src/validation.ts`, all Zod and all `.strict()`. `orderSchema` (line 8) accepts a `userId` string and one to fifty items of `{ productId, quantity }` with quantity between 1 and 10000, then a `superRefine` at lines 11-17 adds an issue if a `productId` repeats. Prices and totals are not in the schema at all, so a client cannot send them: "rejects duplicate cart lines and forged total price or status fields" (`orderService.test.ts:70`).

**S5. How is money represented? [mid]**
As `Decimal` everywhere: `Prisma.Decimal` in the repository (`orderRepository.ts:15`, `:24`), `DECIMAL(12,2)` and `DECIMAL(18,2)` in the migration (`backend/prisma/migrations/20260909000000_initial/migration.sql:3` and `:12`), and a validated decimal *string* on the way in, matched by the regex at `validation.ts:3`. It leaves as a string too, via `toFixed(2)` in `presentProduct` and `presentOrder`. The reason is the one the test names: "calculates fractional decimal totals without binary floating-point drift" (`orderService.test.ts:55`).

**S6. What does the error handler do? [mid]**
`backend/src/app.ts:16-27`. A `HttpError` carries its own status; a `ZodError` becomes 400 with every issue joined by "; "; `entity.parse.failed` is 400 "Malformed JSON." and `entity.too.large` is 413; Prisma `P2002`, `P2003` and `P2034` become 409, with `P2003` getting its own sentence about order history. Anything else falls to 500 and is the only branch that logs, at line 25. Every response body is `{ error: { message, requestId } }`, and the same id is on `X-Request-Id`.

**S7. Who owns an order? [mid]**
Nobody, and this is the first limit to volunteer. `userId` is a trimmed string from the request body (`validation.ts:9`); there is no authentication, no session and no ownership check, so any caller can create an order for any user string or read any order. `astraupskill/VERIFICATION.md` states it, and it is exercise 5 in `astraupskill/05-PRACTICE.md`, flagged as a stretch task.

**S8. How is paging expressed? [junior]**
`pageSchema` at `validation.ts:20` takes `limit` and `offset` as strings matching `^\d+$`, transformed to numbers, with `limit` bounded to 1 to 100 defaulting to 50 and `offset` bounded to 100000 defaulting to 0. Both list queries order by `createdAt asc, id asc` (`orderRepository.ts:7`, `backend/src/repositories/productRepository.ts:6`), and the tie-break on id is what makes the page stable when timestamps collide: "bounds list queries and orders equal timestamps by identity" (`orderService.test.ts:126`).

## Deep dive

**D1. Explain the reservation predicate. [mid]**
`orderRepository.ts:22`: `updateMany({ where: { id: product.id, version: product.version, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity }, version: { increment: 1 } } })`. Three conditions and two relative updates in one statement, so the database evaluates and applies atomically; there is no read-then-write window in application code. Line 23 turns a zero count into 409 "Inventory changed during checkout. Refresh and retry."

**D2. There is already a stock check on line 20. Why is the predicate not redundant? [mid]**
Line 20 reads the value fetched at line 13 and throws 409 "Insufficient stock for ..." naming the product. That check is a courtesy: it produces a good message for the common case. It cannot be the guarantee, because another transaction can commit between the read at line 13 and the write at line 22. `stock: { gte: item.quantity }` in the predicate is the guarantee; the message is worse, deliberately generic, because at that point the server does not know whether stock or the version moved.

**D3. What does `version` add if `stock >= quantity` already prevents oversell? [mid]**
It makes every product write serialize against every other one, which matters because stock is not the only mutable field. A product edit at `productRepository.ts:12` matches on `{ id, version }` and increments; cancellation increments at `orderRepository.ts:39`. So a reservation invalidates any edit form loaded before it, which is the entire subject of `astraupskill/03-WORKED-CHANGE.md`: Alice edits only the name, but her form also carries the old stock, and accepting her stale version would undo Bob's order. "prevents stale inventory forms from restoring reserved stock" (`orderService.test.ts:87`) is the test.

**D4. Why sort the cart? [mid]**
`orderRepository.ts:12` sorts a copy of the items by `productId.localeCompare`. The comment on line 11 says why: a common lock order reduces deadlock risk for overlapping carts. Two carts containing A and B in opposite order would otherwise each hold one row and wait for the other. The course is careful about the claim, and so should you be in an interview: it reduces lock-order contention, it is not a proof that no deadlock is possible, which is why `P2034` is still mapped to 409 at `app.ts:22-23`.

**D5. What happens if the order insert on line 28 fails? [junior]**
Everything rolls back, including every reservation made earlier in the loop, because all of it is inside one `db.$transaction` opened at line 10. The comment at line 27 says exactly that, and the test injects the failure: "rolls back stock when the final order insert fails" (`orderService.test.ts:79`). The sibling case "rolls back earlier reservations when a later cart line is invalid" (line 65) covers the same property for a bad cart line.

**D6. Two customers race for the last unit. Trace it. [mid]**
Both read the product at line 13 and both pass the courtesy check at line 20, because both see the same stock. Then both issue the conditional update at line 22 with the same `version`. PostgreSQL serializes them: the first matches one row, decrements the stock and increments the version; the second now matches zero rows, because both the version and possibly the stock predicate fail, and line 23 raises 409. "prevents two concurrent orders from reserving the same last unit" (`orderService.test.ts:75`) runs it, and `astraupskill/02-CONCEPTS.md` has the same sequence as a two-transaction timeline table.

**D7. Walk through `transition`. [mid]**
`orderRepository.ts:31-43`. It reads the order with its items, 404s if absent, and refuses anything that is not PENDING with 409 "Only pending orders can transition." The write is `updateMany({ where: { id, status: PENDING } })`, and a zero count is 409 "Order status changed. Refresh and retry.", which is what makes two simultaneous cancellations produce one winner. Only on CANCELLED does it loop over the items restoring stock and incrementing each product's version (line 39), then re-reads the order. The tests are "cancels pending orders and restores stock once" (line 92) and "competing cancellations cannot restore stock twice" (line 98).

**D8. Cancellation restores with `update`, not a conditional `updateMany`. Is that a bug? [mid]**
No, and the reasoning is the interesting part. The order row has already been moved out of PENDING by the conditional write on line 36, and that write is the mutual exclusion: only one transaction can be in the restore loop for a given order. The product version is still incremented so that editors are invalidated, but there is no condition to check, because an increment is safe regardless of the current value. The risk that remains is an unbounded increase in stock if a future path restored twice, which is why the transition guard, not the restore, is the thing to protect.

**D9. What breaks if you delete `version: product.version` from line 22? [mid]**
Overselling does not return, because `stock: { gte: item.quantity }` still guards the quantity. What breaks is the lost-update protection for editors: a stale product form could be accepted between the read and the write in a way the version would have caught, and the concurrent-order case becomes dependent purely on stock, so two orders for one unit out of five would both succeed even if one of them read a stale price. Exercise 0 in `astraupskill/05-PRACTICE.md` asks the reader to delete exactly this line, record which named cases go red, then restore it.

**D10. And if you delete `stock: { gte: item.quantity }`? [mid]**
Then the guarantee moves to the database constraint: `Product_stock_nonnegative CHECK ("stock" >= 0)` at `migration.sql:7`. The write becomes a constraint violation rather than a clean 409, so the customer gets the generic 500 or a Prisma-mapped message instead of "Insufficient stock for X", and the whole transaction aborts. That is the difference between a rule enforced where you can produce a good message and a rule enforced as a last resort.

**D11. Why does deleting a purchased product fail, and with what status? [mid]**
`OrderItem_productId_fkey` is `ON DELETE NO ACTION` (`migration.sql:21`), so PostgreSQL refuses. Prisma reports `P2003`, and `app.ts:22-23` maps it to 409 with its own sentence: "This product is referenced by order history and cannot be deleted." The test is "protects product records referenced by order history" (`orderService.test.ts:117`). `astraupskill/VERIFICATION.md` records that this response originally came back as a 500 and that the first backend run failed on it (the failing log itself was not committed).

**D12. How does the product update distinguish 404 from 409? [junior]**
`productRepository.ts:13-16`: when `updateMany` changes zero rows, it does a second read by id inside the same transaction. No row means 404 "Product not found."; a row means the version moved, so 409 "Product changed. Refresh inventory before retrying." `remove` does the same at lines 23-26. Returning one status for both would tell the caller nothing about which action to take.

**D13. What are the transaction timeouts, and why only on `create`? [mid]**
`{ maxWait: 10_000, timeout: 15_000 }` at `orderRepository.ts:29`: up to ten seconds waiting for a connection from the pool and fifteen for the body. `transition` (line 32) uses the defaults. The asymmetry is defensible because a fifty-line cart does fifty sequential conditional updates while `transition` does a bounded amount of work, but it is the kind of inconsistency worth flagging in a review rather than defending as design.

**D14. The `Supplier` and `PurchaseOrder` tables are unused. Is that acceptable? [mid]**
It is acceptable because it is declared: the comment at `schema.prisma:50` says no supplier or purchase-order routes exist yet, and `astraupskill/VERIFICATION.md` lists supplier workflow among the things not built. An unexplained empty table is technical debt; an explained one is a roadmap. In a real review I would still ask for a ticket number in the comment.

## Behavioral

**B1. Tell me about a bug that only appeared with two users. [mid]**
*Situation:* the scaffold created orders without touching stock, and once reservation was added a second bug became possible: a product editor opened before the order could write its stale stock back. *Task:* arbitrate between two users who both did something reasonable. *Action:* I put `version` on `Product`, required it in `productUpdateSchema` (`backend/src/validation.ts:6`), made the update conditional on `{ id, version }` (`productRepository.ts:12`), and made every other writer of `stock` increment the version too, both the reservation at `orderRepository.ts:22` and the cancellation restore at line 39. *Result:* "prevents stale inventory forms from restoring reserved stock" (`orderService.test.ts:87`) passes, and the browser scenario proves the user can recover their draft rather than losing their typing. The delivery run passed all 37 cases.

**B2. Describe a time a test told you something you did not expect. [mid]**
The first backend run failed one case out of 24: deleting a product referenced by order history returned 500 instead of a usable status. `astraupskill/VERIFICATION.md` records it as 23 passed and 1 failed; the log file was not committed to the repository. The fix was not to catch and rethrow at the call site but to map `P2003` in one place, at `app.ts:22-23`, with a message that says what the user should do. Recording the failed run was deliberate: it is the evidence that the constraint was proved rather than assumed.

**B3. When did you choose a weaker message on purpose? [mid]**
In the reservation loop. Line 20 produces "Insufficient stock for X" because at that point the server knows which product and why. Line 23, after the conditional update matched zero rows, says only "Inventory changed during checkout. Refresh and retry." I could have re-read the product to work out which condition failed; I chose not to, because by then the answer would already be out of date, and a precise-sounding message that is a guess is worse than a general one that is true.

**B4. Tell me about something you deliberately did not build. [mid]**
Authentication and idempotency, both named in `astraupskill/VERIFICATION.md`. Orders carry a client-supplied `userId` with no verification, and a retried `POST /api/orders` after a dropped response creates a second order, because there is no request key. Those are exercises 4 and 5 in `astraupskill/05-PRACTICE.md`, and exercise 5 is explicitly marked as a stretch task to pair on. Naming them is the strong answer; claiming the service is safe to expose would not survive one follow-up question.

**B5. How do you make a refusal useful? [mid]**
Every refusal here tells the caller what to do next: "Refresh and retry.", "Refresh inventory before retrying.", "This product is referenced by order history and cannot be deleted." And every response carries a `requestId` (`app.ts:26`) that matches the `X-Request-Id` header, so a user's screenshot is enough to find the request in the log. The test "returns malformed JSON errors with a matching request ID" (`orderService.test.ts:137`) pins that pairing even on the parse-failure path, which is the one that is easiest to get wrong.

## Follow-ups the interviewer asks next

**F1. You read all the products in one query and then update them one at a time. Why not batch?**
The read is already batched at `orderRepository.ts:13` with `findMany({ where: { id: { in: ... } } })`. The writes cannot be, because each carries its own version and quantity predicate, and a batched update would lose the per-line "did this one match" answer that line 23 depends on. The alternative is a single raw `UPDATE ... FROM (VALUES ...)` returning the affected ids, which is faster for a fifty-line cart and gives up type safety; at this size the round trips are not the problem.

**F2. A product in the cart does not exist. What happens, and when?**
404 "A requested product was not found." at line 19, discovered when the loop reaches it, which may be after earlier lines were already reserved. Those reservations roll back with the transaction. The order of discovery is the sorted product id order, not the order the client sent, which is worth mentioning because it means the error message may not name the first item on the customer's screen.

**F3. `presentOrder` formats money. Why not let JSON serialize the Decimal?**
Because `Prisma.Decimal` serializes as an object or loses precision depending on the path, and clients tend to parse it into a float. `backend/src/http.ts:5-6` converts to a fixed two-place string on the way out, and `validation.ts:3` requires a string with at most two decimal places on the way in, so the wire format is a string at both ends and the arithmetic is decimal in the middle. The trade-off is that clients must not do arithmetic on these strings without a decimal library.

**F4. There is no `version` on `Order`. Should there be?**
Today the status transition is guarded by `status: PENDING` in the predicate (`orderRepository.ts:36`), which is enough for the only two transitions that exist, both of which leave a terminal state. A version would be needed the moment an order gains a mutable field, which is exactly why exercise 2 in `astraupskill/05-PRACTICE.md` is "add order notes behind a version check": the note is the first field where two editors can disagree without changing the status.

**F5. Is CORS doing anything for you?**
No. `app.ts:12` is `cors()` with no options, which allows every origin. It exists so the Vite dev server can call the API. `astraupskill/VERIFICATION.md` says in as many words that CORS is not access control, and with no authentication there is nothing for it to protect anyway. In a deployment I would set an explicit origin and, more importantly, add the authentication that makes the question meaningful.

**F6. First thing you would build next?**
Idempotent order creation, exercise 4. It is the only defect a user can trigger by accident, by double-clicking or by retrying after a timeout, and today it silently doubles a real-world commitment of stock. The shape is a client-supplied key, a unique index, a stored fingerprint of the sorted cart and a replay that returns the original order; `astraupskill/06-SOLUTIONS-AND-REVIEW.md` sketches it with an `IdempotencyKey` model and a `P2002`-only catch. Authentication comes second, because without it "whose order is this" has no answer to be idempotent about.
