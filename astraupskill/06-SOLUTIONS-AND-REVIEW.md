# Solution sketches and review questions

Use these notes after attempting [the exercises](05-PRACTICE.md). Exercises 1 to 4 now include real code, because a design sketch is not enough when you have never written the thing before; read the code only after your own attempt compiles or visibly fails. Exercises 5 to 7 stay as design guidance on purpose, because there is no single right answer to an authorization boundary. A useful review checks observable behavior and failure handling rather than whether the code resembles one preferred pattern.

## Exercise 0 - the red-first run

There is no code to check here, only your notes. The expected outcome: removing `version: product.version` leaves `stock: { gte: item.quantity }` in place, so the suite still refuses to oversell - the last-unit race test may still pass - but the *stale editor* tests fail, because an edit form that read version 3 can now overwrite a reservation made at version 4. Removing `stock: { gte: item.quantity }` instead makes the overselling tests fail while the stale-editor tests still pass. If your two failure lists were identical, you did not actually restore the first line before making the second edit. The lesson to write down: the two clauses in one `where` are two separate invariants that happen to share a statement.

## Exercise 1 - filter the catalog

A sound solution parses a bounded `search` value, applies it consistently to count or page queries if both exist, and gives the browser a cache key such as `['products', { search, offset }]`. Resetting offset prevents an old page number from producing a misleading empty result under a narrower search. Test the outgoing query and the final rendered list after two responses arrive out of order. Avoid deriving correctness from a debounce timer alone; cancellation or query identity must still protect the result.

The server half is three small edits. In [validation.ts](../backend/src/validation.ts), extend the page schema instead of accepting a caller-supplied `where`:

```ts
export const productQuerySchema = pageSchema.extend({
  search: z.string().trim().min(1).max(60).optional(),
}).strict();
```

In [productRepository.ts](../backend/src/repositories/productRepository.ts), build the filter once and use the same object for the page and any count:

```ts
findAll(page: ProductQuery) {
  const where: Prisma.ProductWhereInput = page.search
    ? { name: { contains: page.search, mode: 'insensitive' } }
    : {};
  return db.product.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: page.limit, skip: page.offset });
}
```

`mode: 'insensitive'` is the answer to the case-sensitivity question the exercise asks: it makes Prisma emit `ILIKE`, so the behaviour is defined by your query rather than left to the database's collation. Note that `contains` passes `%` and `_` straight through to `LIKE`; if that matters to you, escape them before building the filter.

On the client, the filter has to be part of the cache key or React Query will show you the previous filter's page:

```ts
const { data } = useQuery({
  queryKey: ['products', { search, offset }],
  queryFn: () => listProducts({ search, offset }),
});
```

Resetting `offset` to `0` in the same state update that changes `search` is what stops "page 3 of a narrower search" from rendering an empty list. For the out-of-order responses the exercise asks about, do not reach for a debounce timer: a timer changes *when* requests are sent, not which response wins. The cache key does the real work, because a response for `['products', { search: 'note' }]` cannot be written into `['products', { search: 'notebook' }]`.

## Exercise 2 - order notes behind a version check

The schema change is two lines:

```prisma
model Order {
  // ...existing fields...
  notes   String?
  version Int     @default(1)
}
```

The validator must be `.strict()` for the same reason `productUpdateSchema` is: an unknown key in the body is a caller mistake or an attack, and silently ignoring it is how a mass-assignment bug starts.

```ts
export const orderNotesSchema = z.object({
  notes: z.string().trim().max(500).nullable(),
  version: z.number().int().positive(),
}).strict();
```

The repository method is the delivered product update with different nouns - and that similarity is the point:

```ts
updateNotes(id: string, input: OrderNotesInput) {
  return db.$transaction(async tx => {
    const { version, notes } = input;
    const result = await tx.order.updateMany({
      where: { id, version },
      data: { notes, version: { increment: 1 } },
    });
    if (!result.count) {
      if (!await tx.order.findUnique({ where: { id } })) throw new HttpError(404, 'Order not found.');
      throw new HttpError(409, 'Order changed. Refresh before retrying.');
    }
    return tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
  });
}
```

The failing test you should have written first:

```ts
it('rejects a note written against a stale order version', async () => {
  const order = await createTestOrder();                       // version 1
  const first = await request(app).patch(`/api/orders/${order.id}`)
    .send({ notes: 'leave at reception', version: 1 });
  expect(first.status).toBe(200);
  expect(first.body.data.notes).toBe('leave at reception');

  const stale = await request(app).patch(`/api/orders/${order.id}`)
    .send({ notes: 'ring the bell', version: 1 });              // same version again
  expect(stale.status).toBe(409);

  const stored = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  expect(stored.notes).toBe('leave at reception');              // the loser wrote nothing
});
```

The last assertion is the one juniors leave out, and it is the one that would catch a repository that returns 409 *after* having written the row.

On the three decisions: `transition()` should bump `Order.version` too - if it does not, a note editor opened while the order was PENDING can save successfully against a now-CANCELLED order and the user will believe the note reached a live order. Allowing notes on a CANCELLED order is defensible (a cancellation reason is a note), but then say so in your own pull request, because it means `notes` is not part of the "terminal state is immutable" rule. And an empty string should become `null` in normalization rather than being a 400: "clear the note" is an obvious user intention and a 400 there is hostile.

## Exercise 3 - the movement ledger

Begin with a transaction-level invariant: the stock delta and its explanation commit together. A reservation movement should have a negative quantity and a cancellation movement a positive quantity. Record a stable relationship to the order and product. Decide whether uniqueness can enforce one movement of each relevant type per order item. Then inject a late failure and assert both stock and movement counts remain unchanged. A ledger that writes after commit can fail independently and leave an unexplained balance.

Concretely:

```prisma
model StockMovement {
  id        String   @id @default(cuid())
  productId String
  orderId   String?
  quantity  Int      // negative for a reservation, positive for a restock
  reason    String   // 'RESERVE' | 'CANCEL_RESTORE' | 'MANUAL_ADJUST'
  createdAt DateTime @default(now())
  product   Product  @relation(fields: [productId], references: [id], onDelete: NoAction)
  @@unique([orderId, productId, reason])
  @@index([productId, createdAt])
}
```

The `@@unique([orderId, productId, reason])` is what makes double restocking impossible at the database level, not merely improbable: a second `CANCEL_RESTORE` for the same order line violates the constraint. Write the movement inside the transaction that already exists, next to the `updateMany`:

```ts
const reserved = await tx.product.updateMany({ where: { id: product.id, version: product.version, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity }, version: { increment: 1 } } });
if (!reserved.count) throw new HttpError(409, 'Inventory changed during checkout. Refresh and retry.');
await tx.stockMovement.create({ data: { productId: product.id, quantity: -item.quantity, reason: 'RESERVE' } });
```

`tx`, not `db`. Using `db` there is the exact bug the exercise is checking for: the ledger row would survive a rolled-back reservation and the balance would stop explaining the stock. Direct catalog stock edits in `productRepository.update` need a `MANUAL_ADJUST` movement for the delta, or your history view will show a balance that does not reconcile and you will not know whether the bug is in the ledger or in the sum.

## Exercise 4 - idempotent order creation

Separate the key from the payload fingerprint. Canonicalize cart ordering before comparison because two arrays may describe the same order. Persist a winning result under a unique scoped key. Handle the concurrent loser by reading the winner after its transaction conflict, then compare fingerprints. Return the same resource identity for an equivalent retry and conflict for changed input. Do not catch every database exception and label it a duplicate: connection failure and uniqueness contention require different recovery. Verify the actual transaction behavior with two clients, not just a mocked lookup returning an existing key.

```prisma
model IdempotencyKey {
  key         String   @id
  fingerprint String
  orderId     String
  createdAt   DateTime @default(now())
}
```

```ts
create(input: OrderInput, idempotencyKey: string) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ userId: input.userId, items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)) }))
    .digest('hex');
  return db.$transaction(async tx => {
    const existing = await tx.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'This idempotency key was used with a different order.');
      return tx.order.findUniqueOrThrow({ where: { id: existing.orderId }, include: details });
    }
    // ...the existing reservation loop, unchanged...
    const order = await tx.order.create({ data: { userId: input.userId, total, items: { create: lines } }, include: details });
    await tx.idempotencyKey.create({ data: { key: idempotencyKey, fingerprint, orderId: order.id } });
    return order;
  }, { maxWait: 10_000, timeout: 15_000 });
}
```

Sorting the items before hashing is why two clients that describe the same cart in different orders get one order rather than two; it is the same reason the delivered code sorts before reserving. The concurrent loser needs one more piece: two transactions can both find no key and both try to insert it, and one of them will fail the primary-key constraint at commit. Catch **only** `PrismaClientKnownRequestError` with `code === 'P2002'`, re-read the winner, compare fingerprints, and return it. Catching every exception and calling it a duplicate is how a connection failure turns into a wrong 200.

Prove it with two real clients against the temporary database, not a mocked lookup: fire both requests without awaiting the first, assert one order row exists, assert stock decremented once, then retry the first key a third time and assert you still have one order.

## Exercise 5 - authenticated ownership *(stretch)*

Write an access matrix before adding middleware. Every product and order operation needs an owner scope. A customer reference typed into the UI is not proof of identity. The service should receive an authenticated principal or owner identifier from trusted middleware, while request bodies remain untrusted business input. Test resource IDs copied from another account, including IDs nested inside cart items. Decide whether unauthorized resources appear as 403 or 404 and apply that policy consistently.

## Exercise 6 - supplier purchasing *(stretch)*

A receipt is a business command with durable consequences, not a generic status edit. A correct design links receipt quantities to purchase lines, validates remaining quantities and increments inventory in the same transaction. Replaying a receipt must not add stock twice. Partial receipt introduces a new invariant: cumulative accepted quantity cannot exceed the permitted amount. Explain over-receipt policy before coding it.

## Reviewing any of these (including exercise 7)

Ask the author to show one concrete failure: a stale editor, a duplicate request, an unauthorized ID or a failed final insert. Ask which test fails if the crucial condition is removed. Check schema constraints, HTTP errors, UI recovery and migration implications together. Conclude with the remaining limitation and a proportionate next step, rather than calling local success production readiness.
