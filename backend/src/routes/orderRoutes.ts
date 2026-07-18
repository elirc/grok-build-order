// Orders - transactional

import { Router } from 'express';
import * as orderService from '../services/orderService';

const router = Router();

router.get('/', async (req, res) => {
  const orders = await orderService.getOrders();
  res.json({ data: orders });
});

router.post('/', async (req, res) => {
  try {
    const order = await orderService.createOrder(req.body);
    res.status(201).json({ data: order });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
