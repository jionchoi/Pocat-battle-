import type { Request, Response } from 'express';
import { z } from 'zod';

import { authOf } from '../middleware/auth';
import { serializeSighting } from '../serializers/photo';
import { parseBbox, sightingsInBox } from '../services/mapService';

export const bboxSchema = z.object({
  bbox: z.string().min(7),
});

export async function sightings(req: Request, res: Response) {
  const { userId } = authOf(req);
  const box = parseBbox((req.query as { bbox?: string }).bbox);

  const rows = await sightingsInBox(box);

  res.json({
    sightings: rows.map((row) => ({
      ...serializeSighting(row),
      // Powers the "My photos" vs "Community sightings" toggle on the map without a
      // second request.
      isMine: row.reportedByUserId === userId,
    })),
  });
}
