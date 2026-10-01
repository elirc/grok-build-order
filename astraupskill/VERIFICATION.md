# Verification evidence and practical limits

Final result, as of the 2026-09-09 delivery run: all 37 cases passed (24 database, eight frontend, five browser), both builds passed, and the temporary PostgreSQL cluster stopped successfully. The 37 are 24 `it(` blocks in `backend/src/__tests__/orderService.test.ts`, 8 in `frontend/src/__tests__/ProductsPage.test.tsx` and 5 in `e2e/orders.spec.ts`; no parametrized expansion is involved, so you can count them by hand. The [desktop](images/desktop.png) and [narrow](images/narrow.png) screenshots were visually reviewed.

This project includes three complementary test layers and a repeatable full gate. Run `npm run verify` from the root to reproduce the database, frontend, browser and build checks.

## The logs behind the numbers

The unedited output of the run described here is in [evidence/](evidence/), so you can check every number below without running anything:

| File | What it proves |
| --- | --- |
| [evidence/results.json](evidence/results.json) | The summary: `backendTests: 24`, `frontendTests: 8`, `browserTests: 5`, `tests: 37`. |
| [evidence/backend-tests.log](evidence/backend-tests.log) | Jest against real PostgreSQL, ending `Tests: 24 passed, 24 total` in 17.2 s. Read the case names; they are the invariant names. |
| [evidence/backend.json](evidence/backend.json) | The same run as machine-readable JSON, one entry per case. |
| [evidence/frontend.json](evidence/frontend.json) | The eight Vitest component cases (`frontend-tests.log` only records where this report was written). |
| [evidence/browser-tests.log](evidence/browser-tests.log) | The Playwright JSON report: five Chromium scenarios, `"unexpected": 0, "flaky": 0`. |
| [evidence/initdb.log](evidence/initdb.log), [evidence/postgres-start.log](evidence/postgres-start.log), [evidence/postgres-stop.log](evidence/postgres-stop.log), [evidence/migrations.log](evidence/migrations.log) | The disposable cluster really was created, started, migrated and stopped. |
| [evidence/backend-tests-first-run.log](evidence/backend-tests-first-run.log) | The **failed** earlier run: `Tests: 1 failed, 23 passed, 24 total`. Kept deliberately - see the paragraph on failed runs below. |

Three log files from the run were zero bytes because the commands they captured print nothing on success (`tsc` backend build, `createdb`, frontend typecheck); they are omitted rather than shipped as empty files. `backend-build.log` being empty *is* the pass for `tsc`. Prerequisites are Node/npm, PostgreSQL command-line binaries and the Playwright Chromium installation matching the locked dependency version.

The verification environment used Node 22.16.0, npm 10.9.2, PostgreSQL 18.1, Prisma 5.22.0 and Playwright 1.60.0. Dependency lockfiles cover root, backend and frontend. The initial install wrapper timed out, but npm's completion logs and subsequent dependency-tree checks showed successful installs in all three locations. The actual compile and runtime checks are stronger evidence than installation alone.

The backend suite contains 24 real PostgreSQL cases. It covers valid and invalid CRUD, version contention, last-unit reservation races, decimal totals, rollback after an invalid later cart item, injected final-insert failure, cancellation rollback, competing cancellation, fulfillment, reference protection, historical snapshots, pagination and malformed JSON. The frontend suite contains eight cases with controlled fetch responses. Five Chromium scenarios cover persisted catalog CRUD, order reservation/cancellation, stale form recovery, fulfillment and desktop/narrow layouts. Build checks compile both TypeScript projects and create the Vite production bundle.

The helper creates a new temporary cluster and applies the checked-in SQL migration. It replaces DATABASE_URL for its own child processes, uses allocated loopback ports, and requires a dedicated test marker before fixture cleanup. It stops its own cluster before removing its verified temporary path. A shutdown failure retains the data directory rather than deleting a potentially running cluster. Browser servers refuse to reuse an existing listener. Existing personal databases and original project data are not test fixtures.

Earlier failed runs remain useful diagnostic evidence. The initial backend run passed 23 cases and exposed referenced-product deletion returning 500; the final constraint declaration and regression check address that response mapping. An initial sandboxed Vitest launch failed because esbuild could not read an ancestor directory; full verification uses the reviewed execution path. A browser startup run also exposed an incorrect Vite working root; the config now explicitly serves frontend, and the complete gate passed afterward. None of these failed runs was counted as a pass.

The evidence does not establish production readiness. There is no authenticated ownership, request idempotency, payment service, supplier workflow, stock ledger, capacity benchmark, power-loss test or migration of an existing database. The `/health` endpoint reports process liveness, not database readiness. CORS is not access control. Browser reload proves committed records can be fetched again; it is not a server crash-recovery or failover experiment. The historical Docker Compose scaffolding was not executed. Treat the fresh initial migration separately from any future data-preserving upgrade of an older installation.
