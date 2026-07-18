/**
 * Tests for orderService - focus on inventory/transaction logic
 * 
 * Mid-level learning:
 * - Test that stock is checked before creating order
 * - Use mocks to simulate DB
 * - Verify transaction behavior (even if stubbed)
 */

import * as orderService from '../services/orderService';
import * as orderRepo from '../repositories/orderRepository';
import * as productRepo from '../repositories/productRepository';
import { vi } from 'vitest';

vi.mock('../repositories/orderRepository');
vi.mock('../repositories/productRepository');

describe('orderService - inventory safety', () => {
  it('should not create order if insufficient stock', async () => {
    vi.spyOn(productRepo, 'findAll').mockResolvedValue([{ id: 'p1', stock: 1 } as any]);
    const createSpy = vi.spyOn(orderRepo, 'create');

    await expect(orderService.createOrder({ items: [{ productId: 'p1', quantity: 5 }] }))
      .rejects.toThrow(/insufficient stock/i);

    expect(createSpy).not.toHaveBeenCalled();
  });
});
