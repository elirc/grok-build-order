CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CANCELLED', 'FULFILLED');
CREATE TABLE "Product" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "price" DECIMAL(12,2) NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Product_price_positive" CHECK ("price" > 0),
  CONSTRAINT "Product_stock_nonnegative" CHECK ("stock" >= 0),
  CONSTRAINT "Product_version_positive" CHECK ("version" > 0)
);
CREATE TABLE "Order" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "total" DECIMAL(18,2) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Order_total_nonnegative" CHECK ("total" >= 0)
);
CREATE TABLE "OrderItem" (
  "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL, "productId" TEXT NOT NULL, "productName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL, "price" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "OrderItem_price_positive" CHECK ("price" > 0),
  CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderItem_orderId_productId_key" ON "OrderItem"("orderId", "productId");
CREATE INDEX "Product_createdAt_id_idx" ON "Product"("createdAt", "id");
CREATE INDEX "Order_createdAt_id_idx" ON "Order"("createdAt", "id");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");
CREATE TABLE "Supplier" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "PurchaseOrder" (
  "id" TEXT PRIMARY KEY, "supplierId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
