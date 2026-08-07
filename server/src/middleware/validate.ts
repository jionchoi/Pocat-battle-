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
    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      const issues = z.flattenError(parsed.error).fieldErrors;
      next(new HttpError(400, `That request was not valid: ${JSON.stringify(issues)}`));
      return;
    }

    req.body = parsed.data;
    next();
  };
}
