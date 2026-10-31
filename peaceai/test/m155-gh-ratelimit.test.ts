// M155: the shared GitHub API rate-limit wait-and-retry (peaceai/lib/gh-ratelimit.ts) used by builder-log check.ts
// --verify-shas, builder-log trace.ts and the M8 tamper-proof check-approved-list.ts. Only a real rate limit with a
// near reset (or a retry-after) is waited out; everything else rethrows the original error at once (fail closed).
// The mutation test removes each guard in turn and requires the suite below to fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as real from "../lib/gh-ratelimit.ts";

type Mod = typeof real;
const SRC = resolve(import.meta.dirname, "../lib/gh-ratelimit.ts");
const NOW = 1_800_000_000_000;
const S = NOW / 1000;

/** Every guard, asserted. Throws on the first broken one. `bin` is a scratch dir for the fake gh probe. */
async function suite(m: Mod, bin: string): Promise<void> {
  const P = m.DEFAULT_POLICY;
  const sig = (o: Partial<real.RateLimitSignal>): real.RateLimitSignal => ({ status: 403, remaining: null, reset: null, retryAfter: null, ...o });
  const wait = (o: Partial<real.RateLimitSignal>, p: real.RetryPolicy = P) => m.rateLimitWaitMs(sig(o), NOW, p);
  // Primary limit: remaining exactly "0" and an integer reset within 15 min; waits to the reset + 5 s.
  assert.equal(wait({ remaining: "0", reset: String(S + 120) }), 125_000, "near reset");
  assert.equal(wait({ status: 429, remaining: "0", reset: String(S + 900) }), 905_000, "reset exactly at the cap");
  assert.equal(wait({ remaining: "0", reset: String(S - 30) }), 5_000, "past reset: slack only");
  assert.equal(wait({ remaining: "0", reset: String(S + 901) }), null, "far reset fails closed");
  assert.equal(wait({ remaining: "0", reset: String(S + 3600) }), null, "an hour away fails closed");
  assert.equal(wait({ remaining: "1", reset: String(S + 60) }), null, "requests left: not a primary limit");
  assert.equal(wait({ remaining: "00", reset: String(S + 60) }), null, "remaining must be exactly 0");
  assert.equal(wait({ remaining: "0", reset: "soon" }), null, "malformed reset");
  assert.equal(wait({ remaining: "0", reset: null }), null, "no reset");
  assert.equal(wait({ status: 500, remaining: "0", reset: String(S + 60) }), null, "only 403/429");
  assert.equal(wait({ status: 404, retryAfter: "10" }), null, "only 403/429 (retry-after)");
  assert.equal(wait({}), null, "a 403 without limit headers fails closed");
  // Secondary limit: integer retry-after within the cap.
  assert.equal(wait({ retryAfter: "60" }), 65_000);
  assert.equal(wait({ retryAfter: "901" }), null, "retry-after past the cap");
  assert.equal(wait({ retryAfter: "Wed, 21 Oct 2026 07:28:00 GMT" }), null, "HTTP-date retry-after is not trusted");
  assert.equal(m.rateLimitWaitMs(null, NOW, P), null);
  // Env may only lower the caps.
  assert.deepEqual(m.policyFromEnv({ PEACEAI_RL_MAX_WAIT_S: "999999", PEACEAI_RL_SLACK_S: "999" }), { ...P }, "env cannot raise");
  assert.deepEqual(m.policyFromEnv({ PEACEAI_RL_MAX_WAIT_S: "60", PEACEAI_RL_SLACK_S: "0" }), { ...P, maxWaitMs: 60_000, maxTotalWaitMs: 60_000, slackMs: 0 });
  assert.deepEqual(m.policyFromEnv({ PEACEAI_RL_MAX_WAIT_S: "-1", PEACEAI_RL_SLACK_S: "x" }), { ...P }, "malformed ignored");
  // gh stderr classification.
  const zero = () => ({ remaining: 0, reset: S + 60 });
  const left = () => ({ remaining: 7, reset: S + 60 });
  const RL = "gh: API rate limit exceeded for installation ID 9. (HTTP 403)\n";
  assert.deepEqual(m.ghSignal(RL, zero), sig({ remaining: "0", reset: String(S + 60) }));
  assert.equal(m.rateLimitWaitMs(m.ghSignal(RL, left), NOW, P), null, "probe shows requests left: fail closed");
  assert.equal(m.ghSignal(RL, () => null), null, "probe failed: fail closed");
  assert.equal(m.ghSignal("gh: Resource not accessible by integration (HTTP 403)\n", zero), null, "a 403 that is not a rate limit");
  assert.equal(m.ghSignal("gh: API rate limit exceeded (HTTP 500)\n", zero), null, "only 403/429");
  assert.equal(m.ghSignal("gh: API rate limit exceeded\n", zero), null, "no HTTP status");
  assert.deepEqual(m.ghSignal("gh: You have exceeded a secondary rate limit. (HTTP 403)\n", () => null), sig({ retryAfter: "60" }));
  // The probe reads only a clean "<remaining>\t<reset>" from a successful gh.
  const fake = (out: string, code: number) => {
    const f = join(bin, `gh-${code}-${out.length}`);
    writeFileSync(f, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(out)});\nprocess.exit(${code});\n`);
    chmodSync(f, 0o755);
    return f;
  };
  assert.deepEqual(m.ghCoreProbe(fake(`0\t${S + 60}\n`, 0))(), { remaining: 0, reset: S + 60 });
  assert.equal(m.ghCoreProbe(fake(`0\t${S + 60}\n`, 1))(), null, "failed gh");
  assert.equal(m.ghCoreProbe(fake(`{"message":"x"}`, 0))(), null, "odd output");
  // Budget: retries, single cap, total cap; the original error is rethrown unchanged.
  const runWith = async (policy: real.RetryPolicy, sigs: (real.RateLimitSignal | null)[], sync: boolean) => {
    const slept: number[] = [];
    const logs: string[] = [];
    let calls = 0;
    const sleep = (ms: number) => { slept.push(ms); if (slept.length > 20) throw new Error("runaway retry loop"); };
    const r = new m.RateLimitRetry(policy, { now: () => NOW, sleepSync: sleep, sleep: async (ms) => sleep(ms), log: (l) => logs.push(l) });
    const errs = sigs.map((s, k) => Object.assign(new Error(`e${k}`), { s }));
    const call = () => { const k = calls++; if (k < errs.length) throw errs[k]; return "ok"; };
    const of = (e: unknown) => (e as { s: real.RateLimitSignal | null }).s;
    let out: unknown;
    try { out = sync ? r.runSync(call, of) : await r.run(async () => call(), of); } catch (e) { out = e; }
    return { out, slept, calls, logs, errs };
  };
  const near = sig({ remaining: "0", reset: String(S + 60) });
  for (const sync of [true, false]) {
    const a = await runWith(P, [near], sync);
    assert.equal(a.out, "ok");
    assert.deepEqual(a.slept, [65_000]);
    assert.deepEqual(a.logs, ["rate limited (HTTP 403): waiting 65s for the limit to reset, then retrying (retry 1/3)"]);
    const b = await runWith(P, [near, near, near, near], sync);
    assert.equal(b.out, b.errs[3], "after 3 retries the last original error is rethrown");
    assert.equal(b.slept.length, 3);
    const c = await runWith(P, [sig({})], sync);
    assert.equal(c.out, c.errs[0], "plain 403: original error, no wait");
    assert.deepEqual(c.slept, []);
    const d = await runWith({ ...P, maxTotalWaitMs: 100_000 }, [near, near], sync);
    assert.equal(d.out, d.errs[1], "total cap: the second wait would pass it");
    assert.deepEqual(d.slept, [65_000]);
    const e = await runWith(P, [sig({ remaining: "0", reset: String(S + 1200) })], sync);
    assert.equal(e.out, e.errs[0], "far reset: original error");
    assert.deepEqual(e.slept, []);
  }
  // Default caps stay under the job timeouts (builder-log 50 min with two lookup steps, tamper-proof 30 min).
  assert.ok(P.maxWaitMs + P.slackMs <= P.maxTotalWaitMs && P.maxTotalWaitMs <= 17 * 60_000 && P.maxRetries <= 3);
}

const MUTANTS: [string, string, string][] = [
  ["status 403/429 only", "if (sig.status !== 403 && sig.status !== 429) return null;", ""],
  ["retry-after must be an integer", "if (!/^\\d{1,6}$/.test(sig.retryAfter)) return null;", ""],
  ["remaining must be 0", `sig.remaining === "0" && `, ""],
  ["reset must be an integer", "/^\\d{1,12}$/.test(sig.reset)", "true"],
  ["single-wait cap (far reset)", "if (base > policy.maxWaitMs) return null;", ""],
  ["total-wait cap", "if (this.waitedMs + ms > this.policy.maxTotalWaitMs) return null;", ""],
  ["retry count cap", "if (this.retries >= this.policy.maxRetries) return null;", ""],
  ["gh: stderr must say rate limit", "if (!/rate limit/i.test(stderr)) return null;", ""],
  ["gh: status 403/429 only", "if (status !== 403 && status !== 429) return null;\n  if (/secondary", "if (/secondary"],
  ["gh: probe failure fails closed", "if (!core) return null;", "if (!core) return { status, remaining: \"0\", reset: \"0\", retryAfter: null };"],
  ["probe: gh must succeed", "const m = r.status === 0 ?", "const m = true ?"],
  ["env lowers only (wait)", "if (w !== null && w < p.maxWaitMs)", "if (w !== null)"],
  ["env lowers only (slack)", "if (s !== null && s < p.slackMs)", "if (s !== null)"],
  ["sync: rethrow the original error", "if (ms === null) throw err;\n        this.deps.sleepSync(ms);", "if (ms === null) throw new Error(\"x\");\n        this.deps.sleepSync(ms);"],
  ["async: rethrow the original error", "if (ms === null) throw err;\n        await this.deps.sleep(ms);", "if (ms === null) throw new Error(\"x\");\n        await this.deps.sleep(ms);"],
];

test("M155: only a near rate-limit reset (or retry-after) is waited out, within the caps; everything else fails closed", async () => {
  const bin = mkdtempSync(join(tmpdir(), "m155-"));
  try { await suite(real, bin); } finally { rmSync(bin, { recursive: true, force: true }); }
});

test("M155 mutation: removing any guard of gh-ratelimit.ts makes the suite fail", async () => {
  const src = readFileSync(SRC, "utf8");
  const dir = mkdtempSync(join(tmpdir(), "m155-mut-"));
  try {
    for (const [name, from, to] of MUTANTS) {
      assert.equal(src.split(from).length - 1, 1, `mutant anchor not unique or missing: ${name}`);
      const f = join(dir, `${name.replace(/[^a-z0-9]+/gi, "-")}.ts`);
      writeFileSync(f, src.replace(from, to));
      const m = (await import(pathToFileURL(f).href)) as Mod;
      const bin = mkdtempSync(join(dir, "bin-"));
      await assert.rejects(suite(m, bin), `mutant survived: ${name}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M155 workflows: each job that may wait out a rate limit has room for every lookup step's full wait", () => {
  const root = resolve(import.meta.dirname, "../..");
  const wf = (f: string) => readFileSync(join(root, ".github/workflows", f), "utf8");
  const capMin = real.DEFAULT_POLICY.maxTotalWaitMs / 60_000;
  /** timeout-minutes of the job whose block starts at `  <job>:` */
  const timeout = (text: string, job: string): number => {
    const block = text.split(new RegExp(`^  ${job}:\\n`, "m"))[1]!.split(/^ {2}[\w-]+:\n/m)[0]!;
    return Number(/^ {4}timeout-minutes: (\d+)$/m.exec(block)![1]);
  };
  const bl = wf("builder-log.yml");
  const ci = wf("ci.yml");
  // builder-log: --verify-shas and trace.ts (2 lookup steps) on top of the old 5 min.
  assert.match(bl, /builder-log\/check\.ts --verify-shas/);
  assert.ok(timeout(bl, "builder-log") >= 5 + 2 * capMin, "builder-log");
  assert.ok(timeout(bl, "results-crosscheck") >= 15 + capMin, "results-crosscheck");
  assert.ok(timeout(ci, "tamper-proof") >= 10 + capMin, "tamper-proof");
  // The lookups use the same tokens and permissions as before (nothing widened).
  assert.match(bl, /name: PeaceAI repo@sha landings exist\n {8}env:\n {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}\n/);
  assert.match(ci, /tamper-proof:[\s\S]*?permissions:\n {6}contents: read\n {6}issues: read\n/);
  // The three lookup tools all go through the shared helper.
  for (const f of ["builder-log/check.ts", "builder-log/trace.ts", "peaceai/bin/check-approved-list.ts"]) assert.match(readFileSync(join(root, f), "utf8"), /gh-ratelimit\.ts"/, f);
});
