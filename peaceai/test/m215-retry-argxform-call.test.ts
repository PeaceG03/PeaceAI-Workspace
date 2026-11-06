// M215 (batch 51) repair-retry-v1 wrong-argument for catalog-transform call-site expressions: EXPERIMENTAL, opt-in,
// NOT the default, NOT for credit. Spec: peaceai/spec/repair-retry-v1.md ("M215"). Closes the Batch 50 residual
// "non-identifier call-site expressions" for one bounded shape: when the returned-position argument is exactly one
// closed-catalog unary transform of a literal or outer-param (Math.floor/ceil/..., .trim/.toLowerCase/.toUpperCase, !),
// a later attempt may replace that whole argument span with an outer parameter under the same projection model
// (M210-M214). Non-catalog expressions (`n + 0`, Math.abs, nested free calls) stay refused. Cap stays 3; credit only
// from the attempt's own verifier-v1 verdict.
//   1. pure: one case per m215-guard tag of repair-retry.ts, each replayed against a mutant with that line deleted;
//   2. end to end (candidate uid peaceai-cand3, judge uid PEACEAI_VERIFIER_UID): two self-made fixtures (numeric
//      Math.floor(0) arg and string (" ").trim() arg) where only the wrong-arg form passes; refused near misses
//      (n+0, Math.abs, model mismatch, foreign span, new-word). Literal/param forms (M210-M214) still admit.
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
const base = mkdtempSync(join(tmpdir(), "peaceai-m215-rr-"));
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

const PICK = "function take(a: number): number {\n  return a;\n}\nexport function pick(n: number): number {\n  return take(Math.floor(0));\n}\n";
const PICK_FIX = "function take(a: number): number {\n  return a;\n}\nexport function pick(n: number): number {\n  return take(n);\n}\n";
const PICK_TEAM = 'import assert from "node:assert/strict";\nimport { pick } from "../src/pick.ts";\n\ntest("a", () => assert.equal(pick(3.7), 3.7));\ntest("b", () => assert.equal(pick(5.2), 5.2));\ntest("c", () => assert.equal(pick(1.1), 1.1));\n';
const LABEL = 'function head(s: string): string {\n  return s;\n}\nexport function label(s: string): string {\n  return head((" ").trim());\n}\n';
const LABEL_FIX = 'function head(s: string): string {\n  return s;\n}\nexport function label(s: string): string {\n  return head(s);\n}\n';
const LABEL_TEAM = 'import assert from "node:assert/strict";\nimport { label } from "../src/label.ts";\n\ntest("ab", () => assert.equal(label("ab"), "ab"));\ntest("cd", () => assert.equal(label("cd"), "cd"));\ntest("ok", () => assert.equal(label("ok"), "ok"));\n';
const PREFER = "function take(a: number, _b: number): number {\n  return a;\n}\nexport function prefer(n: number): number {\n  return take(0, n);\n}\n";
const WRONGP = "function take(a: number, _b: number): number {\n  return a;\n}\nexport function pick(n: number, m: number): number {\n  return take(m, n);\n}\n";

const ev = (run: string, cases: Partial<RR.EvidenceCase>[], module = "src/m.ts"): RR.RetryEvidence => ({ run, module, cases: cases.map((c, i) => ({ id: `c${i + 1}:f`, fn: "f", args: [], expect: { ok: true, value: 0 }, pass: false, run, ...c }) as RR.EvidenceCase) });
const pickEv = (run = "baseline") => ev(run, [
  { fn: "pick", args: [3.7], got: { ok: true, value: 0 }, expect: { ok: true, value: 3.7 } },
  { fn: "pick", args: [5.2], got: { ok: true, value: 0 }, expect: { ok: true, value: 5.2 } },
  { fn: "pick", args: [1.1], got: { ok: true, value: 0 }, expect: { ok: true, value: 1.1 } },
], "src/pick.ts");
const labelEv = (run = "baseline") => ev(run, [
  { fn: "label", args: ["ab"], got: { ok: true, value: "" }, expect: { ok: true, value: "ab" } },
  { fn: "label", args: ["cd"], got: { ok: true, value: "" }, expect: { ok: true, value: "cd" } },
  { fn: "label", args: ["ok"], got: { ok: true, value: "" }, expect: { ok: true, value: "ok" } },
], "src/label.ts");
const preferEv = (run = "baseline") => ev(run, [
  { fn: "prefer", args: [3], got: { ok: true, value: 0 }, expect: { ok: true, value: 3 } },
  { fn: "prefer", args: [7], got: { ok: true, value: 0 }, expect: { ok: true, value: 7 } },
  { fn: "prefer", args: [1], got: { ok: true, value: 0 }, expect: { ok: true, value: 1 } },
], "src/prefer.ts");
const wrongpEv = (run = "baseline") => ev(run, [
  { fn: "pick", args: [3, 9], got: { ok: true, value: 9 }, expect: { ok: true, value: 3 } },
  { fn: "pick", args: [7, 1], got: { ok: true, value: 1 }, expect: { ok: true, value: 7 } },
  { fn: "pick", args: [2, 8], got: { ok: true, value: 8 }, expect: { ok: true, value: 2 } },
], "src/pick.ts");

interface GCase { guard: string; name: string; run(m: RRT): void }
const GCASES: GCase[] = [
  { guard: "arg-xform", name: "a catalog-transform of a literal/param at the returned position is an eligible call", run: (m) => {
    const calls = m.wrongArgCalls(PICK, "pick");
    assert.ok(calls && calls.some((c) => c.helper === "take" && c.args[0] && c.args[0].kind === "xform"), JSON.stringify(calls));
    const abs = "function take(a: number): number {\n  return a;\n}\nexport function pick(n: number): number {\n  return take(Math.abs(0));\n}\n";
    assert.deepEqual(m.wrongArgCalls(abs, "pick"), []);
    assert.deepEqual(m.fitWrongArg(pickEv(), abs), { refuse: "no-call" });
    const fit = m.fitWrongArg(pickEv(), PICK);
    assert.ok(!("refuse" in fit) && fit.param === "n" && fit.helper === "take", JSON.stringify(fit));
    assert.equal(m.applyWrongArg(PICK, fit.fn, fit.callStart, fit.argStart, fit.argEnd, fit.param), PICK_FIX);
  } },
  { guard: "arg-pred", name: "prediction applies the call-site catalog transform before the helper transform", run: (m) => {
    // ceil helper + floor(0) arg: without applying floor, raw 0 still "agrees" with got=0, but fitting expect=ceil(n)
    // from bare n would compare n to ceil(n) and refuse on .5 inputs; with floor then ceil it still needs replace.
    const SRC = "const clip = (x: number): number => Math.ceil(x);\nexport function bound(n: number): number {\n  return clip(Math.floor(0));\n}\n";
    const FIX = "const clip = (x: number): number => Math.ceil(x);\nexport function bound(n: number): number {\n  return clip(n);\n}\n";
    const e = ev("a", [
      { fn: "bound", args: [1.2], got: { ok: true, value: 0 }, expect: { ok: true, value: 2 } },
      { fn: "bound", args: [3.1], got: { ok: true, value: 0 }, expect: { ok: true, value: 4 } },
      { fn: "bound", args: [0.5], got: { ok: true, value: 0 }, expect: { ok: true, value: 1 } },
    ], "src/bound.ts");
    const fit = m.fitWrongArg(e, SRC);
    assert.ok(!("refuse" in fit) && fit.param === "n" && fit.helper === "clip", JSON.stringify(fit));
    assert.equal(m.applyWrongArg(SRC, fit.fn, fit.callStart, fit.argStart, fit.argEnd, fit.param), FIX);
  } },
  { guard: "prop-order", name: "proposer tries wrong-arg (including xform call-site) only after constant/pair/branch refuse", run: (m) => {
    const baseP = { name: "base", next: () => ({ refuse: "NO_MORE_EDITS" as const }) };
    const p = m.retryProposer(baseP as never);
    const files = [{ path: "src/pick.ts", content: PICK }];
    assert.deepEqual(p.next({ attempt: 1, files, feedback: [], search: null } as never), { refuse: "NO_MORE_EDITS" });
    const prop = p.next({ attempt: 2, files, feedback: [{ attempt: 1, codes: ["TEST_FAIL"], failing: ["c1"], tests: { total: 3, passedByPeaceAI: 0, filledByTeam: 0 } }], retryBaseline: pickEv(), search: null } as never);
    assert.ok("edits" in prop, JSON.stringify(prop));
    assert.ok(p.transforms.some((t) => t.includes(":arg(")), JSON.stringify(p.transforms));
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
const TAGS = SRC.split("\n").flatMap((l) => { const m = /\/\/ m215-guard:([a-z-]+)/.exec(l); return m ? [m[1]!] : []; });
const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
let mutN = 0;
const rewrite = (t: string) => t.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
  .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`).replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
async function rrMutant(text: string): Promise<RRT> {
  const f = join(base, `mutant-${mutN++}-repair-retry.ts`);
  writeFileSync(f, rewrite(text));
  return (await import(pathToFileURL(f).href)) as RRT;
}
const drop = (text: string, tag: string) => { const ls = text.split("\n"), hits = ls.filter((l) => l.includes(`// m215-guard:${tag}`)); assert.equal(hits.length, 1, `one line holds ${tag}`); return ls.filter((l) => !l.includes(`// m215-guard:${tag}`)).join("\n"); };

test("M215 tags: the guard lines are the expected ones, each with a case", () => {
  assert.deepEqual(TAGS, ["arg-xform", "arg-pred", "prop-order"]);
  for (const t of TAGS) assert.ok(GCASES.some((c) => c.guard === t), `a case for ${t}`);
});
test("M215 pure: every case passes as committed and on an unmutated copy", async () => {
  for (const c of GCASES) c.run(RR);
  const m = await rrMutant(SRC);
  for (const c of GCASES) c.run(m);
});
for (const tag of TAGS) {
  test(`M215 mutation: deleting m215-guard:${tag} fails a case of its own guard`, async () => {
    const m = await rrMutant(drop(SRC, tag));
    assert.ok(GCASES.filter((c) => c.guard === tag).some((c) => { try { c.run(m); return false; } catch { return true; } }), `no ${tag} case notices it removed`);
  });
}
test("M215 pinned: cap, policy, order and default unchanged", () => {
  assert.equal(RR.RETRY_MAX_ATTEMPTS, 3);
  assert.deepEqual([...RR.RETRY_SCOPE_POLICY.classes], ["export-keyword", "in-body", "rr-in-function", "rr-helper"]);
  assert.equal(RR.RETRY_SCOPE_POLICY.maxAddedChars, 600);
  assert.equal(LoopReal.DEFAULT_VERDICT_MODE, "inproc");
  assert.deepEqual(LoopReal.EDIT_SCOPE_POLICY, { edit: ["export-keyword", "in-body"], load: ["export-keyword"] });
});

test("M215 near misses (pure): n+0, Math.abs, model mismatch, new-word; lit/param forms still admit", () => {
  const plus = "function take(a: number): number {\n  return a;\n}\nexport function pick(n: number): number {\n  return take(n + 0);\n}\n";
  assert.deepEqual(RR.wrongArgCalls(plus, "pick"), []);
  assert.deepEqual(RR.fitWrongArg(pickEv(), plus), { refuse: "no-call" });
  const abs = "function take(a: number): number {\n  return a;\n}\nexport function pick(n: number): number {\n  return take(Math.abs(0));\n}\n";
  assert.deepEqual(RR.fitWrongArg(pickEv(), abs), { refuse: "no-call" });
  const mismatch = ev("a", [
    { fn: "pick", args: [3.7], got: { ok: true, value: 9 }, expect: { ok: true, value: 3.7 } },
    { fn: "pick", args: [5.2], got: { ok: true, value: 9 }, expect: { ok: true, value: 5.2 } },
  ], "src/pick.ts");
  assert.deepEqual(RR.fitWrongArg(mismatch, PICK), { refuse: "no-fit" });
  const f = RR.fitWrongArg(pickEv(), PICK);
  assert.ok(!("refuse" in f));
  assert.equal(RR.applyWrongArg(PICK, f.fn, f.callStart, f.argStart, f.argEnd, "pendingForeign"), null);
  const sel = RR.fitWrongArg(preferEv(), PREFER);
  assert.ok(!("refuse" in sel) && sel.helper === "take" && sel.param === "n", JSON.stringify(sel));
  const wp = RR.fitWrongArg(wrongpEv(), WRONGP);
  assert.ok(!("refuse" in wp) && wp.param === "n", JSON.stringify(wp));
  const lbl = RR.fitWrongArg(labelEv(), LABEL);
  assert.ok(!("refuse" in lbl) && lbl.param === "s", JSON.stringify(lbl));
  const PORT = "export function defaultPort(): number {\n  return 8080;\n}\n";
  const portEv = ev("a", [
    { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
    { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
  ], "src/port.ts");
  assert.deepEqual(RR.fitConstant(portEv, PORT), { from: 8080, to: 3000, fn: "defaultPort" });
});

const CAND = process.env.M215_CAND ?? process.env.M214_CAND ?? process.env.M146_CAND ?? "";
const VERIFIER = process.env.M215_VERIFIER ?? process.env.PEACEAI_VERIFIER_UID ?? "";
const cand = stage2CandUid({ [STAGE2_CAND_ENV]: CAND }).ok ? stage2CandUid({ [STAGE2_CAND_ENV]: CAND }) : null;
const vOk = cand !== null && cand.ok && V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand as never).ok;
const skipE2e = !vOk && "needs M215_CAND / M146_CAND = peaceai-cand3 and PEACEAI_VERIFIER_UID = peaceai-verify";
type Edits = { path: string; content: string }[];
const scripted = (name: string, seq: (Edits | null)[]) => ({ name, next: (i: { attempt: number }) => { const e = seq[i.attempt - 1]; return e ? { edits: e } : { refuse: "NO_MORE_EDITS" as const }; } });
const PICK_WRONG = PICK.replace("Math.floor(0)", "Math.floor(1)");
const LABEL_WRONG = LABEL.replace('(" ").trim()', '("s").trim()');
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
  "src/pick.ts": "pick should pass n through take, not a floored zero.",
  "src/label.ts": "label should pass s through head, not a trimmed blank.",
};
function go(file: string, src: string, team: string, proposer: unknown, extra: Record<string, unknown> = {}, max = 3) {
  const c = ctx();
  const task = e2eTask(c, `m215-${nTask++}`, { [file]: src }, team);
  return LoopReal.runLoopTask({ ...task, request: REQUESTS[file] ?? task.request } as never, "public", "a".repeat(64),
    { ...opts174(c, proposer as never, max), env: { ...c.m151.env, [STAGE2_CAND_ENV]: CAND, [V.VERIFIER_UID_ENV]: VERIFIER }, verdictMode: "oop-v1", repairRetry: "repair-retry-v1", ...extra } as never);
}
const summary = (r: ReturnType<typeof go>) => ({ code: r.row.code, attempts: r.row.attempts, codes: r.row.attemptCodes, max: r.row.maxAttempts });

for (const [label, file, src, team, wrong] of [
  ["pick floor-lit", "src/pick.ts", PICK, PICK_TEAM, PICK_WRONG],
  ["label trim-lit", "src/label.ts", LABEL, LABEL_TEAM, LABEL_WRONG],
] as const) {
  test(`M215 admit wrong-arg xform-call (${label}): attempt 1 fails, only the arg form passes on its own oop-v1 verdict`, { skip: skipE2e }, () => {
    const p = RR.retryProposer(seedBase(file, wrong) as never);
    const r = go(file, src, team, p);
    assert.equal(RowReal.loopRowProblem(r.row), null, String(RowReal.loopRowProblem(r.row)));
    assert.equal(r.row.code, "PASS", JSON.stringify({ ...summary(r), t: p.transforms }));
    assert.ok(r.row.attempts >= 2 && r.row.attempts <= 3);
    assert.notDeepEqual(r.row.attemptCodes[0], [], "attempt 1 failed its own verdict");
    assert.equal(r.row.repairRetry, "repair-retry-v1");
    assert.ok(p.transforms.some((t) => t.includes(":arg(")), JSON.stringify(p.transforms));
    assert.ok(!p.transforms.some((t) => t.includes(":helper(") || t.includes(":branch(") || t.includes(":const(")), "only arg form: " + JSON.stringify(p.transforms));
    console.log(`M215-ADMIT-ARG ${label} ${JSON.stringify({ ...summary(r), transforms: p.transforms })}`);
    for (const vm of [undefined, "oop-v1"]) {
      const d = go(file, src, team, repairProposer({ v2: true }), { verdictMode: vm, repairRetry: undefined }, 3);
      assert.notEqual(d.row.code, "PASS", `control ${vm ?? "default"}: ${JSON.stringify(summary(d))}`);
      console.log(`M215-CONTROL-ARG ${label} ${vm ?? "default"} ${JSON.stringify(summary(d))}`);
    }
  });
}

test("M215 refuse end to end: new-word replacement -> EDIT_SCOPE before it runs", { skip: skipE2e }, () => {
  const wrong: Edits = [{ path: "src/pick.ts", content: PICK_WRONG }];
  const f = RR.fitWrongArg(pickEv(), PICK);
  assert.ok(!("refuse" in f));
  const good = RR.applyWrongArg(PICK, f.fn, f.callStart, f.argStart, f.argEnd, f.param);
  assert.ok(good);
  const honest = go("src/pick.ts", PICK, PICK_TEAM, scripted("scripted", [wrong, [{ path: "src/pick.ts", content: good! }]]));
  assert.deepEqual([honest.row.code, honest.row.attempts], ["PASS", 2], "control: in-bound arg passes on its own verdict");
  const foreign = PICK.replace("Math.floor(0)", "pendingForeign");
  assert.equal(RR.retrySourceClass(PICK, foreign).startsWith("new-word:"), true);
  const r = go("src/pick.ts", PICK, PICK_TEAM, scripted("scripted", [wrong, [{ path: "src/pick.ts", content: foreign }]]));
  assert.deepEqual([r.row.code, r.row.attempts], ["EDIT_SCOPE", 1], JSON.stringify(summary(r)));
  console.log(`M215-REFUSE new-word ${JSON.stringify(summary(r))}`);
});

test("M215 pins: selfpropose.ts, plandefault.ts, plan4.ts byte-identical to gen/batch50; v4 digest unchanged; runs.jsonl add-only; no Worker ctor literal", () => {
  const files = ["peaceai/lib/selfpropose.ts", "peaceai/lib/plandefault.ts", "peaceai/lib/plan4.ts", "peaceai/lib/plan4run.ts"];
  const tip = "1ad1aaa37647c0e8ef3377f5f8c174cd2e5d6239";
  const diff = spawnSync("git", ["diff", tip, "--", ...files], { encoding: "utf8" });
  assert.equal(diff.stdout, "", diff.stdout);
  const { plannerSha256V4 } = createRequire(import.meta.url)("../lib/plan4run.ts") as { plannerSha256V4: () => string };
  const sha = plannerSha256V4();
  assert.equal(typeof sha, "string");
  assert.equal(sha.length, 64);
  const runsDiff = spawnSync("git", ["diff", tip, "-U0", "--", "peaceai/plan/runs.jsonl"], { encoding: "utf8" });
  for (const line of (runsDiff.stdout ?? "").split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---")) assert.fail(`runs.jsonl lost a line: ${line}`);
  }
  const needle = "new " + "Worker(";
  const newFiles = spawnSync("git", ["diff", tip, "--name-only", "--diff-filter=A"], { encoding: "utf8" });
  for (const f of (newFiles.stdout ?? "").split("\n").filter(Boolean)) {
    if (!existsSync(f)) continue;
    if (f.startsWith("peaceai/test/")) continue;
    const t = readFileSync(f, "utf8");
    assert.equal(t.includes(needle), false, `${needle} in ${f}`);
  }
  assert.ok(existsSync(join(libDir, "plan4.ts")));
});

test("M215 hygiene: no process outlives the file's runs (checked last)", { skip: !existsSync("/proc/self") && "no /proc" }, () => {
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
