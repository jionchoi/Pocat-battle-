import Constants from 'expo-constants';

import type { ApiError } from '../models';

/**
 * The only way this app talks to a server.
 *
 * There is no database client here and no storage key — the client holds a JWT and nothing
 * else. Everything goes through the Node API.
 */

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiBaseUrl?: string;
};

export const API_BASE_URL = extra.apiBaseUrl ?? 'http://localhost:4000';

export class ApiRequestError extends Error implements ApiError {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** True when retrying could plausibly succeed — drives the inline retry affordance. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

type TokenProvider = () => string | null;
type RefreshHandler = () => Promise<string | null>;

let getAccessToken: TokenProvider = () => null;
let refreshTokens: RefreshHandler = async () => null;

/**
 * Wired up by the auth store at launch. Kept as injected callbacks rather than importing
 * the store here, because the store imports this module — a direct import would be a cycle.
 */
export function configureAuth(params: {
  getAccessToken: TokenProvider;
  refreshTokens: RefreshHandler;
}): void {
  getAccessToken = params.getAccessToken;
  refreshTokens = params.refreshTokens;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Skip the Authorization header. Used by login/signup/refresh. */
  anonymous?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Single in-flight refresh, so five parallel 401s do not trigger five refreshes. */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshTokens().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, anonymous = false, timeoutMs = 15_000 } = options;

  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const send = async (token: string | null): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // Honour an externally supplied signal too, so a screen unmount can cancel a request.
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    try {
      return await fetch(url.toString(), {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  };

  let response: Response;

  try {
    response = await send(anonymous ? null : getAccessToken());
  } catch (err) {
    // Status 0 means the request never reached the server — offline, DNS, or a timeout.
    // The UI distinguishes this from a server error so it can say "you appear offline".
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new ApiRequestError(
      aborted ? 'timeout' : 'network',
      aborted
        ? 'That took too long. Check your connection and try again.'
        : 'We could not reach the server. Check your connection.',
      0
    );
  }

  // One transparent retry after a refresh. If the refresh fails, the auth store signs the
  // player out and the navigator swaps to the auth stack.
  if (response.status === 401 && !anonymous) {
    const fresh = await refreshOnce();
    if (fresh) {
      try {
        response = await send(fresh);
      } catch {
        throw new ApiRequestError('network', 'We could not reach the server.', 0);
      }
    }
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as { error?: ApiError } | null)?.error;
    throw new ApiRequestError(
      error?.code ?? 'unknown',
      error?.message ?? 'Something went wrong. Try again.',
      response.status,
      error?.details
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
