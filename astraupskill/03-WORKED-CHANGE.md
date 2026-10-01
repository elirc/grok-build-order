# Worked change: prevent a stale editor from restoring sold stock

The original scaffold could create order rows but did not implement the promised stock transaction. Once reservation exists, another bug becomes possible: a product editor opened earlier can overwrite the new quantity. This walkthrough follows the delivered solution. Keep [the product repository](../backend/src/repositories/productRepository.ts), [order repository](../backend/src/repositories/orderRepository.ts) and [product screen](../frontend/src/features/products/pages/ProductsPage.tsx) open beside it.

## Reproduce the business problem

Imagine Product A has stock `5`, version `1`. Alice opens its edit form. Bob places an order for one unit, leaving stock `4`, version `2`. Alice changes only the name, but her form still contains stock `5`. An ordinary “update every submitted field by ID” operation would erase Bob's reservation. Both users performed reasonable actions; the server must arbitrate their overlap.

The request now includes the version Alice actually read:

```json
{"name":"Renamed notebook","price":"3.25","stock":5,"version":1}
```

Product input validation requires that version to be a positive integer. The repository performs `updateMany` with both `id` and `version` in its condition. Its data increments version while replacing allowed fields. If the count is zero, the repository distinguishes a missing product from a changed product and throws 404 or 409 respectively. A transaction keeps the winning write and returned row together.

## Make all inventory writers cooperate

A version column is ineffective if only the editor increments it. Order reservation also increments Product.version. Cancellation increments it while restoring stock. Therefore any form loaded before a stock movement is stale. This is a code-review question you can answer by searching for every product stock write, rather than trusting the first method you find.

The order transaction first reads the product and then conditionally reserves quantity using its fetched version and sufficient stock. Competing orders cannot both consume the same final unit. Sorting product IDs gives transactions a consistent reservation order, reducing lock-order contention. It is not a promise that all possible database deadlocks disappear.

## Give the user a safe recovery path

The API client turns 409 into ApiError. The screen retains the proposed form text, reports the error, refreshes fetched data and disables the stale save. “Reload current product” asks before discarding the proposal and creates a new draft from current fields and version. The learner must reapply intended changes against the latest stock. Merely replacing the version token while keeping old stock would allow the same lost update on the next click.

## Prove the change

The backend case creates a product, reserves stock, submits the original version and checks that stock remains reduced. The browser case performs the same race through an open editor and a separate HTTP request, then checks draft preservation and explicit reload. These tests support different claims: server rejection and usable recovery. Add a test for cancellation overlapping an edit as your first extension. The expected result is a conflict that preserves restored stock, not a clever automatic merge of unrelated fields.
