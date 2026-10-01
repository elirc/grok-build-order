import { PrismaClient } from '@prisma/client';
import { productRepository } from '../repositories/productRepository';
import { HttpError } from '../errors';
import { idSchema, pageSchema, productSchema, productUpdateSchema, versionSchema } from '../validation';
export function productService(db: PrismaClient) {
  const repository = productRepository(db);
  return {
    getProducts(query: unknown) { return repository.findAll(pageSchema.parse(query)); },
    async getProduct(id: string) { const product = await repository.find(idSchema.parse(id)); if (!product) throw new HttpError(404, 'Product not found.'); return product; },
    createProduct(input: unknown) { return repository.create(productSchema.parse(input)); },
    updateProduct(id: string, input: unknown) { return repository.update(idSchema.parse(id), productUpdateSchema.parse(input)); },
    deleteProduct(id: string, input: unknown) { return repository.remove(idSchema.parse(id), versionSchema.parse(input).version); },
  };
}
