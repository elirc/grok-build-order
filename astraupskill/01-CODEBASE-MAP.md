# Follow one request through the codebase

Begin at [main.tsx](../frontend/src/main.tsx), which mounts React. [App.tsx](../frontend/src/App.tsx) creates a QueryClient for that mounted application. The client caches server responses, but it is not the database and does not own stock. [ProductsPage.tsx](../frontend/src/features/products/pages/ProductsPage.tsx) contains the catalog, product editor, cart and order history. Local component state holds unsaved input. Query state holds fetched products and orders. Keeping those categories separate prevents a background refresh from silently replacing a draft.

The [API client](../frontend/src/api/client.ts) defines Product, Order and ProductInput types. It checks the HTTP status before returning the response's `data`. A non-success response becomes an ApiError; a successful 204 returns without parsing JSON. This small boundary prevents an error object from masquerading as a product array. Types help callers during compilation; server validation remains necessary because any client can send HTTP requests.

On the server, [index.ts](../backend/src/index.ts) loads environment configuration, starts the listener and disconnects Prisma on shutdown. [app.ts](../backend/src/app.ts) constructs an injectable Express application, assigns request IDs and translates failures into consistent JSON. Tests pass a Prisma client connected to their own database. The listener and app factory are separate so tests do not need to find or reuse an ordinary development port.

There are no `controllers/`, `middleware/` or `types/` folders in this backend, and you should not go looking for them: HTTP routing lives in `backend/src/routes/` together with the small helpers in [http.ts](../backend/src/http.ts), and cross-cutting failure translation lives in [errors.ts](../backend/src/errors.ts) and [app.ts](../backend/src/app.ts). That is the whole request pipeline.

Read [product routes](../backend/src/routes/productRoutes.ts) and [order routes](../backend/src/routes/orderRoutes.ts) next. A route maps HTTP to a service call and selects status codes or a Location header. [validation.ts](../backend/src/validation.ts) defines accepted payloads and pagination bounds. Services parse unknown input and call repositories. Repositories own the database operations and transaction boundaries. See [productRepository.ts](../backend/src/repositories/productRepository.ts) for version checks and [orderRepository.ts](../backend/src/repositories/orderRepository.ts) for reservation and restoration.

## Data ownership map

| Data | Owner | Example |
| --- | --- | --- |
| Unsaved product text | React draft state | A proposed name after a conflict |
| Fetched catalog | Query cache, refreshed from API | Stock displayed on a card |
| Authoritative quantity | PostgreSQL Product | Stock checked during reservation |
| Purchase-time description and price | PostgreSQL OrderItem | Notebook at 3.25 even after catalog changes |
| Order lifecycle | PostgreSQL Order | PENDING changes once to a terminal state |

Read [schema.prisma](../backend/prisma/schema.prisma) beside the SQL migration. Prisma describes models; the migration also creates database check constraints. Supplier and PurchaseOrder are retained models for future exercises. Their presence is not evidence of implemented screens or routes.

Finally inspect [the database helper](../scripts/test-database.mjs), [backend cases](../backend/src/__tests__/orderService.test.ts), [frontend cases](../frontend/src/__tests__/ProductsPage.test.tsx) and [browser cases](../e2e/orders.spec.ts). For every behavior you explain, identify which layer of evidence supports it and which layer remains untested.
