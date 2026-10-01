import { PrismaClient } from '@prisma/client';
import { orderRepository } from '../repositories/orderRepository';
import { HttpError } from '../errors';
import { idSchema, orderSchema, pageSchema, statusSchema } from '../validation';
export function orderService(db: PrismaClient) {
  const repository = orderRepository(db);
  return {
    getOrders(query: unknown) { return repository.findAll(pageSchema.parse(query)); },
    async getOrder(id: string) { const order = await repository.find(idSchema.parse(id)); if (!order) throw new HttpError(404, 'Order not found.'); return order; },
    createOrder(input: unknown) { return repository.create(orderSchema.parse(input)); },
    transitionOrder(id: string, input: unknown) { return repository.transition(idSchema.parse(id), statusSchema.parse(input).status); },
  };
}
