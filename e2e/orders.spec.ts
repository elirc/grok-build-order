import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const api = `http://127.0.0.1:${process.env.ORDER_API_PORT}/api`;
const name = (label: string) => `${label}-${Date.now()}`;
test('catalog CRUD persists across reload and cancelled deletion changes nothing', async ({ page }) => {
  const product = name('Notebook'); await page.goto('/');
  await page.getByLabel('Product name', { exact: true }).fill(product); await page.getByLabel('Price', { exact: true }).fill('12.50'); await page.getByLabel('Stock', { exact: true }).fill('5'); await page.getByRole('button', { name: 'Create product', exact: true }).click();
  const card = page.getByTestId('product-card').filter({ has: page.getByRole('heading', { name: product, exact: true }) });
  await expect(card).toContainText('$12.50'); await page.reload(); await expect(card).toContainText('5 in stock');
  await card.getByRole('button', { name: `Edit ${product}`, exact: true }).click(); await page.getByLabel('Price', { exact: true }).fill('13.25'); await page.getByRole('button', { name: 'Save product', exact: true }).click(); await expect(card).toContainText('$13.25');
  page.once('dialog', d => d.dismiss()); await card.getByRole('button', { name: `Delete ${product}`, exact: true }).click(); await expect(card).toBeVisible();
  page.once('dialog', d => d.accept()); await card.getByRole('button', { name: `Delete ${product}`, exact: true }).click(); await expect(card).toHaveCount(0);
});
test('order placement and cancellation reserve and restore real database stock', async ({ page, request }) => {
  const product = name('Reserve'); const customer = name('customer');
  expect((await request.post(`${api}/products`, { data: { name: product, price: '3.25', stock: 5 } })).status()).toBe(201);
  await page.goto('/'); const card = page.getByTestId('product-card').filter({ has: page.getByRole('heading', { name: product, exact: true }) });
  await page.getByLabel(`Order quantity for ${product}`, { exact: true }).fill('2'); await page.getByLabel('Customer reference').fill(customer); await page.getByRole('button', { name: 'Place order', exact: true }).click();
  const order = page.getByTestId('order-card').filter({ has: page.getByRole('heading', { name: customer, exact: true }) });
  await expect(order).toContainText('$6.50'); await expect(card).toContainText('3 in stock'); await page.reload(); await expect(order).toContainText('PENDING');
  page.once('dialog', d => d.accept()); await order.getByRole('button', { name: 'Cancel order', exact: true }).click(); await expect(order).toContainText('CANCELLED'); await expect(card).toContainText('5 in stock');
  page.once('dialog', d => d.accept()); await card.getByRole('button', { name: `Delete ${product}`, exact: true }).click(); await expect(page.getByRole('alert')).toContainText('history'); await expect(card).toBeVisible();
});
test('stale edit cannot overwrite inventory reserved by another client', async ({ page, request }) => {
  const product = name('Conflict'); const created = await request.post(`${api}/products`, { data: { name: product, price: '1.00', stock: 5 } }); const p = (await created.json()).data;
  await page.goto('/'); await page.getByRole('button', { name: `Edit ${product}`, exact: true }).click(); await page.getByLabel('Product name', { exact: true }).fill('Preserved proposal');
  expect((await request.post(`${api}/orders`, { data: { userId: 'outside-client', items: [{ productId: p.id, quantity: 1 }] } })).status()).toBe(201);
  await page.getByRole('button', { name: 'Save product', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Preserved proposal'); await expect(page.getByRole('button', { name: 'Save product', exact: true })).toBeDisabled();
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Reload current product', exact: true }).click(); await expect(page.getByLabel('Stock', { exact: true })).toHaveValue('4');
  await page.getByLabel('Product name', { exact: true }).fill(product + '-updated'); await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Product updated'); expect((await (await request.get(`${api}/products/${p.id}`)).json()).data.stock).toBe(4);
});
test('fulfillment is final and keeps reserved stock consumed', async ({ page, request }) => {
  const product = name('Fulfill'); const customer = name('ship'); const p = (await (await request.post(`${api}/products`, { data: { name: product, price: '8', stock: 2 } })).json()).data;
  await request.post(`${api}/orders`, { data: { userId: customer, items: [{ productId: p.id, quantity: 1 }] } }); await page.goto('/');
  const order = page.getByTestId('order-card').filter({ has: page.getByRole('heading', { name: customer, exact: true }) }); page.once('dialog', d => d.accept()); await order.getByRole('button', { name: 'Fulfill order', exact: true }).click(); await expect(order).toContainText('FULFILLED'); await expect(order.getByRole('button')).toHaveCount(0);
  expect((await (await request.get(`${api}/products/${p.id}`)).json()).data.stock).toBe(1);
});
test('desktop and narrow layouts stay readable without horizontal overflow', async ({ page }) => {
  const directory = process.env.ORDER_VERIFY_RESULTS_DIR; if (directory) mkdirSync(directory, { recursive: true });
  for (const [label, width] of [['desktop', 1280], ['narrow', 390]] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.goto('/'); await expect(page.getByRole('heading', { name: 'Orders & inventory', exact: true })).toBeVisible(); await expect(page.getByText('Loading products…')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (directory) await page.screenshot({ path: join(directory, `${label}.png`), fullPage: true });
  }
});
