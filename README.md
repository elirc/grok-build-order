# Order and inventory learning lab

A React + Express + Prisma/PostgreSQL CRUD application for learning reliable product editing, inventory reservations and order transitions. Start with [the learning course](astraupskill/README.md).

Implemented: product create/list/read/update/delete; version-checked edits; paged product/order lists; server-priced order creation; transactional stock reservations; cancellation with one-time stock restoration; final fulfillment; historical item names/prices; structured validation and errors; a responsive UI with conflicts and confirmation dialogs.

This is a shared local demo. `userId` is a caller-provided customer reference, not authenticated identity. Supplier and PurchaseOrder models are future exercises with no implemented routes. There is no payment processing, request idempotency or deployment hardening.

## Install and verify

Prerequisites: Node 22, npm, and PostgreSQL binaries (`initdb`, `pg_ctl`, `createdb`). Verification was performed with PostgreSQL 18.1. From this project root:

```powershell
npm run install:all
npx playwright install chromium
# Override if PostgreSQL binaries are elsewhere:
$env:POSTGRES_BIN = 'C:\Program Files\PostgreSQL\18\bin'
npm run verify
```

`verify` owns a temporary loopback-only test cluster, applies the migration, runs database/frontend/browser tests and builds both apps, then stops that cluster. It never connects to your normal DATABASE_URL. Results go to `.verification`. Tests intentionally truncate tables only in the helper-created database. PostgreSQL must permit running these binaries under your account; Unix root cannot run initdb.

## Run for learning

Create a **new empty** PostgreSQL database named `order_learning` using your local database administration tools. Copy `backend/.env.example` to `backend/.env` and replace its connection placeholders. Copy `frontend/.env.example` to `frontend/.env`. Then:

```powershell
# Run from backend so Prisma reads backend/.env and schema:
Set-Location backend
npx prisma generate
npx prisma migrate deploy
Set-Location ..
npm run dev:api
# In another terminal at the project root:
npm run dev:web
```

Open Vite's local URL. Create a product, select an order quantity, enter a customer reference, and place an order. Refresh to observe database persistence. Cancellation restores stock; fulfillment leaves stock consumed. A product referenced by order history cannot be deleted.

The initial migration targets a fresh database. If you already have data from the previous schema, review a separate data-preserving migration/baseline plan; do not reset it or apply this initial migration blindly. The old Docker Compose file is optional historical scaffolding and was not executed during verification.

Commands: `npm run test:api` for isolated database cases; `npm run test:web` for frontend cases; `npm run build` for both builds. Full evidence and remaining work are explained in [VERIFICATION](astraupskill/VERIFICATION.md).
