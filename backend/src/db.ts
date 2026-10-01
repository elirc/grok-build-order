import { PrismaClient } from '@prisma/client';
// One pool per process; tests pass their isolated client to createApp instead.
export const prisma = new PrismaClient();
