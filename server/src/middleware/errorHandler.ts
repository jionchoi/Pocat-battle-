import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { ApiError, errors } from '../errors';
import { logger } from '../logger';

/**
 * Terminal error handler.
 *
 * The rule this enforces: a client sees a typed code and a sentence written for a player.
 * Stack traces, Prisma messages and SQL never cross the boundary — they go to the log.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  let apiError: ApiError;

  if (err instanceof ApiError) {
    apiError = err;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    apiError = mapPrismaError(err);
  } else {
    apiError = errors.internal();
  }

  // 5xx is our fault and gets the full error; 4xx is expected traffic and stays quiet.
  if (apiError.status >= 500) {
    logger.error(
      { err, path: req.path, method: req.method, userId: req.auth?.userId },
      'request failed'
    );
  } else {
    logger.debug(
      { code: apiError.code, path: req.path, userId: req.auth?.userId },
      'request rejected'
    );
  }

  res.status(apiError.status).json({ error: apiError.toJSON() });
}

function mapPrismaError(err: Prisma.PrismaClientKnownRequestError): ApiError {
  switch (err.code) {
    case 'P2002':
      // Unique constraint. The field name is safe to surface; the query is not.
      return errors.conflict('That already exists.');
    case 'P2025':
      return errors.notFound('We could not find that.');
    case 'P2003':
      return errors.badRequest('That reference is no longer valid.');
    default:
      return errors.internal();
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: 'That endpoint does not exist.' },
  });
}
