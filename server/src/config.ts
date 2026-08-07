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
   * Required, not optional.
   *
   * Scoring is the product, so a server that boots without the ability to score is a
   * server that will accept captures and fail every one of them. Better to refuse to
   * start and say which variable is missing.
   */
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),

  // Named rather than hardcoded: swapping model is a config change plus a SCORING_VERSION
  // bump, not a code edit. Must accept images and support structured output.
  OPENAI_SCORING_MODEL: z.string().min(1, 'OPENAI_SCORING_MODEL is required'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast so the app never runs with invalid or missing config.
  console.error('Invalid environment variables:');
  console.error(z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

const env = parsed.data;

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
