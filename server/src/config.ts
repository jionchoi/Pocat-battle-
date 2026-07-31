import 'dotenv/config';
import { z } from 'zod';

/**
 * Config is validated once at boot and never read from `process.env` again.
 * A missing secret should crash the process on startup, not surface as a 500 at 3am.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(24, 'JWT_ACCESS_SECRET must be at least 24 chars'),
  JWT_REFRESH_SECRET: z.string().min(24, 'JWT_REFRESH_SECRET must be at least 24 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  REDIS_URL: z.string().optional().default(''),

  VISION_PROVIDER: z.enum(['google', 'aws']).default('google'),
  GOOGLE_VISION_API_KEY: z.string().optional().default(''),
  VISION_DEV_BYPASS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Caption generation. Without a key the template engine is used (README phase 1);
  // setting one upgrades captions to the LLM path (phase 2).
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  CAPTION_LLM_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  GOOGLE_OAUTH_CLIENT_IDS: z.string().optional().default(''),
  APPLE_BUNDLE_ID: z.string().optional().default('app.catsnap.client'),

  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().default('cat-photos'),
  PHOTO_CDN_BASE_URL: z.string().optional().default(''),

  APPLE_SHARED_SECRET: z.string().optional().default(''),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),

  EXPO_ACCESS_TOKEN: z.string().optional().default(''),
  SENTRY_DSN: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  googleClientIds: parsed.data.GOOGLE_OAUTH_CLIENT_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

/**
 * The Vision bypass exists so local development does not need a billed API key. It is
 * the anti-cheat checkpoint for the entire capture loop, so it must never be on in prod.
 */
if (config.isProd && config.VISION_DEV_BYPASS) {
  throw new Error(
    'VISION_DEV_BYPASS is true in production. This disables photo verification — refusing to boot.'
  );
}

/**
 * Redis holds the submission rate limiter and the leaderboard read cache. Neither is
 * battle state any more, but both still have to be shared: a per-instance rate limit
 * multiplies the real allowance by the instance count, which is exactly the anti-farming
 * control it is meant to be.
 */
if (config.isProd && !config.REDIS_URL) {
  throw new Error(
    'REDIS_URL is required in production. Without it the submission rate limit is per-instance and can be bypassed by spreading requests across the fleet.'
  );
}

if (config.CAPTION_LLM_ENABLED && !config.ANTHROPIC_API_KEY) {
  throw new Error(
    'CAPTION_LLM_ENABLED is true but ANTHROPIC_API_KEY is not set. Unset one or the other.'
  );
}
