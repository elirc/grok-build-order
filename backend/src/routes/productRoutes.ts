import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { productService } from '../services/productService';
import { asyncRoute, presentProduct } from '../http';
export default function productRoutes(db: PrismaClient) {
  const router = Router(); const service = productService(db);
  router.get('/', asyncRoute(async (request, response) => response.json({ data: (await service.getProducts(request.query)).map(presentProduct) })));
  router.get('/:id', asyncRoute(async (request, response) => response.json({ data: presentProduct(await service.getProduct(request.params.id)) })));
  router.post('/', asyncRoute(async (request, response) => {
    const product = await service.createProduct(request.body);
    response.location(`/api/products/${product.id}`).status(201).json({ data: presentProduct(product) });
  }));
  router.patch('/:id', asyncRoute(async (request, response) => response.json({ data: presentProduct(await service.updateProduct(request.params.id, request.body)) })));
  router.delete('/:id', asyncRoute(async (request, response) => { await service.deleteProduct(request.params.id, request.body); response.status(204).end(); }));
  return router;
}
