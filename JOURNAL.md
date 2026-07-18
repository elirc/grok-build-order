# SWE Thought Process Journal - grokbuildorderproject

## Why Order Management?
Core operations system in many companies. Involves:
- Money and inventory (critical data)
- Multi-step processes (order -> fulfill -> ship)
- Concurrency issues (stock levels)
- Different roles (sales, warehouse, finance)
- Reporting needs

Represents real mid-size company backend work.

## Key Decisions

### Inventory & Transactions
Orders must check and update stock atomically. Use DB transactions in service layer.
This teaches ACID properties and why services matter.

### Order Status Machine
Use enum + service methods for transitions (PENDING -> PAID -> SHIPPED).
Prevents invalid states.

### Separation of Concerns
Customer orders vs internal purchase orders.
Different APIs or clear scoping.

### Frontend
Cart as local state + sync to backend.
Order history as server state via TanStack Query.

## Architecture
Same layered as HR project for consistency in learning.
Emphasize query optimization for reports.

Common pitfalls: Race conditions on stock, poor error handling on checkout, mixing customer and admin logic.
