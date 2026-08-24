import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';
import { z } from 'zod';

import { HttpError } from './errorHandler.js';

/**
 * Body validation, in one place.
 *
 * Runs before the controller, so a controller can read `req.body` as the type its schema
 * describes without checking anything. What reaches a service has already been shaped.
 *
 * The parsed value replaces the body rather than sitting beside it: zod strips unknown
 * keys, and keeping the raw object around invites somebody to read an unvalidated field
 * off it six months from now.
 */
export function validate(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = parseOrThrow(schema, req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * The same check, callable directly.
 *
 * Query strings do not go through the middleware above, because `req.query` is a getter in
 * Express 5 and assigning the parsed value back to it throws. A controller parses `req.query`
 * with this instead and holds the result in a local — which is no worse, since a query is
 * read in one place, and it keeps one implementation of what a validation failure looks like.
 */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    const issues = z.flattenError(parsed.error).fieldErrors;
    throw new HttpError(400, `That request was not valid: ${JSON.stringify(issues)}`);
  }

  return parsed.data;
}

/**
 * A route parameter that must be a UUID, checked before it reaches a service.
 *
 * ## Why this is a guard and not a type
 *
 * Every `:photoId`, `:catId`, `:challengeId` and `:userId` in this API is a database key, and
 * until this existed not one of them was checked. Most flow into `.eq('id', value)`, where
 * supabase-js sends the value as a query-string parameter and the worst a malformed one does
 * is turn a 404 into a 500 — noise rather than a hole.
 *
 * `unfriend` was the exception, and it is the reason this file gained a function. It
 * interpolates the parameter into a PostgREST `.or()` **filter expression** on a `.delete()`:
 *
 *     .or(`and(requester_id.eq.${userId},addressee_id.eq.${otherId}),...`)
 *
 * That string is the entire WHERE clause — there is no other filter on the statement to
 * contain it. A parameter carrying `),id.not.is.null,and(requester_id.eq.` closes the
 * `and(...)` group early and adds a disjunct that is true of every row, so a filter matching
 * nothing becomes a filter matching the table. Measured against a populated table, the same
 * payload took a select from 0 rows to all of them; on the delete it is every friendship in
 * the project, removable by any signed-in player.
 *
 * A UUID cannot contain a parenthesis, a comma or a dot, so validating the shape here removes
 * the class rather than that one call site — and the interpolation in `friends.ts` re-asserts
 * it anyway, because a guard one file away is a guard somebody can route around later.
 */
export function uuidParam(...names: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const name of names) {
      const value = req.params[name];

      if (typeof value !== 'string' || !UUID_RE.test(value)) {
        /*
         * 404 rather than 400. The parameter names a thing, and "that is not a well-formed id"
         * and "no such id" are the same answer to the caller — while telling them apart tells
         * somebody probing which of their guesses were at least the right shape.
         */
        next(new HttpError(404, 'We could not find that.'));
        return;
      }
    }

    next();
  };
}

/** Canonical 8-4-4-4-12 hex. Version and variant are Postgres' business, not ours. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
