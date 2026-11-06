// M208 (batch 44) repair-retry-v1 helper: EXPERIMENTAL, opt-in, NOT the default, NOT for credit. Spec:
// peaceai/spec/repair-retry-v1.md ("M208"). Closes the Batch 39 residual "the proposer never writes a helper": when no
// single pinned transform fits ONE run's evidence but an ordered pair does, a later attempt adds ONE private
// (non-exported, unmodified) top-level helper in the same file, right after the function, and routes every value the
// function returns through it. The edit must be inside rr-in-function-v1 as "rr-helper" or it is not offered.
//   1. pure: one case per m208-guard tag of repair-retry.ts, each replayed against a mutant with that line deleted;
//   2. end to end (candidate uid peaceai-cand3, judge uid PEACEAI_VERIFIER_UID): two self-made fixture repos (a tag key,
//      a region code) where attempt 1 (repair-v2) fails, no single transform fits, and the helper attempt passes on its
//      own verifier-v1 verdict; controls (repair-v2 alone fails); refused near misses (helper over the bound, exported
//      helper, helper in another file, helper shadowing an existing name, attempts over the cap).
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
const base = mkdtempSync(join(tmpdir(), "peaceai-m208-rr-"));
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
const TAG = 'export function tagKey(raw: string): string {\n  if (raw.startsWith("#")) return raw.slice(1);\n  return raw;\n}\n';
const TAG_TEAM = 'import assert from "node:assert/strict";\nimport { tagKey } from "../src/tag.ts";\n\ntest("hash and trailing space", () => assert.equal(tagKey("#Red "), "red"));\ntest("leading space", () => assert.equal(tagKey(" Blue"), "blue"));\ntest("plain", () => assert.equal(tagKey("green"), "green"));\n';
const REGION = 'export function regionCode(locale: string): string {\n  if (locale.indexOf("-") === 2) return locale.slice(3);\n  return locale;\n}\n';
const REGION_TEAM = 'import assert from "node:assert/strict";\nimport { regionCode } from "../src/region.ts";\n\ntest("language and region", () => assert.equal(regionCode("en-gb "), "GB"));\ntest("bare region", () => assert.equal(regionCode(" de"), "DE"));\ntest("already a code", () => assert.equal(regionCode("FR"), "FR"));\n';
const TAG_FIX = 'export function tagKey(raw: string): string {\n  if (raw.startsWith("#")) return rrShared(raw.slice(1));\n  return rrShared(raw);\n}\n\nfunction rrShared(v: string): string {\n  return ((v).trim()).toLowerCase();\n}\n';

// ---- pure cases, one or more per m208-guard tag
const ev = (run: string, cases: Partial<RR.EvidenceCase>[], module = "src/m.ts"): RR.RetryEvidence => ({ run, module, cases: cases.map((c, i) => ({ id: `c${i + 1}:f`, fn: "f", args: [], expect: { ok: true, value: 0 }, pass: false, run, ...c }) as RR.EvidenceCase) });
const tagEv = (run = "baseline") => ev(run, [
  { fn: "tagKey", got: { ok: true, value: "Red " }, expect: { ok: true, value: "red" } },
  { fn: "tagKey", got: { ok: true, value: " Blue" }, expect: { ok: true, value: "blue" } },
  { fn: "tagKey", pass: true, expect: { ok: true, value: "green" } },
], "src/tag.ts");
interface GCase { guard: string; name: string; run(m: RRT): void }
const GCASES: GCase[] = [
  { guard: "class-helper-shadow", name: "a helper named like an inner name of the file (a parameter) is outside", run: (m) => {
    const shadow = TAG_FIX.replace(/rrShared/g, "startsWith");
    assert.equal(m.retrySourceClass(TAG, shadow), "rr-helper-shadow");
  } },
  { guard: "class-helper-pick", name: "a helper placed after the changed function is admitted (rr-helper)", run: (m) => assert.equal(m.retrySourceClass(TAG, TAG_FIX), "rr-helper") },
  { guard: "pair-single-first", name: "no pair (no helper) when one transform alone fits", run: (m) => assert.deepEqual(m.fitPair(ev("a", [{ got: { ok: true, value: 2.4 }, expect: { ok: true, value: 2 } }])), { refuse: "single-fits" }) },
  { guard: "pair-one-run", name: "a pair is refused on evidence mixing runs", run: (m) => { const e = tagEv("a"); assert.deepEqual(m.fitPair({ ...e, cases: [...e.cases, { ...e.cases[0]!, id: "c9:f", run: "b" }] }), { refuse: "RETRY_EVIDENCE_COMBINED" }); } },
  { guard: "pair-all", name: "a pair must fit every case (trim+lower, not lower+upper first match)", run: (m) => {
    const f = m.fitPair(tagEv());
    assert.ok("pair" in f && f.pair[0].name === "trim" && f.pair[1].name === "lower", JSON.stringify("pair" in f ? f.pair.map((t) => t.name) : f));
    assert.deepEqual(m.fitPair(ev("a", [{ got: { ok: true, value: " Ab" }, expect: { ok: true, value: "xy" } }])), { refuse: "no-fit" });
  } },
  { guard: "helper-fresh", name: "the helper name is fresh when the file already uses rrShared", run: (m) => { assert.equal(m.freshHelperName("const rrShared = 1;"), "rrShared2"); assert.equal(m.freshHelperName("x"), "rrShared"); } },
  { guard: "helper-class", name: "a helper edit the class would refuse is never offered (over the size bound)", run: (m) => {
    // a function with many returns: wrapping each and adding the helper exceeds maxAddedChars, so nothing is offered
    const many = "export function pick(k: string): string {\n" + Array.from({ length: 60 }, (_, i) => `  if (k === "k${i}") return "v${i}";\n`).join("") + "  return k;\n}\n";
    assert.equal(m.applyHelper(many, "pick", [m.RETRY_TRANSFORMS[4]!, m.RETRY_TRANSFORMS[5]!]), null);
    assert.equal(m.applyHelper(TAG, "tagKey", [m.RETRY_TRANSFORMS[4]!, m.RETRY_TRANSFORMS[5]!]), TAG_FIX, "control: in-bound helper is offered");
  } },
];

const libDir = resolve(import.meta.dirname, "../lib");
const SRC = readFileSync(join(libDir, "repair-retry.ts"), "utf8");
const TAGS = SRC.split("\n").flatMap((l) => { const m = /\/\/ m208-guard:([a-z-]+)/.exec(l); return m ? [m[1]!] : []; });
const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
let mutN = 0;
const rewrite = (t: string) => t.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
  .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`).replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
async function rrMutant(text: string): Promise<RRT> {
  const f = join(base, `mutant-${mutN++}-repair-retry.ts`);
  writeFileSync(f, rewrite(text));
  return (await import(pathToFileURL(f).href)) as RRT;
}
const drop = (text: string, tag: string) => { const ls = text.split("\n"), hits = ls.filter((l) => l.includes(`// m208-guard:${tag}`)); assert.equal(hits.length, 1, `one line holds ${tag}`); return ls.filter((l) => !l.includes(`// m208-guard:${tag}`)).join("\n"); };

test("M208 tags: the guard lines are the expected ones, each with a case", () => {
  assert.deepEqual(TAGS, ["class-helper-pick", "class-helper-shadow", "pair-single-first", "pair-one-run", "pair-all", "helper-fresh", "helper-class"]);
  for (const t of TAGS) assert.ok(GCASES.some((c) => c.guard === t), `a case for ${t}`);
});
test("M208 pure: every case passes as committed and on an unmutated copy", async () => {
  for (const c of GCASES) c.run(RR);
  const m = await rrMutant(SRC);
  for (const c of GCASES) c.run(m);
});
for (const tag of TAGS) {
  test(`M208 mutation: deleting m208-guard:${tag} fails a case of its own guard`, async () => {
    const m = await rrMutant(drop(SRC, tag));
    assert.ok(GCASES.filter((c) => c.guard === tag).some((c) => { try { c.run(m); return false; } catch { return true; } }), `no ${tag} case notices it removed`);
  });
}
test("M208 pinned: cap, policy and default unchanged", () => {
  assert.equal(RR.RETRY_MAX_ATTEMPTS, 3);
  assert.deepEqual([...RR.RETRY_SCOPE_POLICY.classes], ["export-keyword", "in-body", "rr-in-function", "rr-helper"]);
  assert.equal(RR.RETRY_SCOPE_POLICY.maxAddedChars, 600);
  assert.equal(LoopReal.DEFAULT_VERDICT_MODE, "inproc");
  assert.deepEqual(LoopReal.EDIT_SCOPE_POLICY, { edit: ["export-keyword", "in-body"], load: ["export-keyword"] });
});

// ---- near misses as class / scope results (pure), then end to end
const BIG = TAG_FIX.replace("  return ((v).trim()).toLowerCase();", Array.from({ length: 40 }, (_, i) => `  if (v === "z${i}") return v;\n`).join("") + "  return ((v).trim()).toLowerCase();");
const EXPORTED = TAG_FIX.replace("function rrShared(v", "export function rrShared(v");
const SHADOW_TOP = TAG_FIX.replace(/rrShared/g, "tagKey2").replace("tagKey2(v", "tagKey(v");
const SHADOW_INNER = TAG_FIX.replace(/rrShared/g, "slice");
const OTHER_MAIN = 'import { rrShared } from "./shared.ts";\n' + TAG.replace('return raw.slice(1);', 'return rrShared(raw.slice(1));').replace("  return raw;\n}", "  return rrShared(raw);\n}");
const OTHER_FILE = "export function rrShared(v: string): string {\n  return v.trim().toLowerCase();\n}\n";
test("M208 near misses (pure): over the bound, exported, another file, shadowing are outside rr-in-function-v1", () => {
  const orig = (p: string) => (p === "src/tag.ts" ? TAG : null);
  assert.equal(RR.retrySourceClass(TAG, BIG), "rr-too-large");
  assert.equal(RR.retrySourceClass(TAG, EXPORTED), "rr-helper-modifier");
  assert.equal(RR.retrySourceClass(TAG, SHADOW_INNER), "rr-helper-shadow");
  assert.notEqual(RR.retrySourceClass(TAG, SHADOW_TOP), "rr-helper");
  assert.notEqual(RR.retryScopeProblem([{ path: "src/tag.ts", content: OTHER_MAIN }, { path: "src/shared.ts", content: OTHER_FILE }], orig, () => false), null);
  assert.equal(RR.retryScopeProblem([{ path: "src/tag.ts", content: TAG_FIX }], orig, () => false), null, "control");
});

const CAND = process.env.M208_CAND ?? process.env.M146_CAND ?? "";
const VERIFIER = process.env.M208_VERIFIER ?? process.env.PEACEAI_VERIFIER_UID ?? "";
const cand = stage2CandUid({ [STAGE2_CAND_ENV]: CAND }).ok ? stage2CandUid({ [STAGE2_CAND_ENV]: CAND }) : null;
const vOk = cand !== null && cand.ok && V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand as never).ok;
const skipE2e = !vOk && "needs M208_CAND / M146_CAND = peaceai-cand3 and PEACEAI_VERIFIER_UID = peaceai-verify";
type Edits = { path: string; content: string }[];
const scripted = (name: string, seq: (Edits | null)[]) => ({ name, next: (i: { attempt: number }) => { const e = seq[i.attempt - 1]; return e ? { edits: e } : { refuse: "NO_MORE_EDITS" as const }; } });
let ctxShared: { m151: ReturnType<typeof setup151>; scratch: string } | null = null;
const ctx = () => { if (!ctxShared) { const m151 = setup151(); ctxShared = { m151, scratch: mkdtempSync(join(base, "e2e-")) }; } return ctxShared; };
after(() => { if (ctxShared) teardown151(ctxShared.m151); });
let nTask = 0;
const REQUESTS: Record<string, string> = {
  "src/tag.ts": "tagKey keeps stray spaces and capitals; a tag key should be the bare lower-case word.",
  "src/region.ts": "regionCode keeps stray spaces and lower case; a region code should be the bare upper-case code.",
};
function go(file: string, src: string, team: string, proposer: unknown, extra: Record<string, unknown> = {}, max = 3) {
  const c = ctx();
  const task = e2eTask(c, `m208-${nTask++}`, { [file]: src }, team);
  return LoopReal.runLoopTask({ ...task, request: REQUESTS[file] ?? task.request } as never, "public", "a".repeat(64),
    { ...opts174(c, proposer as never, max), env: { ...c.m151.env, [STAGE2_CAND_ENV]: CAND, [V.VERIFIER_UID_ENV]: VERIFIER }, verdictMode: "oop-v1", repairRetry: "repair-retry-v1", ...extra } as never);
}
const summary = (r: ReturnType<typeof go>) => ({ code: r.row.code, attempts: r.row.attempts, codes: r.row.attemptCodes, max: r.row.maxAttempts });

for (const [label, file, src, team] of [["tag key", "src/tag.ts", TAG, TAG_TEAM], ["region code", "src/region.ts", REGION, REGION_TEAM]] as const) {
  test(`M208 admit (${label}): attempt 1 fails, no single transform fits, the helper attempt passes on its own oop-v1 verdict`, { skip: skipE2e }, () => {
    const p = RR.retryProposer(repairProposer({ v2: true }) as never);
    const r = go(file, src, team, p);
    assert.equal(RowReal.loopRowProblem(r.row), null, String(RowReal.loopRowProblem(r.row)));
    assert.equal(r.row.code, "PASS", JSON.stringify({ ...summary(r), t: p.transforms }));
    assert.ok(r.row.attempts >= 2 && r.row.attempts <= 3);
    assert.notDeepEqual(r.row.attemptCodes[0], [], "attempt 1 failed its own verdict");
    assert.equal(r.row.repairRetry, "repair-retry-v1");
    assert.ok(p.transforms.length >= 1 && p.transforms[p.transforms.length - 1]!.includes(":helper("), JSON.stringify(p.transforms));
    assert.ok(!p.transforms.some((t) => !t.includes(":helper(")), "no single-transform attempt was offered: none fits");
    console.log(`M208-ADMIT ${label} ${JSON.stringify({ ...summary(r), transforms: p.transforms })}`);
    for (const vm of [undefined, "oop-v1"]) {
      const d = go(file, src, team, repairProposer({ v2: true }), { verdictMode: vm, repairRetry: undefined }, 3);
      assert.notEqual(d.row.code, "PASS", `control ${vm ?? "default"}: ${JSON.stringify(summary(d))}`);
      console.log(`M208-CONTROL ${label} ${vm ?? "default"} ${JSON.stringify(summary(d))}`);
    }
  });
}
// The near misses are offered by a scripted proposer (not wrapped by retryProposer, whose own fit would answer first);
// the loop still runs under repair-retry-v1 / oop-v1, so attempts after the first meet the rr-in-function-v1 gate.
test("M208 refuse end to end: helper over the bound, exported, in another file, shadowing a name -> EDIT_SCOPE before it runs", { skip: skipE2e }, () => {
  const wrong: Edits = [{ path: "src/tag.ts", content: TAG.replace("raw.slice(1)", "raw.slice(2)") }];
  const honest = go("src/tag.ts", TAG, TAG_TEAM, scripted("scripted", [wrong, [{ path: "src/tag.ts", content: TAG_FIX }]]));
  assert.deepEqual([honest.row.code, honest.row.attempts], ["PASS", 2], "control: the in-bound private helper passes on its own verdict");
  for (const [what, second] of [["over the bound", [{ path: "src/tag.ts", content: BIG }]], ["exported", [{ path: "src/tag.ts", content: EXPORTED }]],
    ["another file", [{ path: "src/tag.ts", content: OTHER_MAIN }, { path: "src/shared.ts", content: OTHER_FILE }]], ["shadowing", [{ path: "src/tag.ts", content: SHADOW_INNER }]]] as const) {
    const r = go("src/tag.ts", TAG, TAG_TEAM, scripted("scripted", [wrong, second as unknown as Edits]));
    assert.deepEqual([r.row.code, r.row.attempts], ["EDIT_SCOPE", 1], `${what}: ${JSON.stringify(summary(r))}`);
    console.log(`M208-REFUSE ${what} ${JSON.stringify(summary(r))}`);
  }
});
test("M208 refuse end to end (cap): the helper fix offered at attempt 4 never runs; ATTEMPT_LIMIT at 3 when 10 are asked", { skip: skipE2e }, () => {
  const wrong = (k: number): Edits => [{ path: "src/tag.ts", content: TAG.replace("raw.slice(1)", `raw.slice(${k + 1})`) }];
  const r = go("src/tag.ts", TAG, TAG_TEAM, scripted("wrong", [wrong(1), wrong(2), wrong(3), [{ path: "src/tag.ts", content: TAG_FIX }]]), {}, 10);
  assert.deepEqual([r.row.code, r.row.attempts, r.row.maxAttempts], ["ATTEMPT_LIMIT", 3, 3], JSON.stringify(summary(r)));
});
test("M208 hygiene: no process outlives the file's runs (checked last)", { skip: !existsSync("/proc/self") && "no /proc" }, () => {
  assert.deepEqual(survivors(base), []);
});
