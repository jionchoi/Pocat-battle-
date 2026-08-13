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
