import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';

import { errors } from '../errors';

/**
 * Schema validation at the edge.
 *
 * Parsed output replaces the raw input, so controllers receive coerced, trimmed,
 * known-shaped data and never have to re-check it. Unknown keys are stripped by Zod
 * objects, which is what stops a client smuggling `{ total: 100 }` into an update.
 */

type Source = 'body' | 'query' | 'params';

export function validate<T>(schema: ZodSchema<T>, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[source]);
      // Query and params are read-only getters on newer Express typings, so assign through
      // a cast rather than reassigning the property.
      (req as unknown as Record<Source, unknown>)[source] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        }));
        next(errors.badRequest('Some of those details are not valid.', details));
        return;
      }
      next(err);
    }
  };
}
