import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function findAll() {
  return prisma.product.findMany();
}

export async function create(data: any) {
  return prisma.product.create({ data });
}
