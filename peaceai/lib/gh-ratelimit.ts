// Shared GitHub API rate-limit wait-and-retry for the required lookup checks: builder-log `check.ts --verify-shas`
// (repo@sha landings exist), builder-log `trace.ts` (landings trace to verdict patches) and the M8 tamper-proof guard
// `check-approved-list.ts` (APPROVED LIST). A lookup that GitHub refused ONLY because of a rate limit is retried after
// the limit resets; nothing else changes. Every guard below fails closed: when any of them says no, the caller gets the
// original error unchanged (same message, same stop-after-rate-limit handling), exactly as before this helper.
//   - only HTTP 403 or 429;
//   - primary limit: x-ratelimit-remaining exactly "0" and an integer x-ratelimit-reset no more than maxWaitMs away
//     (a past reset waits only the slack);
//   - secondary limit: an integer retry-after (seconds) no more than maxWaitMs;
//   - at most maxRetries retries and maxTotalWaitMs of waiting per process (one budget for all lookups), kept under
//     the job timeouts in builder-log.yml and ci.yml;
//   - a 403 with neither signal (a refused token, a missing permission) is never retried.
// The gh CLI does not print response headers on an error, so for gh callers the headers are rebuilt from fixed facts:
// the stderr must say "rate limit" with "(HTTP 403|429)"; GitHub's secondary-limit text waits 60 s (its documented
// minimum when no retry-after is sent); otherwise the free, read-only `gh api rate_limit` endpoint (it does not count
// against the limit) supplies core remaining/reset, and only remaining 0 waits. Same token, no new permission.
// Output: one fixed line per wait on stderr (status, seconds, retry count); never a header value, URL or gh stderr.
import { spawnSync } from "node:child_process";

export interface RateLimitSignal {
  status: number;
  remaining: string | null;
  reset: string | null;
  retryAfter: string | null;
}

export interface RetryPolicy {
  maxRetries: number;
  /** Longest single wait (ms), not counting the slack. */
  maxWaitMs: number;
  /** All waits of one process together (ms), slack included. */
  maxTotalWaitMs: number;
  /** Added after the reset / retry-after, so the retry lands after GitHub's window turns. */
  slackMs: number;
}

/** 15 min to a reset, 3 retries, 17 min in all per process (builder-log.yml and ci.yml job timeouts leave room). */
export const DEFAULT_POLICY: Readonly<RetryPolicy> = Object.freeze({ maxRetries: 3, maxWaitMs: 15 * 60_000, maxTotalWaitMs: 17 * 60_000, slackMs: 5_000 });

/** Wait used for GitHub's secondary-limit text when gh hides the retry-after header (GitHub: wait at least a minute). */
export const SECONDARY_WAIT_S = 60;

/**
 * The default policy, optionally LOWERED (never raised) by PEACEAI_RL_MAX_WAIT_S (single and total wait, seconds)
 * and PEACEAI_RL_SLACK_S. A malformed value is ignored. Lower-only, so no environment can stretch a job past its timeout.
 */
export function policyFromEnv(env: NodeJS.ProcessEnv = process.env, base: Readonly<RetryPolicy> = DEFAULT_POLICY): RetryPolicy {
  const p = { ...base };
  const sec = (v: string | undefined): number | null => (v !== undefined && /^\d{1,6}$/.test(v) ? Number(v) * 1000 : null);
  const w = sec(env.PEACEAI_RL_MAX_WAIT_S);
  if (w !== null && w < p.maxWaitMs) p.maxWaitMs = w;
  if (w !== null && w < p.maxTotalWaitMs) p.maxTotalWaitMs = w;
  const s = sec(env.PEACEAI_RL_SLACK_S);
  if (s !== null && s < p.slackMs) p.slackMs = s;
  return p;
}

/** ms to wait before one retry, or null: not a rate limit we may wait out (fail closed, caller keeps the error). */
export function rateLimitWaitMs(sig: RateLimitSignal | null, nowMs: number, policy: Readonly<RetryPolicy>): number | null {
  if (!sig) return null;
  if (sig.status !== 403 && sig.status !== 429) return null;
  let base: number;
  if (sig.retryAfter !== null) {
    if (!/^\d{1,6}$/.test(sig.retryAfter)) return null;
    base = Number(sig.retryAfter) * 1000;
  } else if (sig.remaining === "0" && sig.reset !== null && /^\d{1,12}$/.test(sig.reset)) {
    base = Math.max(0, Number(sig.reset) * 1000 - nowMs);
  } else {
    return null;
  }
  if (base > policy.maxWaitMs) return null;
  return base + policy.slackMs;
}

/** retry-after / remaining / reset from a fetch Response's headers (check.ts). */
export function signalFromHeaders(res: { status: number; headers: { get(name: string): string | null } }): RateLimitSignal {
  return { status: res.status, remaining: res.headers.get("x-ratelimit-remaining"), reset: res.headers.get("x-ratelimit-reset"), retryAfter: res.headers.get("retry-after") };
}

export type CoreProbe = () => { remaining: number; reset: number } | null;

/** The gh signal (see the header): stderr says rate limit with HTTP 403/429; secondary text, or a probe showing 0 left. */
export function ghSignal(stderr: string, probe: CoreProbe): RateLimitSignal | null {
  if (!/rate limit/i.test(stderr)) return null;
  const status = Number(/\(HTTP (\d{3})\)/.exec(stderr)?.[1] ?? "0");
  if (status !== 403 && status !== 429) return null;
  if (/secondary rate limit/i.test(stderr)) return { status, remaining: null, reset: null, retryAfter: String(SECONDARY_WAIT_S) };
  const core = probe();
  if (!core) return null;
  return { status, remaining: String(core.remaining), reset: String(core.reset), retryAfter: null };
}

/** `gh api rate_limit` (free, read-only, same token): core remaining and reset, or null on any failure or odd output. */
export function ghCoreProbe(bin: string, env: NodeJS.ProcessEnv = process.env): CoreProbe {
  return () => {
    const r = spawnSync(bin, ["api", "rate_limit", "--jq", ".resources.core | [.remaining, .reset] | @tsv"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
    const m = r.status === 0 ? /^(\d{1,9})\t(\d{1,12})\n?$/.exec(r.stdout) : null;
    return m ? { remaining: Number(m[1]), reset: Number(m[2]) } : null;
  };
}

/** The stderr text of a failed execFileSync / spawnSync-style error (never printed; only classified). */
export const stderrOf = (err: unknown): string => String((err as { stderr?: unknown } | null)?.stderr ?? "");

export interface RetryDeps {
  now: () => number;
  sleepSync: (ms: number) => void;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

const realDeps: RetryDeps = {
  now: () => Date.now(),
  sleepSync: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (line) => process.stderr.write(line + "\n"),
};

/** One per process: every lookup shares the retry count and the total-wait budget. */
export class RateLimitRetry {
  retries = 0;
  waitedMs = 0;
  readonly policy: Readonly<RetryPolicy>;
  private readonly deps: RetryDeps;
  constructor(policy: Readonly<RetryPolicy> = policyFromEnv(), deps: Partial<RetryDeps> = {}) {
    this.policy = policy;
    this.deps = { ...realDeps, ...deps };
  }

  /** Commit one wait to the budget and return it, or null (give up: caller rethrows the original error). The signal is
   *  read only while retries are left, so a spent budget makes no rate_limit probe. */
  next(signal: () => RateLimitSignal | null): number | null {
    if (this.retries >= this.policy.maxRetries) return null;
    const sig = signal();
    const ms = rateLimitWaitMs(sig, this.deps.now(), this.policy);
    if (ms === null) return null;
    if (this.waitedMs + ms > this.policy.maxTotalWaitMs) return null;
    this.retries += 1;
    this.waitedMs += ms;
    this.deps.log(`rate limited (HTTP ${sig!.status}): waiting ${Math.ceil(ms / 1000)}s for the limit to reset, then retrying (retry ${this.retries}/${this.policy.maxRetries})`);
    return ms;
  }

  runSync<T>(call: () => T, signalOf: (err: unknown) => RateLimitSignal | null): T {
    for (;;) {
      try {
        return call();
      } catch (err) {
        const ms = this.next(() => signalOf(err));
        if (ms === null) throw err;
        this.deps.sleepSync(ms);
      }
    }
  }

  async run<T>(call: () => Promise<T>, signalOf: (err: unknown) => RateLimitSignal | null): Promise<T> {
    for (;;) {
      try {
        return await call();
      } catch (err) {
        const ms = this.next(() => signalOf(err));
        if (ms === null) throw err;
        await this.deps.sleep(ms);
      }
    }
  }
}
