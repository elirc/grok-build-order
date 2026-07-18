// Products with inventory focus

import { useQuery } from '@tanstack/react-query';
import { fetchProducts } from '../../../api/client';

export function ProductsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Products & Inventory</h2>
      {data?.data?.map((p: any) => (
        <div key={p.id} className="border p-2 my-1">
          {p.name} - Stock: {p.stock} - ${p.price}
        </div>
      ))}
    </div>
  );
}
