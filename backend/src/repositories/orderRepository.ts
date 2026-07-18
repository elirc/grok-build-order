import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function findAll() {
  return prisma.order.findMany({ include: { items: true } });
}

export async function create(data: any) {
  return prisma.order.create({ data });
}
