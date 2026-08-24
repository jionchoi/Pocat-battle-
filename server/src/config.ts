import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env into process.env.
dotenv.config();

/**
 * Runtime configuration, validated once at boot.
 *
 * Everything the server needs is declared here and nowhere else. A missing or malformed
 * value stops the process immediately with the variable named, rather than surfacing as a
 * confusing failure inside the first request that happens to need it.
 */
const envSchema = z.object({
  // The client defaults to http://localhost:4000 — see src/api/client.ts in the app.
  PORT: z.string().default('4000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  SUPABASE_URL: z.url('SUPABASE_URL must be the project URL, e.g. https://xxx.supabase.co'),

  // Bypasses row level security. Server only — see the warning in .env.example.
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  /*
   * Optional, so the rest of the app can be built before the scorer is paid for.
   *
   * Missing them is not tolerated silently: with no key the server refuses to score at
   * all unless SCORING_STUB is on, and then it stamps every score it invents so those rows
   * can never be mistaken for real ones.
   */
  OPENAI_API_KEY: z.string().optional(),

  // Named rather than hardcoded: swapping model is a config change plus a SCORING_VERSION
  // bump, not a code edit. Must accept images and support structured output.
  OPENAI_SCORING_MODEL: z.string().optional(),

  /*
   * How much of the photograph the model is billed for looking at.
   *
   * This is the spend lever §2 asks for when it says to downsample *at the call* rather than
   * lowering `maxPhotoWidth` again — degrading the stored photograph to save on a request is
   * paying for it in the one place the player can see.
   *
   * `low` is a flat, fixed image cost regardless of the file's size, which is a far larger
   * saving than any resize could give and needs no image library on this server. It costs
   * fidelity, and composition is a third of the score, so it is not the default: turn it on
   * when spend is actually the binding constraint and bump SCORING_VERSION when you do,
   * because it changes what the model can see.
   */
  OPENAI_IMAGE_DETAIL: z.enum(['auto', 'low', 'high']).default('auto'),

  /*
   * Makes the stub answer "there is no cat in this".
   *
   * `no_cat` and `no_cat_at` have never executed — the stub hardcoded `isCat: true`, so the
   * guard that stops a second paid look at a photograph the model already rejected has never
   * run once. This flag is how that path gets exercised without a key and without waiting to
   * photograph something that is not a cat.
   *
   * Only meaningful with SCORING_STUB on; ignored otherwise.
   */
  SCORING_STUB_NO_CAT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /*
   * Invent scores locally instead of calling anybody.
   *
   * For building the capture loop end to end without a key. Deliberately a separate switch
   * rather than "fall back when the key is missing" — a fallback turns a misconfigured
   * production server into one that quietly makes its scores up, and the whole game is
   * those numbers meaning something.
   */
  SCORING_STUB: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /*
   * How many reverse proxies sit in front of this process.
   *
   * Rate limiting by address is only as honest as the address, and behind a proxy the socket
   * belongs to the proxy — every caller looks like one client. Express fixes that by reading
   * `X-Forwarded-For`, but that header is written by whoever is talking to you unless
   * something in the path overwrites it.
   *
   * So this is a *count*, never a boolean. `app.set('trust proxy', true)` takes the leftmost
   * value in the header, which the client supplied, so an attacker sends a fresh one per
   * request and every per-address limit below becomes decoration. A count of 1 means "take
   * the address one hop in", which is the entry the proxy itself appended and the caller
   * could not forge.
   *
   * Default 0: trust nothing, use the socket address. Correct for local development and for
   * any host where this process is reachable directly. Set it to the number of proxies you
   * actually have — one for most platform hosts — and no higher. Guessing high is the
   * failure that looks like it works.
   */
  TRUST_PROXY: z
    .string()
    .default('0')
    .transform((value) => Number.parseInt(value, 10))
    .refine((n) => Number.isInteger(n) && n >= 0 && n <= 10, 'TRUST_PROXY must be 0-10'),

  /*
   * Turns the limiters off. Development only — `config.ts` refuses it in production below.
   *
   * Exists for device testing, where one phone plus a reloading Expo client can look like a
   * flood and the limit you hit is your own.
   */
  RATE_LIMIT_DISABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast so the app never runs with invalid or missing config.
  console.error('Invalid environment variables:');
  console.error(z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

const env = parsed.data;

/*
 * Two ways to have no scorer, and only one of them is allowed to run.
 *
 * Stubbed scores in production would be a leaderboard built on numbers nobody produced, so
 * that combination stops the process rather than being logged and carried on with.
 */
if (env.SCORING_STUB && env.NODE_ENV === 'production') {
  console.error('SCORING_STUB cannot be enabled in production.');
  process.exit(1);
}

/*
 * Same argument as SCORING_STUB: a switch that exists to make local work bearable must not be
 * the thing standing between a deployed server and whoever finds it.
 */
if (env.RATE_LIMIT_DISABLED && env.NODE_ENV === 'production') {
  console.error('RATE_LIMIT_DISABLED cannot be enabled in production.');
  process.exit(1);
}

if (!env.SCORING_STUB && !env.OPENAI_API_KEY) {
  console.warn(
    '[config] No OPENAI_API_KEY. Captures will be stored but every score will fail. ' +
      'Set SCORING_STUB=true to invent scores locally while building.'
  );
}

/**
 * Where user tokens are verified against, and who must have issued them.
 *
 * Both are derived rather than configured. They are fixed functions of the project URL,
 * and a second copy in the environment is a second thing to get wrong — one that would
 * fail *open* if the issuer were left blank.
 *
 * This project signs with an ECC (P-256) key, so there is no shared secret anywhere in
 * this file. The server fetches the public half from the JWKS endpoint, which is also why
 * rotating to a standby key in the dashboard needs no change here.
 */
export const config = {
  ...env,
  SUPABASE_JWKS_URL: `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  SUPABASE_ISSUER: `${env.SUPABASE_URL}/auth/v1`,
} as const;
