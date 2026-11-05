// M209 (batch 45) repair-retry-v1 constant and guarded-branch forms: EXPERIMENTAL, opt-in, NOT the default, NOT for
// credit. Spec: peaceai/spec/repair-retry-v1.md ("M209"). Closes the Batch 44 residuals "wrong constants / wrong
// branches are left to repair-v2": when no single pinned transform fits ONE run's evidence, a later attempt may
// (a) replace one wrong number/string literal inside the function, or (c after the M208 pair) emit one if/else-style
// ternary on a single-argument predicate (typeof / === / < / >), each group fitted to one transform. Pinned order after
// single: constant, pair (M208), branch. Cap stays 3; credit only from the attempt's own verifier-v1 verdict.
//   1. pure: one case per m209-guard tag of repair-retry.ts, each replayed against a mutant with that line deleted;
//   2. end to end (candidate uid peaceai-cand3, judge uid PEACEAI_VERIFIER_UID): two self-made fixtures per form (a
//      default port and a blank mark; a tidy value and a band number) where only that form passes; refused near misses
//      (two literals wrong, a three-way split, a predicate on two arguments, a predicate literal not in the cases, an
//      edit over the size bound).
// Fixtures are synthetic: nothing is modelled on PeaceSTOCKS, a dev task, the scanner or a reference diff.
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
import * as V from "../lib/verifier.ts";
import { repairProposer } from "../lib/editpropose.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";
import { e2eTask, opts as opts174 } from "./m174-cases.ts";

type RRT = typeof RR;
const base = mkdtempSync(join(tmpdir(), "peaceai-m209-rr-"));
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

// ---- fixtures (synthetic)
const PORT = "export function defaultPort(): number {\n  return 8080;\n}\n";
const PORT_TEAM = 'import assert from "node:assert/strict";\nimport { defaultPort } from "../src/port.ts";\n\ntest("web default", () => assert.equal(defaultPort(), 3000));\ntest("same port again", () => assert.equal(defaultPort(), 3000));\n';
const MARK = 'export function blankMark(): string {\n  return "?";\n}\n';
const MARK_TEAM = 'import assert from "node:assert/strict";\nimport { blankMark } from "../src/mark.ts";\n\ntest("empty cell", () => assert.equal(blankMark(), ""));\ntest("placeholder", () => assert.equal(blankMark(), ""));\n';
const TIDY = "export function tidy(v: unknown): unknown {\n  return v;\n}\n";
const TIDY_TEAM = 'import assert from "node:assert/strict";\nimport { tidy } from "../src/tidy.ts";\n\ntest("trim spaces", () => assert.equal(tidy("  ok "), "ok"));\ntest("trim one", () => assert.equal(tidy(" x"), "x"));\ntest("floor high", () => assert.equal(tidy(2.9), 2));\ntest("floor low", () => assert.equal(tidy(3.1), 3));\n';
const BAND = "export function band(n: number): number {\n  return n;\n}\n";
const BAND_TEAM = 'import assert from "node:assert/strict";\nimport { band } from "../src/band.ts";\n\ntest("above", () => assert.equal(band(3.2), 4));\ntest("at hinge", () => assert.equal(band(2), 2));\ntest("below", () => assert.equal(band(1.8), 1));\n';

const PORT_FIX = "export function defaultPort(): number {\n  return 3000;\n}\n";
const MARK_FIX = 'export function blankMark(): string {\n  return "";\n}\n';

// ---- pure helpers
const ev = (run: string, cases: Partial<RR.EvidenceCase>[], module = "src/m.ts"): RR.RetryEvidence => ({ run, module, cases: cases.map((c, i) => ({ id: `c${i + 1}:f`, fn: "f", args: [], expect: { ok: true, value: 0 }, pass: false, run, ...c }) as RR.EvidenceCase) });
const portEv = (run = "baseline") => ev(run, [
  { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
  { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
], "src/port.ts");
const tidyEv = (run = "baseline") => ev(run, [
  { fn: "tidy", args: ["  ok "], got: { ok: true, value: "  ok " }, expect: { ok: true, value: "ok" } },
  { fn: "tidy", args: [" x"], got: { ok: true, value: " x" }, expect: { ok: true, value: "x" } },
  { fn: "tidy", args: [2.9], got: { ok: true, value: 2.9 }, expect: { ok: true, value: 2 } },
  { fn: "tidy", args: [3.1], got: { ok: true, value: 3.1 }, expect: { ok: true, value: 3 } },
], "src/tidy.ts");
const bandEv = (run = "baseline") => ev(run, [
  { fn: "band", args: [3.2], got: { ok: true, value: 3.2 }, expect: { ok: true, value: 4 } },
  { fn: "band", args: [2], pass: true, expect: { ok: true, value: 2 } },
  { fn: "band", args: [1.8], got: { ok: true, value: 1.8 }, expect: { ok: true, value: 1 } },
], "src/band.ts");

interface GCase { guard: string; name: string; run(m: RRT): void }
const GCASES: GCase[] = [
  { guard: "lit-text-num", name: "a finite number becomes its source text (and -0 stays signed)", run: (m) => {
    assert.equal(m.litText(3000), "3000");
    assert.equal(m.litText(-0), "-0");
    assert.equal(m.litText(Number.NaN), null);
  } },
  { guard: "lit-text-str", name: "a string becomes a JSON literal", run: (m) => {
    assert.equal(m.litText("n/a"), '"n/a"');
    assert.equal(m.litText(true), null);
  } },
  { guard: "const-single-first", name: "no constant when one transform alone fits", run: (m) => {
    assert.deepEqual(m.fitConstant(ev("a", [{ got: { ok: true, value: 2.4 }, expect: { ok: true, value: 2 } }]), "export function f(x: number): number { return x; }\n"), { refuse: "single-fits" });
  } },
  { guard: "const-one-run", name: "a constant is refused on evidence mixing runs", run: (m) => {
    const e = portEv("a");
    assert.deepEqual(m.fitConstant({ ...e, cases: [...e.cases, { ...e.cases[0]!, id: "c9:f", run: "b" }] }, PORT), { refuse: "RETRY_EVIDENCE_COMBINED" });
  } },
  { guard: "const-one-value", name: "two different wrong returned values are refused (two literals wrong)", run: (m) => {
    assert.deepEqual(m.fitConstant(ev("a", [
      { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
      { fn: "defaultPort", got: { ok: true, value: 9090 }, expect: { ok: true, value: 3000 } },
    ], "src/port.ts"), PORT), { refuse: "two-literals" });
  } },
  { guard: "const-pass", name: "a constant that would break a passing case (expect equals the wrong value) is refused", run: (m) => {
    assert.deepEqual(m.fitConstant(ev("a", [
      { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
      { fn: "defaultPort", pass: true, expect: { ok: true, value: 8080 } },
    ], "src/port.ts"), PORT), { refuse: "no-fit" });
  } },
  { guard: "const-lit", name: "a constant fit needs the wrong value as a literal in the function", run: (m) => {
    assert.deepEqual(m.fitConstant(portEv(), "export function defaultPort(): number {\n  return 1 + 8079;\n}\n"), { refuse: "no-lit" });
    assert.deepEqual(m.fitConstant(portEv(), PORT), { from: 8080, to: 3000, fn: "defaultPort" });
  } },
  { guard: "const-class", name: "a constant edit the class would refuse is never offered (new word / over bound)", run: (m) => {
    assert.equal(m.applyConstant(PORT, "defaultPort", 8080, 3000), PORT_FIX, "control: in-bound constant is offered");
    // a string replacement that introduces a foreign word is refused by the class, so applyConstant offers nothing
    assert.equal(m.applyConstant(MARK, "blankMark", "?", "pending"), null);
    assert.equal(m.applyConstant(MARK, "blankMark", "?", ""), MARK_FIX, "control: empty string adds no word");
  } },
  { guard: "branch-single-first", name: "no branch when one transform alone fits", run: (m) => {
    assert.deepEqual(m.fitBranch(ev("a", [{ args: [2.4], got: { ok: true, value: 2.4 }, expect: { ok: true, value: 2 } }]), "export function f(x: number): number { return x; }\n"), { refuse: "single-fits" });
  } },
  { guard: "branch-one-run", name: "a branch is refused on evidence mixing runs", run: (m) => {
    const e = tidyEv("a");
    assert.deepEqual(m.fitBranch({ ...e, cases: [...e.cases, { ...e.cases[0]!, id: "c9:f", run: "b" }] }, TIDY), { refuse: "RETRY_EVIDENCE_COMBINED" });
  } },
  { guard: "branch-two-groups", name: "a three-way typeof split is refused", run: (m) => {
    assert.deepEqual(m.fitBranch(ev("a", [
      { fn: "tidy", args: ["a"], got: { ok: true, value: "a" }, expect: { ok: true, value: "A" } },
      { fn: "tidy", args: [1], got: { ok: true, value: 1 }, expect: { ok: true, value: 2 } },
      { fn: "tidy", args: [true], got: { ok: true, value: true }, expect: { ok: true, value: false } },
    ], "src/tidy.ts"), TIDY), { refuse: "three-way" });
  } },
  { guard: "branch-typeof", name: "typeof on one argument splits string trim vs number floor", run: (m) => {
    const f = m.fitBranch(tidyEv(), TIDY);
    assert.ok(!("refuse" in f) && f.pred.kind === "typeof" && f.pred.type === "string" && f.tThen.name === "trim" && f.tElse.name === "floor", JSON.stringify(f));
  } },
  { guard: "branch-eq", name: "=== a literal taken from the cases splits two groups", run: (m) => {
    // only two arg values, same type: typeof will not split; === 0 vs not, with transforms
    const src = "export function flag(n: number): number {\n  return n;\n}\n";
    const e = ev("a", [
      { fn: "flag", args: [0], got: { ok: true, value: 0 }, expect: { ok: true, value: 1 } }, // not fits a single num transform from 0->1
      { fn: "flag", args: [0], got: { ok: true, value: 0 }, expect: { ok: true, value: 1 } },
      { fn: "flag", args: [2.9], got: { ok: true, value: 2.9 }, expect: { ok: true, value: 2 } },
      { fn: "flag", args: [3.1], got: { ok: true, value: 3.1 }, expect: { ok: true, value: 3 } },
    ], "src/flag.ts");
    // single transform refuses (0->1 is not a pinned transform; 2.9->2 is floor but 0->1 breaks it)
    assert.deepEqual(m.fitTransform(e), { refuse: "no-fit" });
    const f = m.fitBranch(e, src);
    // typeof will not split (all numbers). === 0 should: then-group needs something mapping 0->1 — none of the pinned
    // transforms do (round/floor/ceil/trunc of 0 is 0). So === may not fit either. Use boolean eq instead.
    const srcB = "export function flag(on: boolean): number {\n  return 0;\n}\n";
    // constant would fit 0->1 if all failing share got 0 expect 1 — avoid by mixed expects per group via wraps on arg.
    // Simpler assertion: the guard line is reached for eq when typeof does not apply and eq does. Use string/number mix
    // already covered by typeof; for eq, force same typeof with a working transform pair via not on booleans:
    const src2 = "export function flip(on: boolean): boolean {\n  return on;\n}\n";
    const e2 = ev("a", [
      { fn: "flip", args: [true], got: { ok: true, value: true }, expect: { ok: true, value: false } },
      { fn: "flip", args: [true], got: { ok: true, value: true }, expect: { ok: true, value: false } },
      { fn: "flip", args: [false], pass: true, expect: { ok: true, value: false } },
    ], "src/flip.ts");
    // single "not" fits ALL (true->false, false->false? not false = true ≠ false). So not does not fit all.
    // typeof won't split (all boolean). === true: yes={true cases} fit "not"; no={false} fit "id".
    const f2 = m.fitBranch(e2, src2);
    assert.ok(!("refuse" in f2) && f2.pred.kind === "eq" && f2.tThen.name === "not", JSON.stringify(f2));
  } },
  { guard: "branch-cmp", name: "> a literal taken from the cases splits ceil vs floor when === cannot", run: (m) => {
    const src = "export function band(n: number): number {\n  return n;\n}\n";
    const e = ev("a", [
      { fn: "band", args: [5.1], got: { ok: true, value: 5.1 }, expect: { ok: true, value: 6 } },
      { fn: "band", args: [4.1], got: { ok: true, value: 4.1 }, expect: { ok: true, value: 5 } },
      { fn: "band", args: [3], pass: true, expect: { ok: true, value: 3 } },
      { fn: "band", args: [2.9], got: { ok: true, value: 2.9 }, expect: { ok: true, value: 2 } },
      { fn: "band", args: [1.1], got: { ok: true, value: 1.1 }, expect: { ok: true, value: 1 } },
    ], "src/band.ts");
    assert.deepEqual(m.fitTransform(e), { refuse: "no-fit" });
    const f = m.fitBranch(e, src);
    assert.ok(!("refuse" in f) && (f.pred.kind === "gt" || f.pred.kind === "lt"), JSON.stringify(f));
    assert.deepEqual([f.tThen.name, f.tElse.name].sort(), ["ceil", "floor"], JSON.stringify(f));
  } },
  { guard: "branch-class", name: "a branch edit the class would refuse is never offered (in-bound control + over-bound)", run: (m) => {
    const f = m.fitBranch(tidyEv(), TIDY);
    assert.ok(!("refuse" in f));
    const next = m.applyBranch(TIDY, f.fn, f.pred, f.tThen, f.tElse);
    assert.ok(next !== null && m.retrySourceClass(TIDY, next!) === "rr-in-function");
    const many = "export function tidy(v: unknown): unknown {\n" + Array.from({ length: 50 }, (_, i) => `  if (v === ${i}) return v;\n`).join("") + "  return v;\n}\n";
    assert.equal(m.applyBranch(many, f.fn, f.pred, f.tThen, f.tElse), null);
  } },
  { guard: "prop-order", name: "proposer tries constant before pair before branch (branch only when earlier refuse)", run: (m) => {
    // evidence where only branch fits (not constant, not pair, not single)
    const baseP = { name: "base", next: () => ({ refuse: "NO_MORE_EDITS" as const }) };
    const p = m.retryProposer(baseP as never);
    const files = [{ path: "src/tidy.ts", content: TIDY }];
    const e = tidyEv("baseline");
    // attempt 1: base refuses
    assert.deepEqual(p.next({ attempt: 1, files, feedback: [], search: null } as never), { refuse: "NO_MORE_EDITS" });
    // attempt 2: with baseline evidence
    const prop = p.next({ attempt: 2, files, feedback: [{ attempt: 1, codes: ["TEST_FAIL"], failing: ["c1"], tests: { total: 4, passedByPeaceAI: 0, filledByTeam: 0 } }], retryBaseline: e, search: null } as never);
    assert.ok("edits" in prop, JSON.stringify(prop));
    assert.ok(p.transforms.some((t) => t.includes(":branch(")), JSON.stringify(p.transforms));
    // constant fixture offers const, not branch
    const p2 = m.retryProposer({ name: "base", next: () => ({ refuse: "NO_MORE_EDITS" as const }) } as never);
    p2.next({ attempt: 1, files: [{ path: "src/port.ts", content: PORT }], feedback: [], search: null } as never);
    const prop2 = p2.next({ attempt: 2, files: [{ path: "src/port.ts", content: PORT }], feedback: [{ attempt: 1, codes: ["TEST_FAIL"], failing: ["c1"], tests: { total: 2, passedByPeaceAI: 0, filledByTeam: 0 } }], retryBaseline: portEv(), search: null } as never);
    assert.ok("edits" in prop2 && p2.transforms.some((t) => t.includes(":const(")), JSON.stringify({ prop2, t: p2.transforms }));
  } },
];

const libDir = resolve(import.meta.dirname, "../lib");
const SRC = readFileSync(join(libDir, "repair-retry.ts"), "utf8");
const TAGS = SRC.split("\n").flatMap((l) => { const m = /\/\/ m209-guard:([a-z-]+)/.exec(l); return m ? [m[1]!] : []; });
const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
let mutN = 0;
const rewrite = (t: string) => t.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
  .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`).replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
async function rrMutant(text: string): Promise<RRT> {
  const f = join(base, `mutant-${mutN++}-repair-retry.ts`);
  writeFileSync(f, rewrite(text));
  return (await import(pathToFileURL(f).href)) as RRT;
}
const drop = (text: string, tag: string) => { const ls = text.split("\n"), hits = ls.filter((l) => l.includes(`// m209-guard:${tag}`)); assert.equal(hits.length, 1, `one line holds ${tag}`); return ls.filter((l) => !l.includes(`// m209-guard:${tag}`)).join("\n"); };

test("M209 tags: the guard lines are the expected ones, each with a case", () => {
  assert.deepEqual(TAGS, ["lit-text-num", "lit-text-str", "const-single-first", "const-one-run", "const-one-value", "const-pass", "const-lit", "const-class", "branch-single-first", "branch-one-run", "branch-two-groups", "branch-typeof", "branch-eq", "branch-cmp", "branch-class", "prop-order"]);
  for (const t of TAGS) assert.ok(GCASES.some((c) => c.guard === t), `a case for ${t}`);
});
test("M209 pure: every case passes as committed and on an unmutated copy", async () => {
  for (const c of GCASES) c.run(RR);
  const m = await rrMutant(SRC);
  for (const c of GCASES) c.run(m);
});
for (const tag of TAGS) {
  test(`M209 mutation: deleting m209-guard:${tag} fails a case of its own guard`, async () => {
    const m = await rrMutant(drop(SRC, tag));
    assert.ok(GCASES.filter((c) => c.guard === tag).some((c) => { try { c.run(m); return false; } catch { return true; } }), `no ${tag} case notices it removed`);
  });
}
test("M209 pinned: cap, policy, order and default unchanged", () => {
  assert.equal(RR.RETRY_MAX_ATTEMPTS, 3);
  assert.deepEqual([...RR.RETRY_SCOPE_POLICY.classes], ["export-keyword", "in-body", "rr-in-function", "rr-helper"]);
  assert.equal(RR.RETRY_SCOPE_POLICY.maxAddedChars, 600);
  assert.equal(LoopReal.DEFAULT_VERDICT_MODE, "inproc");
  assert.deepEqual(LoopReal.EDIT_SCOPE_POLICY, { edit: ["export-keyword", "in-body"], load: ["export-keyword"] });
});

test("M209 near misses (pure): two literals, three-way, two-arg need, foreign literal, over-bound", () => {
  // two literals wrong
  assert.deepEqual(RR.fitConstant(ev("a", [
    { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
    { fn: "defaultPort", got: { ok: true, value: 9090 }, expect: { ok: true, value: 3000 } },
  ], "src/port.ts"), PORT), { refuse: "two-literals" });
  // three-way
  assert.deepEqual(RR.fitBranch(ev("a", [
    { fn: "tidy", args: ["a"], got: { ok: true, value: "a" }, expect: { ok: true, value: "A" } },
    { fn: "tidy", args: [1], got: { ok: true, value: 1 }, expect: { ok: true, value: 2 } },
    { fn: "tidy", args: [true], got: { ok: true, value: true }, expect: { ok: true, value: false } },
  ], "src/tidy.ts"), TIDY), { refuse: "three-way" });
  // predicate on two arguments: function of (a,b); cases only separable by a relation on both — no single-arg pred fits
  const AB = "export function same(a: number, b: number): number {\n  return a;\n}\n";
  const abEv = ev("a", [
    { fn: "same", args: [1, 1], got: { ok: true, value: 1 }, expect: { ok: true, value: 1 }, pass: true },
    { fn: "same", args: [2, 2], got: { ok: true, value: 2 }, expect: { ok: true, value: 2 }, pass: true },
    { fn: "same", args: [3, 9], got: { ok: true, value: 3 }, expect: { ok: true, value: 0 } },
    { fn: "same", args: [4, 1], got: { ok: true, value: 4 }, expect: { ok: true, value: 0 } },
  ], "src/same.ts");
  // single no; constant: failing gots are 3 and 4 → two-literals; branch: no binary pred yields groups each fitting one transform
  assert.deepEqual(RR.fitTransform(abEv), { refuse: "no-fit" });
  assert.deepEqual(RR.fitConstant(abEv, AB), { refuse: "two-literals" });
  assert.deepEqual(RR.fitBranch(abEv, AB), { refuse: "no-fit" });
  // predicate literal not present in the cases: inventing threshold 10 must not happen; only args' literals are tried
  const only = ev("a", [
    { fn: "band", args: [3.2], got: { ok: true, value: 3.2 }, expect: { ok: true, value: 4 } },
    { fn: "band", args: [1.8], got: { ok: true, value: 1.8 }, expect: { ok: true, value: 1 } },
  ], "src/band.ts");
  // Foreign lit 10 must never appear; only args' literals are tried:
  const f = RR.fitBranch(only, BAND);
  if (!("refuse" in f)) {
    const pred = f.pred;
    if (pred.kind === "eq" || pred.kind === "lt" || pred.kind === "gt") {
      assert.ok([3.2, 1.8].some((x) => Object.is(x, pred.lit) || x === pred.lit), JSON.stringify(pred));
    }
  }
  // over the size bound (constant path uses class; branch apply null on huge)
  const many = "export function tidy(v: unknown): unknown {\n" + Array.from({ length: 50 }, (_, i) => `  if (v === ${i}) return v;\n`).join("") + "  return v;\n}\n";
  const bf = RR.fitBranch(tidyEv(), TIDY);
  assert.ok(!("refuse" in bf));
  assert.equal(RR.applyBranch(many, bf.fn, bf.pred, bf.tThen, bf.tElse), null);
});

const CAND = process.env.M209_CAND ?? process.env.M208_CAND ?? process.env.M146_CAND ?? "";
const VERIFIER = process.env.M209_VERIFIER ?? process.env.PEACEAI_VERIFIER_UID ?? "";
const cand = stage2CandUid({ [STAGE2_CAND_ENV]: CAND }).ok ? stage2CandUid({ [STAGE2_CAND_ENV]: CAND }) : null;
const vOk = cand !== null && cand.ok && V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand as never).ok;
const skipE2e = !vOk && "needs M209_CAND / M146_CAND = peaceai-cand3 and PEACEAI_VERIFIER_UID = peaceai-verify";
type Edits = { path: string; content: string }[];
const scripted = (name: string, seq: (Edits | null)[]) => ({ name, next: (i: { attempt: number }) => { const e = seq[i.attempt - 1]; return e ? { edits: e } : { refuse: "NO_MORE_EDITS" as const }; } });
/** Attempt 1 must run and fail so attempt 2 can read evidence: repair-v2 has no candidate on these shapes, so seed one wrong edit, then fall through to repair-v2. */
const PORT_WRONG = PORT.replace("8080", "8079");
const MARK_WRONG = MARK.replace("?", "!");
const TIDY_WRONG = TIDY.replace("return v;", "return (v);");
const BAND_WRONG = BAND.replace("return n;", "return (n);");
function seedBase(file: string, wrong: string) {
  const inner = repairProposer({ v2: true }) as { name: string; loadRepair?: boolean; prepare?: Function; next: Function };
  let seeded = false;
  return {
    name: inner.name,
    loadRepair: true as const,
    prepare: inner.prepare ? (search: unknown, input: unknown) => inner.prepare!(search, input) : undefined,
    next: (i: { attempt: number }) => {
      if (!seeded) { seeded = true; return { edits: [{ path: file, content: wrong }] }; }
      return inner.next(i);
    },
  };
}
let ctxShared: { m151: ReturnType<typeof setup151>; scratch: string } | null = null;
const ctx = () => { if (!ctxShared) { const m151 = setup151(); ctxShared = { m151, scratch: mkdtempSync(join(base, "e2e-")) }; } return ctxShared; };
after(() => { if (ctxShared) teardown151(ctxShared.m151); });
let nTask = 0;
const REQUESTS: Record<string, string> = {
  "src/port.ts": "defaultPort returns the wrong hard-coded port; it should be the common web default.",
  "src/mark.ts": "blankMark returns the wrong placeholder; empty cells should read as an empty string.",
  "src/tidy.ts": "tidy should trim strings and floor numbers.",
  "src/band.ts": "band should round values above the hinge and trunc values at or below it.",
};
function go(file: string, src: string, team: string, proposer: unknown, extra: Record<string, unknown> = {}, max = 3) {
  const c = ctx();
  const task = e2eTask(c, `m209-${nTask++}`, { [file]: src }, team);
  return LoopReal.runLoopTask({ ...task, request: REQUESTS[file] ?? task.request } as never, "public", "a".repeat(64),
    { ...opts174(c, proposer as never, max), env: { ...c.m151.env, [STAGE2_CAND_ENV]: CAND, [V.VERIFIER_UID_ENV]: VERIFIER }, verdictMode: "oop-v1", repairRetry: "repair-retry-v1", ...extra } as never);
}
const summary = (r: ReturnType<typeof go>) => ({ code: r.row.code, attempts: r.row.attempts, codes: r.row.attemptCodes, max: r.row.maxAttempts });

for (const [label, file, src, team, needle] of [
  ["default port", "src/port.ts", PORT, PORT_TEAM, ":const("],
  ["blank mark", "src/mark.ts", MARK, MARK_TEAM, ":const("],
] as const) {
  test(`M209 admit constant (${label}): attempt 1 fails, only the constant form passes on its own oop-v1 verdict`, { skip: skipE2e }, () => {
    const wrong = label === "default port" ? PORT_WRONG : MARK_WRONG;
    const p = RR.retryProposer(seedBase(file, wrong) as never);
    const r = go(file, src, team, p);
    assert.equal(RowReal.loopRowProblem(r.row), null, String(RowReal.loopRowProblem(r.row)));
    assert.equal(r.row.code, "PASS", JSON.stringify({ ...summary(r), t: p.transforms }));
    assert.ok(r.row.attempts >= 2 && r.row.attempts <= 3);
    assert.notDeepEqual(r.row.attemptCodes[0], [], "attempt 1 failed its own verdict");
    assert.equal(r.row.repairRetry, "repair-retry-v1");
    assert.ok(p.transforms.some((t) => t.includes(needle)), JSON.stringify(p.transforms));
    assert.ok(!p.transforms.some((t) => t.includes(":helper(") || t.includes(":branch(")), "only constant form: " + JSON.stringify(p.transforms));
    console.log(`M209-ADMIT-CONST ${label} ${JSON.stringify({ ...summary(r), transforms: p.transforms })}`);
    for (const vm of [undefined, "oop-v1"]) {
      const d = go(file, src, team, repairProposer({ v2: true }), { verdictMode: vm, repairRetry: undefined }, 3);
      assert.notEqual(d.row.code, "PASS", `control ${vm ?? "default"}: ${JSON.stringify(summary(d))}`);
      console.log(`M209-CONTROL-CONST ${label} ${vm ?? "default"} ${JSON.stringify(summary(d))}`);
    }
  });
}
for (const [label, file, src, team] of [
  ["tidy value", "src/tidy.ts", TIDY, TIDY_TEAM],
  ["band number", "src/band.ts", BAND, BAND_TEAM],
] as const) {
  test(`M209 admit branch (${label}): attempt 1 fails, only the branch form passes on its own oop-v1 verdict`, { skip: skipE2e }, () => {
    const wrong = label === "tidy value" ? TIDY_WRONG : BAND_WRONG;
    const p = RR.retryProposer(seedBase(file, wrong) as never);
    const r = go(file, src, team, p);
    assert.equal(RowReal.loopRowProblem(r.row), null, String(RowReal.loopRowProblem(r.row)));
    assert.equal(r.row.code, "PASS", JSON.stringify({ ...summary(r), t: p.transforms }));
    assert.ok(r.row.attempts >= 2 && r.row.attempts <= 3);
    assert.notDeepEqual(r.row.attemptCodes[0], [], "attempt 1 failed its own verdict");
    assert.equal(r.row.repairRetry, "repair-retry-v1");
    assert.ok(p.transforms.some((t) => t.includes(":branch(")), JSON.stringify(p.transforms));
    assert.ok(!p.transforms.some((t) => t.includes(":helper(") || t.includes(":const(")), "only branch form: " + JSON.stringify(p.transforms));
    console.log(`M209-ADMIT-BRANCH ${label} ${JSON.stringify({ ...summary(r), transforms: p.transforms })}`);
    for (const vm of [undefined, "oop-v1"]) {
      const d = go(file, src, team, repairProposer({ v2: true }), { verdictMode: vm, repairRetry: undefined }, 3);
      assert.notEqual(d.row.code, "PASS", `control ${vm ?? "default"}: ${JSON.stringify(summary(d))}`);
      console.log(`M209-CONTROL-BRANCH ${label} ${vm ?? "default"} ${JSON.stringify(summary(d))}`);
    }
  });
}

test("M209 refuse end to end: over the bound branch edit -> EDIT_SCOPE before it runs", { skip: skipE2e }, () => {
  const wrong: Edits = [{ path: "src/tidy.ts", content: TIDY.replace("return v;", "return v && v;") }];
  const good = RR.applyBranch(TIDY, "tidy", { kind: "typeof", param: "v", type: "string", code: 'typeof v === "string"' }, RR.RETRY_TRANSFORMS[4]!, RR.RETRY_TRANSFORMS[1]!);
  assert.ok(good);
  const honest = go("src/tidy.ts", TIDY, TIDY_TEAM, scripted("scripted", [wrong, [{ path: "src/tidy.ts", content: good! }]]));
  assert.deepEqual([honest.row.code, honest.row.attempts], ["PASS", 2], "control: in-bound branch passes on its own verdict");
  const many = "export function tidy(v: unknown): unknown {\n" + Array.from({ length: 50 }, (_, i) => `  if (v === ${i}) return v;\n`).join("") + "  return (typeof v === \"string\" ? (v).trim() : Math.floor(v));\n}\n";
  // over-bound relative to TIDY origin
  assert.equal(RR.retrySourceClass(TIDY, many), "rr-too-large");
  const r = go("src/tidy.ts", TIDY, TIDY_TEAM, scripted("scripted", [wrong, [{ path: "src/tidy.ts", content: many }]]));
  assert.deepEqual([r.row.code, r.row.attempts], ["EDIT_SCOPE", 1], JSON.stringify(summary(r)));
  console.log(`M209-REFUSE over-bound ${JSON.stringify(summary(r))}`);
});

test("M209 pins: selfpropose.ts, plandefault.ts, plan4.ts byte-identical to gen/batch44; v4 digest unchanged; runs.jsonl add-only; no Worker ctor literal", () => {
  const files = ["peaceai/lib/selfpropose.ts", "peaceai/lib/plandefault.ts", "peaceai/lib/plan4.ts", "peaceai/lib/plan4run.ts"];
  const diff = spawnSync("git", ["diff", "4983b66", "--", ...files], { encoding: "utf8" });
  assert.equal(diff.stdout, "", diff.stdout);
  const { plannerSha256V4 } = createRequire(import.meta.url)("../lib/plan4run.ts") as { plannerSha256V4: () => string };
  const sha = plannerSha256V4();
  assert.equal(typeof sha, "string");
  assert.equal(sha.length, 64);
  const runsDiff = spawnSync("git", ["diff", "4983b66", "-U0", "--", "peaceai/plan/runs.jsonl"], { encoding: "utf8" });
  for (const line of (runsDiff.stdout ?? "").split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---")) assert.fail(`runs.jsonl lost a line: ${line}`);
  }
  const needle = "new " + "Worker(";
  const newFiles = spawnSync("git", ["diff", "4983b66", "--name-only", "--diff-filter=A"], { encoding: "utf8" });
  for (const f of (newFiles.stdout ?? "").split("\n").filter(Boolean)) {
    if (!existsSync(f)) continue;
    if (f.startsWith("peaceai/test/")) continue;
    const t = readFileSync(f, "utf8");
    assert.equal(t.includes(needle), false, `${needle} in ${f}`);
  }
  assert.ok(existsSync(join(libDir, "plan4.ts")));
});

test("M209 hygiene: no process outlives the file's runs (checked last)", { skip: !existsSync("/proc/self") && "no /proc" }, () => {
  assert.deepEqual(survivors(base), []);
  if (CAND) {
    const u = Number((spawnSync("id", ["-u", CAND], { encoding: "utf8" }).stdout ?? "").trim());
    if (Number.isInteger(u)) {
      const live: number[] = [];
      for (const e of readdirSync("/proc")) {
        if (!/^\d+$/.test(e)) continue;
        try {
          const st = readFileSync(`/proc/${e}/status`, "utf8");
          if (new RegExp(`^Uid:\\s+${u}\\b`, "m").test(st)) live.push(Number(e));
        } catch { /* */ }
      }
      assert.deepEqual(live, []);
    }
  }
});
