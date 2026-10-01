import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductsPage } from './features/products/pages/ProductsPage';
export default function App() {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><ProductsPage /></QueryClientProvider>;
}
