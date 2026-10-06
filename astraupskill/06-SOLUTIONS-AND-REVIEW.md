# Solution sketches and review questions

Use these notes after attempting [the exercises](05-PRACTICE.md); the warm-up drills are answered by their `Check` lines. Exercises 1 to 4 include real code, because a design sketch is not enough when you have never written the thing before; read the code only after your own attempt compiles or visibly fails. Exercises 5 to 7 stay as design guidance on purpose, because there is no single right answer to an authorization boundary. A useful review checks observable behavior and failure handling rather than whether the code resembles one preferred pattern.

## Senior review of the shipped code

These are observations about the delivered code, each checkable at the cited lines. They are review material, not bugs you must fix before the exercises.

**The version guard makes popular products fail under load.** Reservation reads products without a lock (`orderRepository.ts:13`) and then requires the version it read (line 22). Two customers each buying one unit of a product with 100 in stock overlap like this: T1 updates and bumps the version, T2 waits on the row lock and then re-checks `version: 3` against the new row, matches nothing, and returns 409 "Inventory changed during checkout". Nothing was wrong with T2's order. `stock: { gte }` alone already prevents overselling (W3 and Exercise 0 show this), and the `version: { increment: 1 }` in `data` is what protects stale editors, so the version in the `where` buys little and costs real orders. The ecommerce sibling project avoids this by locking each row with `SELECT ... FOR UPDATE` before reading it, so the version it compares is always current.

**Restoration has no upper bound.** Cancellation increments stock unconditionally (`orderRepository.ts:39`). Validation caps editable stock at 2,000,000,000 (`validation.ts:5`), but a restore can push a product past that cap (up to PostgreSQL's integer limit), after which saving the unchanged edit form fails validation with a 400. The ecommerce project refuses such a cancellation with an explicit 409. The window is small; the review point is that every writer of a column must respect the same bounds.

**Lock order is consistent, but by two different sort rules.** `create` sorts cart lines with JavaScript `localeCompare` (line 12), while cancellation walks `order.items`, ordered by the database (`orderBy: { productId: 'asc' }`, line 4). With Prisma `cuid()` ids both orders agree. With ids whose collation differs from `localeCompare` (mixed case, punctuation), two transactions could take row locks in opposite orders. Sorting with a plain `<` comparison in both places would remove the question.

**Transitions are guarded by status, not version.** `transition` pre-checks PENDING (line 35) and repeats it in the conditional update (line 36), so concurrent cancellations have exactly one winner ("competing cancellations cannot restore stock twice", `orderService.test.ts:98`). Because `Order` has no version column (`schema.prisma:27-35`), a client acting on a stale view of an order gets no conflict as long as the order is still PENDING. Exercise 2 adds the version that would make such staleness visible.

**Anyone can act on any order.** `cors()` accepts every origin (`app.ts:12`) and `userId` is caller-supplied (`validation.ts:9`), so any local client can cancel or fulfill any order id. README states this; Exercise 5 is the fix.

## Exercise 0 - the red-first run

There is no code to check here, only your notes. Expected outcome: removing either `version: product.version` or `stock: { gte: item.quantity }` alone leaves all 24 tests green. The losing transaction's `UPDATE` waits for the winner's row lock and then re-checks its `WHERE` against the committed row, so either remaining clause makes it match nothing. "Prevents stale inventory forms" keeps passing because the version is incremented in `data`, not guarded in `where`. Only removing both clauses lets the loser's decrement reach PostgreSQL, where `Product_stock_nonnegative` rejects it and the last-unit test sees `[201, 500]`, when the two requests overlap.

If you predicted "the version clause guards editors and the stock clause guards overselling", that is the common intuition and the reason this exercise exists: overlapping guards hide each other from the tests. The useful follow-up is one test per guard, which for this code starts with a plenty-of-stock race where the version clause causes a spurious 409 (see the senior review above).

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

On the client, the filter has to be part of the cache key or React Query will show you the previous filter's page. Today the key is `['products', offset]` and `fetchProducts(offset, signal)` (`frontend/src/api/client.ts:15`) takes no filter, so extend both:

```ts
const { data } = useQuery({
  queryKey: ['products', { search, offset }],
  queryFn: ({ signal }) => fetchProducts(offset, search, signal),
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
  const p = await product();                                   // helpers at orderService.test.ts:19-20
  const order = (await checkout(p.id)).body.data;              // version 1
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

The `@@unique([orderId, productId, reason])` is what makes double restocking impossible at the database level, not merely improbable: a second `CANCEL_RESTORE` for the same order line violates the constraint. Write the movements inside the transaction that already exists, but after `tx.order.create` (line 28), because the order id does not exist while the reservation loop runs:

```ts
const order = await tx.order.create({ data: { userId: input.userId, total, items: { create: lines } }, include: details });
await tx.stockMovement.createMany({
  data: lines.map(line => ({ productId: line.productId, orderId: order.id, quantity: -line.quantity, reason: 'RESERVE' })),
});
return order;
```

Without `orderId` the unique index cannot help: PostgreSQL treats NULLs as distinct, so `(NULL, productId, 'RESERVE')` rows never collide.

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

Sorting the items before hashing is why two clients that describe the same cart in different orders get one order rather than two. The concurrent loser needs more care than a unique-key catch. Both transactions find no key and both enter the reservation loop; the second then waits on the first's product row lock and, because of the version clause at line 22, usually fails with 409 "Inventory changed" *before* it reaches the key insert, so the retry reports a conflict instead of the order that exists. Serialize on the key first, before the lookup, as the ecommerce project does (`pg_advisory_xact_lock(hashtextextended(key, 0))` in its `orderRepository.ts`). Keep a `P2002` handler as a backstop and run its re-read as a new query outside the aborted transaction. Catch **only** `PrismaClientKnownRequestError` with `code === 'P2002'`; catching every exception and calling it a duplicate is how a connection failure turns into a wrong 200. Finally, scope the key: a global `@id` lets one caller's key collide with another's, so include the namespace or owner in the primary key.

Prove it with two real clients against the temporary database, not a mocked lookup: fire both requests without awaiting the first, assert one order row exists, assert stock decremented once, then retry the first key a third time and assert you still have one order.

## Exercise 5 - authenticated ownership *(stretch)*

Write an access matrix before adding middleware. Every product and order operation needs an owner scope. A customer reference typed into the UI is not proof of identity. The service should receive an authenticated principal or owner identifier from trusted middleware, while request bodies remain untrusted business input. Test resource IDs copied from another account, including IDs nested inside cart items. Decide whether unauthorized resources appear as 403 or 404 and apply that policy consistently.

## Exercise 6 - supplier purchasing *(stretch)*

A receipt is a business command with durable consequences, not a generic status edit. A correct design links receipt quantities to purchase lines, validates remaining quantities and increments inventory in the same transaction. Replaying a receipt must not add stock twice. Partial receipt introduces a new invariant: cumulative accepted quantity cannot exceed the permitted amount. Explain over-receipt policy before coding it.

## Reviewing any of these (including exercise 7)

Ask the author to show one concrete failure: a stale editor, a duplicate request, an unauthorized ID or a failed final insert. Ask which test fails if the crucial condition is removed. Check schema constraints, HTTP errors, UI recovery and migration implications together. Conclude with the remaining limitation and a proportionate next step, rather than calling local success production readiness.
