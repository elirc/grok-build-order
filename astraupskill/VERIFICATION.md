# Verification evidence and practical limits

Final result, as of the 2026-09-09 delivery run: all 37 cases passed (24 database, eight frontend, five browser), both builds passed, and the temporary PostgreSQL cluster stopped successfully. The 37 are 24 `it(` blocks in `backend/src/__tests__/orderService.test.ts`, 8 in `frontend/src/__tests__/ProductsPage.test.tsx` and 5 `test(` blocks in `e2e/orders.spec.ts`; no parametrized expansion is involved, so you can count them by hand. The [desktop](images/desktop.png) and [narrow](images/narrow.png) screenshots were visually reviewed.

This project includes three complementary test layers and a repeatable full gate. Run `npm run verify` from the root to reproduce the database, frontend, browser and build checks.

## The logs behind the numbers

Four JSON reports from the run described here are committed in [evidence/](evidence/), so you can check the counts without running anything:

| File | What it proves |
| --- | --- |
| [evidence/results.json](evidence/results.json) | The summary: `backendTests: 24`, `frontendTests: 8`, `browserTests: 5`, `tests: 37`. |
| [evidence/backend.json](evidence/backend.json) | Jest against real PostgreSQL, `numPassedTests: 24` of `numTotalTests: 24`, one entry per case. Read the case names; they are the invariant names. |
| [evidence/frontend.json](evidence/frontend.json) | The eight Vitest component cases. |
| [evidence/browser.json](evidence/browser.json) | The Playwright report: `stats` shows `"expected": 5, "unexpected": 0, "flaky": 0`. |

The text logs from that run (cluster `initdb`/start/stop, migrations, and the failed first backend run described below) were not committed (status checked 2026-10-06), so those parts of this record are statements, not inspectable files. Prerequisites are Node/npm, PostgreSQL command-line binaries and the Playwright Chromium installation matching the locked dependency version.

The verification environment used Node 22.16.0, npm 10.9.2, PostgreSQL 18.1, Prisma 5.22.0 and Playwright 1.60.0. Dependency lockfiles cover root, backend and frontend. The initial install wrapper timed out, but npm's completion logs and subsequent dependency-tree checks showed successful installs in all three locations. The actual compile and runtime checks are stronger evidence than installation alone.

The backend suite contains 24 real PostgreSQL cases. It covers valid and invalid CRUD, version contention, last-unit reservation races, decimal totals, rollback after an invalid later cart item, injected final-insert failure, cancellation rollback, competing cancellation, fulfillment, reference protection, historical snapshots, pagination and malformed JSON. The frontend suite contains eight cases with controlled fetch responses. Five Chromium scenarios cover persisted catalog CRUD, order reservation/cancellation, stale form recovery, fulfillment and desktop/narrow layouts. Build checks compile both TypeScript projects and create the Vite production bundle.

The helper creates a new temporary cluster and applies the checked-in SQL migration. It replaces DATABASE_URL for its own child processes, uses allocated loopback ports, and requires a dedicated test marker before fixture cleanup. It stops its own cluster before removing its verified temporary path. A shutdown failure retains the data directory rather than deleting a potentially running cluster. Browser servers refuse to reuse an existing listener. Existing personal databases and original project data are not test fixtures.

Earlier failed runs remain useful diagnostic evidence. The initial backend run passed 23 cases and exposed referenced-product deletion returning 500; the final constraint declaration and regression check address that response mapping. An initial sandboxed Vitest launch failed because esbuild could not read an ancestor directory; full verification uses the reviewed execution path. A browser startup run also exposed an incorrect Vite working root; the config now explicitly serves frontend, and the complete gate passed afterward. None of these failed runs was counted as a pass.

The evidence does not establish production readiness. There is no authenticated ownership, request idempotency, payment service, supplier workflow, stock ledger, capacity benchmark, power-loss test or migration of an existing database. The `/health` endpoint reports process liveness, not database readiness. CORS is not access control. Browser reload proves committed records can be fetched again; it is not a server crash-recovery or failover experiment. The historical Docker Compose scaffolding was not executed. Treat the fresh initial migration separately from any future data-preserving upgrade of an older installation.
