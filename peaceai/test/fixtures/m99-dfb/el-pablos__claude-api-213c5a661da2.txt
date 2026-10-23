import { logger } from "./logger";

export interface RetryOptions {
  maxAttempts: number;
  delayBase: number;
  delayMax: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  delayBase: 1000,
  delayMax: 30000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function calculateDelay(
  attempt: number,
  base: number,
  max: number,
): number {
  const exponential = base * Math.pow(2, attempt - 1);
  const jitter = exponential * (0.8 + Math.random() * 0.4);
  return Math.min(jitter, max);
}

export function isRetryableStatus(
  status: number,
  retryable: number[],
): boolean {
  return retryable.includes(status);
}

export function isRateLimitError(status: number): boolean {
  return status === 429;
}

export function isAuthError(status: number): boolean {
  return status === 401 || status === 403;
}

export function isServerError(status: number): boolean {
  return status >= 500 && status < 600;
}

export function parseRetryAfter(headers: Headers): number | null {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return null;

  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return Date.now() + seconds * 1000;
  }

  const date = Date.parse(retryAfter);
  if (!isNaN(date)) {
    return date;
  }

  return null;
}

export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  lastStatus?: number;
  lastError?: Error;
  switchedAccount: boolean;
}

export async function withRetry<T>(
  fn: (ctx: RetryContext) => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const ctx: RetryContext = {
      attempt,
      maxAttempts: opts.maxAttempts,
      lastError,
      switchedAccount: attempt > 1,
    };

    try {
      return await fn(ctx);
    } catch (err) {
      lastError = err as Error;
      const status = (err as { status?: number }).status;

      ctx.lastStatus = status;

      if (attempt >= opts.maxAttempts) {
        logger.error("All retry attempts exhausted", {
          attempt,
          maxAttempts: opts.maxAttempts,
          error: lastError.message,
        });
        throw lastError;
      }

      if (status && !isRetryableStatus(status, opts.retryableStatuses)) {
        throw lastError;
      }

      const delay = calculateDelay(attempt, opts.delayBase, opts.delayMax);
      logger.warn("Retrying request", {
        attempt,
        maxAttempts: opts.maxAttempts,
        delay: Math.round(delay),
        status,
        error: lastError.message,
      });

      await sleep(delay);
    }
  }

  throw lastError ?? new Error("Retry exhausted with no error captured");
}
