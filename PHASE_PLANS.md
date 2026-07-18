

## Expanded Testing Examples (Newly Added)

Concrete examples now live in the project:

**Backend:**
- `orderService.test.ts`: Verifies inventory safety logic. Tests that orders are rejected when stock is insufficient. Uses mocks for repositories. Excellent for learning transactional business rules.

**Frontend:**
- `ProductsPage.test.tsx`: Tests product listing with inventory data using mocked API + TanStack Query.

Mid-level testing exercises:
- Write a test that ensures stock is decremented only after successful payment (mock the payment service).
- Add integration test for the checkout endpoint that returns 400 on low stock.
- Frontend test for adding items to cart and reflecting stock warnings.

This gives you hands-on examples of testing the parts that matter most in operations systems: data integrity and user feedback on errors.
