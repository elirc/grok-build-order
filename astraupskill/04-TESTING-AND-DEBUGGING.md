# Test the failure boundary, not only the happy path

Run `npm run test:api` from the project root for database cases, `npm run test:web` for frontend cases, and `npm run verify` for the complete build and browser gate. Read [the helper](../scripts/test-database.mjs) before changing these commands. It allocates a loopback port, creates a temporary PostgreSQL cluster, creates `astra_order_test`, generates Prisma, applies the migration and invokes Jest. Cleanup stops only the cluster directory it created. If shutdown cannot be confirmed, the directory is retained for investigation.

The backend suite additionally requires the helper marker, loopback hostname and exact database name before any table truncation. These guards are protections against accidental test configuration, not a sandbox against intentionally malicious code. Never remove them just to point the suite at your normal database. If initdb fails, inspect its log and binary path rather than bypassing isolation.

## The three commands

Each layer has its own root script; only `verify` builds and runs the browser gate. From `package.json`, `scripts`:

```bash
npm run test:api   # node scripts/test-database.mjs backend (jest --runInBand)
npm run test:web   # npm test --prefix frontend -- --run    (vitest)
npm run verify     # node scripts/test-database.mjs verify
```

## Three complementary layers

[Backend tests](../backend/src/__tests__/orderService.test.ts) send real HTTP requests through Supertest and use real PostgreSQL transactions. They cover precision, unknown fields, CRUD versions, final-unit contention, historical snapshots, one-time cancellation and database constraints. SQL triggers deliberately fail an order insert or a later restock. Those cases check that earlier changes roll back as well. A mocked repository returning success could not establish those properties.

[Frontend tests](../frontend/src/__tests__/ProductsPage.test.tsx) run React in jsdom with a controlled fetch boundary. They inspect submitted payloads, failed loads, confirmation cancellation, empty 204 responses, retained order quantities and stale drafts. These cases make UI recovery easy to isolate. They do not prove PostgreSQL behavior because fetch is replaced.

[Browser tests](../e2e/orders.spec.ts) run Chromium, the actual API and the temporary database. They create and reload catalog records, reserve and restore stock, check fulfillment and exercise a stale edit caused by another HTTP client. Layout checks inspect document width at desktop and narrow sizes and capture screenshots. Passing width checks alone does not establish full accessibility or visual correctness.

## A debugging routine

For an unexpected 500, record the response requestId and reproduce with the smallest payload. Inspect the server-side error and database log; avoid returning raw SQL details to the browser. For a 409, inspect the current version and status before retrying. For a failing browser test, compare the API response with the visible state: was the mutation rejected, was the cache not refreshed, or was a form deliberately preserved?

One verification run found referenced-product deletion returning 500. PostgreSQL rejected the delete correctly, but the initial RESTRICT constraint did not produce the handled ORM error on the tested stack. The final migration uses non-deferrable NO ACTION references and the regression still requires 409 plus preserved records. This illustrates why asserting only “an error occurred” is too weak.

Do not increase timeouts to hide a deadlock without investigation. Keep failed logs, identify the layer, fix the cause and rerun affected checks. A passing suite describes exercised behavior under its environment; it does not prove power-loss recovery, production capacity or authenticated ownership.
