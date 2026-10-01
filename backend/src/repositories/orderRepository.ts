import { OrderStatus, Prisma, PrismaClient } from '@prisma/client';
import { HttpError } from '../errors';
import { OrderInput, PageInput } from '../validation';
const details = { items: { orderBy: { productId: 'asc' as const } } };
export function orderRepository(db: PrismaClient) {
  return {
    findAll(page: PageInput) { return db.order.findMany({ include: details, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: page.limit, skip: page.offset }); },
    find(id: string) { return db.order.findUnique({ where: { id }, include: details }); },
    create(input: OrderInput) {
      return db.$transaction(async tx => {
        // A common lock order reduces deadlock risk for overlapping carts.
        const requested = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
        const products = await tx.product.findMany({ where: { id: { in: requested.map(item => item.productId) } } });
        const byId = new Map(products.map(product => [product.id, product]));
        let total = new Prisma.Decimal(0);
        const lines: { productId: string; productName: string; quantity: number; price: Prisma.Decimal }[] = [];
        for (const item of requested) {
          const product = byId.get(item.productId);
          if (!product) throw new HttpError(404, 'A requested product was not found.');
          if (product.stock < item.quantity) throw new HttpError(409, `Insufficient stock for ${product.name}.`);
          // The condition and decrement are one database write, not a read-then-write promise.
          const reserved = await tx.product.updateMany({ where: { id: product.id, version: product.version, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity }, version: { increment: 1 } } });
          if (!reserved.count) throw new HttpError(409, 'Inventory changed during checkout. Refresh and retry.');
          total = total.add(product.price.mul(item.quantity));
          lines.push({ productId: product.id, productName: product.name, quantity: item.quantity, price: product.price });
        }
        // Failure here rolls back every earlier reservation in the same transaction.
        return tx.order.create({ data: { userId: input.userId, total, items: { create: lines } }, include: details });
      }, { maxWait: 10_000, timeout: 15_000 });
    },
    transition(id: string, target: 'CANCELLED' | 'FULFILLED') {
      return db.$transaction(async tx => {
        const order = await tx.order.findUnique({ where: { id }, include: details });
        if (!order) throw new HttpError(404, 'Order not found.');
        if (order.status !== OrderStatus.PENDING) throw new HttpError(409, 'Only pending orders can transition.');
        const changed = await tx.order.updateMany({ where: { id, status: OrderStatus.PENDING }, data: { status: target } });
        if (!changed.count) throw new HttpError(409, 'Order status changed. Refresh and retry.');
        if (target === OrderStatus.CANCELLED) {
          for (const item of order.items) await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity }, version: { increment: 1 } } });
        }
        return tx.order.findUniqueOrThrow({ where: { id }, include: details });
      });
    },
  };
}
