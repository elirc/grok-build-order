# Code reading drill: six rounds

Answer aloud first. The repository is small enough that an interviewer can open any file, so read for intent, not for memorized lines.

## Drill 1: explain this loop

`backend/src/repositories/orderRepository.ts:17-26`.

```ts
        for (const item of requested) {
          const product = byId.get(item.productId);
          if (!product) throw new HttpError(404, 'A requested product was not found.');
          if (product.stock < item.quantity) throw new HttpError(409, `Insufficient stock for ${product.name}.`);
          // The condition and decrement are one database write, not a read-then-write promise.
          const reserved = await tx.product.updateMany({ where: { id: product.id, version: product.version, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity }, version: { increment: 1 } } });
          if (!reserved.count) throw new HttpError(409, 'Inventory changed during checkout. Refresh and retry.');
          total = total.add(product.price.mul(item.quantity));
          lines.push({ productId: product.id, productName: product.name, quantity: item.quantity, price: product.price });
        }
```

<details><summary>What a strong answer says</summary>

Two guards that look alike and are not. The `product.stock < item.quantity` check reads the value fetched before the loop at line 13, so it can be out of date by the time the write happens; its job is to produce a message that names the product. The predicate inside `updateMany` is the actual guarantee, evaluated by PostgreSQL at write time, which is why its failure message is deliberately vaguer: at that point the server does not know whether stock moved or the version did.

`decrement` and `increment` are relative, so no value computed in JavaScript is ever written back. The version increment is not about this order at all; it is what invalidates any product edit form opened earlier, which matters because `backend/src/repositories/productRepository.ts:12` matches on `{ id, version }`.

The total and the line snapshot are built from the row that was read, and the line carries `productName` and `price`, so the order keeps what was bought even if the catalog changes later ("keeps historical product name and price after catalog changes", `backend/src/__tests__/orderService.test.ts:121`).
</details>

## Drill 2: explain this transition

`backend/src/repositories/orderRepository.ts:32-42`.

```ts
      return db.$transaction(async tx => {
        const order = await tx.order.findUnique({ where: { id }, include: details });
        if (!order) throw new HttpError(404, 'Order not found.');
        if (order.status !== OrderStatus.PENDING) throw new HttpError(409, 'Only pending orders can transition.');
        const changed = await tx.order.updateMany({ where: { id, status: OrderStatus.PENDING }, data: { status: target } });
        if (!changed.count) throw new HttpError(409, 'Order status changed. Refresh and retry.');
        if (target === OrderStatus.CANCELLED) {
          for (const item of order.items) await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity }, version: { increment: 1 } } });
        }
        return tx.order.findUniqueOrThrow({ where: { id }, include: details });
      });
```

<details><summary>What a strong answer says</summary>

The read-side check on line 35 gives a specific message, and the `status: PENDING` clause inside `updateMany` on line 36 is what actually decides a race, exactly the same division of labour as the reservation loop. Two simultaneous cancellations both pass line 35 and only one matches a row at line 36; the loser gets "Order status changed. Refresh and retry." That is "competing cancellations cannot restore stock twice" (`orderService.test.ts:98`).

The restore loop is a plain `update`, not a conditional one, and a candidate who calls that a bug has missed the structure: the conditional write above it is the mutual exclusion, so only one transaction can ever reach the loop for a given order. The version is still incremented so that product editors are invalidated by a restock just as they are by a sale.

Both transitions lead to terminal states, PENDING to CANCELLED or FULFILLED, so there is no `version` column on `Order` and none is needed yet. The moment an order gains a mutable field, such as the notes in exercise 2 of `astraupskill/05-PRACTICE.md`, that changes.
</details>

## Drill 3: spot the bug

A mutated copy of the reservation. Compare with `orderRepository.ts:10-29`.

```ts
      return db.$transaction(async tx => {
        const requested = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
        const products = await tx.product.findMany({ where: { id: { in: requested.map(i => i.productId) } } });
        const byId = new Map(products.map(p => [p.id, p]));
        let total = new Prisma.Decimal(0);
        const lines = [];
        for (const item of requested) {
          const product = byId.get(item.productId);
          if (!product) throw new HttpError(404, 'A requested product was not found.');
          if (product.stock < item.quantity) throw new HttpError(409, `Insufficient stock for ${product.name}.`);
          await tx.product.update({ where: { id: product.id }, data: { stock: product.stock - item.quantity, version: product.version + 1 } });
          total = total.add(product.price.mul(item.quantity));
          lines.push({ productId: product.id, productName: product.name, quantity: item.quantity, price: product.price });
        }
        return tx.order.create({ data: { userId: input.userId, total, items: { create: lines } }, include: details });
      });
```

<details><summary>The mutation</summary>

The conditional `updateMany` became an unconditional `update` with absolute values computed in JavaScript. Three things break at once.

The predicate is gone, so nothing at write time checks the version or that stock is still sufficient; the only remaining check is the stale read at the line above. Two orders for the last unit both pass it and both write, and the second one writes `product.stock - item.quantity` computed from the value it read, so the first order's decrement is simply overwritten. Stock ends at 4 instead of 3 after two sales from 5.

Because the values are absolute rather than relative, the `stock` can go negative directly, at which point `Product_stock_nonnegative CHECK ("stock" >= 0)` (`backend/prisma/migrations/20260909000000_initial/migration.sql:7`) aborts the transaction and the customer sees a generic failure instead of "Insufficient stock for X".

And `if (!reserved.count)` is gone, so there is no branch left that could report a conflict at all. The named case that goes red is "prevents two concurrent orders from reserving the same last unit" (`orderService.test.ts:75`); exercise 0 in `astraupskill/05-PRACTICE.md` asks the reader to remove parts of this predicate one at a time and record which cases fail for each.
</details>

## Drill 4: spot the bug

A mutated copy of the product update. Compare with `backend/src/repositories/productRepository.ts:9-19`.

```ts
    update(id: string, input: ProductUpdate) {
      return db.$transaction(async tx => {
        const { version, ...fields } = input;
        const result = await tx.product.updateMany({ where: { id, version }, data: { ...fields, price: new Prisma.Decimal(fields.price) } });
        if (!result.count) throw new HttpError(409, 'Product changed. Refresh inventory before retrying.');
        return tx.product.findUniqueOrThrow({ where: { id } });
      });
    },
```

<details><summary>The mutations</summary>

Two, and they compound.

`version: { increment: 1 }` was dropped from the `data`. The write still requires the caller's version, so the first save succeeds, but the version never advances, which means the same stale form can be saved again and again, and, worse, a *later* editor who loaded the same version is also accepted. Optimistic locking only works if the winner moves the token.

The 404 branch was deleted. In the real code, lines 13-16 re-read by id and answer 404 "Product not found." when the row is gone, reserving 409 for a version that moved. Collapsing both into a conflict tells a user to refresh a product that no longer exists, and the case "deletes an unused product and returns 404 on repeat" (`orderService.test.ts:41`) depends on the same distinction in `remove`.

Worth noticing but not a defect: `price` is rebuilt as a `Prisma.Decimal` from the validated string, which is why `validation.ts:3` insists on a string with at most two decimal places rather than accepting a number.
</details>

## Drill 5: predict the status code

Name the status and the line.

1. `POST /api/orders` with `{"userId":"u1","items":[{"productId":"p1","quantity":1},{"productId":"p1","quantity":2}]}`.
2. `POST /api/orders` with a valid cart plus `"total":"0.00"`.
3. `POST /api/products` with `{"name":"Pen","price":"1.999","stock":5}`.
4. `PATCH /api/products/p1` with the correct fields and a version that is one behind.
5. `DELETE /api/products/p1` for a product that appears on an order, with the correct version.
6. `PATCH /api/orders/o1/status` with `{"status":"FULFILLED"}` on an already cancelled order.
7. `GET /api/products?limit=500`.
8. `POST /api/orders` with the body `{"userId":`.

<details><summary>Answers</summary>

1. **400.** The `superRefine` at `backend/src/validation.ts:11-17` adds "Each product must appear only once." The handler joins Zod issues into one message at `backend/src/app.ts:19`.
2. **400.** `orderSchema` is `.strict()` (`validation.ts:11`), so an unknown key is an issue. "rejects duplicate cart lines and forged total price or status fields" (`orderService.test.ts:70`) covers both this and case 1.
3. **400.** The price regex at `validation.ts:3` allows at most two decimal places.
4. **409** "Product changed. Refresh inventory before retrying." from `productRepository.ts:15`, reached after the re-read at line 14 confirms the row still exists.
5. **409.** The delete is refused by `OrderItem_productId_fkey` (`migration.sql:21`), Prisma reports `P2003`, and `app.ts:22-23` gives it its own sentence about order history. Note the path: this one is decided by the database, not by the repository.
6. **409** "Only pending orders can transition." from `orderRepository.ts:35`, before any write.
7. **400.** `pageSchema` bounds `limit` to 100 (`validation.ts:20`), and the refinement failure is a Zod issue.
8. **400** "Malformed JSON." from `app.ts:20`, matched on `error.type === 'entity.parse.failed'`. The response still carries the request id, which is what "returns malformed JSON errors with a matching request ID" (`orderService.test.ts:137`) asserts.
</details>

## Drill 6: review this diff

Three defects. Which block?

```diff
--- a/backend/src/repositories/orderRepository.ts
+++ b/backend/src/repositories/orderRepository.ts
@@
     create(input: OrderInput) {
       return db.$transaction(async tx => {
-        const requested = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
+        const requested = input.items;
         const products = await tx.product.findMany({ where: { id: { in: requested.map(item => item.productId) } } });
@@
-        return tx.order.create({ data: { userId: input.userId, total, items: { create: lines } }, include: details });
-      }, { maxWait: 10_000, timeout: 15_000 });
+        const order = await tx.order.create({ data: { userId: input.userId, total, items: { create: lines } }, include: details });
+        await notifyWarehouse(order);
+        return order;
+      }, { maxWait: 10_000, timeout: 15_000 });
     },
@@
     transition(id: string, target: 'CANCELLED' | 'FULFILLED') {
       return db.$transaction(async tx => {
-        const changed = await tx.order.updateMany({ where: { id, status: OrderStatus.PENDING }, data: { status: target } });
+        const changed = await tx.order.updateMany({ where: { id }, data: { status: target } });
```

<details><summary>Review notes</summary>

**Block on the network call inside the transaction.** `notifyWarehouse` runs while the transaction holds row locks on every product in the cart, so a slow warehouse blocks every other customer who wants those products, and the fifteen second `timeout` on line 29 now covers somebody else's HTTP latency. Worse, it cannot be rolled back: if the order insert succeeded and a later statement failed, the warehouse has been told about an order that does not exist. The pattern that keeps both properties is an outbox row written inside the transaction and a worker that sends afterwards, which is also what makes delivery at-least-once and therefore requires the receiver to deduplicate.

**Block on the lost status predicate.** `where: { id }` instead of `{ id, status: PENDING }` means the conditional write no longer decides the race. The read-side check at line 35 still rejects most cases, but two concurrent cancellations can both pass it and both proceed into the restore loop, restoring the stock twice. "competing cancellations cannot restore stock twice" (`orderService.test.ts:98`) is precisely this scenario, and it is the kind of bug that shows up as unexplained inventory, not as an error.

**Raise, probably block: the lost sort.** Reserving in client-supplied order removes the common lock order that the comment on line 11 explains. Two carts containing the same two products in opposite order can now deadlock; PostgreSQL will abort one, Prisma reports `P2034`, and `backend/src/app.ts:22-23` turns it into a 409 telling the customer to refresh. Nothing is corrupted, so this is a latency and error-rate defect rather than a correctness one, but it is free to keep and expensive to diagnose later.
</details>
