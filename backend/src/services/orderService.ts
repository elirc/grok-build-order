// Order service
// Key: Use transaction for createOrder to handle stock

import * as orderRepo from '../repositories/orderRepository';
import * as productRepo from '../repositories/productRepository';

export async function getOrders() {
  return orderRepo.findAll();
}

export async function createOrder(data: any) {
  // In real impl: prisma.$transaction to check and decrement stock
  // This prevents overselling
  const order = await orderRepo.create(data);
  // TODO: update product stock
  return order;
}
