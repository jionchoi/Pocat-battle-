import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import * as voteService from '../services/votes.js';
import { REACTIONS } from '../game/community.js';

/**
 * Reactions and impressions.
 *
 * Both live here rather than on the photos controller because both are about *other people's*
 * photographs — the one file in the API whose subject is somebody else's work.
 */

export const voteSchema = z.strictObject({
  reaction: z.enum(REACTIONS as unknown as [string, ...string[]]),
});

export async function vote(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { reaction: (typeof REACTIONS)[number] };

    res.json(
      await voteService.vote(req.user!.id, req.params['photoId'] as string, body.reaction)
    );
  } catch (err) {
    next(err);
  }
}

/**
 * Batched on purpose — the client flushes every ten seconds rather than per card.
 *
 * The cap is a sanity bound rather than a policy: a reader cannot genuinely see two hundred
 * photographs in one flush interval, so a batch that size is a bug or an attempt to inflate
 * a denominator, and both deserve the same refusal.
 */
export const impressionsSchema = z.strictObject({
  photoIds: z.array(z.uuid()).min(1).max(200),
});

export async function impressions(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { photoIds: string[] };
    res.json(await voteService.recordImpressions(req.user!.id, body.photoIds));
  } catch (err) {
    next(err);
  }
}
