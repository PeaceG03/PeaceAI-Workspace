// M203 (batch 39) repair-retry-v1: EXPERIMENTAL, opt-in, NOT the default, NOT for credit. Spec:
// peaceai/spec/repair-retry-v1.md. When the loop's first attempt fails verification, a later attempt is proposed from
// ONE verifier-v1 run's per-case evidence (expected vs returned value / error name) and retried, at most
// RETRY_MAX_ATTEMPTS (3) attempts in all, under VERDICT_MODE oop-v1 only; every attempt is judged by verifier-v1 on its
// own run alone. A later attempt may use the separate opt-in class RETRY_SCOPE_POLICY (rr-in-function-v1);
// EDIT_SCOPE_POLICY and the default are unchanged.
//   1. pure: the class, the evidence / credit binding, the fit, the proposer (one case per m203-guard tag; each
//      replayed against a mutant of repair-retry.ts with that line deleted);
//   2. end to end (stage-2 candidate uid M203_CAND / M146_CAND = peaceai-cand3 only): admitted on three code shapes
//      (a percentage, a midpoint index, a first line of text) where attempt 1 (repair-v2) fails and a later attempt
//      passes on its own verdict; refused near misses (in-process mode, the cap, an edit outside the class, a dangerous
//      word, a foreign verdict); the H-Object.is and X-exit forges offered as later-attempt edits (refused by the gate,
//      and still failing under oop-v1 in a mutant without the gate); each m203-guard line of loop.ts deleted in a mutant.
// Shapes are synthetic: nothing is modelled on PeaceSTOCKS, a dev task or a reference diff.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as RR from "../lib/repair-retry.ts";
import * as LoopReal from "../lib/loop.ts";
import * as RowReal from "../lib/looprow.ts";
import { repairProposer } from "../lib/editpropose.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";
import { e2eTask, opts as opts174 } from "./m174-cases.ts";

type RRT = typeof RR;
type L = typeof LoopReal;
const base = mkdtempSync(join(tmpdir(), "peaceai-m203-rr-"));
after(() => {
  for (const p of survivors(base)) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
  spawnSync("chmod", ["-R", "u+w", base]); rmSync(base, { recursive: true, force: true });
});
function survivors(dir: string): number[] {
  if (!existsSync("/proc/self")) return [];
  const out: number[] = [];
  for (const e of readdirSync("/proc")) {
    if (!/^\d+$/.test(e) || Number(e) === process.pid) continue;
    let cmd = "", cwd = "";
    try { cmd = readFileSync(`/proc/${e}/cmdline`, "utf8").replace(/\0/g, " "); } catch { continue; }
    try { cwd = readlinkSync(`/proc/${e}/cwd`); } catch { /* not ours */ }
    if (cmd === "") continue;
    if (cmd.includes(dir) || cwd === dir || cwd.startsWith(dir + "/")) out.push(Number(e));
  }
  return out;
}

// ---- fixtures (synthetic shapes)
const SHARE = "export function sharePercent(part: number, whole: number): number {\n  if (whole === 0) return 0;\n  return (part / whole) * 100;\n}\n";
const SHARE_TEAM = 'import assert from "node:assert/strict";\nimport { sharePercent } from "../src/share.ts";\n\ntest("29 of 100", () => assert.equal(sharePercent(29, 100), 29));\ntest("57 of 100", () => assert.equal(sharePercent(57, 100), 57));\ntest("a quarter", () => assert.equal(sharePercent(1, 4), 25));\ntest("nothing of nothing", () => assert.equal(sharePercent(0, 0), 0));\n';
const MID = "export function midIndex(lo: number, hi: number): number {\n  return (lo + hi) / 2;\n}\n";
const MID_TEAM = 'import assert from "node:assert/strict";\nimport { midIndex } from "../src/mid.ts";\n\ntest("odd span", () => assert.equal(midIndex(0, 5), 2));\ntest("even span", () => assert.equal(midIndex(2, 4), 3));\ntest("short span", () => assert.equal(midIndex(1, 4), 2));\ntest("empty span", () => assert.equal(midIndex(0, 0), 0));\n';
const LINE = 'export function firstLine(text: string): string {\n  const i = text.indexOf("\\n");\n  return i < 0 ? text : text.slice(0, i);\n}\n';
const LINE_TEAM = 'import assert from "node:assert/strict";\nimport { firstLine } from "../src/line.ts";\n\ntest("crlf text", () => assert.equal(firstLine("title\\r\\nbody"), "title"));\ntest("one line", () => assert.equal(firstLine("one"), "one"));\ntest("trailing blank", () => assert.equal(firstLine("a \\nb"), "a"));\n';
const TEMP = "export function toCelsius(f: number): number {\n  return (f - 32) * 5 / 8;\n}\n";
const TEMP_TEAM = 'import assert from "node:assert/strict";\nimport { toCelsius } from "../src/temp.ts";\n\ntest("212F is 100C", () => assert.equal(toCelsius(212), 100));\ntest("32F is 0C", () => assert.equal(toCelsius(32), 0));\n';

// ---- pure cases, one or more per m203-guard tag of repair-retry.ts (replayed against its mutants)
const F2 = "export function a(x: number): number {\n  return x + 1;\n}\nexport function b(x: number): number {\n  return x * 2;\n}\n";
const OBJ = "export function same(x: number, y: number): boolean {\n  return Object.is(x, y);\n}\n";
const ev = (run: string, cases: Partial<RR.EvidenceCase>[], module = "src/m.ts"): RR.RetryEvidence => ({ run, module, cases: cases.map((c, i) => ({ id: `c${i + 1}:f`, fn: "f", args: [], expect: { ok: true, value: 0 }, pass: false, run, ...c }) as RR.EvidenceCase) });
const verdict = (run: string, n = 2, over: Partial<RR.RetryVerdict> = {}): RR.RetryVerdict => ({ mode: "oop-v1", run, code: "OOP_OK", pass: n, fail: 0, results: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, pass: true, run })), ...over });
const E1 = [{ path: "src/m.ts", content: "x" }], E2 = [{ path: "src/m.ts", content: "y" }];
interface GCase { guard: string; name: string; run(m: RRT): void }
const GCASES: GCase[] = [
  { guard: "ev-combined", name: "evidence from two runs is combined", run: (m) => assert.equal(m.evidenceProblem({ run: "a", module: "m", cases: [...ev("a", [{}]).cases, ...ev("b", [{ id: "c2:f" }]).cases] }), "RETRY_EVIDENCE_COMBINED") },
  { guard: "ev-dup", name: "one case twice (relabelled from another run) is combined", run: (m) => { const e = ev("a", [{}]); assert.equal(m.evidenceProblem({ ...e, cases: [e.cases[0]!, e.cases[0]!] }), "RETRY_EVIDENCE_COMBINED"); } },
  { guard: "credit-verdict", name: "a pass claim without a verdict / an in-process verdict is not credit", run: (m) => { assert.equal(m.retryCreditProblem(null, 2, E1), "RETRY_NO_VERDICT"); assert.equal(m.retryCreditProblem(verdict(m.retryRunLabel(2, E1), 2, { mode: "inproc" }), 2, E1), "RETRY_NO_VERDICT"); } },
  { guard: "credit-pass", name: "a verdict with a failing case is not credit", run: (m) => { const own = m.retryRunLabel(2, E1); assert.equal(m.retryCreditProblem(verdict(own, 2, { pass: 1, fail: 1, results: [{ id: "c1", pass: true, run: own }, { id: "c2", pass: false, run: own }] }), 2, E1), "RETRY_NO_VERDICT"); assert.equal(m.retryCreditProblem(verdict(own, 0), 2, E1), "RETRY_NO_VERDICT"); } },
  { guard: "credit-combined", name: "results from another run inside this attempt's verdict are combined", run: (m) => { const own = m.retryRunLabel(2, E1); assert.equal(m.retryCreditProblem(verdict(own, 2, { results: [{ id: "c1", pass: true, run: own }, { id: "c2", pass: true, run: m.retryRunLabel(1, E2) }] }), 2, E1), "RETRY_EVIDENCE_COMBINED"); } },
  { guard: "credit-own", name: "attempt 1's verdict, another edit's or the baseline's is foreign to attempt 2", run: (m) => {
    assert.equal(m.retryCreditProblem(verdict(m.retryRunLabel(1, E1)), 2, E1), "RETRY_VERDICT_FOREIGN");
    assert.equal(m.retryCreditProblem(verdict(m.retryRunLabel(2, E2)), 2, E1), "RETRY_VERDICT_FOREIGN");
    assert.equal(m.retryCreditProblem(verdict("baseline"), 2, E1), "RETRY_VERDICT_FOREIGN");
    assert.equal(m.retryCreditProblem(verdict(m.retryRunLabel(2, E1)), 2, E1), null, "control: its own verdict is credit");
  } },
  { guard: "mode-oop", name: "repair-retry-v1 in an in-process mode is refused", run: (m) => { assert.equal(m.retryModeProblem("repair-retry-v1", "inproc"), "RETRY_INPROC_REFUSED"); assert.equal(m.retryModeProblem("repair-retry-v1", "oop-v1"), null); assert.equal(m.retryModeProblem(undefined, "inproc"), null); } },
  { guard: "class-parse", name: "an unparsable candidate is outside the class", run: (m) => assert.equal(m.retrySourceClass(F2, F2.replace("x + 1;", "x + ;")), "rr-parse") },
  { guard: "class-size", name: "a body grown past maxAddedChars is outside", run: (m) => assert.equal(m.retrySourceClass(F2, F2.replace("return x + 1;", "const k = x;\n" + "  if (k === 0) return 1;\n".repeat(40) + "  return Math.max(k, 1);")), "rr-too-large") },
  { guard: "class-count", name: "a removed top-level statement is outside", run: (m) => assert.equal(m.retrySourceClass(F2, "export function a(x: number): number {\n  return Math.max(x, 1);\n}\n"), "rr-top-level-count") },
  { guard: "class-helper-fn", name: "an added top-level const (not a function declaration) is outside", run: (m) => assert.equal(m.retrySourceClass(F2, "const K = Math.max(1, 2);\n" + F2), "rr-helper-shape") },
  { guard: "class-helper-private", name: "an exported (or async) helper is outside", run: (m) => { const h = "function clampUp(v: number): number {\n  return Math.max(v, 0);\n}\n"; assert.equal(m.retrySourceClass(F2, "export " + h + F2.replace("x + 1", "clampUp(x) + 1")), "rr-helper-modifier"); assert.equal(m.retrySourceClass(F2, "async " + h + F2.replace("x + 1", "clampUp(x) + 1")), "rr-helper-modifier"); } },
  { guard: "class-helper-name", name: "a helper reusing a top-level name is outside", run: (m) => assert.equal(m.retrySourceClass(F2, F2 + "function b(x: number): number {\n  return Math.min(x, 0);\n}\n"), "rr-helper-name") },
  { guard: "class-one-fn", name: "two function bodies changed is outside", run: (m) => assert.equal(m.retrySourceClass(F2, F2.replace("x + 1", "Math.max(x, 1)").replace("x * 2", "Math.min(x, 2)")), "rr-two-functions") },
  { guard: "class-fn", name: "a changed non-function statement is outside", run: (m) => assert.equal(m.retrySourceClass("const K = 1;\n" + F2, "const K = Math.max(1, 2);\n" + F2), "rr-not-function") },
  { guard: "class-head", name: "a changed signature is outside", run: (m) => assert.equal(m.retrySourceClass(F2, F2.replace("a(x: number): number {\n  return x + 1;", "a(x: number, y = 0): number {\n  return Math.max(x, y);")), "rr-head-changed") },
  { guard: "class-dangerous", name: "an added dangerous word (process, globalThis) is outside", run: (m) => { assert.equal(m.retrySourceClass(F2, F2.replace("return x + 1;", "process.exit(0);\n  return x + 1;")), "dangerous:process"); assert.equal(m.retrySourceClass(F2, F2.replace("return x + 1;", "const g = globalThis;\n  return x + 1;")), "dangerous:globalThis"); } },
  { guard: "class-global", name: "a write to a global the file only read (Object.is) is outside", run: (m) => assert.equal(m.retrySourceClass(OBJ, OBJ.replace("return Object.is(x, y);", "Object.is = () => true;\n  return Object.is(x, y);")), "global-write") },
  { guard: "class-local", name: "a multi-statement body with its own local names is admitted", run: (m) => assert.equal(m.retrySourceClass(F2, F2.replace("return x + 1;", "const bumped = x + 1;\n  return Math.round(bumped);")), "rr-in-function") },
  { guard: "class-new-word", name: "a word the file never had (Date, or a local used as a property) is outside", run: (m) => {
    assert.equal(m.retrySourceClass(F2, F2.replace("return x + 1;", "const t = Date.now();\n  return x + t;")), "new-word:Date");
    assert.equal(m.retrySourceClass(F2, F2.replace("return x + 1;", "const peek = { peek: 1 };\n  return x + peek.peek;")), "new-word:peek");
  } },
  { guard: "class-filekind", name: "a test file, a config file and a new file stay refused", run: (m) => {
    const orig = (p: string) => (p === "src/m.ts" ? F2 : null);
    assert.equal(m.retryEditClass("test/m.test.ts", F2, orig), "test-file");
    assert.equal(m.retryEditClass("package.json", "{}", orig), "config");
    assert.equal(m.retryEditClass("src/new.ts", F2, orig), "new-file");
  } },
  { guard: "scope-one-file", name: "two source files changed is outside", run: (m) => { const orig = (p: string) => (p.startsWith("src/") ? F2 : null); const ed = F2.replace("x + 1", "Math.max(x, 1)"); assert.equal(m.retryScopeProblem([{ path: "src/p.ts", content: ed }, { path: "src/q.ts", content: ed }], orig, () => false), "rr-files"); } },
  { guard: "scope-policy", name: "a class refusal is the scope problem", run: (m) => { const orig = () => F2; assert.equal(m.retryScopeProblem([{ path: "src/m.ts", content: F2.replace("return x + 1;", "process.exit(0);\n  return x + 1;") }], orig, () => false), "dangerous:process"); assert.equal(m.retryScopeProblem([{ path: "src/m.ts", content: F2.replace("x + 1", "Math.max(x, 1)") }], orig, () => false), null); } },
  { guard: "fit-one-run", name: "a fit is refused on evidence mixing runs", run: (m) => { const e = ev("a", [{ got: { ok: true, value: 2.5 }, expect: { ok: true, value: 2 } }]); const mixed = { ...e, cases: [...e.cases, { ...e.cases[0]!, id: "c2:f", run: "b" }] }; assert.deepEqual(m.fitTransform(mixed), { refuse: "RETRY_EVIDENCE_COMBINED" }); } },
  { guard: "fit-all", name: "a transform must fit every case (2.5 -> 2 is floor, not round)", run: (m) => { const f = m.fitTransform(ev("a", [{ got: { ok: true, value: 2.5 }, expect: { ok: true, value: 2 } }, { got: { ok: true, value: 3.5 }, expect: { ok: true, value: 3 } }])); assert.ok("transform" in f && f.transform.name === "floor", JSON.stringify(f)); } },
  { guard: "prop-stop", name: "after a tampered run the proposer stops", run: (m) => {
    const p = m.retryProposer({ name: "base", next: () => ({ edits: [{ path: "src/m.ts", content: F2 }] }) });
    const files = [{ path: "src/m.ts", content: "export function f(): number {\n  return 2.5;\n}\n" }];
    const input = (attempt: number, codes: string[]) => ({ request: "", repo: "", plan: null as never, files, context: [], attempt, feedback: attempt > 1 ? [{ attempt: 1, codes, failing: [], tests: { total: 1, passedByPeaceAI: 0, filledByTeam: 1 }, evidence: ev("attempt-1:x", [{ got: { ok: true, value: 2.5 }, expect: { ok: true, value: 2 } }]) }] : [] });
    p.next(input(1, []) as never);
    assert.deepEqual(p.next(input(2, ["TAMPERED", "TEST_FAIL"]) as never), { refuse: "NO_MORE_EDITS" });
  } },
];

const libDir = resolve(import.meta.dirname, "../lib");
const SRC = { rr: readFileSync(join(libDir, "repair-retry.ts"), "utf8"), loop: readFileSync(join(libDir, "loop.ts"), "utf8"), row: readFileSync(join(libDir, "looprow.ts"), "utf8") };
const tagsOf = (t: string) => t.split("\n").flatMap((l) => { const m = /\/\/ m203-guard:([a-z-]+)/.exec(l); return m ? [m[1]!] : []; });
const RR_TAGS = tagsOf(SRC.rr), LOOP_TAGS = tagsOf(SRC.loop);
const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
let mutN = 0;
const rewrite = (t: string, own: Record<string, string>) => t.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(own[f] ?? join(libDir, f)).href)}`)
  .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`).replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
async function rrMutant(text: string): Promise<RRT> {
  const f = join(base, `mutant-${mutN++}-repair-retry.ts`);
  writeFileSync(f, rewrite(text, {}));
  return (await import(pathToFileURL(f).href)) as RRT;
}
async function loopMutant(text: string): Promise<L> {
  const n = mutN++;
  const files = { "loop.ts": join(base, `mutant-${n}-loop.ts`) } as Record<string, string>;
  writeFileSync(files["loop.ts"]!, rewrite(text, files));
  return (await import(pathToFileURL(files["loop.ts"]!).href)) as L;
}
const drop = (text: string, tag: string) => { const ls = text.split("\n"), hits = ls.filter((l) => l.includes(`// m203-guard:${tag}`)); assert.equal(hits.length, 1, `one line holds ${tag}`); return ls.filter((l) => !l.includes(`// m203-guard:${tag}`)).join("\n"); };

test("M203 tags: the guard lines of repair-retry.ts and loop.ts are the expected ones", () => {
  assert.deepEqual(RR_TAGS, ["ev-combined", "ev-dup", "credit-verdict", "credit-pass", "credit-combined", "credit-own", "mode-oop", "class-parse", "class-size", "class-helper-fn", "class-helper-private", "class-helper-name", "class-count", "class-one-fn", "class-fn", "class-head", "class-dangerous", "class-global", "class-local", "class-new-word", "class-filekind", "scope-one-file", "scope-policy", "fit-one-run", "fit-all", "prop-stop"]);
  assert.deepEqual(LOOP_TAGS, ["loop-cap", "loop-inproc", "loop-gate", "loop-credit"]);
  for (const t of RR_TAGS) assert.ok(GCASES.some((c) => c.guard === t), `a case for ${t}`);
});
test("M203 pure: every case passes on repair-retry.ts as committed (and on an unmutated copy: the harness is sound)", async () => {
  for (const c of GCASES) c.run(RR);
  const m = await rrMutant(SRC.rr);
  for (const c of GCASES) c.run(m);
});
for (const tag of RR_TAGS) {
  test(`M203 mutation: deleting m203-guard:${tag} fails a case of its own guard`, async () => {
    const m = await rrMutant(drop(SRC.rr, tag));
    const own = GCASES.filter((c) => c.guard === tag);
    assert.ok(own.some((c) => { try { c.run(m); return false; } catch { return true; } }), `no ${tag} case notices it removed`);
  });
}

test("M203 default unchanged: EDIT_SCOPE_POLICY, INPROC_BOUNDED_SCOPE and the default verdict mode are untouched; the retry policy is separate", () => {
  assert.deepEqual(LoopReal.EDIT_SCOPE_POLICY, { edit: ["export-keyword", "in-body"], load: ["export-keyword"] });
  assert.deepEqual([...LoopReal.INPROC_BOUNDED_SCOPE], ["export-keyword", "in-body"]);
  assert.equal(LoopReal.DEFAULT_VERDICT_MODE, "inproc");
  assert.equal(RR.RETRY_MAX_ATTEMPTS, 3);
  assert.equal(RR.RETRY_SCOPE_POLICY.name, "rr-in-function-v1");
  assert.ok(Object.isFrozen(RR.RETRY_SCOPE_POLICY) && Object.isFrozen(RR.RETRY_NEW_WORDS));
  for (const w of RR.RETRY_NEW_WORDS) assert.ok(!LoopReal.EDIT_DANGEROUS.includes(w), w);
  // runLoopFile never asks for it: only runLoopTask's options carry repairRetry
  const runFile = SRC.loop.slice(SRC.loop.indexOf("export function runLoopFile"));
  assert.ok(!runFile.includes("repairRetry"));
});
test("M203 pure: fit + transform on each shape's baseline evidence write the expected edit; the text passes the class", () => {
  const cases: [string, string, unknown[][], unknown[], string][] = [
    [SHARE, "sharePercent", [[29, 100], [57, 100], [1, 4], [0, 0]], [29, 57, 25, 0], "round"],
    [MID, "midIndex", [[0, 5], [2, 4], [1, 4], [0, 0]], [2, 3, 2, 0], "floor"],
    [LINE, "firstLine", [["title\r\nbody"], ["one"], ["a \nb"]], ["title", "one", "a"], "trim"],
  ];
  for (const [src, fn, args, exp, want] of cases) {
    // the evidence is computed here from the shape's own semantics (a stand-in for verifier-v1, pure test only)
    const impl = new Function(`return (${src.replace(/: number|: string/g, "").replace(/^export /, "").replace(/^function [a-zA-Z]+/, "function")})`)() as (...a: unknown[]) => unknown;
    const e: RR.RetryEvidence = { run: "baseline", module: "src/m.ts", cases: args.map((a, i) => { const got = impl(...a); const pass = got === exp[i]; return { id: `c${i + 1}:${fn}`, fn, args: a, expect: { ok: true, value: exp[i] }, pass, ...(pass ? {} : { got: { ok: true, value: got } }), run: "baseline" }; }) };
    const f = RR.fitTransform(e);
    assert.ok("transform" in f && f.transform.name === want, `${fn}: ${JSON.stringify(f)}`);
    const next = RR.applyTransform(src, fn, f.transform)!;
    assert.ok(next && next !== src);
    assert.ok(["in-body", "rr-in-function"].includes(RR.retryEditClass("src/m.ts", next, () => src)), RR.retryEditClass("src/m.ts", next, () => src));
  }
  // near misses: an error case, or a case another transform would break, never fits
  assert.deepEqual(RR.fitTransform(ev("a", [{ got: { ok: false, name: "TypeError" } }])), { refuse: "no-fit" });
  assert.deepEqual(RR.fitTransform(ev("a", [{ got: { ok: true, value: 2.5 }, expect: { ok: true, value: 2 } }, { pass: true, expect: { ok: true, value: 2.5 } }])), { refuse: "no-fit" });
});
test("M203 pure: the proposer reads one run at a time (last attempt's on its own code, else the baseline's), and gives base only its own attempts", () => {
  const seen: { attempt: number; fb: number[] }[] = [];
  const baseP = { name: "base", next: (i: { attempt: number; feedback: readonly { attempt: number }[] }) => { seen.push({ attempt: i.attempt, fb: i.feedback.map((f) => f.attempt) }); return { edits: [{ path: "src/mid.ts", content: MID.replace("(lo + hi) / 2", "(lo + hi) / 2 + 0") }] }; } };
  const p = RR.retryProposer(baseP as never);
  const files = [{ path: "src/mid.ts", content: MID }];
  const tests = { total: 4, passedByPeaceAI: 2, filledByTeam: 2 };
  const baseEv = ev("baseline", [{ fn: "midIndex", got: { ok: true, value: 2.5 }, expect: { ok: true, value: 2 } }, { fn: "midIndex", pass: true, expect: { ok: true, value: 3 } }], "src/mid.ts");
  const first = p.next({ request: "", repo: "", plan: null as never, files, context: [], attempt: 1, feedback: [], retryBaseline: baseEv } as never);
  assert.ok("edits" in first);
  // attempt 1's own evidence (on its code) mixes runs: ignored; the baseline's fits floor on the ORIGINAL code
  const a1 = ev("attempt-1:x", [{ fn: "midIndex", got: { ok: true, value: 2.5 }, expect: { ok: true, value: 2 } }], "src/mid.ts");
  const mixed = { ...a1, cases: [...a1.cases, { ...a1.cases[0]!, id: "c2:midIndex", run: "baseline" }] };
  const second = p.next({ request: "", repo: "", plan: null as never, files, context: [], attempt: 2, feedback: [{ attempt: 1, codes: ["TEST_FAIL"], failing: [], tests, evidence: mixed }], retryBaseline: baseEv } as never);
  assert.deepEqual(second, { edits: [{ path: "src/mid.ts", content: MID.replace("(lo + hi) / 2", "Math.floor((lo + hi) / 2)") }] });
  // attempt 3: nothing new fits (floor tried) -> base again, seeing only its own attempt 1, as attempt 2
  const third = p.next({ request: "", repo: "", plan: null as never, files, context: [], attempt: 3, feedback: [{ attempt: 1, codes: ["TEST_FAIL"], failing: [], tests, evidence: mixed }, { attempt: 2, codes: ["TEST_FAIL"], failing: [], tests, evidence: ev("attempt-2:y", [{ fn: "midIndex", got: { ok: true, value: 7 }, expect: { ok: true, value: 2 } }], "src/mid.ts") }], retryBaseline: baseEv } as never);
  assert.ok("edits" in third);
  assert.deepEqual(seen, [{ attempt: 1, fb: [] }, { attempt: 2, fb: [1] }]);
});

// ---- end to end (stage-2 candidate uid peaceai-cand3 only)
const M203_CAND = process.env.M203_CAND ?? process.env.M146_CAND ?? "";
const cand = stage2CandUid({ [STAGE2_CAND_ENV]: M203_CAND }).ok;
const skipCand = !cand && "needs the stage-2 candidate uid (M203_CAND / M146_CAND = peaceai-cand3)";
type Edits = { path: string; content: string }[];
const scripted = (name: string, seq: (Edits | null)[]) => ({ name, next: (i: { attempt: number }) => { const e = seq[i.attempt - 1]; return e ? { edits: e } : { refuse: "NO_MORE_EDITS" as const }; } });
let ctxShared: { m151: ReturnType<typeof setup151>; scratch: string } | null = null;
const ctx = () => { if (!ctxShared) { const m151 = setup151(); ctxShared = { m151, scratch: mkdtempSync(join(base, "e2e-")) }; } return ctxShared; };
after(() => { if (ctxShared) teardown151(ctxShared.m151); });
let nTask = 0;
function go(l: L, file: string, src: string, team: string, proposer: unknown, extra: Record<string, unknown> = {}, max = 3) {
  const c = ctx();
  return l.runLoopTask(e2eTask(c, `m203-${nTask++}`, { [file]: src }, team) as never, "public", "a".repeat(64),
    { ...opts174(c, proposer as never, max), env: { ...c.m151.env, [STAGE2_CAND_ENV]: M203_CAND }, verdictMode: "oop-v1", repairRetry: "repair-retry-v1", ...extra } as never);
}
const rv2 = () => RR.retryProposer(repairProposer({ v2: true }) as never);
const summary = (r: ReturnType<typeof go>) => ({ code: r.row.code, attempts: r.row.attempts, codes: r.row.attemptCodes, max: r.row.maxAttempts });

for (const [label, file, src, team] of [["percentage", "src/share.ts", SHARE, SHARE_TEAM], ["midpoint index", "src/mid.ts", MID, MID_TEAM], ["first line", "src/line.ts", LINE, LINE_TEAM]] as const) {
  test(`M203 admit (${label}): attempt 1 (repair-v2) fails, a later evidence-driven attempt passes on its own verifier-v1 verdict`, { skip: skipCand }, () => {
    const p = rv2();
    const r = go(LoopReal, file, src, team, p);
    assert.equal(RowReal.loopRowProblem(r.row), null, String(RowReal.loopRowProblem(r.row)));
    assert.equal(r.row.code, "PASS", JSON.stringify(summary(r)));
    assert.ok(r.row.attempts >= 2 && r.row.attempts <= 3, JSON.stringify(summary(r)));
    assert.deepEqual(r.row.attemptCodes[0], ["TEST_FAIL"], "attempt 1 failed its own verdict");
    assert.equal(r.row.repairRetry, "repair-retry-v1");
    assert.equal(r.row.proposer, "rr1-repair-v2");
    assert.ok(p.transforms.length >= 1, "the passing attempt was evidence-driven");
    // control: the default (no repairRetry, inproc) is not changed by this skill: one repair-v2 attempt, no PASS
    const d = go(LoopReal, file, src, team, repairProposer({ v2: true }), { verdictMode: undefined, repairRetry: undefined }, 1);
    assert.notEqual(d.row.code, "PASS");
    assert.equal("repairRetry" in d.row, false);
  });
}
test("M203 refuse (in-process mode): repair-retry-v1 without oop-v1 is refused before anything runs", { skip: skipCand }, async () => {
  for (const vm of [undefined, "inproc"]) {
    const r = go(LoopReal, "src/mid.ts", MID, MID_TEAM, rv2(), { verdictMode: vm });
    assert.deepEqual([r.row.code, r.row.attempts, r.row.result], ["RETRY_INPROC_REFUSED", 0, "refused"]);
    assert.equal(RowReal.loopRowProblem(r.row), null, String(RowReal.loopRowProblem(r.row)));
  }
  const m = await loopMutant(drop(SRC.loop, "loop-inproc"));
  assert.notEqual(go(m, "src/mid.ts", MID, MID_TEAM, rv2(), { verdictMode: "inproc" }).row.code, "RETRY_INPROC_REFUSED", "without m203-guard:loop-inproc it runs in process");
});
test("M203 refuse (cap): no transform fits and every attempt fails: ATTEMPT_LIMIT at 3 even when 10 are asked for", { skip: skipCand }, async () => {
  const wrong = (k: number): Edits => [{ path: "src/temp.ts", content: TEMP.replace("5 / 8", `5 / ${10 + k}`) }];
  const seq = [wrong(1), wrong(2), wrong(3), wrong(4), [{ path: "src/temp.ts", content: TEMP.replace("5 / 8", "5 / 9") }]];
  const r = go(LoopReal, "src/temp.ts", TEMP, TEMP_TEAM, RR.retryProposer(scripted("wrong", seq) as never), {}, 10);
  assert.deepEqual(summary(r), { code: "ATTEMPT_LIMIT", attempts: 3, codes: [["TEST_FAIL"], ["TEST_FAIL"], ["TEST_FAIL"]], max: 3 });
  const m = await loopMutant(drop(SRC.loop, "loop-cap"));
  const r2 = go(m, "src/temp.ts", TEMP, TEMP_TEAM, RR.retryProposer(scripted("wrong", seq) as never), {}, 10);
  assert.deepEqual([r2.row.code, r2.row.attempts], ["PASS", 5], "without m203-guard:loop-cap the 5th attempt runs (and is credited)");
});
test("M203 refuse (outside the class, dangerous word) + forges H-Object.is / X-exit as later-attempt edits", { skip: skipCand }, async () => {
  const OBJSRC = "export function isLeap(y: number): boolean {\n  return Object.is(y % 4, 0) && y % 100 !== 0;\n}\n";
  const LEAP_TEAM = 'import assert from "node:assert/strict";\nimport { isLeap } from "../src/leap.ts";\n\ntest("2000 is leap", () => assert.equal(isLeap(2000), true));\ntest("1900 is not", () => assert.equal(isLeap(1900), false));\ntest("2024 is leap", () => assert.equal(isLeap(2024), true));\n';
  const wrong: Edits = [{ path: "src/leap.ts", content: OBJSRC.replace("y % 100 !== 0", "y % 100 === 0") }];
  const fix2 = OBJSRC.replace("return Object.is(y % 4, 0) && y % 100 !== 0;", "const by4 = y % 4 === 0;\n  return by4 && (y % 100 !== 0 || y % 400 === 0);");
  const forgeObj = OBJSRC.replace("  return Object.is", "  Object.is = () => true;\n  return Object.is");
  const forgeExit = OBJSRC.replace("  return Object.is(y % 4, 0) && y % 100 !== 0;", "  process.exit(0);\n  return false;");
  const twoFiles: Edits = [{ path: "src/leap.ts", content: fix2 }, { path: "src/other.ts", content: "export const k = 1;\n" }];
  const run = (l: L, second: Edits) => go(l, "src/leap.ts", OBJSRC, LEAP_TEAM, RR.retryProposer(scripted("scripted", [wrong, second]) as never));
  const honest = run(LoopReal, [{ path: "src/leap.ts", content: fix2 }]);
  assert.deepEqual([honest.row.code, honest.row.attempts], ["PASS", 2], "control: an in-class multi-statement fix at attempt 2 passes on its own verdict");
  for (const [what, second] of [["new file", twoFiles], ["H-Object.is", [{ path: "src/leap.ts", content: forgeObj }]], ["X-exit", [{ path: "src/leap.ts", content: forgeExit }]]] as const) {
    const r = run(LoopReal, second as Edits);
    assert.deepEqual([r.row.code, r.row.attempts], ["EDIT_SCOPE", 1], `${what}: refused by the retry gate before it runs`);
  }
  // without the gate: the forges reach verifier-v1 and still fail (not credited); the new file goes through
  const open = await loopMutant(drop(SRC.loop, "loop-gate"));
  const o1 = run(open, [{ path: "src/leap.ts", content: forgeObj }]);
  assert.notEqual(o1.row.code, "PASS");
  assert.deepEqual(o1.row.attemptCodes[1], ["TEST_FAIL"], "H-Object.is: verifier-v1 compares with its own primordials");
  const o2 = run(open, [{ path: "src/leap.ts", content: forgeExit }]);
  assert.equal(o2.row.code, "VERDICT_OOP_REFUSED", "X-exit: a silent exit is a protocol refusal, never a pass");
  assert.equal(run(open, twoFiles).row.code, "PASS", "without m203-guard:loop-gate an edit outside the class is credited");
});
test("M203 refuse (foreign verdict): a run labelled as another run's is never credited", { skip: skipCand }, async () => {
  const fix: Edits = [{ path: "src/temp.ts", content: TEMP.replace("5 / 8", "5 / 9") }];
  const at = "retryRunLabel(attempt, p.edits))";
  assert.ok(SRC.loop.includes(at));
  const foreign = SRC.loop.replace(at, '"baseline")');
  const m = await loopMutant(foreign);
  const r = go(m, "src/temp.ts", TEMP, TEMP_TEAM, RR.retryProposer(scripted("fixed", [fix]) as never));
  assert.deepEqual([r.row.code, r.row.attempts], ["RETRY_VERDICT_FOREIGN", 0]);
  const m2 = await loopMutant(drop(foreign, "loop-credit"));
  assert.equal(go(m2, "src/temp.ts", TEMP, TEMP_TEAM, RR.retryProposer(scripted("fixed", [fix]) as never)).row.code, "PASS", "without m203-guard:loop-credit the foreign verdict is credited");
});
test("M203 hygiene: no process outlives the file's runs (checked last)", { skip: !existsSync("/proc/self") && "no /proc" }, () => {
  assert.deepEqual(survivors(base), []);
});
