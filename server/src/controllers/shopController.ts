import type { Request, Response } from 'express';
import { z } from 'zod';

import { authOf } from '../middleware/auth';
import { catalog, purchase } from '../services/shopService';

export const purchaseSchema = z.object({
  platform: z.enum(['ios', 'android']),
  productId: z.string().min(3),
  receipt: z.string().min(10),
});

export async function getCatalog(req: Request, res: Response) {
  res.json(await catalog(authOf(req).userId));
}

export async function postPurchase(req: Request, res: Response) {
  const { userId } = authOf(req);
  const body = req.body as z.infer<typeof purchaseSchema>;

  const result = await purchase({
    userId,
    platform: body.platform,
    productId: body.productId,
    receipt: body.receipt,
  });

  // Fresh catalogue and balance come back with the purchase so the shop does not need a
  // follow-up request to update its own state.
  res.json({ ...result, ...(await catalog(userId)) });
}
