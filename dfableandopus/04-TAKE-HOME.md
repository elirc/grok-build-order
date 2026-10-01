# Take-home: an inventory movement ledger

Time box: 3 to 4 hours in this repository.

## Background given to the candidate

Stock moves in three places and none of them leaves a trace. Reservation decrements at `backend/src/repositories/orderRepository.ts:22`, cancellation restores at line 39, and a catalog edit can set `stock` to any value at `backend/src/repositories/productRepository.ts:12`. Today the only way to answer "why is this product at 4" is to read every order, and a direct catalog edit cannot be reconstructed at all. `astraupskill/VERIFICATION.md` lists the absence of a stock ledger among the limits.

## The assignment

Add a movement ledger and one read endpoint over it.

1. A `StockMovement` record per change: product, signed quantity, a reason, a timestamp, and an order reference where one applies.
2. Reservation writes a negative movement inside the existing order transaction. Cancellation writes a positive one inside the existing transition transaction. A catalog stock edit writes a movement for the difference, or writes nothing if the quantity did not change; decide which and say why.
3. A failed order insert must leave neither stock changes nor movement rows.
4. A repeated cancellation must not create a second restoration movement.
5. `GET /api/products/:id/movements` returns that product's movements, newest first, paginated with the existing `pageSchema` shape, wrapped as `{ data: ... }` like every other route.
6. For a product created with a known opening quantity, the sum of its movements plus the opening balance must equal its current `stock`.

## Acceptance criteria

- A new migration file beside `backend/prisma/migrations/20260909000000_initial/`, additive, with explicit `CHECK` constraints in the style of `migration.sql:6-8`. Do not edit the applied migration; the helper applies the checked-in SQL to a fresh cluster.
- Every movement write uses the transaction client `tx` already in scope, never the outer `db`. This is the trap: `db` would open a second connection outside the transaction, so requirement 3 would fail silently while all the happy paths pass.
- The reason is a bounded enum, not free text, and it is validated in Zod if it can ever come from a request.
- Requirement 4 must follow from a structural guarantee, not from a comment. Two candidates are the existing conditional write at `orderRepository.ts:36`, which already makes only one transaction reach the restore loop, and a unique constraint on (order, product, reason). Say in `NOTES.md` which one you are relying on.
- The read endpoint validates its query with the existing `pageSchema` (`backend/src/validation.ts:20`) rather than inventing a second paging shape, and returns 404 for an unknown product id the way `backend/src/services/productService.ts` does for a product read.
- `presentProduct` and `presentOrder` in `backend/src/http.ts` convert decimals for the wire; if any movement field is decimal, follow that pattern instead of returning a `Decimal` directly.

## What to submit

- A branch or patch with source, the migration and tests.
- `NOTES.md`, one page: your decision on catalog edits from requirement 2, your structural guarantee for requirement 4, what you left out, and the reconciliation query you would run in production to detect drift.
- Pasted test output.

## Tests and commands

Backend cases go in `backend/src/__tests__/orderService.test.ts`, which runs against a real PostgreSQL cluster the helper creates and destroys.

```
npm run test:api     # node scripts/test-database.mjs backend
npm run verify       # adds the frontend, browser and build checks
```

The helper allocates loopback ports, applies the checked-in SQL migration, requires a dedicated test marker before fixture cleanup, and stops its own cluster before removing the directory. It will not use an existing personal database. Prerequisites are Node, the PostgreSQL command-line binaries and, for `verify`, the Playwright Chromium build matching the lockfile.

Minimum tests: a movement pair for a successful order; no movement rows after an injected failure at the order insert, in the shape of "rolls back stock when the final order insert fails" (`orderService.test.ts:79`); exactly one restoration movement after two competing cancellations, modelled on "competing cancellations cannot restore stock twice" (line 98); and a reconciliation case that sums movements and compares with `stock`.

## Grading rubric

| Criterion | Strong | Weak |
|---|---|---|
| Transaction discipline | Every movement written through the in-scope `tx`, proved by a rollback test | Uses the outer `db` client, so rollback tests pass by luck or not at all |
| Completeness of the ledger | Catalog edits covered with a stated decision, so the balance is explainable | Only order paths recorded, leaving adjustments invisible |
| Double-write prevention | Relies on the existing conditional write or a unique constraint, and says which | A code comment, or a `count()` before inserting |
| Schema | New additive migration, signed quantity, bounded reason, `CHECK` constraints written out | Edits the applied migration, or stores the reason as free text |
| Read endpoint | Reuses `pageSchema`, returns `{ data }`, 404 for an unknown product, stable ordering with an id tie-break like `productRepository.ts:6` | A second paging convention, unbounded results, unstable order |
| Reconciliation | A test that sums movements against the stored quantity from a known opening balance | Asserts only that rows were inserted |
| Communication | `NOTES.md` names the drift query and the case the candidate is unsure about | Notes restate the assignment |

## Reviewer's notes

The first thing I grep for is `db.` inside the new code. The repositories are factory functions that close over a `PrismaClient` (`orderRepository.ts:5`), so `db` is in scope everywhere and using it inside a transaction callback compiles, runs, and quietly writes outside the transaction. A candidate who writes movements through `tx` and has a rollback test proving it has understood the single most important thing about this codebase.

Second, requirement 2 and the catalog edit. Both answers are defensible. Recording a movement for an adjustment makes the balance explainable but means the ledger contains entries no order can justify; recording nothing keeps the ledger clean and makes it unable to explain the balance, which defeats the purpose. I want the decision and the consequence, not a preference.

Third, I try two cancellations at once. If the answer to requirement 4 is a unique constraint, I expect a `P2002` to appear and to be mapped, and `backend/src/app.ts:22` already maps it to 409; if the answer is the existing `status: PENDING` predicate, I want the candidate to point at line 36 and explain why only one transaction can reach the restore loop.

Fourth, ordering. `findAll` orders by `createdAt asc, id asc` for stability (`productRepository.ts:6`); a ledger read that orders by timestamp alone will interleave unpredictably when two movements share a millisecond, which is exactly what happens inside one order transaction.

No UI is expected. I do expect one sentence about what the ledger still cannot tell you: it records quantity movements, not value, so it does not answer what the inventory was worth at a point in time.
