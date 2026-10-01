import { NextFunction, Request, Response } from 'express';
import { Order, OrderItem, Product } from '@prisma/client';
export const asyncRoute = (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => { Promise.resolve(handler(request, response)).catch(next); };
export const presentProduct = (product: Product) => ({ ...product, price: product.price.toFixed(2) });
export const presentOrder = (order: Order & { items: OrderItem[] }) => ({ ...order, total: order.total.toFixed(2), items: order.items.map(item => ({ ...item, price: item.price.toFixed(2) })) });
