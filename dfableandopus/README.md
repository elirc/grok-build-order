# Order and inventory service: interview pack

`astraupskill/` is the course. This folder is the job-search half: what a hiring panel asks about a small ordering service, and what is true of this one.

The repository is a root workspace with `backend/` (Express, TypeScript, Zod, Prisma 5 over PostgreSQL 18), `frontend/` (React and Vite), and `e2e/` (Playwright). There are four tables in use: `Product`, `Order`, `OrderItem`, plus `Supplier` and `PurchaseOrder`, which are declared with a comment saying they are future exercises and have no routes (`backend/prisma/schema.prisma:50-64`). The thing to interview about is stock: an order reserves it, a cancellation returns it, and a product editor that loaded the page before either of those must not be allowed to write its stale quantity back.

## The pitch

"The scaffold could create orders but never touched inventory, so the stock column was decorative. I made reservation real and made every writer of that column cooperate. Order creation reads the products, sorts the cart by product id to give overlapping carts a common lock order, and reserves each line with a single conditional update whose predicate carries the product version and `stock >= quantity`; a zero row count is a 409 rather than a negative number. Cancellation restores stock and bumps the version too, which is the point: any product edit form loaded before either event is stale and its save is refused with a 409 that the UI turns into a keep-your-draft recovery. The delivery run passed all 37 cases, 24 against real PostgreSQL."

## Target stacks

Node and TypeScript back-end roles. For .NET panels, the conditional `updateMany` maps onto `ExecuteUpdateAsync` with the same predicate or a `[ConcurrencyCheck]` column raising `DbUpdateConcurrencyException`; `Prisma.Decimal` maps onto `decimal` with an explicit column precision, which is worth saying because the money handling here is deliberate.

## Two-week plan

- Days 1 to 3: [01-INTERVIEW-QUESTIONS.md](01-INTERVIEW-QUESTIONS.md), with `backend/src/repositories/orderRepository.ts` open. It is 45 lines; read all of them.
- Days 4 and 5: [02-STORIES-AND-RESUME.md](02-STORIES-AND-RESUME.md); numbers come from `astraupskill/VERIFICATION.md` and `astraupskill/evidence/results.json`.
- Days 6 to 8: [03-CODE-READING-DRILL.md](03-CODE-READING-DRILL.md) on a clock.
- Days 9 to 11: [04-TAKE-HOME.md](04-TAKE-HOME.md) against the real suite.
- Days 12 and 13: [05-SYSTEM-DESIGN-FOLLOWUPS.md](05-SYSTEM-DESIGN-FOLLOWUPS.md).
- Daily: [06-FLASHCARDS.md](06-FLASHCARDS.md).

## Limits to say before you are asked

This service has no authentication and no ownership: `userId` arrives in the order body and is trusted (`backend/src/validation.ts:9`). It has no idempotency, so a retried `POST /api/orders` after a dropped response places a second order. There is no payment, no supplier workflow and no stock ledger, so "why did this product's stock change" can only be answered by reading orders. `/health` reports process liveness, not database readiness (`backend/src/app.ts:13`), and CORS is open (`app.ts:12`) and is not access control. All of that is written in `astraupskill/VERIFICATION.md`, and the interview answer that names a limit is stronger than the one that does not.
