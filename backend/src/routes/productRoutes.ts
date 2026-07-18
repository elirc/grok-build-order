// Products routes - inventory focus

import { Router } from 'express';
import * as productService from '../services/productService';

const router = Router();

router.get('/', async (req, res) => {
  const products = await productService.getProducts();
  res.json({ data: products });
});

router.post('/', async (req, res) => {
  const product = await productService.createProduct(req.body);
  res.status(201).json({ data: product });
});

export default router;
