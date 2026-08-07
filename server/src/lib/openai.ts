import { z } from 'zod';

import { config } from '../config.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  SCORING_VERSION,
  buildScoringPrompt,
  scoringResponseSchema,
  type ScoringResponse,
} from '../game/scoring.js';

/**
 * The one call.
 *
 * Sends a downscaled photograph and gets back a score, a pose, badges and a description of
 * the animal — everything the capture pipeline needs from a model, in a single request.
 * Splitting it into "look at it" and "judge it" would pay twice for the same image.
 *
 * Plain `fetch` rather than a vendor SDK. There is exactly one endpoint being called, the
 * request is a JSON body, and a dependency here would be a dependency on someone else's
 * release schedule for the sake of a wrapper around `POST`.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * A slow model must not hold a request open forever.
 *
 * The player is watching a progress ring while this runs, and a capture that hangs for two
 * minutes is worse than one that fails in thirty seconds and can be revealed again from
 * the album — the photograph is already safe in storage either way.
 */
const TIMEOUT_MS = 45_000;

/**
 * Derived from the zod schema, so the shape asked for and the shape validated cannot drift.
 *
 * `additionalProperties: false` and every field required is what strict structured output
 * needs; `io: 'output'` makes zod emit the schema for what comes *out* of the model rather
 * than what could go in.
 */
const jsonSchema = z.toJSONSchema(scoringResponseSchema, { io: 'output' });

export interface ScoredImage {
  result: ScoringResponse;
  model: string;
  version: string;
}

/**
 * Scores one photograph.
 *
 * Throws rather than returning a fallback score. A photograph that could not be judged has
 * no score, and inventing a neutral one would put a number on a leaderboard that no model
 * ever gave — the row stays unscored and the player can spend another reveal on it.
 */
export async function scorePhoto(image: Buffer): Promise<ScoredImage> {
  if (config.SCORING_STUB) return stubScore(image);

  if (!config.OPENAI_API_KEY || !config.OPENAI_SCORING_MODEL) {
    /*
     * Refused rather than faked. A server with no scorer configured must not quietly
     * produce numbers — the photo stays unscored and revealable, which is exactly the
     * state the schema already has a shape for.
     */
    throw new HttpError(503, 'Scoring is not configured yet. Your photo is saved.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.OPENAI_SCORING_MODEL,
        /*
         * The image goes in as a data URI. It has already been resized on the phone before
         * upload, so this is the same handful of hundred kilobytes that reached storage —
         * there is nothing to gain by handing the model a larger copy it would only
         * downsample itself, and image cost scales with pixels.
         */
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: buildScoringPrompt() },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` },
              },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'cat_frame_score', strict: true, schema: jsonSchema },
        },
        /*
         * Not a knob for creativity here. Scoring should be as close to repeatable as a
         * language model gets, and every point of variance is a player wondering why an
         * identical shot scored differently from their friend's.
         */
        temperature: 0,
      }),
    });
  } catch (err) {
    clearTimeout(timeout);

    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpError(504, 'Scoring took too long. Your photo is saved — try revealing it again.');
    }
    throw new HttpError(502, 'We could not reach the scorer. Your photo is saved.');
  }

  clearTimeout(timeout);

  if (!response.ok) {
    // The body carries the provider's own explanation, which belongs in our log and
    // nowhere near a player — it can name models, quotas and account state.
    console.error('[scoring] provider returned', response.status, await response.text());
    throw new HttpError(502, 'The scorer refused that photo. Your photo is saved.');
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string; refusal?: string } }[];
  };

  const message = payload.choices?.[0]?.message;

  /*
   * A refusal is a successful HTTP response carrying a decline, so it has to be checked
   * separately or it reads as an empty content field and fails as a parse error two lines
   * later — which would say "malformed response" about something perfectly well formed.
   */
  if (message?.refusal) {
    console.error('[scoring] provider refused:', message.refusal);
    throw new HttpError(422, 'That photo could not be judged. Try another shot.');
  }

  if (!message?.content) {
    throw new HttpError(502, 'The scorer sent nothing back. Your photo is saved.');
  }

  const parsed = scoringResponseSchema.safeParse(JSON.parse(message.content));

  if (!parsed.success) {
    /*
     * Structured output makes this unlikely, not impossible — and the difference matters,
     * because the failure mode without this check is a NaN reaching a leaderboard row that
     * can never be recomputed.
     */
    console.error('[scoring] response failed validation:', z.flattenError(parsed.error));
    throw new HttpError(502, 'The scorer sent something we could not read. Your photo is saved.');
  }

  return {
    result: parsed.data,
    model: config.OPENAI_SCORING_MODEL,
    version: SCORING_VERSION,
  };
}

/* -------------------------------------------------------------------------- */
/* The stub                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A score invented locally, for building the loop before the scorer exists.
 *
 * Derived from the image's own bytes rather than from `Math.random`, so the same photograph
 * always scores the same. A reveal that produced a different number every time would make
 * every other part of the pipeline impossible to test — you could never tell a bug from
 * the dice.
 *
 * Every field is plausible and none of it is real. `model: 'stub'` goes into the row, so
 * these are identifiable forever and can be deleted or re-scored once a key exists.
 */
function stubScore(image: Buffer): ScoredImage {
  // A cheap, stable hash of the file. Any change to the photograph changes the score.
  let hash = 0;
  for (let i = 0; i < image.length; i += 997) {
    hash = (hash * 31 + image[i]!) >>> 0;
  }

  const pick = <T>(values: readonly T[], salt: number): T =>
    values[(hash + salt) % values.length]!;

  const composition = 18 + ((hash >>> 2) % 20);
  const poseRarity = (hash >>> 5) % 22;
  const catRarity = (hash >>> 8) % 20;
  const bonus = (hash >>> 11) % 12;

  return {
    result: {
      isCat: true,
      confidence: 0.9,
      pose: pick(
        ['sitting', 'standing', 'walking', 'sleeping', 'loafing', 'yawning', 'stretching'],
        0
      ),
      scores: { composition, poseRarity, catRarity, bonus },
      badges: bonus > 8 ? [pick(['Golden Hour', 'Perfect Loaf', 'Caught Mid-Yawn'], 3)] : [],
      traits: {
        coatPattern: pick(['tabby', 'tuxedo', 'calico', 'solid', 'tortie'], 1),
        primaryColor: pick(['orange', 'grey', 'black', 'white', 'brown'], 2),
        secondaryColor: null,
        eyeColor: pick(['green', 'amber', 'blue'], 4),
        markings: [],
      },
      note: 'Stubbed score — no model was called.',
    },
    model: 'stub',
    version: SCORING_VERSION,
  };
}
