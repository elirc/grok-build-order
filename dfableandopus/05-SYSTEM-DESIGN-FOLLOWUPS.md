# Now scale it: seven follow-ups

Each answer starts from the code as it is, then names the cost of the change.

```
 React (Vite)              POST /api/orders  { userId, items[] }
        |
        v
 app.ts   X-Request-Id per request                    (11)
          cors() open to every origin                 (12)
          express.json limit 32kb                     (12)
          /api/products  /api/orders                  (14)
          error translator: HttpError | Zod | parse | P2002/P2003/P2034 | 500  (16-27)
        |
        v
 orderRoutes.ts:9   ->  orderService.createOrder  ->  orderSchema.parse
        |
        v
 orderRepository.create        db.$transaction  { maxWait 10s, timeout 15s }
 +--------------------------------------------------------------+
 | sort cart by productId          common lock order      | :12  |
 | findMany products in one query                         | :13  |
 | per line:                                              |      |
 |   stock < qty ?  409 "Insufficient stock for <name>"   | :20  |
 |   updateMany { id, version, stock >= qty }             | :22  |
 |     -> decrement stock, increment version              |      |
 |   count === 0 ? 409 "Inventory changed during checkout"| :23  |
 | order.create with item snapshots                       | :28  |
 +--------------------------------------------------------------+
        |
        v
 PostgreSQL 18   Product_stock_nonnegative CHECK (stock >= 0)
                 OrderItem_productId_fkey  ON DELETE NO ACTION
```

## 1. Two API instances. What still holds?

All of the concurrency, because it is decided by PostgreSQL. The reservation predicate at `backend/src/repositories/orderRepository.ts:22` and the status predicate at line 36 are evaluated by the database, so two processes race exactly as two requests in one process do. There is no in-memory state to diverge: the service holds a `PrismaClient` and nothing else.

What changes is pool pressure. Each instance has its own connection pool, and a fifty-line cart holds one connection for up to fifteen seconds (`orderRepository.ts:29`) while it issues fifty sequential writes. Two instances double the connections PostgreSQL sees for the same workload, and the first symptom is not an error but `maxWait` expiring, which surfaces as a 500 through the default branch at `backend/src/app.ts:25`. A pooler such as PgBouncer in transaction mode is the usual answer, with the caveat that interactive transactions are exactly the workload that constrains it.

## 2. A million products and a hundred thousand orders. Which query fails first?

`findAll` on both repositories uses `skip`/`take` (`orderRepository.ts:7`, `backend/src/repositories/productRepository.ts:6`) with `offset` bounded to 100000 by `backend/src/validation.ts:20`. At the far end of that range PostgreSQL walks and discards a hundred thousand rows per request. The ordering is `createdAt asc, id asc`, and both tables have `@@index([createdAt, id])` (`backend/prisma/schema.prisma:24`, `:34`), so the index supports keyset pagination directly: carry the last `(createdAt, id)` and use a row comparison instead of an offset.

What is lost is jumping to an arbitrary page, which the current UI does not need, and there is no `count` in these endpoints at all, so no total to give up. That is an advantage this service has over most: nobody promised a total, so nobody has to scan for one.

## 3. There is no ownership. What does adding authentication actually touch?

More than the routes. `userId` is a trimmed string in the body (`validation.ts:9`), copied straight onto the order at `orderRepository.ts:28`, and no read filters by it: `GET /api/orders` returns everybody's orders. So the change is: identity from a verified token, `userId` removed from `orderSchema` entirely so it cannot be claimed, a scope predicate composed into both order reads, and a decision about the catalog, which is currently world-writable through `PATCH /api/products/:id`.

It is exercise 5 in `astraupskill/05-PRACTICE.md` and it is marked as a stretch task for a reason: it changes the contract of every endpoint at once, and it interacts with idempotency, because a request key has to be scoped to an identity to be safe. The order to do them in is authentication first, then keys scoped to the account.

## 4. Make order creation safe to retry. Concretely.

Today a dropped response has no safe retry: a second `POST /api/orders` reserves stock again. The fix is a caller-supplied key, a table with a unique index on it, a canonical fingerprint of the sorted cart, and the winning order id, all written in the same transaction as the reservation. A retry with the same key and the same cart returns the original order; the same key with a different cart is a 409. `astraupskill/06-SOLUTIONS-AND-REVIEW.md` sketches it as an `IdempotencyKey` model with a `P2002`-only catch, which is the important detail: catching every `PrismaClientKnownRequestError` would swallow the write conflicts that `backend/src/app.ts:22` deliberately surfaces.

The cart must be canonicalized before fingerprinting, and the sort at `orderRepository.ts:12` already exists for a different reason, so the same ordering serves both. The remaining decision is retention: keys cannot be kept forever, and the moment one expires, a very late retry becomes a new order again.

## 5. The warehouse wants to hear about every order. Where does that go?

Not inside `db.$transaction`. The transaction holds row locks on every product in the cart, so an outbound call there couples inventory throughput to somebody else's availability, and it cannot be rolled back if a later statement fails.

The shape is an outbox: insert an intent row inside the same transaction that creates the order, and let a separate worker deliver it and mark it done. That keeps the property this codebase already relies on, effects and their records commit together, which is what "rolls back stock when the final order insert fails" (`backend/src/__tests__/orderService.test.ts:79`) proves for the order itself. The cost is at-least-once delivery, so the warehouse must deduplicate on the order id, and a crash between delivery and marking the row leaves a duplicate that nobody can prevent from inside one database.

## 6. The ledger question: why did this product's stock change?

Unanswerable today, and that is a design gap rather than a missing feature. `stock` is mutated in three places, at `orderRepository.ts:22`, `orderRepository.ts:39` and `productRepository.ts:12`, and only the first two leave anything behind, in the form of an order you would have to go looking for. A direct catalog edit leaves no trace at all.

A `StockMovement` table written inside the existing transactions, exercise 3 in `astraupskill/05-PRACTICE.md`, turns `stock` into a cached balance that can be reconciled against the sum of its movements. The honest caveat is the one the practice text makes: a journal that ignores catalog adjustments cannot explain the balance, so the adjustment case has to be decided, not skipped. The other cost is write amplification, one extra insert per line per order, which for a fifty-line cart doubles the statements in the hottest transaction in the system.

## 7. Observability: the first three signals.

Today the only log is the default branch of the error translator at `backend/src/app.ts:25`, which fires for unclassified errors, and every response carries a request id set at line 11 and echoed in the body at line 26. So a user can report an id and it can be found, provided the failure was a 500.

First, count 409s split by message: insufficient stock, inventory changed during checkout, order status changed, product changed, and the foreign key one. They are not errors, they are the system refusing correctly, and their relative mix is diagnostic. A rise in "Inventory changed during checkout" with flat "Insufficient stock" means contention, not scarcity, and the two need different responses.

Second, transaction duration for `create`, because the fifteen second timeout at `orderRepository.ts:29` will present as an unclassified 500 and be indistinguishable from a real bug without it.

Third, a log line for every `P2034`, since mapping deadlocks to 409 at `app.ts:22-23` is the right user-facing choice and also the perfect way to never learn that you have a deadlock problem. The cost of all three is cardinality, and keying them by product id would be the most useful and the most expensive version.

## For a .NET interview

The reservation is an `ExecuteUpdateAsync` with the same `Where(p => p.Id == id && p.Version == version && p.Stock >= qty)`, or a `[ConcurrencyCheck]` property and a caught `DbUpdateConcurrencyException`, mapped to 409 where `app.ts:22-23` maps Prisma's codes. The interactive transaction is an `IDbContextTransaction` around the same sequence. `Prisma.Decimal` is `decimal` with `HasPrecision(12, 2)`, and the input validation that insists on a decimal string maps to a `[RegularExpression]` or a FluentValidation rule; the argument for it is identical in both stacks, which is that a JSON number has already lost the value by the time your code sees it.
