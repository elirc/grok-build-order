/**
 * Test for ProductsPage in order management context.
 * 
 * Demonstrates testing data fetching components.
 */

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductsPage } from '../features/products/pages/ProductsPage';
import { vi } from 'vitest';

const queryClient = new QueryClient();

vi.mock('../../../api/client', () => ({
  fetchProducts: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Laptop', stock: 5, price: 999 }] }),
}));

test('renders product inventory', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <ProductsPage />
    </QueryClientProvider>
  );

  expect(await screen.findByText(/laptop/i)).toBeInTheDocument();
  expect(screen.getByText(/stock: 5/i)).toBeInTheDocument();
});
