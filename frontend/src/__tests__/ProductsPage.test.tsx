import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import { request } from '../api/client';
const initial = { id: 'p1', name: 'Notebook', price: '10.00', stock: 5, version: 1 };
let current = { ...initial }; let requests: { url: string; method: string; body: unknown }[];
beforeEach(() => {
  current = { ...initial }; requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const method = options?.method || 'GET'; const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    requests.push({ url: String(url), method, body });
    return new Response(JSON.stringify({ data: String(url).includes('/products') ? [current] : [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('renders catalog data and the explicit demo identity boundary', async () => {
  render(<App />); expect(await screen.findByRole('heading', { name: 'Notebook' })).toBeInTheDocument();
  expect(screen.getByText(/Accounts and access control are not implemented/)).toBeInTheDocument();
  expect(screen.getByText(/5 in stock/)).toBeInTheDocument();
});
it('shows HTTP load failures instead of treating an error body as a list', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Database unavailable' } }), { status: 503 }));
  render(<App />); expect(await screen.findByText(/Could not load products: Database unavailable/)).toBeInTheDocument();
});
it('sends an explicit product input with decimal text and integer stock', async () => {
  const user = userEvent.setup(); render(<App />); await screen.findByRole('heading', { name: 'Notebook' });
  await user.type(screen.getByLabelText('Product name'), 'Pen'); await user.type(screen.getByLabelText('Price'), '1.25');
  await user.clear(screen.getByLabelText('Stock')); await user.type(screen.getByLabelText('Stock'), '7'); await user.click(screen.getByRole('button', { name: 'Create product' }));
  await waitFor(() => expect(requests.find(r => r.method === 'POST')?.body).toEqual({ name: 'Pen', price: '1.25', stock: 7 }));
});
it('does not issue a delete when confirmation is cancelled', async () => {
  const user = userEvent.setup(); vi.spyOn(window, 'confirm').mockReturnValue(false); render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Delete Notebook' })); expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
});
it('preserves a conflicting draft and disables its stale write until explicit reload', async () => {
  const user = userEvent.setup(); const normal = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (options?.method === 'PATCH') { current = { ...initial, stock: 4, version: 2 }; return new Response(JSON.stringify({ error: { message: 'Refresh before updating.' } }), { status: 409 }); }
    return normal(url, options);
  });
  render(<App />); await user.click(await screen.findByRole('button', { name: 'Edit Notebook' }));
  await user.clear(screen.getByLabelText('Product name')); await user.type(screen.getByLabelText('Product name'), 'My draft'); await user.click(screen.getByRole('button', { name: 'Save product' }));
  await screen.findByText('Refresh before updating.'); expect(screen.getByLabelText('Product name')).toHaveValue('My draft'); expect(screen.getByRole('button', { name: 'Save product' })).toBeDisabled();
  vi.spyOn(window, 'confirm').mockReturnValue(true); await waitFor(() => expect(screen.getByRole('button', { name: 'Reload current product' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Reload current product' })); expect(screen.getByLabelText('Stock')).toHaveValue(4); expect(screen.getByLabelText('Product name')).toHaveValue('Notebook');
});
it('submits cart identities and quantities without browser prices', async () => {
  const user = userEvent.setup(); render(<App />); const quantity = await screen.findByLabelText('Order quantity for Notebook');
  await user.clear(quantity); await user.type(quantity, '2'); await user.type(screen.getByLabelText('Customer reference'), 'customer-a'); await user.click(screen.getByRole('button', { name: 'Place order' }));
  await waitFor(() => expect(requests.find(r => r.method === 'POST')?.body).toEqual({ userId: 'customer-a', items: [{ productId: 'p1', quantity: 2 }] }));
});
it('accepts empty 204 delete responses without attempting JSON parsing', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 })); await expect(request('/products/p1', 'DELETE', { version: 1 })).resolves.toBeUndefined();
});
it('keeps failed order quantities for correction and retry', async () => {
  const user = userEvent.setup(); const normal = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => options?.method === 'POST' ? new Response(JSON.stringify({ error: { message: 'Insufficient stock' } }), { status: 409 }) : normal(url, options));
  render(<App />); const quantity = await screen.findByLabelText('Order quantity for Notebook'); await user.clear(quantity); await user.type(quantity, '2'); await user.type(screen.getByLabelText('Customer reference'), 'customer'); await user.click(screen.getByRole('button', { name: 'Place order' }));
  await screen.findByText('Insufficient stock'); expect(quantity).toHaveValue(2);
});
