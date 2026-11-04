// M196 cases for reproduce-v1 (peaceai/spec/reproduce-v1.md): admit cases on three shapes (LEDGER node:test, SHELF
// flat npm + vitest, AGENT pnpm + jest workspace) and a refused near miss for every tagged `repro-guard:` condition.
// Static and judge cases only (no process is started): m196-reproduce.test.ts replays them against each guard mutant.
// The sandbox runs (the dynamic near misses: passes on current code, vacuous, wrong reason) are in the test file.
import assert from "node:assert/strict";
import { openRepo } from "../lib/codesearch.ts";
import { diagnose, type ThrowSite } from "../lib/plan5.ts";
import type * as Repro from "../lib/reproduce.ts";

export type ReproModule = Pick<typeof Repro, "planRepro" | "judge" | "validateRepro">;
export interface CaseCtx { ledger: string; shelf: string; agent: string }
export interface ReproCase { id: string; condition: string; kind: "admit" | "refuse"; shape: "ledger" | "shelf" | "agent" | "judge"; run(m: ReproModule, c: CaseCtx): void }

/** The site plan-only-v5 diagnoses for `code` (the first), from a plain failure report. */
export function siteOf(dir: string, code: string): ThrowSite {
  const d = diagnose(openRepo(dir), `The run failed with ${code}.`);
  const s = d.codes.find((x) => x.code === code)?.sites[0];
  assert.ok(s, `no v5 site for ${code}`);
  return s;
}
type Plan = Repro.ReproPlan;
const plan = (m: ReproModule, dir: string, code: string, site?: ThrowSite): Plan => {
  const p = m.planRepro(openRepo(dir), code, site ?? siteOf(dir, code));
  assert.ok(!("refuse" in p), `expected a plan for ${code}, got ${"refuse" in p ? p.refuse : ""}`);
  return p as Plan;
};
const refused = (m: ReproModule, dir: string, code: string, want: Repro.ReproRefusal, site?: ThrowSite, detail?: string) => {
  const p = m.planRepro(openRepo(dir), code, site ?? siteOf(dir, code));
  assert.deepEqual("refuse" in p ? p.refuse : "PLANNED", want, code);
  // Batch 31: a refusal with a precise reason checks the reason too
  if (detail !== undefined) assert.equal("refuse" in p ? p.detail : undefined, detail, `${code} detail`);
};
/** Batch 31: the plan keeps the helper call (awaited, its other arguments as written) and rebuilds its callback from
 *  the callback's own parameters and setup, with the same injected dependency and check inside. */
const viaHelper = (m: ReproModule, dir: string, code: string, test: string, outer: RegExp, inner: RegExp) => {
  const p = plan(m, dir, code);
  assert.equal(p.existing.path, test);
  for (const v of ["repro", "probe", "control"] as const) assert.match(p.variants[v], outer, v);
  assert.match(p.variants.repro, inner);
  assert.match(p.variants.repro, new RegExp(String.raw`if \(__peaceaiHas\(__peaceaiSeen, "${code}"\)\) throw[^\n]*\n\}\);\n\}\);`), "the check is inside the helper's callback");
  assert.doesNotMatch(p.variants.control, /__peaceaiArgs\[\d\] = __peaceaiFail/);
  return p;
};
const LEDGER_HELPER = (m: ReproModule, c: CaseCtx) => viaHelper(m, c.ledger, "JOURNAL_APPEND_FAILED", "test/journal.test.ts",
  /async function withJournal\(run[^]*\ntest\("peaceai-repro \w+: appendEntry with io\.append failing", async \(\) => \{\nconst label = "first";\nawait withJournal\(async \(lines\) => \{\nconst io = \{ append: async \(l: string\) => \{ lines\.push\(l\); \} \};\nconst __peaceaiArgs = \[io, label\];/,
  /__peaceaiArgs\[0\] = __peaceaiFail\(__peaceaiArgs\[0\], "append", true\);/);
const SHELF_HELPER = (m: ReproModule, c: CaseCtx) => viaHelper(m, c.shelf, "VAULT_KEY_UNREADABLE", "test/vault.test.ts",
  /import \{ withKeys \} from "\.\/helpers";[^]*\nit\("peaceai-repro \w+: unlock with keys\.get failing", async \(\) => \{\nawait withKeys\(\{ a: "1" \}, async \(keys\) => \{\nconst __peaceaiArgs = \[keys, "a"\];/,
  /__peaceaiArgs\[0\] = __peaceaiFail\(__peaceaiArgs\[0\], "get", true\);/);
const AGENT_HELPER = (m: ReproModule, c: CaseCtx) => viaHelper(m, c.agent, "FETCH_ONE_FAILED", "packages/agent/test/fetch.test.js",
  /const \{ withApi \} = require\("\.\/support"\);[^]*\ntest\("peaceai-repro \w+: fetchOne with api\.get failing", async \(\) => \{\nawait withApi\(async \(api\) => \{\nconst __peaceaiArgs = \[api, quiet, "a"\];/,
  /__peaceaiArgs\[0\] = __peaceaiFail\(__peaceaiArgs\[0\], "get", true\);/);
const R = (exitCode: number, pass: number, fail: number, extra: Partial<Repro.VariantRun> = {}): Repro.VariantRun => ({ exitCode, pass, fail, leftovers: 0, ...extra });
const FAIL = R(1, 0, 1), PASS = R(0, 1, 0);

export const CASES: ReproCase[] = [
  // ---- admits (the variants are checked on each: only repro / probe inject the failure; probe asserts the opposite)
  { id: "admit-returned-node-test", condition: "site-source", kind: "admit", shape: "ledger", run: (m, c) => {
    const p = plan(m, c.ledger, "QUOTA_STORE_DOWN");
    assert.deepEqual([p.channel, p.trigger.callee, p.trigger.param, p.trigger.prop, p.trigger.reject, p.runner.runner, p.existing.path, p.testPath, p.tsxImport], ["returned", "store.used", 0, "used", true, "node-test", "test/quota.test.ts", "test/quota.peaceai-repro.test.ts", false]);
    assert.match(p.variants.repro, /^\/\/ @ts-nocheck\n/);
    assert.match(p.variants.repro, /import \{ reserve \} from "\.\.\/src\/quota\.ts";\nconst store = \{ limit: 5/);
    assert.match(p.variants.repro, /__peaceaiArgs\[0\] = __peaceaiFail\(__peaceaiArgs\[0\], "used", true\);/);
    assert.match(p.variants.repro, /if \(__peaceaiHas\(__peaceaiSeen, "QUOTA_STORE_DOWN"\)\) throw/);
    assert.match(p.variants.probe, /if \(!__peaceaiHas\(__peaceaiSeen, "QUOTA_STORE_DOWN"\)\) throw/);
    assert.doesNotMatch(p.variants.control, /__peaceaiArgs\[0\] = __peaceaiFail/);
    assert.doesNotMatch(p.variants.repro, /test\("reserve reports what is left"/, "the existing test is not copied");
  } },
  { id: "admit-thrown-vitest-describe", condition: "throw-caught", kind: "admit", shape: "shelf", run: (m, c) => {
    const p = plan(m, c.shelf, "SETTINGS_UNREADABLE");
    assert.deepEqual([p.channel, p.trigger.callee, p.runner.runner, p.testPath], ["thrown", "io.read", "vitest", "test/settings.peaceai-repro.test.ts"]);
    assert.match(p.variants.repro, /import \{ describe, expect, it \} from "vitest";/);
    assert.match(p.variants.repro, /\ndescribe\("peaceai-repro 0", \(\) => \{\nconst io = reader\(/);
    assert.match(p.variants.repro, /\);\nit\("peaceai-repro repro: loadSettings with io.read failing"/);
  } },
  { id: "admit-logged-jest-workspace", condition: "observe-log", kind: "admit", shape: "agent", run: (m, c) => {
    const p = plan(m, c.agent, "SYNC_PUSH_FAILED");
    assert.deepEqual([p.channel, p.logParam, p.trigger.callee, p.runner.runner, p.runner.pkgDir, p.testPath], ["logged", 1, "api.push", "jest", "packages/agent", "packages/agent/test/sync.peaceai-repro.test.js"]);
    assert.match(p.variants.repro, /^\/\/ Generated by PeaceAI reproduce-v1/);
    assert.match(p.variants.repro, /const \{ syncAll \} = require\("\.\.\/src\/sync"\);/);
    assert.match(p.variants.repro, /\ntest\("peaceai-repro repro: syncAll/);
  } },
  { id: "admit-pushed-local-list", condition: "observe-push", kind: "admit", shape: "ledger", run: (m, c) => {
    assert.equal(plan(m, c.ledger, "THEME_DEFAULTED").channel, "pushed");
  } },
  { id: "admit-trigger-param-not-local-fn", condition: "trigger-param", kind: "admit", shape: "shelf", run: (m, c) => {
    assert.equal(plan(m, c.shelf, "SETTINGS_UNREADABLE").trigger.callee, "io.read");
    assert.equal(plan(m, c.ledger, "PROFILE_MISSING").trigger.callee, "io.read");
  } },
  { id: "admit-trigger-skips-callback", condition: "trigger-no-nested-fn", kind: "admit", shape: "ledger", run: (m, c) => {
    assert.equal(plan(m, c.ledger, "FETCH_ALL_FAILED").trigger.callee, "api.all");
  } },
  { id: "admit-trigger-skips-data-method", condition: "trigger-not-builtin", kind: "admit", shape: "ledger", run: (m, c) => {
    assert.equal(plan(m, c.ledger, "FETCH_ALL_FAILED").trigger.callee, "api.all");
  } },
  { id: "admit-trigger-skips-inner-try", condition: "trigger-no-inner-try", kind: "admit", shape: "ledger", run: (m, c) => {
    assert.equal(plan(m, c.ledger, "PUBLISH_FAILED").trigger.callee, "io.write");
  } },
  { id: "admit-trigger-skips-handled-destructured", condition: "trigger-handled", kind: "admit", shape: "ledger", run: (m, c) => {
    const p = plan(m, c.ledger, "SAVE_PUT_FAILED");
    assert.deepEqual([p.trigger.callee, p.trigger.param, p.trigger.prop], ["put", 0, "put"]);
  } },
  { id: "admit-cjs-exports", condition: "entry-exported", kind: "admit", shape: "agent", run: (m, c) => {
    assert.equal(plan(m, c.agent, "SYNC_PUSH_FAILED").entry.name, "syncAll");
  } },
  // ---- refused near misses, one per condition
  { id: "refuse-code-not-constant-case", condition: "code-shape", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "QUOTA_STORE_DOWN|X", "REPRO_NO_DIAGNOSIS", siteOf(c.ledger, "QUOTA_STORE_DOWN")) },
  { id: "refuse-test-file-target", condition: "site-source", kind: "refuse", shape: "ledger", run: (m, c) =>
    refused(m, c.ledger, "FAKE_STORE_DOWN", "REPRO_TEST_TARGET", { path: "test/fake-store.ts", line: 5, symbol: "flakyStore", via: "error-new", match: "token" }) },
  { id: "refuse-data-conditional-throw", condition: "throw-caught", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "QUOTA_EXCEEDED", "REPRO_NO_TRIGGER") },
  { id: "refuse-not-exported", condition: "entry-exported", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "CACHE_WARM_FAILED", "REPRO_NO_ENTRY") },
  { id: "refuse-reported-in-callback", condition: "entry-direct", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "WATCH_READ_FAILED", "REPRO_NO_ENTRY") },
  { id: "refuse-imported-logger", condition: "observe-log", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "UPLOAD_FAILED", "REPRO_NO_OBSERVE") },
  { id: "refuse-module-level-list", condition: "observe-push", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "TRACK_SEND_FAILED", "REPRO_NO_OBSERVE") },
  { id: "refuse-trigger-only-in-callback", condition: "trigger-no-nested-fn", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "DEFER_FAILED", "REPRO_NO_TRIGGER") },
  { id: "refuse-trigger-only-in-inner-try", condition: "trigger-no-inner-try", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "PROBE_FAILED", "REPRO_NO_TRIGGER") },
  { id: "refuse-trigger-handled-locally", condition: "trigger-handled", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "WARMUP_FAILED", "REPRO_NO_TRIGGER") },
  { id: "refuse-trigger-data-method", condition: "trigger-not-builtin", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "NAMES_UPPER_FAILED", "REPRO_NO_TRIGGER") },
  { id: "refuse-trigger-no-param-call", condition: "trigger-param", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "CLOCK_READ_FAILED", "REPRO_NO_TRIGGER") },
  { id: "refuse-test-imports-other-module", condition: "existing-binds", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "ARCHIVE_WRITE_FAILED", "REPRO_NO_EXISTING_TEST") },
  { id: "refuse-call-only-in-hook", condition: "existing-in-test", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "ROTATE_FAILED", "REPRO_NO_EXISTING_TEST") },
  { id: "admit-call-in-try-finally", condition: "existing-plain-path", kind: "admit", shape: "ledger", run: (m, c) => {
    const p = plan(m, c.ledger, "SWEEP_BIN_STUCK");
    assert.match(p.variants.repro, /async \(\) => \{\nconst opened: string\[\] = \[\];\ntry \{\nopened\.push\("bin"\);\nconst bin = \{ empty: async \(\) => 3 \};\nconst __peaceaiArgs = \[bin\];/);
    assert.match(p.variants.repro, /throw new Error\("peaceai-repro: the reported failure was produced"\);\n\} finally \{\n {4}opened\.length = 0;\n {2}\}\n\}\);/);
  } },
  { id: "refuse-call-in-try-catch", condition: "existing-plain-path", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "REFILL_PUMP_STUCK", "REPRO_NO_EXISTING_TEST") },
  { id: "refuse-call-with-spread", condition: "existing-args", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "STAMP_SIGN_FAILED", "REPRO_NO_EXISTING_TEST") },
  // ---- Batch 31: the call inside one async callback of a helper the test file defines or imports from the repo
  { id: "admit-helper-local-fn", condition: "existing-helper-local", kind: "admit", shape: "ledger", run: (m, c) => { LEDGER_HELPER(m, c); } },
  { id: "admit-helper-relative-import", condition: "existing-helper-local", kind: "admit", shape: "shelf", run: (m, c) => { SHELF_HELPER(m, c); } },
  { id: "admit-helper-relative-require", condition: "existing-helper-local", kind: "admit", shape: "agent", run: (m, c) => { AGENT_HELPER(m, c); } },
  { id: "admit-helper-one-level-ledger", condition: "existing-helper-one-level", kind: "admit", shape: "ledger", run: (m, c) => { LEDGER_HELPER(m, c); } },
  { id: "admit-helper-one-level-shelf", condition: "existing-helper-one-level", kind: "admit", shape: "shelf", run: (m, c) => { SHELF_HELPER(m, c); } },
  { id: "admit-helper-async-ledger", condition: "existing-helper-async", kind: "admit", shape: "ledger", run: (m, c) => { LEDGER_HELPER(m, c); } },
  { id: "admit-helper-async-agent", condition: "existing-helper-async", kind: "admit", shape: "agent", run: (m, c) => { AGENT_HELPER(m, c); } },
  { id: "refuse-helper-from-package", condition: "existing-helper-local", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "PKG_APPEND_FAILED", "REPRO_NO_EXISTING_TEST", undefined, "unknown-helper") },
  { id: "refuse-helper-nested", condition: "existing-helper-one-level", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "NESTED_APPEND_FAILED", "REPRO_NO_EXISTING_TEST", undefined, "nested-callback") },
  { id: "refuse-helper-in-describe-body", condition: "existing-helper-one-level", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "SUITE_APPEND_FAILED", "REPRO_NO_EXISTING_TEST", undefined, "nested-callback") },
  { id: "refuse-helper-sync-callback", condition: "existing-helper-async", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "SYNC_APPEND_FAILED", "REPRO_NO_EXISTING_TEST", undefined, "sync-callback") },
  { id: "refuse-test-each-row", condition: "existing-in-test", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "ROW_APPEND_FAILED", "REPRO_NO_EXISTING_TEST", undefined, "not-in-test") },
  { id: "refuse-hook-reason", condition: "existing-in-test", kind: "refuse", shape: "ledger", run: (m, c) => refused(m, c.ledger, "ROTATE_FAILED", "REPRO_NO_EXISTING_TEST", undefined, "not-in-test") },
  { id: "refuse-toplevel-catch-site", condition: "site-not-toplevel", kind: "refuse", shape: "ledger", run: (m, c) =>
    refused(m, c.ledger, "QUOTA_STORE_DOWN", "REPRO_NO_ENTRY", { ...siteOf(c.ledger, "QUOTA_STORE_DOWN"), shape: "toplevel-catch" }, "toplevel-catch") },
  { id: "refuse-no-candidate-uid", condition: "needs-cand", kind: "refuse", shape: "ledger", run: (m, c) => {
    const r = m.validateRepro(c.ledger, plan(m, c.ledger, "QUOTA_STORE_DOWN"), { env: {}, roots: [] });
    assert.deepEqual([r.code, r.detail], ["REPRO_ISOLATION", "CAND_UID_REQUIRED"]);
  } },
  // ---- the judge (pure): the three runs
  { id: "judge-admit", condition: "judge-control", kind: "admit", shape: "judge", run: (m) => assert.equal(m.judge({ repro: FAIL, probe: PASS, control: PASS }), "REPRO_OK") },
  { id: "judge-passes-on-current-code", condition: "judge-repro-fails", kind: "refuse", shape: "judge", run: (m) => assert.equal(m.judge({ repro: PASS, probe: FAIL, control: PASS }), "REPRO_NOT_FAILING") },
  { id: "judge-fails-for-wrong-reason", condition: "judge-probe", kind: "refuse", shape: "judge", run: (m) => assert.equal(m.judge({ repro: FAIL, probe: FAIL, control: PASS }), "REPRO_WRONG_REASON") },
  { id: "judge-vacuous", condition: "judge-control", kind: "refuse", shape: "judge", run: (m) => assert.equal(m.judge({ repro: FAIL, probe: PASS, control: FAIL }), "REPRO_VACUOUS") },
  { id: "judge-no-isolation", condition: "judge-isolation", kind: "refuse", shape: "judge", run: (m) => assert.equal(m.judge({ repro: R(97, 0, 0), probe: PASS, control: PASS }), "REPRO_ISOLATION") },
  { id: "judge-tampered-control", condition: "judge-clean", kind: "refuse", shape: "judge", run: (m) => assert.equal(m.judge({ repro: FAIL, probe: PASS, control: R(0, 1, 0, { tampered: ["x"] }) }), "REPRO_VACUOUS") },
  { id: "judge-leftover-probe", condition: "judge-clean", kind: "refuse", shape: "judge", run: (m) => assert.equal(m.judge({ repro: FAIL, probe: R(0, 1, 0, { leftovers: 1 }), control: PASS }), "REPRO_WRONG_REASON") },
  { id: "judge-probe-ran-nothing", condition: "judge-one-pass", kind: "refuse", shape: "judge", run: (m) => assert.equal(m.judge({ repro: FAIL, probe: R(0, 0, 0), control: PASS }), "REPRO_WRONG_REASON") },
  { id: "judge-repro-two-failures", condition: "judge-one-fail", kind: "refuse", shape: "judge", run: (m) => assert.equal(m.judge({ repro: R(1, 0, 2), probe: PASS, control: PASS }), "REPRO_WRONG_REASON") },
  { id: "judge-shim-made-up-fail", condition: "judge-one-fail", kind: "refuse", shape: "judge", run: (m) => assert.equal(m.judge({ repro: R(94, 0, 1), probe: PASS, control: PASS }), "REPRO_WRONG_REASON") },
];
