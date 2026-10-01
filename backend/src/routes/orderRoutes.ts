import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { orderService } from '../services/orderService';
import { asyncRoute, presentOrder } from '../http';
export default function orderRoutes(db: PrismaClient) {
  const router = Router(); const service = orderService(db);
  router.get('/', asyncRoute(async (request, response) => response.json({ data: (await service.getOrders(request.query)).map(presentOrder) })));
  router.get('/:id', asyncRoute(async (request, response) => response.json({ data: presentOrder(await service.getOrder(request.params.id)) })));
  router.post('/', asyncRoute(async (request, response) => {
    const order = await service.createOrder(request.body);
    response.location(`/api/orders/${order.id}`).status(201).json({ data: presentOrder(order) });
  }));
  router.patch('/:id/status', asyncRoute(async (request, response) => response.json({ data: presentOrder(await service.transitionOrder(request.params.id, request.body)) })));
  return router;
}
