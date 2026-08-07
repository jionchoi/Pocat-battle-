import type { Request, Response, NextFunction } from 'express';

/**
 * An error with an HTTP status attached.
 *
 * Anything thrown that is not one of these is treated as a 500 — which is the correct
 * default, because an error nobody labelled is an error nobody anticipated.
 */
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

/**
 * The single place a response gets its error shape.
 *
 * Registered last in app.ts, so every controller can simply `next(err)` and stop thinking
 * about status codes and JSON envelopes.
 *
 * Unlabelled errors are logged with their stack and answered with a generic message: the
 * stack belongs in the server log, not in a response body where it tells a stranger which
 * table a query touched. Deliberate `HttpError`s are the opposite — their messages are
 * written to be read by the person holding the phone, so they are passed through intact.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  console.error(err.stack ?? err);
  res.status(500).json({ error: 'Internal server error' });
}
