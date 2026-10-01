import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../app';

// Destructive fixture cleanup is permitted only in the helper-created local test database.
const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (process.env.ORDER_TEST_DATABASE !== 'owned-temporary-cluster' || target.hostname !== '127.0.0.1' || target.pathname !== '/astra_order_test') {
  throw new Error('Run npm run test:api from the project root; tests require the isolated database helper.');
}
const db = new PrismaClient(); const app = createApp(db, () => {});
beforeAll(async () => {
  const rows = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (rows[0]?.name !== 'astra_order_test') throw new Error('Refusing to reset an unexpected database.');
});
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "OrderItem", "Order", "Product" RESTART IDENTITY CASCADE'); });
afterAll(async () => { await db.$disconnect(); });
const product = (name = 'Notebook', stock = 5, price = '10.00') => db.product.create({ data: { name, stock, price } });
const checkout = (productId: string, quantity = 1) => request(app).post('/api/orders').send({ userId: 'learner', items: [{ productId, quantity }] });

describe('real PostgreSQL CRUD and inventory transactions', () => {
  it('creates a product with readable Location and decimal response', async () => {
    const response = await request(app).post('/api/products').send({ name: '  Notebook  ', price: '10.5', stock: 5 });
    expect(response.status).toBe(201); expect(response.body.data.price).toBe('10.50'); expect(response.body.data.name).toBe('Notebook');
    expect((await request(app).get(response.headers.location)).body.data.id).toBe(response.body.data.id);
  });
  it('rejects invalid precision negative stock and unexpected fields', async () => {
    for (const body of [{ name: 'x', price: '1.001', stock: 1 }, { name: 'x', price: '1', stock: -1 }, { name: 'x', price: 1.25, stock: 1 }, { name: 'x', price: '1', stock: 1, id: 'caller-id' }]) {
      expect((await request(app).post('/api/products').send(body)).status).toBe(400);
    }
    expect(await db.product.count()).toBe(0);
  });
  it('updates a product using the expected version', async () => {
    const p = await product(); const response = await request(app).patch(`/api/products/${p.id}`).send({ name: 'Updated', price: '12', stock: 8, version: p.version });
    expect(response.status).toBe(200); expect(response.body.data).toMatchObject({ name: 'Updated', price: '12.00', stock: 8, version: 2 });
  });
  it('gives competing product edits one winner', async () => {
    const p = await product(); const responses = await Promise.all(['First', 'Second'].map(name => request(app).patch(`/api/products/${p.id}`).send({ name, price: '12', stock: 8, version: 1 })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]); expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).version).toBe(2);
  });
  it('deletes an unused product and returns 404 on repeat', async () => {
    const p = await product(); expect((await request(app).delete(`/api/products/${p.id}`).send({ version: 1 })).status).toBe(204);
    expect(await db.product.findUnique({ where: { id: p.id } })).toBeNull(); expect((await request(app).delete(`/api/products/${p.id}`).send({ version: 1 })).status).toBe(404);
  });
  it('rejects stale product deletion without losing data', async () => {
    const p = await product(); expect((await request(app).delete(`/api/products/${p.id}`).send({ version: 99 })).status).toBe(409); expect(await db.product.count()).toBe(1);
  });
  it('creates an order using server prices and reserves stock', async () => {
    const p = await product(); const response = await checkout(p.id, 2);
    expect(response.status).toBe(201); expect(response.body.data).toMatchObject({ status: 'PENDING', total: '20.00' });
    expect(response.body.data.items[0]).toMatchObject({ productName: 'Notebook', price: '10.00', quantity: 2 });
    expect((await request(app).get(response.headers.location)).body.data.id).toBe(response.body.data.id);
    expect(await db.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ stock: 3, version: 2 });
  });
  it('calculates fractional decimal totals without binary floating-point drift', async () => {
    const a = await product('A', 5, '0.10'); const b = await product('B', 5, '0.20');
    const response = await request(app).post('/api/orders').send({ userId: 'learner', items: [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 2 }] });
    expect(response.status).toBe(201); expect(response.body.data.total).toBe('0.50');
  });
  it('rejects insufficient stock without an order or stock mutation', async () => {
    const p = await product('Limited', 1); const response = await checkout(p.id, 2);
    expect(response.status).toBe(409); expect(response.body.error.message).toMatch(/insufficient stock/i);
    expect(await db.order.count()).toBe(0); expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(1);
  });
  it('rolls back earlier reservations when a later cart line is invalid', async () => {
    await db.product.create({ data: { id: 'a-product', name: 'Available', price: '10', stock: 5 } });
    const response = await request(app).post('/api/orders').send({ userId: 'learner', items: [{ productId: 'a-product', quantity: 2 }, { productId: 'z-missing', quantity: 1 }] });
    expect(response.status).toBe(404); expect(await db.product.findUniqueOrThrow({ where: { id: 'a-product' } })).toMatchObject({ stock: 5, version: 1 }); expect(await db.orderItem.count()).toBe(0);
  });
  it('rejects duplicate cart lines and forged total price or status fields', async () => {
    const p = await product(); const item = { productId: p.id, quantity: 1 };
    for (const body of [{ userId: 'learner', items: [item, item] }, { userId: 'learner', items: [item], total: 0 }, { userId: 'learner', items: [{ ...item, price: 0 }] }, { userId: 'learner', items: [item], status: 'FULFILLED' }]) expect((await request(app).post('/api/orders').send(body)).status).toBe(400);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5); expect(await db.order.count()).toBe(0);
  });
  it('prevents two concurrent orders from reserving the same last unit', async () => {
    const p = await product('Last unit', 1); const responses = await Promise.all([checkout(p.id), checkout(p.id)]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]); expect(await db.order.count()).toBe(1); expect(await db.orderItem.count()).toBe(1); expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0);
  });
  it('rolls back stock when the final order insert fails', async () => {
    const p = await product();
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_order_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected order insert failure'; END; $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER fail_order_insert BEFORE INSERT ON "Order" FOR EACH ROW EXECUTE FUNCTION fail_order_insert()');
    try {
      expect((await checkout(p.id, 2)).status).toBe(500); expect(await db.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ stock: 5, version: 1 }); expect(await db.order.count()).toBe(0);
    } finally { await db.$executeRawUnsafe('DROP TRIGGER fail_order_insert ON "Order"'); await db.$executeRawUnsafe('DROP FUNCTION fail_order_insert()'); }
  });
  it('prevents stale inventory forms from restoring reserved stock', async () => {
    const p = await product(); await checkout(p.id, 2);
    const response = await request(app).patch(`/api/products/${p.id}`).send({ name: p.name, price: '10', stock: p.stock, version: p.version });
    expect(response.status).toBe(409); expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3);
  });
  it('cancels pending orders and restores stock once', async () => {
    const p = await product(); const placed = await checkout(p.id, 2); const id = placed.body.data.id;
    expect((await request(app).patch(`/api/orders/${id}/status`).send({ status: 'CANCELLED' })).status).toBe(200);
    expect(await db.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ stock: 5, version: 3 });
    expect((await request(app).patch(`/api/orders/${id}/status`).send({ status: 'CANCELLED' })).status).toBe(409); expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });
  it('competing cancellations cannot restore stock twice', async () => {
    const p = await product(); const placed = await checkout(p.id, 2); const path = `/api/orders/${placed.body.data.id}/status`;
    const responses = await Promise.all([request(app).patch(path).send({ status: 'CANCELLED' }), request(app).patch(path).send({ status: 'CANCELLED' })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]); expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });
  it('rolls back cancellation and prior restocks if a later restock fails', async () => {
    await db.product.create({ data: { id: 'a-product', name: 'First', price: '10', stock: 5 } }); await db.product.create({ data: { id: 'b-product', name: 'Fail restoration', price: '10', stock: 5 } });
    const placed = await request(app).post('/api/orders').send({ userId: 'learner', items: [{ productId: 'a-product', quantity: 1 }, { productId: 'b-product', quantity: 1 }] });
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_restock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name = 'Fail restoration' AND NEW.stock > OLD.stock THEN RAISE EXCEPTION 'injected restock failure'; END IF; RETURN NEW; END; $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER fail_restock BEFORE UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION fail_restock()');
    try {
      expect((await request(app).patch(`/api/orders/${placed.body.data.id}/status`).send({ status: 'CANCELLED' })).status).toBe(500);
      expect((await db.order.findUniqueOrThrow({ where: { id: placed.body.data.id } })).status).toBe('PENDING'); expect((await db.product.findMany()).map(p => p.stock)).toEqual([4, 4]);
    } finally { await db.$executeRawUnsafe('DROP TRIGGER fail_restock ON "Product"'); await db.$executeRawUnsafe('DROP FUNCTION fail_restock()'); }
  });
  it('fulfillment keeps reserved stock consumed and cannot be cancelled', async () => {
    const p = await product(); const placed = await checkout(p.id, 2); const path = `/api/orders/${placed.body.data.id}/status`;
    expect((await request(app).patch(path).send({ status: 'FULFILLED' })).status).toBe(200); expect((await request(app).patch(path).send({ status: 'CANCELLED' })).status).toBe(409); expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3);
  });
  it('protects product records referenced by order history', async () => {
    const p = await product(); await checkout(p.id); const current = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect((await request(app).delete(`/api/products/${p.id}`).send({ version: current.version })).status).toBe(409); expect(await db.product.count()).toBe(1); expect(await db.orderItem.count()).toBe(1);
  });
  it('keeps historical product name and price after catalog changes', async () => {
    const p = await product(); const placed = await checkout(p.id); const current = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    await request(app).patch(`/api/products/${p.id}`).send({ name: 'Renamed', price: '99', stock: current.stock, version: current.version });
    const response = await request(app).get(`/api/orders/${placed.body.data.id}`); expect(response.body.data.items[0]).toMatchObject({ productName: 'Notebook', price: '10.00' }); expect(response.body.data.total).toBe('10.00');
  });
  it('bounds list queries and orders equal timestamps by identity', async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    await db.product.createMany({ data: ['b', 'a', 'c'].map(id => ({ id, name: id, price: '1', stock: 1, createdAt })) });
    const response = await request(app).get('/api/products?limit=1&offset=1'); expect(response.body.data.map((p: { id: string }) => p.id)).toEqual(['b']);
    for (const query of ['limit=101', 'offset=-1', 'limit[]=1', 'unknown=yes']) expect((await request(app).get(`/api/products?${query}`)).status).toBe(400);
  });
  it('returns missing-resource and invalid-transition errors consistently', async () => {
    expect((await request(app).get('/api/products/missing')).status).toBe(404); expect((await request(app).get('/api/orders/missing')).status).toBe(404);
    expect((await request(app).patch('/api/orders/missing/status').send({ status: 'CANCELLED' })).status).toBe(404);
    expect((await request(app).patch('/api/orders/missing/status').send({ status: 'PAID' })).status).toBe(400);
  });
  it('returns malformed JSON errors with a matching request ID', async () => {
    const response = await request(app).post('/api/products').set('Content-Type', 'application/json').send('{');
    expect(response.status).toBe(400); expect(response.body.error.requestId).toBe(response.headers['x-request-id']); expect(response.body.error.message).toBe('Malformed JSON.');
  });
  it('database constraints reject invalid writes that bypass HTTP validation', async () => {
    await expect(db.product.create({ data: { name: 'Invalid', price: '1', stock: -1 } })).rejects.toBeDefined();
    await expect(db.product.create({ data: { name: 'Invalid', price: '0', stock: 1 } })).rejects.toBeDefined(); expect(await db.product.count()).toBe(0);
  });
});
