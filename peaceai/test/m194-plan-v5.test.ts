// M194 PLAN-ONLY v5 (peaceai/spec/plan-only-v5.md): v5 is v4 plus one family, "diagnose from failure codes". Checked
// here: every M153 and M164 case still holds on v5 (a request the family refuses gets v4's plan); the family's admit
// cases and refused near misses (m194-cases.ts) on two shapes (a flat npm + vitest package, a pnpm + jest workspace);
// a mutation check (each tagged `rule:diag-*` line mutated must fail a case); a generality check; the synthetic grade
// before (v4) and after (v5); the wiring (v5 EXPERIMENTAL with its own CLI and digest, v4 stays the default and
// byte-identical); and the runner's rows. Offline.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { approvedRules, sha256, type Plan, type PlanTask, type PlanTaskFile } from "../lib/plan.ts";
import * as plan5 from "../lib/plan5.ts";
import { DEFAULT_PLANNER, selectPlanner } from "../lib/plandefault.ts";
import { gradePlan, logRowProblem } from "../lib/plangrade.ts";
import type { Checkout, Fetcher } from "../lib/planrun.ts";
import { plannerSha256V4 } from "../lib/plan4run.ts";
import { plannerSha256V5, runTaskV5 } from "../lib/plan5run.ts";
import { loadModel } from "../lib/nlparse.ts";
import { loadTargets } from "../lib/target.ts";
import type { IndexFile } from "../lib/symbols.ts";
import { CASES as CASES_V3, type PlannerModule } from "./m153-cases.ts";
import { LICENSE_SHA } from "./m153-fixtures.ts";
import { CASES_V4 } from "./m164-cases.ts";
import { CASES_V5, planV4, planV5, type CaseCtx, type V5Module } from "./m194-cases.ts";
import { BACKUP, BACKUP_REQ, QUEUE, QUEUE_REQ } from "./m194-fixtures.ts";
import { CASES_V5_REPORT } from "./m195-cases.ts";
import { MAIL, MAIL_REQ } from "./m195-fixtures.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const libDir = join(repo, "peaceai/lib");
const source = readFileSync(join(libDir, "plan5.ts"), "utf8");
const ctx: CaseCtx = { rules: approvedRules(repo), model: loadModel() };
const ctx3 = { ...ctx, targetRepo: Object.keys(loadTargets().targets).sort()[0]! };
const H40 = "a".repeat(40);
/** v5 in M153's PlannerModule shape, so M153's and M164's cases run on it unchanged. */
const asV3 = (m: V5Module): PlannerModule => ({ planTaskV3: m.planTaskV5 as unknown as PlannerModule["planTaskV3"], repoFromFiles: m.repoFromFiles });
const TAGS = ["diag-alias", "diag-alias-use", "diag-ambiguous", "diag-class-follow", "diag-code-shape", "diag-detail-trim", "diag-error-class", "diag-error-new", "diag-failure-report", "diag-fallback-v4", "diag-needs-site", "diag-plan-sites", "diag-reject", "diag-report-caught", "diag-report-log", "diag-report-push", "diag-report-result", "diag-source-only", "diag-statement-bound", "diag-template-boundary", "diag-template-prefix", "diag-throw", "diag-toplevel-call", "diag-toplevel-local", "diag-toplevel-module"];
/** M195's conditions: each needs admit cases on two shapes (`mail`, `agent`), a near miss, a removing mutant and a loosening one. */
const TAGS_M195 = ["diag-detail-trim", "diag-report-caught", "diag-report-log", "diag-report-push", "diag-report-result", "diag-template-boundary", "diag-template-prefix", "diag-toplevel-call", "diag-toplevel-local", "diag-toplevel-module"];
const CASES = [...CASES_V5, ...CASES_V5_REPORT];

/** One mutant per tagged rule. `find` must occur exactly once in plan5.ts. */
const MUTANTS: { id: string; find: string; replace: string }[] = [
  { id: "diag-failure-report", find: "  /\\b(?:fail(?:s|ed|ing|ures?)?|errors?|", replace: "  /(?:)|\\b(?:fail(?:s|ed|ing|ures?)?|errors?|" },
  { id: "diag-code-shape", find: "([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)", replace: "([A-Za-z][A-Za-z0-9]*(?:_[A-Z0-9]+)*)" },
  { id: "diag-throw", find: 'if (ts.isThrowStatement(p)) return { via: "throw", cls: null }; // rule:diag-throw', replace: "" },
  { id: "diag-error-new", find: 'return { via: "error-new", cls: null }; // rule:diag-error-new', replace: "{}" },
  { id: "diag-reject", find: 'if (nameOf(p.expression) === "reject") return { via: "reject", cls: null }; // rule:diag-reject', replace: "" },
  { id: "diag-error-class", find: "if (p.expression.kind === ts.SyntaxKind.SuperKeyword) { // rule:diag-error-class", replace: 'if (p.expression.kind === ts.SyntaxKind.SuperKeyword) { return { via: "error-class", cls: ts.findAncestor(p, ts.isClassLike)?.name?.text ?? "x" };' },
  { id: "diag-statement-bound", find: "if (ts.isStatement(p) || ts.isFunctionLike(p) || ts.isClassLike(p) || ts.isSourceFile(p)) return null; // rule:diag-statement-bound", replace: "" },
  { id: "diag-source-only", find: ".filter(isSourceFile); // rule:diag-source-only", replace: ";" },
  { id: "diag-alias", find: " && /^[A-Z][A-Z0-9_]*$/.test(d.name.text)) aliases.add(d.name.text); // rule:diag-alias", replace: ") aliases.add(d.name.text);" },
  { id: "diag-alias-use", find: "for (const a of aliases) uses(a, (n) => { // rule:diag-alias-use", replace: "for (const a of [] as string[]) uses(a, (n) => {" },
  { id: "diag-class-follow", find: "for (const cls of classes) { // rule:diag-class-follow", replace: "for (const cls of [] as string[]) {" },
  { id: "diag-ambiguous", find: " || new Set(sites.map((s) => s.path)).size > MAX_SITE_FILES_PER_CODE)", replace: ")" },
  { id: "diag-needs-site", find: 'if (!codes.some((c) => c.status === "thrown" || c.status === "reported")) return refuse("NO_THROW_SITE", codes); // rule:diag-needs-site', replace: "" },
  { id: "diag-fallback-v4", find: "if (d.family === null) return { ...base, planner: PLANNER_V5, diagnosis: d }; // rule:diag-fallback-v4", replace: "if (d.family === null && Date.now() < 0) return { ...base, planner: PLANNER_V5, diagnosis: d };" },
  { id: "diag-plan-sites", find: "!sources.some((x) => x.path === s.path)) sources.push(", replace: "true) sources.push(" },
  // M195: for each new guard, one mutant that removes it (the admit cases fail) and one that loosens it (a near miss fails)
  { id: "diag-report-log", find: 'const log = isLogCall(p.expression) ? caught("catch-log", p) : null; // rule:diag-report-log', replace: "const log = null;" },
  { id: "diag-report-log", find: 'const log = isLogCall(p.expression) ? caught("catch-log", p) : null; // rule:diag-report-log', replace: 'const log = caught("catch-log", p);' },
  { id: "diag-report-push", find: 'const push = isProblemPush(p.expression) ? caught("catch-push", p) : null; // rule:diag-report-push', replace: "const push = null;" },
  { id: "diag-report-push", find: 'const push = isProblemPush(p.expression) ? caught("catch-push", p) : null; // rule:diag-report-push', replace: 'const push = ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === "push" ? caught("catch-push", p) : null;' },
  { id: "diag-report-result", find: 'const result = ts.isObjectLiteralExpression(p) && isFailedResult(p) ? caught("catch-result", p) : null; // rule:diag-report-result', replace: "const result = null;" },
  { id: "diag-report-result", find: 'const result = ts.isObjectLiteralExpression(p) && isFailedResult(p) ? caught("catch-result", p) : null; // rule:diag-report-result', replace: 'const result = ts.isObjectLiteralExpression(p) ? caught("catch-result", p) : null;' },
  { id: "diag-report-caught", find: "const at = caughtBy(sink); return at ? { via, cls: null, at } : null; }; // rule:diag-report-caught", replace: "return null; };" },
  { id: "diag-report-caught", find: "const at = caughtBy(sink); return at ? { via, cls: null, at } : null; }; // rule:diag-report-caught", replace: "return { via, cls: null, at: sink }; };" },
  { id: "diag-template-prefix", find: "return m && m[1]!.length - 1 >= 5 ? m[1]! : null; // rule:diag-template-prefix", replace: "return null;" },
  { id: "diag-template-prefix", find: "return m && m[1]!.length - 1 >= 5 ? m[1]! : null; // rule:diag-template-prefix", replace: 'return /^([A-Z][A-Z0-9]*_(?:[A-Z0-9]+_)*)[A-Z0-9]+$/.exec(errCode)?.[1] ?? null;' },
  { id: "diag-template-boundary", find: "if ((before === \"\" ? i === 0 : /[^A-Za-z0-9_$]$/.test(before)) && !/^[A-Za-z0-9_$]/.test(parts[i + 1]!)) return true; // rule:diag-template-boundary", replace: "" },
  { id: "diag-template-boundary", find: "if ((before === \"\" ? i === 0 : /[^A-Za-z0-9_$]$/.test(before)) && !/^[A-Za-z0-9_$]/.test(parts[i + 1]!)) return true; // rule:diag-template-boundary", replace: "return true;" },
  { id: "diag-detail-trim", find: 'const detail = m[2]?.replace(/\\.+$/, "") || null; // rule:diag-detail-trim', replace: "const detail = m[2] ?? null;" },
  { id: "diag-detail-trim", find: 'const detail = m[2]?.replace(/\\.+$/, "") || null; // rule:diag-detail-trim', replace: 'const detail = m[2]?.replace(/\\./g, "") || null;' },  // Batch 31 (toplevel-catch): removing each guard's admit path fails the admit cases; loosening it fails its near miss
  { id: "diag-toplevel-call", find: 'if (at.expression.name.text !== "catch" || !ts.isCallExpression(recv) || !ts.isIdentifier(recv.expression)) return null; // rule:diag-toplevel-call', replace: "return null;" },
  { id: "diag-toplevel-call", find: 'if (at.expression.name.text !== "catch" || !ts.isCallExpression(recv) || !ts.isIdentifier(recv.expression)) return null; // rule:diag-toplevel-call', replace: "" },
  { id: "diag-toplevel-module", find: "if (ts.findAncestor(at.parent, (p) => ts.isFunctionLike(p) || ts.isClassLike(p))) return null; // rule:diag-toplevel-module", replace: "return null;" },
  { id: "diag-toplevel-module", find: "if (ts.findAncestor(at.parent, (p) => ts.isFunctionLike(p) || ts.isClassLike(p))) return null; // rule:diag-toplevel-module", replace: "" },
  { id: "diag-toplevel-local", find: "if (!decl) return null; // rule:diag-toplevel-local", replace: "return null;" },
  { id: "diag-toplevel-local", find: "if (!decl) return null; // rule:diag-toplevel-local", replace: "if (!decl) return { symbol: name, line: 1 };" },
];

const dir = mkdtempSync(join(tmpdir(), "peaceai-m194-mut-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const tsUrl = pathToFileURL(createRequire(join(repo, "package.json")).resolve("typescript")).href;
const absImports = (text: string) => text.replace(/from "\.\/([\w-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`).replace('from "typescript"', `from ${JSON.stringify(tsUrl)}`);

test("M194: every M153 case (v3's rules) and every M164 case (v4's named-test rule) still holds on v5", () => {
  for (const c of [...CASES_V3, ...CASES_V4]) c.run(asV3(plan5), ctx3);
});

test("M194: every diagnose admit case and refused near miss holds; each tagged rule has a mutant, an admit and a near miss", () => {
  for (const c of CASES) c.run(plan5, ctx);
  // M194/M195 conditions are the `diag-*` tags; Batch 34's `trace-*` tags are checked by m198-plan-v5-trace.test.ts
  const tags = [...new Set([...source.matchAll(/\/\/ rule:(diag-[a-z0-9-]+)/g)].map((m) => m[1]!))].sort();
  assert.deepEqual(tags, TAGS);
  for (const t of TAGS) {
    assert.ok(MUTANTS.some((m) => m.id === t), `rule ${t} has no mutant`);
    assert.ok(CASES.some((c) => c.condition === t && c.kind === "admit"), `rule ${t} has no admit case`);
    assert.ok(CASES.some((c) => c.condition === t && c.kind === "refuse"), `rule ${t} needs a refused near miss`);
  }
  for (const c of CASES) assert.ok(TAGS.includes(c.condition), c.id);
  for (const t of TAGS_M195) {
    assert.equal(new Set(CASES_V5_REPORT.filter((c) => c.condition === t && c.kind === "admit").map((c) => c.shape)).size, 2, `rule ${t} needs admit cases on both M195 shapes`);
    assert.equal(MUTANTS.filter((m) => m.id === t).length, 2, `rule ${t} needs a removing and a loosening mutant`);
  }
});

test("M194 mutation: mutating any one tagged rule of plan5.ts fails at least one case", async () => {
  let n = 0;
  for (const m of MUTANTS) {
    assert.equal(source.split(m.find).length - 1, 1, `mutant ${m.id}: anchor text must occur once in plan5.ts`);
    const file = join(dir, `mutant-${m.id}-${n++}.ts`);
    writeFileSync(file, absImports(source.replace(m.find, () => m.replace)));
    const mod = (await import(pathToFileURL(file).href)) as V5Module;
    const failed: string[] = [];
    for (const c of CASES) { try { c.run(mod, ctx); } catch (e) { if (e instanceof assert.AssertionError) failed.push(c.id); else throw e; } }
    assert.ok(failed.length > 0, `mutant ${m.id} survived every case`);
    // M195 / Batch 31 guards: caught by a case written for that same condition, not only by a side effect elsewhere
    if (TAGS_M195.includes(m.id)) assert.ok(CASES.some((c) => c.condition === m.id && failed.includes(c.id)), `mutant ${m.id}: no ${m.id} case fails (${failed.join(", ")})`);
  }
});

test("M194 generality: plan5.ts, plan5run.ts and the M194 fixtures name no task, task repository, task file or Peace project", () => {
  const pub = JSON.parse(readFileSync(join(repo, "peaceai/plan/tasks-public-v1.json"), "utf8")) as PlanTaskFile;
  const words = new Set<string>(["peacestocks", "stocks", "scanner", "markets", "ticker", "daily_bars", "r2_put", "corporate_actions", "stop_chain", "trading"]);
  for (const t of pub.tasks) {
    words.add(t.id.toLowerCase());
    for (const part of t.repo.toLowerCase().split("/")) if (part.length >= 4) words.add(part);
    for (const f of [...t.reference.files.map((x) => x.path), ...t.tests.files]) if (f.split("/").length >= 2) words.add(f.toLowerCase());
  }
  for (const f of [join(libDir, "plan5.ts"), join(libDir, "plan5run.ts"), join(repo, "peaceai/test/m194-fixtures.ts"), join(repo, "peaceai/test/m194-cases.ts"), join(repo, "peaceai/test/m195-fixtures.ts"), join(repo, "peaceai/test/m195-cases.ts")]) {
    const lower = readFileSync(f, "utf8").toLowerCase();
    for (const w of words) assert.ok(!new RegExp(String.raw`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(lower), `${f} mentions ${w}`);
  }
});

const task = (request: string, sources: string[], tests: string[], command: string): PlanTask => ({
  id: "m194-synthetic", repo: "example-org/m194-fixture", license: "MIT", licensePath: "LICENSE", licenseSha256: LICENSE_SHA, commit: H40, request,
  tests: { command, files: tests },
  reference: { from: { pr: 1, merge: "b".repeat(40) }, files: [...sources.map((path) => ({ path, change: "modify" as const })), ...tests.map((path) => ({ path, change: "modify" as const }))], steps: [...sources.map((file) => ({ action: "edit-source" as const, file })), ...tests.map((file) => ({ action: "edit-test" as const, file })), { action: "run-tests", file: null }], docs: [] },
  trainingCheck: { workspaceCommit: H40, sources: 1, inTraining: false },
});
/** Synthetic tasks written for the fixtures: the fix is at the throwing site (2), at the try statements whose failure
 *  is caught and reported (M195, 1), or the request is one the family refuses (2: v5 must grade exactly as v4). */
const SYNTHETIC: [string, IndexFile[], PlanTask][] = [
  ["backup", BACKUP, task(BACKUP_REQ, ["src/upload.ts"], ["test/upload.test.ts"], "npx vitest run test/upload.test.ts")],
  ["queue", QUEUE, task(QUEUE_REQ, ["packages/worker/src/run.ts", "packages/worker/src/lease.ts"], ["packages/worker/test/run.test.ts", "packages/worker/test/lease.test.ts"], "cd packages/worker && pnpm jest test/run.test.ts test/lease.test.ts")],
  ["mail-reported", MAIL, task(MAIL_REQ, ["src/sync.ts", "src/digest.ts", "src/quota.ts"], ["test/sync.test.ts", "test/digest.test.ts", "test/quota.test.ts"], "npx vitest run test/sync.test.ts test/digest.test.ts test/quota.test.ts")],
  ["symptom-only", BACKUP, task("The nightly backup job fails: the manifest check reports MANIFEST_STALE.", ["src/manifest.ts"], ["test/manifest.test.ts"], "npx vitest run test/manifest.test.ts")],
  ["no-failure", BACKUP, task("`checkManifest` should treat two days as stale.", ["src/manifest.ts"], ["test/manifest.test.ts"], "npx vitest run test/manifest.test.ts")],
];

test("M194: synthetic grade before (v4) and after (v5): v5 finds the throwing sites and loses nothing on refused requests", () => {
  const g = (p: unknown, files: IndexFile[], t: PlanTask) => gradePlan(p as Plan, t, ctx.rules, files.filter((f) => /\.ts$/.test(f.path)));
  const rows = SYNTHETIC.map(([id, files, t]) => ({ id, v4: g(planV4(ctx, files, t.request), files, t), v5: g(planV5(plan5, ctx, files, t.request), files, t) }));
  for (const r of rows) assert.ok(r.v5.score >= r.v4.score, `v5 lost ${r.id}`);
  assert.deepEqual(rows.map((r) => [r.v4.fileRecall, r.v5.fileRecall]), [[0, 1], [0, 1], [0.333, 1], [1, 1], [1, 1]]);
  assert.deepEqual(rows.slice(3).map((r) => r.v5), rows.slice(3).map((r) => r.v4), "refused requests grade exactly as v4");
});

test("M194 wiring: v5 is EXPERIMENTAL (own CLI and digest, not in plandefault); v4 stays the default and byte-identical", () => {
  assert.equal(DEFAULT_PLANNER, "plan-only-v4");
  assert.equal(selectPlanner("v5"), null, "v5 is not selectable through plandefault until it is scored");
  assert.equal(plannerSha256V4(), "b667d518936d28723e4c6eecf12fd9d784febbf22804a3622362819f604c2c7c", "v4 is the planner the Auditor scored");
  const expect = sha256(["lib/plan4.ts", "lib/plan5.ts", "lib/plangrade.ts", "lib/plan5run.ts"].map((f) => readFileSync(join(repo, "peaceai", f), "utf8")).join("\0"));
  assert.equal(plannerSha256V5(), expect);
  const cli = readFileSync(join(repo, "peaceai/bin/plan-only-v5.ts"), "utf8");
  assert.match(cli, /import\("\.\.\/lib\/plan5run\.ts"\)/);
  assert.ok(!/plan4run|runFileV4/.test(cli), "v5's CLI runs v5 only");
  const run5 = readFileSync(join(libDir, "plan5run.ts"), "utf8");
  const run4 = readFileSync(join(libDir, "plan4run.ts"), "utf8");
  const body = (t: string) => t.slice(t.indexOf("\nimport ") + 1);
  assert.equal(body(run5).replace(/V5\b/g, "V4").replace(/plan5/g, "plan4").replace(/\(v5\)/g, "(v4)").replace(/with v5\./g, "with v4.").replace("v1-v5 plans share", "v1, v2, v3 and v4 plans share")
    .replace("/** v5's digest: v4's planner (v5 builds on it), v5's planner, the shared grader and this runner. v1-v4 digests are untouched. */", "/** v4's digest: its planner, the shared grader and this runner. v1's, v2's and v3's digests are untouched. */")
    .replace('["lib/plan4.ts", "lib/plan4.ts", "lib/plangrade.ts", "lib/plan4run.ts"]', '["lib/plan4.ts", "lib/plangrade.ts", "lib/plan4run.ts"]'), body(run4), "plan5run.ts is plan4run.ts with only the v5 renames and digest list");
});

test("M194 runner: v5 rows carry their own id and digest, pass the log validator, and a hidden row names no repo", () => {
  const fetcher: Fetcher = () => ({ head: H40, files: BACKUP.filter((f) => /\.tsx?$/.test(f.path)), read: (p) => BACKUP.find((f) => f.path === p)?.content ?? null, unchanged: () => true, close: () => {} } satisfies Checkout);
  const o = { root: repo, fetcher, outDir: dir, rules: ctx.rules, training: new Set<string>() };
  const t = SYNTHETIC[0]![2];
  const pub = runTaskV5(t, "public", sha256("m194"), o);
  assert.equal(pub.row.planner, "plan-only-v5");
  assert.equal(pub.row.plannerSha256, plannerSha256V5());
  assert.equal(pub.row.code, "OK");
  assert.equal(logRowProblem(pub.row), null);
  assert.equal(pub.plan?.diagnosis.family, "diagnose-failure-codes");
  assert.deepEqual(pub.plan?.tests.files, ["test/upload.test.ts"]);
  const hid = runTaskV5(t, "hidden", sha256("m194"), o);
  assert.equal(logRowProblem(hid.row), null);
  assert.ok(!("repo" in hid.row) && !("commit" in hid.row));
});
