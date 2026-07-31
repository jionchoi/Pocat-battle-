/**
 * Typed API errors. Every failure the client can see goes through one of these so the
 * response shape is predictable and no internal detail leaks in a message.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/** Copy rules apply to these strings — they are shown to players verbatim. */
export const errors = {
  badRequest: (message = 'That request was not valid.', details?: unknown) =>
    new ApiError(400, 'bad_request', message, details),

  unauthorized: (message = 'Please sign in again.') =>
    new ApiError(401, 'unauthorized', message),

  forbidden: (message = 'You do not have access to that.') =>
    new ApiError(403, 'forbidden', message),

  notFound: (message = 'We could not find that.') =>
    new ApiError(404, 'not_found', message),

  conflict: (message = 'That is already taken.') =>
    new ApiError(409, 'conflict', message),

  tooMany: (message = 'Slow down for a moment, then try again.') =>
    new ApiError(429, 'rate_limited', message),

  internal: (message = 'Something went wrong on our side.') =>
    new ApiError(500, 'internal', message),

  unavailable: (message = 'That service is unavailable right now.') =>
    new ApiError(503, 'unavailable', message),
};
