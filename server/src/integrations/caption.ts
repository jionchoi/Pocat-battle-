import Anthropic from '@anthropic-ai/sdk';

import { config } from '../config';
import { logger } from '../logger';
import type { PoseClass, Rarity } from '../game/rules';

/**
 * Caption suggestions for the Score Result screen (README section 2 and 12).
 *
 * Two implementations behind one interface, matching the README's phasing:
 *
 *  - Phase 1: a template engine, keyed on the detected pose. No API key, no latency,
 *    no per-capture cost. This is the default and it always works.
 *  - Phase 2: an LLM writes them, using the photo's detected pose, badges and score.
 *    Enabled by setting ANTHROPIC_API_KEY; falls back to templates on any failure.
 *
 * Captions are always *suggestions* — the player edits them before sharing, so a
 * mediocre one is a mild annoyance rather than a broken feature. That is what makes the
 * silent template fallback the right behaviour on an LLM error: a caption is never worth
 * failing a capture over.
 */

export interface CaptionContext {
  pose: PoseClass;
  badges: string[];
  tier: Rarity;
  total: number;
  breedGuess: string | null;
  catNickname: string;
  isNewCat: boolean;
  goldenHour: boolean;
  catCount: number;
}

const SUGGESTION_COUNT = 3;

export async function generateCaptions(context: CaptionContext): Promise<string[]> {
  const templates = templateCaptions(context);

  if (!config.CAPTION_LLM_ENABLED || !config.ANTHROPIC_API_KEY) return templates;

  try {
    const generated = await llmCaptions(context);
    // Keep one template in the mix as a safety net — if the model produces something
    // odd, the player still has a usable option to tap.
    return [...generated, templates[0]].slice(0, SUGGESTION_COUNT);
  } catch (err) {
    logger.error({ err }, 'caption generation failed — falling back to templates');
    return templates;
  }
}

/* -------------------------------------------------------------------------- */
/* Phase 1 — templates                                                        */
/* -------------------------------------------------------------------------- */

const POSE_TEMPLATES: Record<PoseClass, string[]> = {
  yawning: [
    'Caught mid-opinion.',
    'Not a fan of mornings either.',
    'Something to say about all this.',
  ],
  jumping: ['Briefly a bird.', 'Gravity is a suggestion.', 'Sticking the landing, probably.'],
  pouncing: ['Something is about to go badly for a leaf.', 'Locked on.', 'Committed to the bit.'],
  stretching: ['Elongated beyond reason.', 'Achieving maximum length.', 'Just needed a moment.'],
  grooming: ['Busy. Come back later.', 'Mid-routine.', 'Standards to maintain.'],
  sleeping: ['Unbothered by everything.', 'Off duty.', 'Do not disturb, obviously.'],
  loafing: ['Fully assembled loaf.', 'No legs today.', 'Structurally a brick.'],
  walking: ['Places to be.', 'On patrol.', 'Somewhere to get to, apparently.'],
  sitting: ['Holding this spot.', 'Supervising.', 'Sat here on purpose.'],
  standing: ['Considering the options.', 'Mid-decision.', 'Weighing something up.'],
  unknown: ['Caught in the act.', 'Hard to explain, easy to enjoy.', 'A moment, captured.'],
};

export function templateCaptions(context: CaptionContext): string[] {
  const pool = [...POSE_TEMPLATES[context.pose]];

  // Context-specific lines go first — they are more likely to actually fit the photo
  // than a generic pose line.
  if (context.isNewCat) pool.unshift(`First sighting of ${context.catNickname}.`);
  if (context.catCount >= 2) pool.unshift('A whole committee.');
  if (context.goldenHour) pool.unshift('Caught the good light.');
  if (context.tier === 'Legendary') pool.unshift('This one is going in the frame.');
  if (context.badges.includes('Blurry but Worth It')) {
    pool.unshift('Blurry. Worth it. No regrets.');
  }

  return pool.slice(0, SUGGESTION_COUNT);
}

/* -------------------------------------------------------------------------- */
/* Phase 2 — LLM                                                              */
/* -------------------------------------------------------------------------- */

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

const SYSTEM_PROMPT = `You write short, funny captions for photos of real neighbourhood cats in a photography app.

Rules:
- Each caption is one line, at most 60 characters.
- Dry and understated beats zany. Aim for the tone of a good photo caption, not a meme template.
- Never use emoji, hashtags, or exclamation marks.
- Do not describe the photo literally — the player can already see it. React to it.
- Do not refer to scores, badges, or the app itself.`;

const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    captions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exactly two caption suggestions, each at most 60 characters.',
    },
  },
  required: ['captions'],
  additionalProperties: false,
} as const;

async function llmCaptions(context: CaptionContext): Promise<string[]> {
  const details = [
    `Pose: ${context.pose}`,
    `Cat: ${context.breedGuess ?? 'unknown breed'}, known to this player as "${context.catNickname}"`,
    context.isNewCat ? 'This is the first time anyone has photographed this cat.' : null,
    context.catCount >= 2 ? `${context.catCount} cats are in the frame.` : null,
    context.goldenHour ? 'Shot in golden-hour light.' : null,
    context.badges.length > 0 ? `Photo earned: ${context.badges.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await getClient().beta.messages.create(
    {
      model: 'claude-opus-5',
      max_tokens: 1024,
      // A caption is a short creative task, not a reasoning one — low effort keeps the
      // capture-to-reveal latency down without hurting the result.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: CAPTION_SCHEMA },
      },
      // Server-side fallback: a declined request is re-run on another model in the same
      // call rather than surfacing as a failed capture.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Write two captions for this cat photo.\n\n${details}`,
        },
      ],
    },
    // The reveal animation is waiting on this — a slow caption must not hold up a
    // capture that has already been scored.
    { timeout: 10_000 }
  );

  // `stop_reason` has to be checked before reading content: on a refusal the content
  // array is empty, and indexing into it would throw rather than degrade.
  if (response.stop_reason === 'refusal') {
    throw new Error('caption request was declined by safety classifiers');
  }

  const text = response.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text') throw new Error('caption response had no text block');

  const parsed = JSON.parse(text.text) as { captions?: unknown };

  if (!Array.isArray(parsed.captions)) {
    throw new Error('caption response did not match the schema');
  }

  return parsed.captions
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c.length <= 80);
}
