/**
 * Pure HTTP policy helpers, kept separate from the ky wiring so they can be
 * unit-tested without importing ky (which is ESM-only).
 */

export interface AuthHeaderInput {
  accessToken: string | null;
  farmId: string | null;
}

/** Assemble the auth-related headers for a request. */
export function buildAuthHeaders(
  input: AuthHeaderInput,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (input.accessToken) {
    headers.Authorization = `Bearer ${input.accessToken}`;
  }
  if (input.farmId) {
    headers['X-Farm-Id'] = input.farmId;
  }
  return headers;
}

export function isUnauthorized(status: number): boolean {
  return status === 401;
}

/** HTTP status codes worth retrying (transient server/network conditions). */
export const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504] as const;

/**
 * Exponential backoff with full jitter, capped. `attempt` is 1-based.
 * Returns a delay in the range [exp/2, exp] where exp = base·2^(attempt-1).
 */
export function backoffDelayMs(
  attempt: number,
  baseMs = 300,
  capMs = 10_000,
  random: () => number = Math.random,
): number {
  const exp = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  const half = exp / 2;
  return Math.round(half + half * random());
}
