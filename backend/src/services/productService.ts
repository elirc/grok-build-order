// Product service - stock management

import * as productRepo from '../repositories/productRepository';

export async function getProducts() {
  return productRepo.findAll();
}

export async function createProduct(data: any) {
  return productRepo.create(data);
}
