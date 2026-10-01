export interface Product { id: string; name: string; price: string; stock: number; version: number; }
export interface Order { id: string; userId: string; status: 'PENDING' | 'CANCELLED' | 'FULFILLED'; total: string; items: { id: string; productName: string; quantity: number; price: string }[]; }
export interface ProductInput { name: string; price: string; stock: number; }
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000/api';
export async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method, signal, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(res.status, payload?.error?.message || `Request failed (${res.status}).`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()).data as T;
}
export const fetchProducts = (offset = 0, signal?: AbortSignal) => request<Product[]>(`/products?limit=20&offset=${offset}`, 'GET', undefined, signal);
export const fetchOrders = (offset = 0, signal?: AbortSignal) => request<Order[]>(`/orders?limit=20&offset=${offset}`, 'GET', undefined, signal);
export const createProduct = (data: ProductInput) => request<Product>('/products', 'POST', data);
export const updateProduct = (id: string, data: ProductInput & { version: number }) => request<Product>(`/products/${encodeURIComponent(id)}`, 'PATCH', data);
export const deleteProduct = (id: string, version: number) => request<void>(`/products/${encodeURIComponent(id)}`, 'DELETE', { version });
export const createOrder = (data: { userId: string; items: { productId: string; quantity: number }[] }) => request<Order>('/orders', 'POST', data);
export const transitionOrder = (id: string, status: 'CANCELLED' | 'FULFILLED') => request<Order>(`/orders/${encodeURIComponent(id)}/status`, 'PATCH', { status });
