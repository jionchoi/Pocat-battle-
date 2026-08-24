import type { Request, Response, NextFunction } from 'express';

/**
 * An error with an HTTP status attached.
 *
 * Anything thrown that is not one of these is treated as a 500 — which is the correct
 * default, because an error nobody labelled is an error nobody anticipated.
 */
export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code ?? codeForStatus(status);
    this.name = 'HttpError';
  }
}

/**
 * A stable machine-readable string beside the human one.
 *
 * Derived from the status by default, because a code that has to be supplied at every throw
 * site is a code that will be forgotten at half of them. Pass one explicitly when the client
 * needs to tell two refusals with the same status apart.
 */
function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'invalid_request';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'server_error' : 'request_failed';
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
 *
 * ## The envelope is `{ error: { code, message } }`, not `{ error: "message" }`
 *
 * The client reads `payload.error.message` (src/api/client.ts) and falls back to a generic
 * "Something went wrong" when it is absent. A bare string here type-checks on both sides and
 * still throws away every message this codebase asks you to write for a player — the
 * showcase limit, the reveal quota, "that photo is not in your album". Nesting it is what
 * makes those messages reach the phone.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  /*
   * The route and the player, on the line above the stack.
   *
   * There is no request logging anywhere in this server, so a 500 used to leave a bare stack
   * and nothing to say which call produced it. From a phone the player sees only "Something
   * went wrong. Try again." — identical for every unlabelled failure in the app — so the log
   * was the only place the two could be told apart, and it did not say either.
   *
   * The id and not the email: enough to find the row in `profiles`, without copying an
   * address into a log that may end up somewhere less careful than this process.
   */
  console.error(
    `${req.method} ${req.originalUrl}${req.user ? ` user=${req.user.id}` : ' anonymous'}`
  );
  console.error(err.stack ?? err);
  res.status(500).json({
    error: { code: 'server_error', message: 'Something went wrong. Try again.' },
  });
}
