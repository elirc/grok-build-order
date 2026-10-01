# Trace lab: one order, two clients, one inventory balance

Use a new persistent local learning database configured according to [setup](../README.md). Keep the browser Network panel open. The automated equivalent runs safely inside the temporary cluster through `npm run verify`. Do not run the destructive backend fixtures against your interactive database.

Create Notebook with price `3.25` and stock `5`. Inspect the POST `/api/products` request: price is a string, stock is an integer, and no caller-selected ID is sent. The response is 201 with a Location header. Follow that path with GET and compare the ID, price and version. The list endpoint returns an envelope containing a `data` array; the API client unwraps it before React sees the value.

Set quantity to `2` and enter `trace-customer`. Place the order. Its request should resemble:

```json
{"userId":"trace-customer","items":[{"productId":"COPY_THE_REAL_ID","quantity":2}]}
```

There is no total, price, status or product name in the request. Find the corresponding strict schema and explain what happens if you add a forged total. Follow service parsing into the repository transaction: fetch products, conditionally decrement stock and increment version, calculate Decimal totals, snapshot item name and price, insert the order and return it. The final total is `6.50`; remaining stock is `3`.

Now open an edit form before another client changes inventory. You can use a second browser tab to place another one-unit order. Return to the older form, change its name and save. Inspect the submitted version and the 409 response. The draft remains visible. Compare the refreshed catalog stock with the disabled draft stock. Confirm “Reload current product,” reapply your intended name change and save. Explain why automatically replacing only the version would be unsafe.

Cancel the first order. Observe the status transition and stock restoration. Repeat the transition directly from a local API client using the same order ID: the expected result is 409 and unchanged stock. The absence of a second cancel button is useful UX; the server condition is the actual consistency guard.

Finally change the catalog price and compare an older order. Its item price and name remain the purchase-time snapshot. Attempt to delete the referenced product. Expect conflict and preserved order history. Delete a separate unused product to demonstrate successful 204 handling without JSON parsing.

Write a trace table with columns for action, HTTP request, database invariant, response and UI recovery. Include at least one failed action. Finish by explaining two limitations: a lost successful order response can still lead to a duplicate on retry, and any local client can use another customer reference because authentication is absent. Accurate boundaries are part of the lab, not optional footnotes.
