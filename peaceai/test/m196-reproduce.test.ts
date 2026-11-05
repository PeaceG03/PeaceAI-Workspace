// M196 REPRODUCE-REPORTED-FAILURE v1 (peaceai/spec/reproduce-v1.md): from a v5 diagnosis, a candidate regression test in
// the repo's own runner, kept only when it fails on the current code for the asserted reason. Checked here: the admit
// cases and a refused near miss for every tagged `repro-guard:` condition (m196-cases.ts, static and judge only); a
// mutation check (each guard removed or loosened must fail a case); the sandbox runs as the stage-2 candidate uid (no
// network) on three shapes (node:test, flat npm + vitest 4, pnpm workspace + jest 29) plus the dynamic near misses
// (passes on the current code, vacuous, fails for the wrong reason) and a fixed copy the kept test then passes on; the
// wiring (plan-only: nothing in the loop, its grading or the credit sources imports it); and a generality check.
// The sandbox runs need a candidate uid (M196_CAND, else M146_CAND); without one they are skipped (CI has none).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { openRepo } from "../lib/codesearch.ts";
import { privateRoots } from "../lib/loop.ts";
import * as repro from "../lib/reproduce.ts";
import type { PlanTaskFile } from "../lib/plan.ts";
import { CASES, siteOf, type CaseCtx, type ReproModule } from "./m196-cases.ts";
import { AGENT, LEDGER, LEDGER_BASES, LEDGER_HELPERS, LEDGER_TRIGGERS, LEDGER_ASSIGNS, LEDGER_VACUOUS, SHELF, SHELF_ASSIGNS, SHELF_BASES, SHELF_VACUOUS, writeRepo } from "./m196-fixtures.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const libDir = join(repo, "peaceai/lib");
const source = readFileSync(join(libDir, "reproduce.ts"), "utf8");
const CAND = process.env.M196_CAND || process.env.M146_CAND || "";
const noCand = CAND ? false : "no candidate uid (M196_CAND / M146_CAND): the sandbox runs need one";
const scratch = mkdtempSync(join(tmpdir(), "peaceai-m196-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const ctx: CaseCtx = {
  ledger: writeRepo(join(scratch, "ledger"), { ...LEDGER, ...LEDGER_TRIGGERS, ...LEDGER_HELPERS, ...LEDGER_BASES, ...LEDGER_VACUOUS, ...LEDGER_ASSIGNS }),
  shelf: writeRepo(join(scratch, "shelf"), { ...SHELF(), ...SHELF_BASES, ...SHELF_VACUOUS, ...SHELF_ASSIGNS }),
  agent: writeRepo(join(scratch, "agent"), AGENT),
};
const TAGS = ["attempt-own-runs", "attempt-stop-env", "attempt-stop-ok", "attempts-best-ranked", "attempts-cap", "code-shape", "entry-direct", "entry-exported", "existing-args", "existing-binds", "existing-helper-async", "existing-helper-local", "existing-helper-one-level", "existing-in-test", "existing-plain-path", "judge-clean", "judge-control", "judge-isolation", "judge-one-fail", "judge-one-pass", "judge-probe", "judge-repro-fails", "needs-cand", "observe-log", "observe-push", "rank-names-dependency", "rank-own-file", "rank-setup-assigns-failure", "rank-setup-injects-failure", "site-not-toplevel", "site-source", "throw-caught", "trigger-handled", "trigger-no-inner-try", "trigger-no-nested-fn", "trigger-not-builtin", "trigger-param"];

/** One mutant per guard (removing it, or loosening it where removing leaves nothing to run). `find` occurs once. */
const MUTANTS: { id: string; find: string; replace: string }[] = [
  { id: "code-shape", find: 'if (!CODE_SHAPE.test(errCode)) return refuse("REPRO_NO_DIAGNOSIS"); // repro-guard:code-shape', replace: "" },
  { id: "site-source", find: 'if (!isSourceFile(site.path) || isTestPath(site.path) || isGeneratedPath(site.path)) return refuse("REPRO_TEST_TARGET"); // repro-guard:site-source', replace: "" },
  { id: "throw-caught", find: 'if (!at) return "REPRO_NO_TRIGGER"; // repro-guard:throw-caught', replace: "if (!at) return { at: best, guarded: best, handler: best, chain: false };" },
  { id: "entry-direct", find: "if (!top) return null; // repro-guard:entry-direct", replace: "if (!top) top = ts.findAncestor(fn, (x) => !!x.parent && ts.isSourceFile(x.parent)) ?? null; if (!top) return null;" },
  { id: "entry-exported", find: "if (!(exported(top) || cjsExports(sf).has(name))) return null; // repro-guard:entry-exported", replace: "" },
  { id: "trigger-no-nested-fn", find: "if (n !== r.guarded && ts.isFunctionLike(n)) return; // repro-guard:trigger-no-nested-fn", replace: "" },
  { id: "trigger-no-inner-try", find: "if (n !== r.guarded && ts.isTryStatement(n)) return; // repro-guard:trigger-no-inner-try", replace: "" },
  { id: "trigger-handled", find: "if (ts.isCallExpression(n) && !(n !== r.guarded && handledLocally(n))) { // repro-guard:trigger-handled", replace: "if (ts.isCallExpression(n)) {" },
  { id: "trigger-param", find: "const t = paramCallee(n.expression, fn); // repro-guard:trigger-param", replace: "const t = paramCallee(n.expression, fn) ?? { param: 0, prop: null };" },
  { id: "trigger-not-builtin", find: "if (t && t.prop !== null && DATA_METHODS.has(t.prop)) { ts.forEachChild(n, visit); return; } // repro-guard:trigger-not-builtin", replace: "" },
  { id: "observe-log", find: 'return i >= 0 ? { channel: "logged", logParam: i } : null; // repro-guard:observe-log', replace: 'return { channel: "logged", logParam: i >= 0 ? i : null };' },
  { id: "observe-push", find: 'return id && (paramIdx(id) >= 0 || local(id)) ? { channel: "pushed", logParam: null } : null; // repro-guard:observe-push', replace: 'return { channel: "pushed", logParam: null };' },
  { id: "existing-binds", find: "&& to(st.moduleSpecifier.text) && !st.importClause?.isTypeOnly) { // repro-guard:existing-binds", replace: "&& !st.importClause?.isTypeOnly) {" },
  { id: "existing-in-test", find: 'ts.isCallExpression(tc) && plainCall(tc, ["test", "it"])', replace: "ts.isCallExpression(tc)" },
  // Batch 31: the helper-callback path (each removed; the cases check the refusal's reason, so a removal that is caught
  // by a later rule with another reason still fails its case)
  { id: "existing-helper-local", find: 'if (!helpers.has(hc.expression.text)) return "unknown-helper"; // repro-guard:existing-helper-local', replace: "" },
  { id: "existing-helper-one-level", find: 'if (!inTestCb(outer)) return "nested-callback"; // repro-guard:existing-helper-one-level', replace: "" },
  { id: "existing-helper-async", find: 'if (!mods(cb).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return "sync-callback"; // repro-guard:existing-helper-async', replace: "" },
  { id: "site-not-toplevel", find: 'if (site.shape === "toplevel-catch") return refuse("REPRO_NO_ENTRY", "toplevel-catch"); // repro-guard:site-not-toplevel', replace: "" },
  { id: "existing-plain-path", find: "if (!(t && ts.isTryStatement(t) && t.tryBlock === b && !t.catchClause && !!t.finallyBlock)) return null; // repro-guard:existing-plain-path", replace: "if (!t || !ts.isTryStatement(t)) return null;" },
  { id: "existing-args", find: "&& !n.arguments.some(ts.isSpreadElement); // repro-guard:existing-args", replace: "; // removed" },
  // Batch 32: ranking, the cap, stop at the first REPRO_OK, the verdict from one attempt's own runs, the best-ranked reason
  { id: "rank-names-dependency", find: 'const namesDependency = trigger.prop !== null ? word(trigger.prop.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")).test(text) : !NO_VALUE(arg); // repro-guard:rank-names-dependency', replace: "const namesDependency = false;" },
  { id: "rank-own-file", find: "const ownFile = norm(fileStem(ex.path)) === norm(fileStem(sitePath)); // repro-guard:rank-own-file", replace: "const ownFile = false;" },
  { id: "rank-setup-injects-failure", find: "return exprInjectsFailure(arg, trigger.prop, locals); // repro-guard:rank-setup-injects-failure", replace: "return false;" },
  // Batch 33 follow-up: removed (an assignment override is not seen), and loosened (any assignment to the member counts)
  { id: "rank-setup-assigns-failure", find: "if (setupAssignsFailure(ex, trigger, locals)) return true; // repro-guard:rank-setup-assigns-failure", replace: "" },
  { id: "rank-setup-assigns-failure", find: "return !unsure && functionInjectsFailure(resolveLocal(last, locals));", replace: "return functionInjectsFailure(resolveLocal(last, locals));" },
  { id: "attempts-cap", find: "const tried = plans.slice(0, MAX_ATTEMPTS); // repro-guard:attempts-cap", replace: "const tried = plans;" },
  { id: "attempt-stop-ok", find: 'if (code === "REPRO_OK") return { code, runs: r.runs!, plan: p, attempts, untried: plans.length - attempts.length }; // repro-guard:attempt-stop-ok', replace: "" },
  { id: "attempt-stop-env", find: "if (!BASE_REASONS.has(code)) break; // repro-guard:attempt-stop-env", replace: "" },
  { id: "attempts-best-ranked", find: "const best = attempts[0]; // repro-guard:attempts-best-ranked", replace: "const best = attempts[attempts.length - 1];" },
  // removed: the attempt's claimed code is trusted
  { id: "attempt-own-runs", find: 'const code: ReproCode = r.runs ? judge(r.runs) : r.code === "REPRO_OK" ? "REPRO_WRONG_REASON" : r.code; // repro-guard:attempt-own-runs', replace: "const code: ReproCode = r.code;" },
  // loosened: each variant may come from any attempt so far (evidence pooled across attempts)
  { id: "attempt-own-runs", find: 'const code: ReproCode = r.runs ? judge(r.runs) : r.code === "REPRO_OK" ? "REPRO_WRONG_REASON" : r.code; // repro-guard:attempt-own-runs', replace: 'const pooled = { ...r.runs } as Record<Variant, VariantRun>; for (const a of attempts) for (const v of VARIANTS) if (r.runs && a.runs && judge({ ...pooled, [v]: a.runs[v] }) === "REPRO_OK") pooled[v] = a.runs[v]; const code: ReproCode = r.runs ? judge(pooled) : r.code;' },
  { id: "needs-cand", find: 'if (!cu.ok) return { code: "REPRO_ISOLATION", detail: cu.reason }; // repro-guard:needs-cand', replace: "" },
  { id: "judge-isolation", find: 'if (all.some((r) => r.exitCode === 97 || r.exitCode === 98)) return "REPRO_ISOLATION"; // repro-guard:judge-isolation', replace: "" },
  { id: "judge-clean", find: "const clean = (r: VariantRun) => r.leftovers === 0 && !r.tampered?.length; // repro-guard:judge-clean", replace: "const clean = (_r: VariantRun) => true;" },
  { id: "judge-one-pass", find: "r.pass === 1; // repro-guard:judge-one-pass", replace: "r.pass >= 0;" },
  { id: "judge-one-fail", find: "r.fail === 1 && r.pass === 0; // repro-guard:judge-one-fail", replace: "r.fail >= 1;" },
  { id: "judge-repro-fails", find: 'if (passed(runs.repro)) return "REPRO_NOT_FAILING"; // repro-guard:judge-repro-fails', replace: "" },
  { id: "judge-probe", find: 'if (!passed(runs.probe)) return "REPRO_WRONG_REASON"; // repro-guard:judge-probe', replace: "" },
  { id: "judge-control", find: 'if (!passed(runs.control)) return "REPRO_VACUOUS"; // repro-guard:judge-control', replace: "" },
];

test("M196: every admit case and refused near miss holds; each guard has a mutant and a near miss; three admit shapes", () => {
  for (const c of CASES) c.run(repro, ctx);
  const tags = [...new Set([...source.matchAll(/\/\/ repro-guard:([a-z0-9-]+)/g)].map((m) => m[1]!))].sort();
  assert.deepEqual(tags, TAGS);
  for (const t of TAGS) {
    assert.ok(MUTANTS.some((m) => m.id === t), `guard ${t} has no mutant`);
    assert.ok(CASES.some((c) => c.condition === t && c.kind === "refuse"), `guard ${t} needs a refused near miss`);
  }
  for (const c of CASES) assert.ok(TAGS.includes(c.condition), c.id);
  assert.deepEqual([...new Set(CASES.filter((c) => c.kind === "admit" && c.shape !== "judge").map((c) => c.shape))].sort(), ["agent", "ledger", "shelf"]);
});

const tsUrl = pathToFileURL(createRequire(join(repo, "package.json")).resolve("typescript")).href;
const absImports = (text: string) => text.replace(/from "\.\/([\w-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`).replace('from "typescript"', `from ${JSON.stringify(tsUrl)}`);
test("M196 mutation: removing or loosening any one guard of reproduce.ts fails a case written for that guard", async () => {
  const dir = mkdtempSync(join(scratch, "mut-"));
  let n = 0;
  for (const m of MUTANTS) {
    assert.equal(source.split(m.find).length - 1, 1, `mutant ${m.id}: anchor text must occur once in reproduce.ts`);
    const file = join(dir, `mutant-${m.id}-${n++}.ts`);
    // a guard's tag comment may run on after the tag: the replacement keeps the rest of the line a comment
    const by = m.replace + (m.find.includes("// repro-guard:") ? " //" : "");
    writeFileSync(file, absImports(source.replace(m.find, () => by)));
    const mod = (await import(pathToFileURL(file).href)) as ReproModule;
    const failed: string[] = [];
    // a case fails by a wrong result or by throwing (a removed guard can leave a value undefined)
    for (const c of CASES) { try { c.run(mod, ctx); } catch { failed.push(c.id); } }
    assert.ok(failed.length > 0, `mutant ${m.id} survived every case`);
    // and it is caught by a case written for that condition, not only by a side effect elsewhere
    assert.ok(CASES.some((c) => c.condition === m.id && failed.includes(c.id)), `mutant ${m.id}: no ${m.id} case fails (${failed.join(", ")})`);
  }
});

const env = () => ({ PEACEAI_STAGE2_CAND: CAND });
const roots = () => privateRoots(repo, process.env);
const busy = () => Number(spawnSync("sh", ["-c", `pgrep -u ${CAND} | wc -l`], { encoding: "utf8" }).stdout.trim() || "0");

test("M196 sandbox (node:test): admit returned and thrown; passes on current code, vacuous and wrong-reason refused; the kept test passes once fixed", { skip: noCand }, () => {
  assert.equal(busy(), 0, "the candidate uid must be idle (tests run one at a time)");
  const run = (dir: string, code: string) => repro.reproduce(dir, code, siteOf(ctx.ledger, code), { env: env(), roots: roots() });
  const ok = run(ctx.ledger, "QUOTA_STORE_DOWN");
  assert.equal(ok.code, "REPRO_OK", JSON.stringify(ok));
  assert.deepEqual(ok.runs, { repro: { exitCode: 1, pass: 0, fail: 1, leftovers: 0 }, probe: { exitCode: 0, pass: 1, fail: 0, leftovers: 0 }, control: { exitCode: 0, pass: 1, fail: 0, leftovers: 0 } });
  assert.equal(run(ctx.ledger, "SWEEP_BIN_STUCK").code, "REPRO_OK", "the call is inside the test's try / finally");
  // Batch 31: the call is inside the async callback of a helper the test file defines (kept, with its own try / finally)
  const viaHelper = run(ctx.ledger, "JOURNAL_APPEND_FAILED");
  assert.equal(viaHelper.code, "REPRO_OK", JSON.stringify(viaHelper));
  assert.deepEqual(viaHelper.runs, ok.runs);
  assert.equal(run(ctx.ledger, "PROFILE_MISSING").code, "REPRO_NOT_FAILING", "an injected failure the code does not report: the test cannot fail");
  assert.equal(run(ctx.ledger, "THEME_DEFAULTED").code, "REPRO_VACUOUS", "the code is produced with no failure injected");
  const wrong = run(ctx.ledger, "RATES_UNAVAILABLE");
  assert.equal(wrong.code, "REPRO_WRONG_REASON", "the module does not load without the script's setup: the repro fails, but not for the code");
  assert.equal(wrong.runs!.probe.exitCode, 1);
  // the same plan on a fixed copy (the store failure is no longer reported as QUOTA_STORE_DOWN): the repro test passes
  const fixed = join(scratch, "ledger-fixed");
  cpSync(ctx.ledger, fixed, { recursive: true });
  writeFileSync(join(fixed, "src/quota.ts"), readFileSync(join(fixed, "src/quota.ts"), "utf8").replace('return { ok: false, code: "QUOTA_STORE_DOWN" };', "return { ok: true, left: 0 };"));
  const after = repro.validateRepro(fixed, ok.plan!, { env: env(), roots: roots() });
  assert.equal(after.code, "REPRO_NOT_FAILING");
  assert.deepEqual(after.runs!.repro, { exitCode: 0, pass: 1, fail: 0, leftovers: 0 });
});

const online = () => spawnSync("npm", ["view", "vitest@4.1.10", "version"], { encoding: "utf8", timeout: 60_000 }).status === 0;
test("M196 sandbox (flat npm + vitest 4): admit thrown, dependencies installed by installDeps as the candidate uid", { skip: noCand }, (t) => {
  if (!process.env.CI && !online()) { t.skip("offline"); return; }
  assert.equal(busy(), 0);
  const r = repro.reproduce(ctx.shelf, "SETTINGS_UNREADABLE", siteOf(ctx.shelf, "SETTINGS_UNREADABLE"), { env: env(), roots: roots() });
  assert.equal(r.code, "REPRO_OK", JSON.stringify(r));
  assert.deepEqual([r.runs!.repro.exitCode, r.runs!.repro.fail, r.runs!.probe.pass, r.runs!.control.pass], [1, 1, 1, 1]);
  // Batch 31: the call is inside the async callback of a helper imported from ./helpers
  const h = repro.reproduce(ctx.shelf, "VAULT_KEY_UNREADABLE", siteOf(ctx.shelf, "VAULT_KEY_UNREADABLE"), { env: env(), roots: roots() });
  assert.equal(h.code, "REPRO_OK", JSON.stringify(h));
});

test("M196 sandbox (pnpm workspace + jest 29, CommonJS): admit logged through an injected logger", { skip: noCand }, (t) => {
  if (!process.env.CI && !online()) { t.skip("offline"); return; }
  assert.equal(busy(), 0);
  // jest 29.7.0 from its pinned lockfile (fixtures/m173-forge-jest29), installed once and linked into the copy's root
  // node_modules the way installDeps links a staged tree (the workspace has no pnpm lockfile of its own)
  const deps = mkdtempSync(join(scratch, "jest29-"));
  cpSync(join(repo, "peaceai/test/fixtures/m173-forge-jest29"), deps, { recursive: true });
  const i = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: deps, encoding: "utf8", timeout: 600_000 });
  assert.equal(i.status, 0, i.stderr);
  spawnSync("chmod", ["-R", "a+rX", deps]);
  chmodSync(deps, 0o755);
  chmodSync(scratch, 0o755);
  const provideDeps = (copy: string) => { mkdirSync(join(copy, "node_modules"), { recursive: true }); for (const e of readdirSync(join(deps, "node_modules"))) if (e !== ".bin") symlinkSync(join(deps, "node_modules", e), join(copy, "node_modules", e)); };
  const r = repro.reproduce(ctx.agent, "SYNC_PUSH_FAILED", siteOf(ctx.agent, "SYNC_PUSH_FAILED"), { env: env(), roots: roots(), provideDeps });
  assert.equal(r.code, "REPRO_OK", JSON.stringify(r));
  assert.equal(r.plan!.runner.runner, "jest");
  // Batch 31: the call is inside the async callback of a helper required from ./support
  const h = repro.reproduce(ctx.agent, "FETCH_ONE_FAILED", siteOf(ctx.agent, "FETCH_ONE_FAILED"), { env: env(), roots: roots(), provideDeps });
  assert.equal(h.code, "REPRO_OK", JSON.stringify(h));
});

// Batch 32: the first-found (or first-ranked) base test does not reach the site; a later or better-ranked one does
const codes = (r: repro.ReproResult) => r.attempts!.map((a) => `${a.base.path}:${a.base.line} ${a.code}`);
const planned = (dir: string, code: string) => { const p = repro.planRepros(openRepo(dir), code, siteOf(dir, code)); assert.ok(!("refuse" in p)); return p.plans; };
const firstFound = (ps: repro.ReproPlan[]) => ps.find((p) => p.rank.found === 0)!;
test("M196 sandbox (node:test, Batch 32): ranked base tests; attempt 2 kept; the fourth beyond the cap never run", { skip: noCand }, () => {
  assert.equal(busy(), 0, "the candidate uid must be idle (tests run one at a time)");
  const o = { env: env(), roots: roots() };
  const run = (code: string) => repro.reproduce(ctx.ledger, code, siteOf(ctx.ledger, code), o);
  // ranking: the first-found base (null, mode "off") does not reach the site; the base providing `read` does
  const g = run("GAUGE_READ_FAILED");
  assert.equal(g.code, "REPRO_OK", JSON.stringify(g));
  assert.deepEqual(codes(g), ["test/gauge.test.ts:9 REPRO_OK"]);
  assert.equal(repro.validateRepro(ctx.ledger, firstFound(planned(ctx.ledger, "GAUGE_READ_FAILED")), o).code, "REPRO_NOT_FAILING", "v1's first-found base");
  // a second attempt: the first-ranked base (dry) does not reach the site
  const m = run("METER_SAMPLE_FAILED");
  assert.equal(m.code, "REPRO_OK", JSON.stringify(m));
  assert.deepEqual(codes(m), ["test/meter.test.ts:6 REPRO_NOT_FAILING", "test/meter.test.ts:10 REPRO_OK"]);
  assert.deepEqual(m.runs, m.attempts![1]!.runs, "the kept result's runs are attempt 2's own");
  assert.equal(m.plan!.existing.line, 10);
  // the module's own test file first; the first-found base (another file, cached) does not reach the site
  const t = run("TALLY_COUNT_FAILED");
  assert.deepEqual([t.code, ...codes(t)], ["REPRO_OK", "test/tally.test.ts:6 REPRO_OK"]);
  assert.equal(repro.validateRepro(ctx.ledger, firstFound(planned(ctx.ledger, "TALLY_COUNT_FAILED")), o).code, "REPRO_NOT_FAILING");
  // all three attempts fail: the best-ranked reason, no plan, and the fourth candidate (which would pass) is never run
  const p = run("PUMP_DRAIN_FAILED");
  assert.deepEqual([p.code, p.plan, p.untried, p.attempts!.length], ["REPRO_NOT_FAILING", undefined, 1, 3]);
  assert.ok(p.attempts!.every((a) => a.code === "REPRO_NOT_FAILING"));
  const fourth = planned(ctx.ledger, "PUMP_DRAIN_FAILED")[3]!;
  assert.ok(!p.attempts!.some((a) => a.base.line === fourth.existing.line));
  assert.equal(repro.validateRepro(ctx.ledger, fourth, o).code, "REPRO_OK", "the cap really left a base that reaches the site");
});

test("M196 sandbox (flat npm + vitest 4, Batch 32): ranked base test kept; attempt 2 kept", { skip: noCand }, (t) => {
  if (!process.env.CI && !online()) { t.skip("offline"); return; }
  assert.equal(busy(), 0);
  const o = { env: env(), roots: roots() };
  const f = repro.reproduce(ctx.shelf, "FEED_FETCH_FAILED", siteOf(ctx.shelf, "FEED_FETCH_FAILED"), o);
  assert.equal(f.code, "REPRO_OK", JSON.stringify(f));
  assert.deepEqual(codes(f), ["test/feed.test.ts:8 REPRO_OK"]);
  assert.equal(repro.validateRepro(ctx.shelf, firstFound(planned(ctx.shelf, "FEED_FETCH_FAILED")), o).code, "REPRO_NOT_FAILING", "v1's first-found base");
  const b = repro.reproduce(ctx.shelf, "BEACON_POST_FAILED", siteOf(ctx.shelf, "BEACON_POST_FAILED"), o);
  assert.equal(b.code, "REPRO_OK", JSON.stringify(b));
  assert.deepEqual(codes(b), ["test/beacon.test.ts:7 REPRO_NOT_FAILING", "test/beacon.test.ts:10 REPRO_OK"]);
});


test("M196 sandbox (node:test + vitest, Batch 33): a setup that injects the failure is demoted; the healthy base is REPRO_OK", { skip: noCand }, (t) => {
  assert.equal(busy(), 0, "the candidate uid must be idle (tests run one at a time)");
  const o = { env: env(), roots: roots() };
  const k = repro.reproduce(ctx.ledger, "KILN_HEAT_FAILED", siteOf(ctx.ledger, "KILN_HEAT_FAILED"), o);
  assert.equal(k.code, "REPRO_OK", JSON.stringify(k));
  assert.equal(k.plan!.rank.setupInjectsFailure, false);
  assert.deepEqual(codes(k), ["test/kiln.test.ts:10 REPRO_OK"]);
  // the demoted (throwing stub) base alone is REPRO_VACUOUS
  const demoted = planned(ctx.ledger, "KILN_HEAT_FAILED").find((p) => p.rank.setupInjectsFailure)!;
  assert.equal(repro.validateRepro(ctx.ledger, demoted, o).code, "REPRO_VACUOUS", "the stubbing base is vacuous alone");
  if (!process.env.CI && !online()) { t.skip("offline (vitest shape)"); return; }
  const r = repro.reproduce(ctx.shelf, "RELAY_SEND_FAILED", siteOf(ctx.shelf, "RELAY_SEND_FAILED"), o);
  assert.equal(r.code, "REPRO_OK", JSON.stringify(r));
  assert.equal(r.plan!.rank.setupInjectsFailure, false);
  assert.deepEqual(codes(r), ["test/relay.test.ts:10 REPRO_OK"]);
});

test("M196 sandbox (node:test + vitest, Batch 33 follow-up): an assignment override of the trigger is demoted; the healthy base is REPRO_OK", { skip: noCand }, (t) => {
  assert.equal(busy(), 0, "the candidate uid must be idle (tests run one at a time)");
  const o = { env: env(), roots: roots() };
  const l = repro.reproduce(ctx.ledger, "LOOM_DRAW_FAILED", siteOf(ctx.ledger, "LOOM_DRAW_FAILED"), o);
  assert.equal(l.code, "REPRO_OK", JSON.stringify(l));
  assert.deepEqual(codes(l), ["test/loom.test.ts:12 REPRO_OK"]);
  const demoted = planned(ctx.ledger, "LOOM_DRAW_FAILED").find((p) => p.rank.setupInjectsFailure)!;
  assert.equal(demoted.existing.line, 8);
  assert.equal(repro.validateRepro(ctx.ledger, demoted, o).code, "REPRO_VACUOUS", "the overriding base is vacuous alone");
  if (!process.env.CI && !online()) { t.skip("offline (vitest shape)"); return; }
  const b = repro.reproduce(ctx.shelf, "BEAM_GLOW_FAILED", siteOf(ctx.shelf, "BEAM_GLOW_FAILED"), o);
  assert.equal(b.code, "REPRO_OK", JSON.stringify(b));
  assert.deepEqual(codes(b), ["test/beam.test.ts:11 REPRO_OK"]);
});

test("M196 wiring: plan-only; nothing in the loop, its grading, selfpropose or the credit sources imports reproduce.ts", () => {
  const importers: string[] = [];
  for (const d of ["peaceai/lib", "peaceai/bin", "builder-log", "scripts", ".github/workflows"]) {
    let ents: string[] = [];
    try { ents = readdirSync(join(repo, d)); } catch { continue; }
    for (const f of ents) {
      let t = "";
      try { t = readFileSync(join(repo, d, f), "utf8"); } catch { continue; }
      if (/reproduce(?:-v1)?\.ts/.test(t) && f !== "reproduce.ts") importers.push(`${d}/${f}`);
    }
  }
  assert.deepEqual(importers, ["peaceai/bin/reproduce-v1.ts"]);
  assert.doesNotMatch(source, /from "\.\/(?:plan5run|loopgrade|plangrade|selfgrade|credit[\w-]*)\.ts"|builder-log/);
  const spec = readFileSync(join(repo, "peaceai/spec/reproduce-v1.md"), "utf8");
  assert.match(spec, /## Soundness/);
  assert.match(spec, /separate reviewed design/);
  assert.match(spec, /never a grading test/i);
  assert.match(source, /NOT FOR CREDIT/);
});

test("M196 generality: reproduce.ts, its CLI and the M196 fixtures name no task, task repository, task file or Peace project", () => {
  const pub = JSON.parse(readFileSync(join(repo, "peaceai/plan/tasks-public-v1.json"), "utf8")) as PlanTaskFile;
  const words = new Set<string>(["peacestocks", "stocks", "scanner", "markets", "ticker", "universe", "daily_bars", "r2_put", "corporate_actions", "stop_chain", "trading"]);
  for (const t of pub.tasks) {
    words.add(t.id.toLowerCase());
    for (const part of t.repo.toLowerCase().split("/")) if (part.length >= 4) words.add(part);
    for (const f of [...t.reference.files.map((x) => x.path), ...t.tests.files]) if (f.split("/").length >= 2) words.add(f.toLowerCase());
  }
  for (const f of [join(libDir, "reproduce.ts"), join(repo, "peaceai/bin/reproduce-v1.ts"), join(repo, "peaceai/test/m196-fixtures.ts"), join(repo, "peaceai/test/m196-cases.ts")]) {
    const text = readFileSync(f, "utf8").toLowerCase();
    for (const w of words) assert.ok(!new RegExp(`(?<![a-z0-9_])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_])`).test(text), `${f} names ${w}`);
  }
});
