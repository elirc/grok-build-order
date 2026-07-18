import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductsPage } from './features/products/pages/ProductsPage';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="p-8">
        <h1 className="text-3xl mb-8">Order Management Demo</h1>
        <ProductsPage />
      </div>
    </QueryClientProvider>
  );
}
