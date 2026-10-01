# Invariants, transactions and conflicts

An invariant is a condition that must remain true after a successful operation. Here, stock cannot be negative; one pending order can restore its stock at most once; an order's price comes from the server's catalog; historical item prices do not change when the catalog changes. Writing these conditions first is more useful than starting with controller names.

## Atomicity is about all related writes

Suppose a cart contains two products. Reserving the first succeeds, but the second has insufficient stock. If each update commits independently, the customer receives no order while the first product loses stock. In [orderRepository.ts](../backend/src/repositories/orderRepository.ts), reservation and order creation run inside one interactive transaction. An exception aborts the transaction, restoring earlier writes. The test suite also injects a failure at the final order insert: this proves that successful reservations alone are not enough to commit the workflow.

A transaction does not automatically settle every race. Consider two requests that both read stock `1`. Each initially believes it can buy the item. The implementation uses a conditional update matching the product's version and sufficient stock. One request changes stock and increments the version; the other finds that its condition no longer matches and returns a conflict. The database evaluates the condition at the write boundary. A prior JavaScript `if` alone would not provide that guarantee.

### What the database sees during the last-unit race

Read this table before the prose above makes sense. Two customers order the final Notebook at the same moment. `T1` and `T2` are the two transactions in [orderRepository.ts](../backend/src/repositories/orderRepository.ts); the third column is the committed row, which only one of them can change.

| Step | T1 (Alice) | T2 (Bob) | Product row after the step |
| --- | --- | --- | --- |
| 1 | `findMany` reads `stock=1, version=3` | — | `stock=1, version=3` |
| 2 | — | `findMany` reads `stock=1, version=3` | `stock=1, version=3` |
| 3 | JavaScript check `product.stock < quantity` passes | JavaScript check passes too — **both believe they can buy** | `stock=1, version=3` |
| 4 | `updateMany({ where: { id, version: 3, stock: { gte: 1 } }, data: { stock: { decrement: 1 }, version: { increment: 1 } } })` returns `count = 1` | blocked on T1's row lock | `stock=0, version=4` |
| 5 | `order.create(...)`, transaction commits | the same `updateMany` now runs; `version: 3` no longer matches, so `count = 0` | `stock=0, version=4` |
| 6 | 201 Created, total `3.25` | `if (!reserved.count) throw new HttpError(409, 'Inventory changed during checkout. Refresh and retry.')` — the transaction rolls back | `stock=0, version=4` |

Step 3 is the point of the table: the JavaScript comparison is a *courtesy check* that produces a friendly message in the ordinary case, and it is worthless as a guarantee because both requests pass it. The guarantee is in step 5, where the `where` clause is evaluated by PostgreSQL inside the write itself. Stock never goes below zero, no unit is sold twice, and the loser gets 409 rather than a corrupted row. The backend case named `'prevents two concurrent orders from reserving the same last unit'` in [orderService.test.ts](../backend/src/__tests__/orderService.test.ts) drives exactly this sequence against a real database.

## Optimistic product editing

A product editor remembers version `4`. An order reserves stock and increments it to `5`. The editor still contains the older stock value. Sending an unconditional full update would restore consumed inventory. PATCH therefore includes the expected version. On conflict, the UI preserves the draft but disables that stale write until the learner explicitly reloads current data. It does not quietly attach version `5` to old stock; that would defeat the purpose of the check.

## Money and history

Prices cross HTTP as decimal strings, for example `"3.25"`. Validation allows at most two fractional digits. Prisma Decimal calculates totals without binary floating-point accumulation. The server ignores no forged price field: strict schemas reject it. OrderItem stores the catalog name and price at creation, so later renaming Notebook to Journal does not rewrite an earlier purchase description.

## State transitions and deletion

PENDING may become CANCELLED or FULFILLED. Cancellation changes the status and restores quantities in the same transaction. Its conditional status update ensures concurrent cancellation requests have one winner. Fulfillment leaves stock consumed. There is no payment provider behind that word. Product deletion is version-checked and constrained by foreign keys; referenced order history remains valid. The migration uses non-deferrable NO ACTION references, which reject an invalid delete at the statement boundary.

These guarantees have limits. A retried successful POST can create a second order because request idempotency is not implemented. Customer references are caller-controlled, so transactions do not establish authorization. Learn the difference between data consistency, identity and delivery uncertainty before combining them in later exercises.
