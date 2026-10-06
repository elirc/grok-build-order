# From CRUD screens to reliable inventory workflows

This course uses an actual React, Express, Prisma and PostgreSQL application. Your objective is to explain a change across the browser, HTTP boundary, business rules and database, then prove that it behaves correctly when two people act at once. That is a useful step from junior feature implementation toward mid-level ownership.

Start by reading the [project setup](../README.md). Install the locked dependencies and run `npm run verify`. The helper creates its own disposable PostgreSQL database; it does not require you to sacrifice an existing learning database. For interactive work, configure a new persistent local database separately. Keep those two purposes distinct: repeatable automated fixtures and a sandbox whose records you want to keep.

## Before you start

**You should already know:** JavaScript/TypeScript syntax, React function components with `useState`, how to send a request with `fetch`, and what a database table, a primary key and a foreign key are. You do **not** need prior experience with Prisma, transactions, optimistic locking or PostgreSQL administration — those are what the course teaches.

**Tools:** Node 22.x and npm (`node --version` should print `v22.`), PostgreSQL command-line binaries (`initdb`, `pg_ctl`, `psql`) on your PATH, and the Playwright Chromium build that the locked dependency version expects (`npx playwright install chromium`). All commands in this course are plain `npm` scripts and run the same on Windows, macOS and Linux; where a path is shown with backslashes, use forward slashes on macOS/Linux.

**Pacing (total ~10 hours, not one sitting):**

| Chapter | What it costs you |
| --- | --- |
| [01 Codebase map](01-CODEBASE-MAP.md) + [02 Concepts](02-CONCEPTS.md) | ~1 hour together, plus a second pass over 02 later — it is dense |
| [03 Worked change](03-WORKED-CHANGE.md) | ~2 hours with the source files open beside it |
| [04 Testing and debugging](04-TESTING-AND-DEBUGGING.md) | ~1 hour, including one real `npm run verify` run |
| [05 Practice](05-PRACTICE.md) warm-up drills W1–W3 and Exercise 0 | ~1 hour; the drills need only Node |
| [05 Practice](05-PRACTICE.md) 1–4 | one evening each |
| [05 Practice](05-PRACTICE.md) 5–7 | stretch goals; pair with a senior rather than budgeting them |
| [07 Trace lab](07-TRACE-LAB.md) | ~1.5 hours with the browser Network panel open |

## Glossary

Terms this course uses without stopping to define them in the chapters:

- **Invariant** — a condition that is true before an operation and must still be true after it succeeds. Example: stock is never negative.
- **Transaction** — a group of database writes that all commit or all roll back. Here, `db.$transaction(async tx => ...)` in the repositories.
- **Interactive transaction** — a Prisma transaction where you run your own JavaScript between the writes (as opposed to a fixed batch), which is what lets the reservation loop react to each result.
- **Optimistic concurrency / optimistic locking** — instead of locking a row while a human edits a form, you record the row's `version` when you read it and refuse the write if the stored version moved. The opposite is pessimistic locking, which holds a database lock.
- **Conditional update** — an `UPDATE ... WHERE id = ? AND version = ?` that reports how many rows it changed. `updateMany(...).count === 0` means somebody else got there first.
- **Stale draft / stale form** — form fields loaded from a version of the record that is no longer current.
- **409 Conflict** — the HTTP status this app returns when your write was refused because the record changed under you. **404 Not Found** means the row is gone; the repository tells those two apart deliberately.
- **Decimal** — an exact base-10 number type (`Prisma.Decimal`, PostgreSQL `numeric`). Money is stored and added with it so `0.1 + 0.2` problems cannot occur.
- **Snapshot** — a copy of a value written at the moment of a business event. `OrderItem.productName` and `OrderItem.price` are snapshots of the catalog at purchase time.
- **Idempotency** — the property that repeating the same request produces the same single effect. This app does **not** have it; exercise 4 adds it.
- **Terminal state** — a status that cannot change again. `CANCELLED` and `FULFILLED` are terminal; `PENDING` is not.
- **Envelope** — the `{ "data": [...] }` wrapper the list endpoints return, so pagination metadata has somewhere to live.

## A concrete first session

Create a product called Notebook with price `3.25` and stock `5`. Set its order quantity to `2`, use `customer-a` as the customer reference and place the order. The order total must be `6.50`, and stock becomes `3`. Reload the browser. Both the order and remaining stock should still be visible because PostgreSQL holds the data. Cancel the order and observe stock return to `5`. There is no second cancellation button because the order is now terminal; the server also rejects a repeated cancellation.

Next, try deleting Notebook. Its order history still refers to it, so deletion returns a conflict. Explain why cancelling a sale does not mean deleting its audit evidence. Create an unused Pen instead and delete that product. Those two outcomes demonstrate domain rules more clearly than a generic delete-everything endpoint.

## Reading and practice sequence

Read [the code map](01-CODEBASE-MAP.md), then [concepts](02-CONCEPTS.md). Work through [the change walkthrough](03-WORKED-CHANGE.md) with the source open. Use [testing and debugging](04-TESTING-AND-DEBUGGING.md) to investigate failures. Complete [practice](05-PRACTICE.md) before consulting [solutions and review](06-SOLUTIONS-AND-REVIEW.md). Finish with [the trace lab](07-TRACE-LAB.md) and compare your claims with [verification](VERIFICATION.md).

For each session, keep a small engineering note: the user-visible problem, the invariant you want to preserve, the files involved, the test that would fail without your change, and the remaining limitation. For example: “Stock may never go below zero; two customers compete for one unit; one order succeeds and one conflicts.” This statement drives both implementation and testing.

The customer reference is not login. There is no ownership boundary, real payment, request retry deduplication or production deployment. Learn to state these limits as precisely as the implemented features. A mid-level engineer can distinguish a passing demonstration from the evidence needed for a wider release.
