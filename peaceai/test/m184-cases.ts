// M184 behavior cases (batch 20) for repair-v2's barrel re-export localisation (peaceai/lib/editpropose.ts
// reExportedFunction and its use in M172's imported callees). As data so m184-mutation.test.ts can replay the pure cases
// against each mutant. Each case throws (node:assert) on failure. Admitted on three unrelated module layouts (a folder
// index with a named re-export, a folder index with `export *` over several modules, a two-step barrel chain with an
// alias), each a fault in a function the entry imports through a barrel, so no site located before M184 holds the fix;
// every m184 guard has a refused near miss; every proposal of the admits is checked against the loop's M175 gate
// (in-body). Fixtures are tiny synthetic repos written for these tests from general shapes (a receipt formatter, a
// route on a grid, a card title): none is modeled on a dev-split task's code or on a reference diff, and none is a
// PeaceSTOCKS shape. The "tests" are an in-process oracle over a small CommonJS loader of the fixture's files; the
// end-to-end case (needsCand) runs the real loop and needs M184_CAND (no fallback user).
// Spec: peaceai/spec/repair-v2-m184.md.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { openRepo } from "../lib/codesearch.ts";
import type * as Prop from "../lib/editpropose.ts";
import { repairProposer } from "../lib/editpropose.ts"; // the e2e case runs the real (unmutated) proposer
import * as loop from "../lib/loop.ts";
import type * as Loop from "../lib/loop.ts";
import { loopRowProblem, type LoopRow } from "../lib/looprow.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";
import { e2eTask, opts as opts174 } from "./m174-cases.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";

const M184_CAND = process.env.M184_CAND ?? "";
export const m184Cand = (): boolean => stage2CandUid({ [STAGE2_CAND_ENV]: M184_CAND }).ok;

export interface Libs { prop: typeof Prop }
export interface Ctx { base: string }
export interface Case { id: string; needsCand?: boolean; run: (l: Libs, ctx: Ctx) => void }
export function setup(): Ctx { return { base: mkdtempSync(join(tmpdir(), "peaceai-m184-")) }; }
export function teardown(ctx: Ctx): void { rmSync(ctx.base, { recursive: true, force: true }); }

export type Files = Record<string, string>;
let n = 0;
function repoDir(ctx: Ctx, files: Files): string {
  const d = join(ctx.base, `r${n++}`);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
const tsFiles = (files: Files) => Object.keys(files).filter((p) => /\.tsx?$/.test(p)).sort().map((p) => ({ path: p, content: files[p]! }));
/** A tiny CommonJS loader over the in-memory files (relative specifiers only; `x`, `x.ts`, `x/index.ts`). */
function load(m: ReadonlyMap<string, string>, entry: string): Record<string, any> {
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const req = (path: string): Record<string, unknown> => {
    const hit = cache.get(path);
    if (hit) return hit.exports;
    const mod = { exports: {} as Record<string, unknown> };
    cache.set(path, mod);
    const js = ts.transpileModule(m.get(path)!, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const require = (spec: string) => {
      const base = posix.normalize(posix.join(posix.dirname(path), spec));
      const p = [base, `${base}.ts`, `${base}/index.ts`].find((c) => m.has(c));
      if (!p) throw new Error(`no module ${spec}`);
      return req(p);
    };
    vm.runInNewContext(js, { module: mod, exports: mod.exports, require, Math }, { timeout: 1000 });
    return mod.exports;
  };
  return req(entry);
}
export type Check = (x: Record<string, any>) => boolean;
const oracle = (path: string, checks: readonly Check[]) => (m: ReadonlyMap<string, string>): number => {
  let x: Record<string, any>;
  try { x = load(m, path); } catch { return 0; }
  let ok = 0;
  for (const c of checks) { try { if (c(x)) ok++; } catch { /* a failing test */ } }
  return ok;
};
const apply = (orig: ReadonlyMap<string, string>, edits: readonly Prop.RepairEdit[]) => { const m = new Map(orig); for (const e of edits) m.set(e.path, e.content); return m; };
const MAX_ATTEMPTS = loop.MAX_ATTEMPTS;
const key = (e: readonly Prop.RepairEdit[]) => JSON.stringify(e);
function gate(orig: ReadonlyMap<string, string>, edits: readonly Prop.RepairEdit[]): string {
  const read = (p: string) => orig.get(p) ?? null;
  return loop.editScopeProblem(edits, read, () => false) ?? loop.editScopeOf(edits, read) ?? "none";
}
export const sitesOf = (l: Libs, ctx: Ctx, files: Files, request: string, depth: number = l.prop.CALLEE_DEPTH.v2): Prop.Site[] => l.prop.locate(openRepo(repoDir(ctx, files)), { request, failing: [] }, depth);
/** The tier-5 (barrel-resolved) sites as "name@path". */
export const barrel = (l: Libs, ctx: Ctx, files: Files, request: string): string[] => sitesOf(l, ctx, files, request).filter((s) => s.tier === 5).map((s) => `${s.name}@${s.path}`);

function simulate(l: Libs, ctx: Ctx, files: Files, request: string, path: string, checks: readonly Check[]) {
  const d = repoDir(ctx, files);
  const test = oracle(path, checks);
  const total = checks.length;
  const p = l.prop.repairProposer({ v2: true });
  p.prepare(openRepo(d), { request, failing: [] });
  const fs = tsFiles(files);
  const orig = new Map(fs.map((f) => [f.path, f.content]));
  const base = test(orig);
  assert.ok(base < total, "the fixture is not broken");
  assert.ok(base > 0, "the fixture loads (some check passes before the fix)");
  const feedback: Prop.RepairFeedback[] = [];
  const proposals: Prop.RepairEdit[][] = [];
  let result = "limit";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = p.next({ files: fs, attempt, feedback, baseline: { total, passing: base, failing: total - base } });
    if ("refuse" in r) { result = r.refuse; break; }
    proposals.push(r.edits);
    const pass = test(apply(orig, r.edits));
    if (pass === total) { result = "pass"; break; }
    feedback.push({ attempt, codes: ["TEST_FAIL"], failing: [], tests: { total, passedByPeaceAI: pass } });
  }
  return { proposals, result, orig };
}

/** An admit: the exact sites of the given tier (5: barrel; M185 / M186 reuse it for tiers 4 and 5), PASS within
 *  MAX_ATTEMPTS, the passing edit inside a site of that tier and outside every other site, no repeated proposal, every
 *  proposal in-body under the M175 gate. */
export const admitAt = (tier: number) => (id: string, files: Files, request: string, path: string, checks: Check[], want: string[], fixRe: RegExp): Case => ({
  id, run(l, ctx) {
    const sites = sitesOf(l, ctx, files, request);
    const bs = sites.filter((s) => s.tier === tier);
    assert.deepEqual(bs.map((s) => `${s.name}@${s.path}`), want, "the barrel-resolved functions are located");
    const s = simulate(l, ctx, files, request, path, checks);
    assert.equal(s.result, "pass", `${s.result} after ${s.proposals.length}`);
    const last = s.proposals.at(-1)!;
    assert.equal(last.length, 1);
    const before = files[last[0]!.path]!, after = last[0]!.content;
    let a = 0; while (before[a] === after[a]) a++;
    let b = 0; while (b < before.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
    const end = before.length - b;
    assert.ok(bs.some((m) => m.path === last[0]!.path && m.start <= a && end <= m.end), "the fix is inside the barrel site");
    assert.ok(!sites.some((x) => x.tier !== tier && x.path === last[0]!.path && x.start < end && a < x.end), "the fix is outside every earlier site");
    assert.match(after, fixRe);
    assert.equal(new Set(s.proposals.map(key)).size, s.proposals.length, "a proposal repeated");
    for (const p of s.proposals) assert.equal(gate(s.orig, p), "in-body");
  },
});

const admit = admitAt(5);

// ---- fixtures (synthetic, general module layouts)
// A: a folder index with named re-exports: the money formatter multiplies the cents by 100 instead of dividing
export const RECEIPT: Files = {
  "src/receipt.ts": 'import { money } from "./format/index.ts";\n\nexport function line(label: string, cents: number): string {\n  return label + " " + money(cents);\n}\n',
  "src/format/index.ts": 'export { money } from "./money.ts";\nexport { pad } from "./pad.ts";\n',
  "src/format/money.ts": 'export function money(cents: number): string {\n  return "$" + (cents * 100).toFixed(2);\n}\n',
  "src/format/pad.ts": 'export function pad(s: string, n: number): string {\n  return s.padStart(n, " ");\n}\n',
};
export const RECEIPT_REQ = "`line` prints the wrong amount.";
export const RECEIPT_CHECKS: Check[] = [(x) => x.line("tea", 250) === "tea $2.50", (x) => x.line("cake", 1000) === "cake $10.00", (x) => x.line("free", 0) === "free $0.00", (x) => x.line("gum", 5) === "gum $0.05"];
// B: a folder index with `export *` over several modules: the grid distance subtracts the vertical leg
const ROUTE: Files = {
  "src/route.ts": 'import { manhattan } from "./geo/index.ts";\n\nexport function steps(path: { x: number; y: number }[]): number {\n  let n = 0;\n  for (let i = 1; i < path.length; i++) n += manhattan(path[i - 1]!, path[i]!);\n  return n;\n}\n',
  "src/geo/index.ts": 'export * from "./angle.ts";\nexport * from "./distance.ts";\n',
  "src/geo/angle.ts": 'export function degrees(rad: number): number {\n  return (rad * 180) / Math.PI;\n}\n',
  "src/geo/distance.ts": 'export function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {\n  return Math.abs(a.x - b.x) - Math.abs(a.y - b.y);\n}\n',
};
const ROUTE_REQ = "`steps` undercounts the moves.";
const ROUTE_CHECKS: Check[] = [(x) => x.steps([{ x: 0, y: 0 }, { x: 2, y: 3 }]) === 5, (x) => x.steps([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 4 }]) === 5, (x) => x.steps([{ x: 0, y: 0 }]) === 0, (x) => x.steps([{ x: 3, y: 1 }, { x: 0, y: 1 }]) === 3];
// C: a two-step barrel chain with an alias: the title clip cuts a string that exactly fits
const CARD: Files = {
  "src/card.ts": 'import { clip } from "./text/index.ts";\n\nexport function title(s: string): string {\n  return clip(s, 5);\n}\n',
  "src/text/index.ts": 'export { clip } from "./clip.ts";\n',
  "src/text/clip.ts": 'export { cut as clip } from "./core/cut.ts";\n',
  "src/text/core/cut.ts": 'export function cut(s: string, n: number): string {\n  return s.length < n ? s : s.slice(0, n) + "~";\n}\n',
};
const CARD_REQ = "`title` mangles short titles.";
const CARD_CHECKS: Check[] = [(x) => x.title("hello") === "hello", (x) => x.title("hi") === "hi", (x) => x.title("abcdefg") === "abcde~", (x) => x.title("abcdef") === "abcde~"];

const ADMITS = [[RECEIPT, RECEIPT_REQ], [ROUTE, ROUTE_REQ], [CARD, CARD_REQ]] as const;
const entry = (fn: string, imp: string) => ({ "src/app.ts": `import { ${fn} } from "${imp}";\n\nexport function run(x: number): number {\n  return ${fn}(x) + 1;\n}\n` });
const fnFile = (fn: string, exported = true) => `${exported ? "export " : ""}function ${fn}(x: number): number {\n  return x * 2;\n}\n`;
const RUN = "`run` is wrong.";

export const CASES: Case[] = [
  // ---- admits: three unrelated module layouts, each a fault in a function reached only through a barrel
  admit("admit (a folder index with named re-exports): receipt.line -> money via format/index.ts; the cents operator is fixed in money.ts", RECEIPT, RECEIPT_REQ, "src/receipt.ts", RECEIPT_CHECKS, ["money@src/format/money.ts"], /\(cents \/ 100\)/),
  admit("admit (a folder index with export * over several modules): route.steps -> manhattan via geo/index.ts; the leg sign is fixed in distance.ts", ROUTE, ROUTE_REQ, "src/route.ts", ROUTE_CHECKS, ["manhattan@src/geo/distance.ts"], /Math\.abs\(a\.x - b\.x\) \+ Math\.abs\(a\.y - b\.y\)/),
  admit("admit (a two-step barrel chain with an alias): card.title -> clip via text/index.ts and text/clip.ts to cut; the comparison is fixed in core/cut.ts", CARD, CARD_REQ, "src/card.ts", CARD_CHECKS, ["cut@src/text/core/cut.ts"], /s\.length <= n/),
  {
    id: "order and v1: barrel sites are tier 5 after every other site, the earlier sites are unchanged, and repair-v1 locates none",
    run(l, ctx) {
      for (const [files, req] of ADMITS) {
        const sites = sitesOf(l, ctx, files, req);
        const at = sites.findIndex((s) => s.tier === 5);
        assert.ok(at > 0);
        assert.ok(sites.slice(at).every((s) => s.tier === 5));
        const v1 = sitesOf(l, ctx, files, req, l.prop.CALLEE_DEPTH.v1);
        assert.deepEqual(v1.filter((s) => s.tier === 5), []);
        const v2NoBarrel = sites.filter((s) => s.tier !== 5);
        assert.deepEqual(v2NoBarrel.slice(0, v1.length), v1);
      }
    },
  },
  {
    id: "unchanged: a direct import of the declaring module is M172's tier-1 site, never a barrel site; a non-relative barrel is not followed",
    run(l, ctx) {
      const direct = { ...entry("twice", "./lib/twice.ts"), "src/lib/twice.ts": fnFile("twice") };
      const sites = sitesOf(l, ctx, direct, RUN);
      assert.deepEqual(sites.filter((s) => s.tier === 5), []);
      assert.ok(sites.some((s) => s.name === "twice" && s.path === "src/lib/twice.ts"));
      const pkg = { ...entry("twice", "lib"), "src/lib/index.ts": 'export { twice } from "./twice.ts";\n', "src/lib/twice.ts": fnFile("twice") };
      assert.deepEqual(barrel(l, ctx, pkg, RUN), []);
    },
  },
  // ---- near misses, one per guard
  {
    id: "near miss (m184-guard:rx-named-first): an explicit named re-export wins over an export * that also exports the name",
    run(l, ctx) {
      const f = { ...entry("twice", "./lib/index.ts"), "src/lib/index.ts": 'export * from "./b.ts";\nexport { twice } from "./a.ts";\n', "src/lib/a.ts": fnFile("twice"), "src/lib/b.ts": fnFile("twice") };
      assert.deepEqual(barrel(l, ctx, f, RUN), ["twice@src/lib/a.ts"]);
    },
  },
  {
    id: "near miss (m184-guard:rx-star-unique): a name two export * modules both export is ambiguous (ES does not export it) and is not followed",
    run(l, ctx) {
      const f = { ...entry("twice", "./lib/index.ts"), "src/lib/index.ts": 'export * from "./a.ts";\nexport * from "./b.ts";\n', "src/lib/a.ts": fnFile("twice"), "src/lib/b.ts": fnFile("twice") };
      assert.deepEqual(barrel(l, ctx, f, RUN), []);
      const one = { ...f, "src/lib/b.ts": fnFile("half") };
      assert.deepEqual(barrel(l, ctx, one, RUN), ["twice@src/lib/a.ts"]);
    },
  },
  {
    id: "near miss (m184-guard:rx-exported): a star module's non-exported helper of the same name is not what the barrel re-exports",
    run(l, ctx) {
      const f = { ...entry("twice", "./lib/index.ts"), "src/lib/index.ts": 'export * from "./a.ts";\nexport * from "./b.ts";\n', "src/lib/a.ts": fnFile("twice", false), "src/lib/b.ts": fnFile("twice") };
      assert.deepEqual(barrel(l, ctx, f, RUN), ["twice@src/lib/b.ts"]);
      const local = { ...f, "src/lib/a.ts": fnFile("twice", false) + "export { twice };\n", "src/lib/b.ts": fnFile("half") };
      assert.deepEqual(barrel(l, ctx, local, RUN), ["twice@src/lib/a.ts"], "a local export list exports it");
    },
  },
  {
    id: "near miss (m184-guard:rx-type-only): an `export type *` module is not followed; only the value export * is",
    run(l, ctx) {
      const f = { ...entry("twice", "./lib/index.ts"), "src/lib/index.ts": 'export type * from "./a.ts";\nexport * from "./b.ts";\n', "src/lib/a.ts": fnFile("twice"), "src/lib/b.ts": fnFile("twice") };
      assert.deepEqual(barrel(l, ctx, f, RUN), ["twice@src/lib/b.ts"]);
    },
  },
  {
    id: "near miss (m184-guard:rx-hops): at most MAX_REEXPORT_HOPS re-export steps; a cyclic barrel ends",
    run(l, ctx) {
      assert.equal(l.prop.MAX_REEXPORT_HOPS, 3);
      const chain = (k: number): Files => {
        const f: Files = { ...entry("twice", "./b0.ts"), [`src/b${k}.ts`]: fnFile("twice") };
        for (let i = 0; i < k; i++) f[`src/b${i}.ts`] = `export { twice } from "./b${i + 1}.ts";\n`;
        return f;
      };
      assert.deepEqual(barrel(l, ctx, chain(3), RUN), ["twice@src/b3.ts"]);
      assert.deepEqual(barrel(l, ctx, chain(4), RUN), []);
      const cyc = { ...entry("twice", "./a.ts"), "src/a.ts": 'export * from "./b.ts";\n', "src/b.ts": 'export * from "./a.ts";\n' };
      assert.deepEqual(barrel(l, ctx, cyc, RUN), []);
    },
  },
  {
    id: "near miss (m184-guard:rx-allowed): a function a barrel re-exports from a vendored or test path is not located",
    run(l, ctx) {
      const f = { ...entry("twice", "./lib/index.ts"), "src/lib/index.ts": 'export { twice } from "./vendor/twice.ts";\nexport { half } from "./half.ts";\n', "src/lib/vendor/twice.ts": fnFile("twice"), "src/lib/half.ts": fnFile("half") };
      assert.deepEqual(barrel(l, ctx, f, RUN), []);
      const ok = { ...f, "src/app.ts": f["src/app.ts"]!.replace(/twice/g, "half") };
      assert.deepEqual(barrel(l, ctx, ok, RUN), ["half@src/lib/half.ts"]);
    },
  },
  {
    id: "near miss (m184-guard:rx-known): a barrel-resolved function that is already a located site is not added again",
    run(l, ctx) {
      assert.deepEqual(barrel(l, ctx, RECEIPT, "`line` and `money` print the wrong amount."), []);
      assert.deepEqual(barrel(l, ctx, RECEIPT, RECEIPT_REQ), ["money@src/format/money.ts"]);
    },
  },
  {
    id: "near miss (m184-guard:rx-cap): at most MAX_REEXPORT_SITES barrel sites, in call order",
    run(l, ctx) {
      assert.equal(l.prop.MAX_REEXPORT_SITES, 4);
      const names = ["fa", "fb", "fc", "fd", "fe"];
      const f: Files = {
        "src/app.ts": `import { ${names.join(", ")} } from "./lib/index.ts";\n\nexport function run(x: number): number {\n  return ${names.map((x) => `${x}(x)`).join(" + ")};\n}\n`,
        "src/lib/index.ts": names.map((x) => `export { ${x} } from "./${x}.ts";\n`).join(""),
      };
      for (const x of names) f[`src/lib/${x}.ts`] = fnFile(x);
      assert.deepEqual(barrel(l, ctx, f, RUN), names.slice(0, 4).map((x) => `${x}@src/lib/${x}.ts`));
    },
  },
  // ---- end to end (candidate uid): the real loop with repair-v2 fixes fixture A within the attempt budget
  {
    id: "loop e2e: repair-v2 locates money through the format barrel and fixes it; the row is a valid PASS with editScope in-body",
    needsCand: true,
    run() {
      const m151 = setup151();
      const scratch = mkdtempSync(join(tmpdir(), "peaceai-m184-e2e-"));
      try {
        const ctx = { m151, scratch };
        const test = 'import assert from "node:assert/strict";\nimport { line } from "../src/receipt.ts";\n\ntest("two fifty", () => assert.equal(line("tea", 250), "tea $2.50"));\ntest("ten", () => assert.equal(line("cake", 1000), "cake $10.00"));\ntest("zero", () => assert.equal(line("free", 0), "free $0.00"));\ntest("cents", () => assert.equal(line("gum", 5), "gum $0.05"));\n';
        const task = { ...e2eTask(ctx, `m184-receipt-${Date.now() % 100000}`, RECEIPT, test), request: RECEIPT_REQ };
        const r = loop.runLoopTask(task as never, "public", "a".repeat(64), { ...opts174(ctx, repairProposer({ v2: true }) as unknown as Loop.Proposer, MAX_ATTEMPTS), env: { ...m151.env, [STAGE2_CAND_ENV]: M184_CAND } } as never);
        assert.equal(loopRowProblem(r.row), null, `row valid (${loopRowProblem(r.row)})`);
        if (!m184Cand()) { assert.match(r.row.code, /^CAND_UID_/); return; }
        assert.equal(r.row.code, "PASS", `codes ${JSON.stringify(r.row.attemptCodes)}`);
        assert.equal((r.row as LoopRow).editScope, "in-body");
        assert.ok(r.row.attempts! >= 1 && r.row.attempts! <= MAX_ATTEMPTS, `attempts ${r.row.attempts}`);
      } finally { teardown151(m151); rmSync(scratch, { recursive: true, force: true }); }
    },
  },
];
