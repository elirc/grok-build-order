import { Prisma, PrismaClient } from '@prisma/client';
import { HttpError } from '../errors';
import { ProductInput, ProductUpdate, PageInput } from '../validation';
export function productRepository(db: PrismaClient) {
  return {
    findAll(page: PageInput) { return db.product.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: page.limit, skip: page.offset }); },
    find(id: string) { return db.product.findUnique({ where: { id } }); },
    create(input: ProductInput) { return db.product.create({ data: { ...input, price: new Prisma.Decimal(input.price) } }); },
    update(id: string, input: ProductUpdate) {
      return db.$transaction(async tx => {
        const { version, ...fields } = input;
        const result = await tx.product.updateMany({ where: { id, version }, data: { ...fields, price: new Prisma.Decimal(fields.price), version: { increment: 1 } } });
        if (!result.count) {
          if (!await tx.product.findUnique({ where: { id } })) throw new HttpError(404, 'Product not found.');
          throw new HttpError(409, 'Product changed. Refresh inventory before retrying.');
        }
        return tx.product.findUniqueOrThrow({ where: { id } });
      });
    },
    remove(id: string, version: number) {
      return db.$transaction(async tx => {
        const result = await tx.product.deleteMany({ where: { id, version } });
        if (!result.count) {
          if (!await tx.product.findUnique({ where: { id } })) throw new HttpError(404, 'Product not found.');
          throw new HttpError(409, 'Product changed. Refresh inventory before retrying.');
        }
      });
    },
  };
}
