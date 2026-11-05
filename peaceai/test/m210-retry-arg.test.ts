// M210 (batch 46) repair-retry-v1 wrong-argument call-site form: EXPERIMENTAL, opt-in, NOT the default, NOT for
// credit. Spec: peaceai/spec/repair-retry-v1.md ("M210"). Closes the Batch 45 residual "wrong arguments are left to
// repair-v2" for one bounded shape: when no earlier form fits ONE run's evidence, and the changed function calls a
// same-file select helper (`function h(...){ return <param>; }`) with a literal at the returned position, a later
// attempt may replace that literal with one of the outer function's own parameters. Pinned order after single:
// constant, pair (M208), branch (M209), wrong-arg (M210). Cap stays 3; credit only from the attempt's own verifier-v1
// verdict.
//   1. pure: one case per m210-guard tag of repair-retry.ts, each replayed against a mutant with that line deleted;
//   2. end to end (candidate uid peaceai-cand3, judge uid PEACEAI_VERIFIER_UID): two self-made fixtures (a numeric
//      take/prefer select and a string head/label select) where only the wrong-arg form passes; refused near misses
//      (non-select helper, non-export modifier, no literal call, model mismatch, foreign span, new-word class refuse).
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
const base = mkdtempSync(join(tmpdir(), "peaceai-m210-rr-"));
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
const PREFER = "function take(a: number, _b: number): number {\n  return a;\n}\nexport function prefer(n: number): number {\n  return take(0, n);\n}\n";
const PREFER_FIX = "function take(a: number, _b: number): number {\n  return a;\n}\nexport function prefer(n: number): number {\n  return take(n, n);\n}\n";
const PREFER_TEAM = 'import assert from "node:assert/strict";\nimport { prefer } from "../src/prefer.ts";\n\ntest("three", () => assert.equal(prefer(3), 3));\ntest("seven", () => assert.equal(prefer(7), 7));\ntest("one", () => assert.equal(prefer(1), 1));\n';
const LABEL = 'function head(a: string, _b: string): string {\n  return a;\n}\nexport function label(s: string): string {\n  return head("?", s);\n}\n';
const LABEL_FIX = 'function head(a: string, _b: string): string {\n  return a;\n}\nexport function label(s: string): string {\n  return head(s, s);\n}\n';
const LABEL_TEAM = 'import assert from "node:assert/strict";\nimport { label } from "../src/label.ts";\n\ntest("red", () => assert.equal(label("red"), "red"));\ntest("blue", () => assert.equal(label("blue"), "blue"));\ntest("ok", () => assert.equal(label("ok"), "ok"));\n';

const ev = (run: string, cases: Partial<RR.EvidenceCase>[], module = "src/m.ts"): RR.RetryEvidence => ({ run, module, cases: cases.map((c, i) => ({ id: `c${i + 1}:f`, fn: "f", args: [], expect: { ok: true, value: 0 }, pass: false, run, ...c }) as RR.EvidenceCase) });
const preferEv = (run = "baseline") => ev(run, [
  { fn: "prefer", args: [3], got: { ok: true, value: 0 }, expect: { ok: true, value: 3 } },
  { fn: "prefer", args: [7], got: { ok: true, value: 0 }, expect: { ok: true, value: 7 } },
  { fn: "prefer", args: [1], got: { ok: true, value: 0 }, expect: { ok: true, value: 1 } },
], "src/prefer.ts");
const labelEv = (run = "baseline") => ev(run, [
  { fn: "label", args: ["red"], got: { ok: true, value: "?" }, expect: { ok: true, value: "red" } },
  { fn: "label", args: ["blue"], got: { ok: true, value: "?" }, expect: { ok: true, value: "blue" } },
  { fn: "label", args: ["ok"], got: { ok: true, value: "?" }, expect: { ok: true, value: "ok" } },
], "src/label.ts");

interface GCase { guard: string; name: string; run(m: RRT): void }
const GCASES: GCase[] = [
  { guard: "helper-plain", name: "a helper with a non-export modifier is not a select helper", run: (m) => {
    const asyncH = "async function take(a: number): Promise<number> {\n  return a;\n}\nexport function prefer(n: number): number {\n  return 0;\n}\n";
    assert.deepEqual(m.selectHelpers(asyncH), []);
    assert.ok(m.selectHelpers(PREFER).some((h) => h.name === "take" && h.retIdx === 0));
  } },
  { guard: "helper-select", name: "a helper with more than one body statement is not a select helper", run: (m) => {
    // first statement is `return a` (would look like a select if the length check were dropped); a trailing statement must refuse
    const multi = "function take(a: number, _b: number): number {\n  return a;\n  return 0;\n}\nexport function prefer(n: number): number {\n  return take(0, n);\n}\n";
    assert.deepEqual(m.selectHelpers(multi), []);
    assert.deepEqual(m.fitWrongArg(preferEv(), multi), { refuse: "no-call" });
    const add = "function take(a: number, b: number): number {\n  return a + b;\n}\nexport function prefer(n: number): number {\n  return take(0, n);\n}\n";
    assert.deepEqual(m.selectHelpers(add), []);
  } },
  { guard: "arg-single-first", name: "no wrong-arg when one transform alone fits", run: (m) => {
    assert.deepEqual(m.fitWrongArg(ev("a", [{ got: { ok: true, value: 2.4 }, expect: { ok: true, value: 2 } }]), "export function f(x: number): number { return x; }\n"), { refuse: "single-fits" });
  } },
  { guard: "arg-one-run", name: "a wrong-arg is refused on evidence mixing runs", run: (m) => {
    const e = preferEv("a");
    assert.deepEqual(m.fitWrongArg({ ...e, cases: [...e.cases, { ...e.cases[0]!, id: "c9:f", run: "b" }] }, PREFER), { refuse: "RETRY_EVIDENCE_COMBINED" });
  } },
  { guard: "arg-call", name: "a wrong-arg fit needs a select-helper call with a literal at the returned position", run: (m) => {
    const noLit = "function take(a: number, _b: number): number {\n  return a;\n}\nexport function prefer(n: number): number {\n  return take(n, n);\n}\n";
    assert.deepEqual(m.fitWrongArg(preferEv(), noLit), { refuse: "no-call" });
    assert.deepEqual(m.fitWrongArg(preferEv(), "export function prefer(n: number): number {\n  return 0;\n}\n"), { refuse: "no-call" });
  } },
  { guard: "arg-model", name: "a select model that disagrees with the observed returns is refused", run: (m) => {
    // evidence says got=9, but the literal at the returned position is 0 — model disagrees
    const e = ev("a", [
      { fn: "prefer", args: [3], got: { ok: true, value: 9 }, expect: { ok: true, value: 3 } },
      { fn: "prefer", args: [7], got: { ok: true, value: 9 }, expect: { ok: true, value: 7 } },
    ], "src/prefer.ts");
    assert.deepEqual(m.fitWrongArg(e, PREFER), { refuse: "no-fit" });
  } },
  { guard: "arg-all", name: "the replacement must fit every case (not just the failing ones' shared literal)", run: (m) => {
    // one case expects a value that is not any outer arg — no param replacement fits all
    const e = ev("a", [
      { fn: "prefer", args: [3], got: { ok: true, value: 0 }, expect: { ok: true, value: 3 } },
      { fn: "prefer", args: [7], got: { ok: true, value: 0 }, expect: { ok: true, value: 99 } },
    ], "src/prefer.ts");
    assert.deepEqual(m.fitWrongArg(e, PREFER), { refuse: "no-fit" });
    const ok = m.fitWrongArg(preferEv(), PREFER);
    assert.ok(!("refuse" in ok) && ok.param === "n" && ok.helper === "take", JSON.stringify(ok));
  } },
  { guard: "arg-span", name: "a stale / foreign span is never applied", run: (m) => {
    const f = m.fitWrongArg(preferEv(), PREFER);
    assert.ok(!("refuse" in f));
    // extend the span through ", n" so a missing span check would emit take(n) (still rr-in-function) instead of null
    const wideEnd = PREFER.indexOf("take(0, n)") + "take(0, n)".indexOf(")") ;
    assert.ok(wideEnd > f.argEnd);
    assert.equal(m.applyWrongArg(PREFER, f.fn, f.callStart, f.argStart, wideEnd, f.param), null);
    assert.equal(m.applyWrongArg(PREFER, f.fn, f.callStart, f.argStart, f.argEnd, f.param), PREFER_FIX);
  } },
  { guard: "arg-class", name: "a wrong-arg edit the class would refuse is never offered (new word)", run: (m) => {
    const f = m.fitWrongArg(preferEv(), PREFER);
    assert.ok(!("refuse" in f));
    assert.equal(m.applyWrongArg(PREFER, f.fn, f.callStart, f.argStart, f.argEnd, "pendingForeign"), null);
    assert.equal(m.applyWrongArg(PREFER, f.fn, f.callStart, f.argStart, f.argEnd, f.param), PREFER_FIX, "control: param name admits");
    assert.equal(m.retrySourceClass(PREFER, PREFER_FIX), "rr-in-function");
  } },
  { guard: "prop-order", name: "proposer tries wrong-arg only after constant/pair/branch refuse", run: (m) => {
    const baseP = { name: "base", next: () => ({ refuse: "NO_MORE_EDITS" as const }) };
    const p = m.retryProposer(baseP as never);
    const files = [{ path: "src/prefer.ts", content: PREFER }];
    assert.deepEqual(p.next({ attempt: 1, files, feedback: [], search: null } as never), { refuse: "NO_MORE_EDITS" });
    const prop = p.next({ attempt: 2, files, feedback: [{ attempt: 1, codes: ["TEST_FAIL"], failing: ["c1"], tests: { total: 3, passedByPeaceAI: 0, filledByTeam: 0 } }], retryBaseline: preferEv(), search: null } as never);
    assert.ok("edits" in prop, JSON.stringify(prop));
    assert.ok(p.transforms.some((t) => t.includes(":arg(")), JSON.stringify(p.transforms));
    // constant fixture still offers const, not arg
    const PORT = "export function defaultPort(): number {\n  return 8080;\n}\n";
    const portEv = ev("baseline", [
      { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
      { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
    ], "src/port.ts");
    const p2 = m.retryProposer({ name: "base", next: () => ({ refuse: "NO_MORE_EDITS" as const }) } as never);
    p2.next({ attempt: 1, files: [{ path: "src/port.ts", content: PORT }], feedback: [], search: null } as never);
    const prop2 = p2.next({ attempt: 2, files: [{ path: "src/port.ts", content: PORT }], feedback: [{ attempt: 1, codes: ["TEST_FAIL"], failing: ["c1"], tests: { total: 2, passedByPeaceAI: 0, filledByTeam: 0 } }], retryBaseline: portEv, search: null } as never);
    assert.ok("edits" in prop2 && p2.transforms.some((t) => t.includes(":const(")), JSON.stringify({ prop2, t: p2.transforms }));
    assert.ok(!p2.transforms.some((t) => t.includes(":arg(")), "constant wins over arg");
  } },
];

const libDir = resolve(import.meta.dirname, "../lib");
const SRC = readFileSync(join(libDir, "repair-retry.ts"), "utf8");
const TAGS = SRC.split("\n").flatMap((l) => { const m = /\/\/ m210-guard:([a-z-]+)/.exec(l); return m ? [m[1]!] : []; });
const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
let mutN = 0;
const rewrite = (t: string) => t.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
  .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`).replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
async function rrMutant(text: string): Promise<RRT> {
  const f = join(base, `mutant-${mutN++}-repair-retry.ts`);
  writeFileSync(f, rewrite(text));
  return (await import(pathToFileURL(f).href)) as RRT;
}
const drop = (text: string, tag: string) => { const ls = text.split("\n"), hits = ls.filter((l) => l.includes(`// m210-guard:${tag}`)); assert.equal(hits.length, 1, `one line holds ${tag}`); return ls.filter((l) => !l.includes(`// m210-guard:${tag}`)).join("\n"); };

test("M210 tags: the guard lines are the expected ones, each with a case", () => {
  assert.deepEqual(TAGS, ["helper-plain", "helper-select", "arg-single-first", "arg-one-run", "arg-call", "arg-model", "arg-all", "arg-span", "arg-class", "prop-order"]);
  for (const t of TAGS) assert.ok(GCASES.some((c) => c.guard === t), `a case for ${t}`);
});
test("M210 pure: every case passes as committed and on an unmutated copy", async () => {
  for (const c of GCASES) c.run(RR);
  const m = await rrMutant(SRC);
  for (const c of GCASES) c.run(m);
});
for (const tag of TAGS) {
  test(`M210 mutation: deleting m210-guard:${tag} fails a case of its own guard`, async () => {
    const m = await rrMutant(drop(SRC, tag));
    assert.ok(GCASES.filter((c) => c.guard === tag).some((c) => { try { c.run(m); return false; } catch { return true; } }), `no ${tag} case notices it removed`);
  });
}
test("M210 pinned: cap, policy, order and default unchanged", () => {
  assert.equal(RR.RETRY_MAX_ATTEMPTS, 3);
  assert.deepEqual([...RR.RETRY_SCOPE_POLICY.classes], ["export-keyword", "in-body", "rr-in-function", "rr-helper"]);
  assert.equal(RR.RETRY_SCOPE_POLICY.maxAddedChars, 600);
  assert.equal(LoopReal.DEFAULT_VERDICT_MODE, "inproc");
  assert.deepEqual(LoopReal.EDIT_SCOPE_POLICY, { edit: ["export-keyword", "in-body"], load: ["export-keyword"] });
});

test("M210 near misses (pure): non-select, no-call, model mismatch, new-word, earlier form wins", () => {
  const add = "function take(a: number, b: number): number {\n  return a + 1;\n}\nexport function prefer(n: number): number {\n  return take(0, n);\n}\n";
  assert.deepEqual(RR.selectHelpers(add), []);
  assert.deepEqual(RR.fitWrongArg(preferEv(), add), { refuse: "no-call" });
  assert.deepEqual(RR.fitWrongArg(preferEv(), "export function prefer(n: number): number {\n  return 0;\n}\n"), { refuse: "no-call" });
  const mismatch = ev("a", [
    { fn: "prefer", args: [3], got: { ok: true, value: 9 }, expect: { ok: true, value: 3 } },
    { fn: "prefer", args: [7], got: { ok: true, value: 9 }, expect: { ok: true, value: 7 } },
  ], "src/prefer.ts");
  assert.deepEqual(RR.fitWrongArg(mismatch, PREFER), { refuse: "no-fit" });
  const f = RR.fitWrongArg(preferEv(), PREFER);
  assert.ok(!("refuse" in f));
  assert.equal(RR.applyWrongArg(PREFER, f.fn, f.callStart, f.argStart, f.argEnd, "pendingForeign"), null);
  // earlier form (constant) wins: no wrong-arg when a return-equal literal fits
  const PORT = "export function defaultPort(): number {\n  return 8080;\n}\n";
  const portEv = ev("a", [
    { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
    { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
  ], "src/port.ts");
  assert.deepEqual(RR.fitConstant(portEv, PORT), { from: 8080, to: 3000, fn: "defaultPort" });
});

const CAND = process.env.M210_CAND ?? process.env.M209_CAND ?? process.env.M146_CAND ?? "";
const VERIFIER = process.env.M210_VERIFIER ?? process.env.PEACEAI_VERIFIER_UID ?? "";
const cand = stage2CandUid({ [STAGE2_CAND_ENV]: CAND }).ok ? stage2CandUid({ [STAGE2_CAND_ENV]: CAND }) : null;
const vOk = cand !== null && cand.ok && V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand as never).ok;
const skipE2e = !vOk && "needs M210_CAND / M146_CAND = peaceai-cand3 and PEACEAI_VERIFIER_UID = peaceai-verify";
type Edits = { path: string; content: string }[];
const scripted = (name: string, seq: (Edits | null)[]) => ({ name, next: (i: { attempt: number }) => { const e = seq[i.attempt - 1]; return e ? { edits: e } : { refuse: "NO_MORE_EDITS" as const }; } });
/** Attempt 1 must run and fail so attempt 2 can read evidence: seed one wrong edit, then fall through to repair-v2. */
const PREFER_WRONG = PREFER.replace("take(0, n)", "take(1, n)");
const LABEL_WRONG = LABEL.replace('head("?", s)', 'head("!", s)');
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
  "src/prefer.ts": "prefer should pass its input through take as the first argument, not a hard-coded zero.",
  "src/label.ts": "label should pass its input through head as the first argument, not a hard-coded mark.",
};
function go(file: string, src: string, team: string, proposer: unknown, extra: Record<string, unknown> = {}, max = 3) {
  const c = ctx();
  const task = e2eTask(c, `m210-${nTask++}`, { [file]: src }, team);
  return LoopReal.runLoopTask({ ...task, request: REQUESTS[file] ?? task.request } as never, "public", "a".repeat(64),
    { ...opts174(c, proposer as never, max), env: { ...c.m151.env, [STAGE2_CAND_ENV]: CAND, [V.VERIFIER_UID_ENV]: VERIFIER }, verdictMode: "oop-v1", repairRetry: "repair-retry-v1", ...extra } as never);
}
const summary = (r: ReturnType<typeof go>) => ({ code: r.row.code, attempts: r.row.attempts, codes: r.row.attemptCodes, max: r.row.maxAttempts });

for (const [label, file, src, team, wrong] of [
  ["prefer number", "src/prefer.ts", PREFER, PREFER_TEAM, PREFER_WRONG],
  ["label string", "src/label.ts", LABEL, LABEL_TEAM, LABEL_WRONG],
] as const) {
  test(`M210 admit wrong-arg (${label}): attempt 1 fails, only the arg form passes on its own oop-v1 verdict`, { skip: skipE2e }, () => {
    const p = RR.retryProposer(seedBase(file, wrong) as never);
    const r = go(file, src, team, p);
    assert.equal(RowReal.loopRowProblem(r.row), null, String(RowReal.loopRowProblem(r.row)));
    assert.equal(r.row.code, "PASS", JSON.stringify({ ...summary(r), t: p.transforms }));
    assert.ok(r.row.attempts >= 2 && r.row.attempts <= 3);
    assert.notDeepEqual(r.row.attemptCodes[0], [], "attempt 1 failed its own verdict");
    assert.equal(r.row.repairRetry, "repair-retry-v1");
    assert.ok(p.transforms.some((t) => t.includes(":arg(")), JSON.stringify(p.transforms));
    assert.ok(!p.transforms.some((t) => t.includes(":helper(") || t.includes(":branch(") || t.includes(":const(")), "only arg form: " + JSON.stringify(p.transforms));
    console.log(`M210-ADMIT-ARG ${label} ${JSON.stringify({ ...summary(r), transforms: p.transforms })}`);
    for (const vm of [undefined, "oop-v1"]) {
      const d = go(file, src, team, repairProposer({ v2: true }), { verdictMode: vm, repairRetry: undefined }, 3);
      assert.notEqual(d.row.code, "PASS", `control ${vm ?? "default"}: ${JSON.stringify(summary(d))}`);
      console.log(`M210-CONTROL-ARG ${label} ${vm ?? "default"} ${JSON.stringify(summary(d))}`);
    }
  });
}

test("M210 refuse end to end: new-word replacement -> EDIT_SCOPE before it runs", { skip: skipE2e }, () => {
  const wrong: Edits = [{ path: "src/prefer.ts", content: PREFER_WRONG }];
  const f = RR.fitWrongArg(preferEv(), PREFER);
  assert.ok(!("refuse" in f));
  const good = RR.applyWrongArg(PREFER, f.fn, f.callStart, f.argStart, f.argEnd, f.param);
  assert.ok(good);
  const honest = go("src/prefer.ts", PREFER, PREFER_TEAM, scripted("scripted", [wrong, [{ path: "src/prefer.ts", content: good! }]]));
  assert.deepEqual([honest.row.code, honest.row.attempts], ["PASS", 2], "control: in-bound arg passes on its own verdict");
  const foreign = PREFER.replace("take(0, n)", "take(pendingForeign, n)");
  assert.equal(RR.retrySourceClass(PREFER, foreign).startsWith("new-word:"), true);
  const r = go("src/prefer.ts", PREFER, PREFER_TEAM, scripted("scripted", [wrong, [{ path: "src/prefer.ts", content: foreign }]]));
  assert.deepEqual([r.row.code, r.row.attempts], ["EDIT_SCOPE", 1], JSON.stringify(summary(r)));
  console.log(`M210-REFUSE new-word ${JSON.stringify(summary(r))}`);
});

test("M210 pins: selfpropose.ts, plandefault.ts, plan4.ts byte-identical to gen/batch45; v4 digest unchanged; runs.jsonl add-only; no Worker ctor literal", () => {
  const files = ["peaceai/lib/selfpropose.ts", "peaceai/lib/plandefault.ts", "peaceai/lib/plan4.ts", "peaceai/lib/plan4run.ts"];
  const diff = spawnSync("git", ["diff", "94282046551b59e5d9e8eab08ad0479c314cb3bf", "--", ...files], { encoding: "utf8" });
  assert.equal(diff.stdout, "", diff.stdout);
  const { plannerSha256V4 } = createRequire(import.meta.url)("../lib/plan4run.ts") as { plannerSha256V4: () => string };
  const sha = plannerSha256V4();
  assert.equal(typeof sha, "string");
  assert.equal(sha.length, 64);
  const runsDiff = spawnSync("git", ["diff", "94282046551b59e5d9e8eab08ad0479c314cb3bf", "-U0", "--", "peaceai/plan/runs.jsonl"], { encoding: "utf8" });
  for (const line of (runsDiff.stdout ?? "").split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---")) assert.fail(`runs.jsonl lost a line: ${line}`);
  }
  const needle = "new " + "Worker(";
  const newFiles = spawnSync("git", ["diff", "94282046551b59e5d9e8eab08ad0479c314cb3bf", "--name-only", "--diff-filter=A"], { encoding: "utf8" });
  for (const f of (newFiles.stdout ?? "").split("\n").filter(Boolean)) {
    if (!existsSync(f)) continue;
    if (f.startsWith("peaceai/test/")) continue;
    const t = readFileSync(f, "utf8");
    assert.equal(t.includes(needle), false, `${needle} in ${f}`);
  }
  assert.ok(existsSync(join(libDir, "plan4.ts")));
});

test("M210 hygiene: no process outlives the file's runs (checked last)", { skip: !existsSync("/proc/self") && "no /proc" }, () => {
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
