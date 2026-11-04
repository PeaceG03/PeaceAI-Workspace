// M186 behavior cases (batch 21) for repair-v2's default-export localisation (peaceai/lib/editpropose.ts defaultDecl, the
// default binding in relativeImports, and the "default" name in M184's reExportedDecl). As data so m186-mutation.test.ts
// can replay the pure cases against each mutant. Each case throws (node:assert) on failure. Admitted on three unrelated
// module layouts (a default import of `export default <name>`, a named import of a barrel's `export { default as x }`
// over an anonymous default arrow, a default import of a local `export { f as default }` under another local name),
// each a fault in a function the entry calls through a default export, so no site located before M186 holds the fix;
// every condition has a refused near miss; every proposal of the admits is checked against the loop's M175 gate
// (in-body, by M184's admitAt helper). Fixtures are tiny synthetic repos written for these tests from general shapes
// (a bill with a tip, a slider position, a zoom level, small near-miss modules): none is modeled on a dev-split task's
// code or on a reference diff, and none is a PeaceSTOCKS shape. The end-to-end case (needsCand) runs the real loop and
// needs M186_CAND (no fallback user). Spec: peaceai/spec/repair-v2-m186.md.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repairProposer } from "../lib/editpropose.ts"; // the e2e case runs the real (unmutated) proposer
import * as loop from "../lib/loop.ts";
import type * as Loop from "../lib/loop.ts";
import { loopRowProblem, type LoopRow } from "../lib/looprow.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";
import { e2eTask, opts as opts174 } from "./m174-cases.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";
import { admitAt, barrel, sitesOf, type Case, type Check, type Files } from "./m184-cases.ts";

export { setup, teardown, type Ctx, type Case } from "./m184-cases.ts";

const M186_CAND = process.env.M186_CAND ?? "";
export const m186Cand = (): boolean => stage2CandUid({ [STAGE2_CAND_ENV]: M186_CAND }).ok;
const MAX_ATTEMPTS = loop.MAX_ATTEMPTS;
const admit = admitAt(5);

// ---- fixtures (synthetic, general module layouts)
// A: a default import of `export default tip`: the tip divides by the rate instead of multiplying
export const BILL: Files = {
  "src/bill.ts": 'import tip from "./tip.ts";\n\nexport function total(amount: number): number {\n  return amount + tip(amount);\n}\n',
  "src/tip.ts": "const RATE = 0.2;\n\nfunction tip(amount: number): number {\n  return amount / RATE;\n}\n\nexport default tip;\n",
};
export const BILL_REQ = "`total` charges far too much.";
export const BILL_CHECKS: Check[] = [(x) => x.total(100) === 120, (x) => x.total(50) === 60, (x) => x.total(0) === 0, (x) => x.total(10) === 12];
// B: a barrel's `export { default as lerp }` over an anonymous default arrow: the interpolation subtracts the step
const SLIDER: Files = {
  "src/slider.ts": 'import { lerp } from "./math/index.ts";\n\nexport function position(v: number): number {\n  return lerp(0, 100, v / 10);\n}\n',
  "src/math/index.ts": 'export { default as lerp } from "./lerp.ts";\nexport { default as clamp } from "./clamp.ts";\n',
  "src/math/lerp.ts": "export default (a: number, b: number, t: number): number => a - (b - a) * t;\n",
  "src/math/clamp.ts": "export default function clamp(v: number, lo: number, hi: number): number {\n  return Math.min(hi, Math.max(lo, v));\n}\n",
};
const SLIDER_REQ = "`position` moves the wrong way.";
const SLIDER_CHECKS: Check[] = [(x) => x.position(5) === 50, (x) => x.position(0) === 0, (x) => x.position(10) === 100, (x) => x.position(2) === 20];
// C: a local `export { scale as default }`, imported under another name: the zoom divides by the factor
const ZOOM: Files = {
  "src/zoom.ts": 'import grow from "./scale.ts";\n\nexport function zoomIn(size: number): number {\n  return grow(size, 2);\n}\n',
  "src/scale.ts": "function scale(size: number, by: number): number {\n  return size / by;\n}\n\nexport { scale as default };\n",
};
const ZOOM_REQ = "`zoomIn` shrinks instead.";
const ZOOM_CHECKS: Check[] = [(x) => x.zoomIn(3) === 6, (x) => x.zoomIn(0) === 0, (x) => x.zoomIn(5) === 10, (x) => x.zoomIn(1) === 2];

const ADMITS = [[BILL, BILL_REQ], [SLIDER, SLIDER_REQ], [ZOOM, ZOOM_REQ]] as const;
const REQ = "`total` is wrong.";
const TIP_FN = "function tip(amount: number): number {\n  return amount * 0.2;\n}\n";
const user = (imp: string, from = "./tip.ts") => `import ${imp} from "${from}";\n\nexport function total(amount: number): number {\n  return amount + tip(amount);\n}\n`;
const withTip = (tipFile: string, imp = "tip", from = "./tip.ts"): Files => ({ "src/bill.ts": user(imp, from), "src/tip.ts": tipFile });

export const CASES: Case[] = [
  // ---- admits: three unrelated module layouts, each a fault in a function reached through a default export
  admit("admit (a default import of `export default <name>`): total -> tip (src/tip.ts); the rate operator is fixed in the default-exported function", BILL, BILL_REQ, "src/bill.ts", BILL_CHECKS, ["tip@src/tip.ts"], /return amount \* RATE;/),
  admit("admit (a barrel's `export { default as lerp }` over an anonymous default arrow): position -> lerp (src/math/lerp.ts); the step sign is fixed", SLIDER, SLIDER_REQ, "src/slider.ts", SLIDER_CHECKS, ["default@src/math/lerp.ts"], /a \+ \(b - a\) \* t;/),
  admit("admit (a default import of a local `export { scale as default }` under another name): zoomIn -> grow = scale (src/scale.ts); the factor operator is fixed", ZOOM, ZOOM_REQ, "src/zoom.ts", ZOOM_CHECKS, ["scale@src/scale.ts"], /return size \* by;/),
  {
    id: "order and v1: default-export sites are tier 5 after every other site, the earlier sites are unchanged, and repair-v1 locates none",
    run(l, ctx) {
      for (const [files, req] of ADMITS) {
        const sites = sitesOf(l, ctx, files, req);
        const at = sites.findIndex((s) => s.tier === 5);
        assert.ok(at > 0);
        assert.ok(sites.slice(at).every((s) => s.tier === 5));
        const v1 = sitesOf(l, ctx, files, req, l.prop.CALLEE_DEPTH.v1);
        assert.deepEqual(sites.slice(0, v1.length), v1);
        assert.deepEqual(v1.filter((s) => s.tier === 5), []);
      }
    },
  },
  {
    id: "forms: `export default function tip`, `export default tip`, a default arrow and `export { tip as default }` are each followed from a default import",
    run(l, ctx) {
      assert.deepEqual(barrel(l, ctx, withTip("export default " + TIP_FN), REQ), ["tip@src/tip.ts"]);
      assert.deepEqual(barrel(l, ctx, withTip(TIP_FN + "export default tip;\n"), REQ), ["tip@src/tip.ts"]);
      assert.deepEqual(barrel(l, ctx, withTip("export default (amount: number): number => amount * 0.2;\n"), REQ), ["default@src/tip.ts"]);
      assert.deepEqual(barrel(l, ctx, withTip(TIP_FN + "export { tip as default };\n"), REQ), ["tip@src/tip.ts"]);
      assert.deepEqual(barrel(l, ctx, withTip("export default " + TIP_FN, "{ default as tip }"), REQ), ["tip@src/tip.ts"], "a named import of `default`");
    },
  },
  // ---- near misses, one per condition
  {
    id: "near miss (m186-guard:dx-not-named): `export default function tip` is not a named export tip, so a barrel's `export { tip } from` is not followed; `export { default as tip } from` is",
    run(l, ctx) {
      const f = (index: string): Files => ({ "src/bill.ts": user("{ tip }", "./fees/index.ts"), "src/fees/index.ts": index, "src/fees/tip.ts": "export default " + TIP_FN });
      assert.deepEqual(barrel(l, ctx, f('export { tip } from "./tip.ts";\n'), REQ), []);
      assert.deepEqual(barrel(l, ctx, f('export { default as tip } from "./tip.ts";\n'), REQ), ["tip@src/fees/tip.ts"]);
    },
  },
  {
    id: "near miss (m186-guard:dx-star): `export *` never re-exports a default; `export { default } from` does",
    run(l, ctx) {
      const f = (index: string): Files => ({ "src/bill.ts": user("tip", "./fees/index.ts"), "src/fees/index.ts": index, "src/fees/tip.ts": "export default " + TIP_FN });
      assert.deepEqual(barrel(l, ctx, f('export * from "./tip.ts";\n'), REQ), []);
      assert.deepEqual(barrel(l, ctx, f('export { default } from "./tip.ts";\n'), REQ), ["tip@src/fees/tip.ts"]);
    },
  },
  {
    id: "near miss (m186-guard:dx-equals): `export = tip` (CommonJS interop, flag-dependent) is not followed; `export default tip` is",
    run(l, ctx) {
      assert.deepEqual(barrel(l, ctx, withTip(TIP_FN + "export = tip;\n"), REQ), []);
      assert.deepEqual(barrel(l, ctx, withTip(TIP_FN + "export default tip;\n"), REQ), ["tip@src/tip.ts"]);
    },
  },
  {
    id: "near miss (m186-guard:dx-type-only): `export type { tip as default }` exports no value; the value export list does",
    run(l, ctx) {
      assert.deepEqual(barrel(l, ctx, withTip(TIP_FN + "export type { tip as default };\n"), REQ), []);
      assert.deepEqual(barrel(l, ctx, withTip(TIP_FN + "export { tip as default };\n"), REQ), ["tip@src/tip.ts"]);
    },
  },
  {
    id: "near miss (m186-guard:dx-unique): two default claims (broken code) follow neither; one does",
    run(l, ctx) {
      const other = "function fee(amount: number): number {\n  return amount + 1;\n}\n";
      assert.deepEqual(barrel(l, ctx, withTip(TIP_FN + other + "export default tip;\nexport { fee as default };\n"), REQ), []);
      assert.deepEqual(barrel(l, ctx, withTip(TIP_FN + other + "export default tip;\nexport { fee };\n"), REQ), ["tip@src/tip.ts"]);
    },
  },
  {
    id: "limits: a default that is a class, a call result or an imported binding is not a function site; the request naming the function itself adds nothing (rx-known)",
    run(l, ctx) {
      assert.deepEqual(barrel(l, ctx, withTip("export default class Tip {\n  rate = 0.2;\n}\n"), REQ), []);
      assert.deepEqual(barrel(l, ctx, withTip("const make = (r: number) => (a: number) => a * r;\nexport default make(0.2);\n"), REQ), []);
      assert.deepEqual(barrel(l, ctx, { ...withTip('import { pct } from "./pct.ts";\nexport default pct;\n'), "src/pct.ts": "export function pct(a: number): number {\n  return a * 0.2;\n}\n" }, REQ), []);
      assert.deepEqual(barrel(l, ctx, withTip("export default " + TIP_FN), "`total` and `tip` are wrong."), []);
    },
  },
  // ---- end to end (candidate uid): the real loop with repair-v2 fixes fixture A within the attempt budget
  {
    id: "loop e2e: repair-v2 locates tip through the default import and fixes it; the row is a valid PASS with editScope in-body",
    needsCand: true,
    run() {
      const m151 = setup151();
      const scratch = mkdtempSync(join(tmpdir(), "peaceai-m186-e2e-"));
      try {
        const ctx = { m151, scratch };
        const test = 'import assert from "node:assert/strict";\nimport { total } from "../src/bill.ts";\n\ntest("hundred", () => assert.equal(total(100), 120));\ntest("fifty", () => assert.equal(total(50), 60));\ntest("zero", () => assert.equal(total(0), 0));\ntest("ten", () => assert.equal(total(10), 12));\n';
        const task = { ...e2eTask(ctx, `m186-bill-${Date.now() % 100000}`, BILL, test), request: BILL_REQ };
        const r = loop.runLoopTask(task as never, "public", "a".repeat(64), { ...opts174(ctx, repairProposer({ v2: true }) as unknown as Loop.Proposer, MAX_ATTEMPTS), env: { ...m151.env, [STAGE2_CAND_ENV]: M186_CAND } } as never);
        assert.equal(loopRowProblem(r.row), null, `row valid (${loopRowProblem(r.row)})`);
        if (!m186Cand()) { assert.match(r.row.code, /^CAND_UID_/); return; }
        assert.equal(r.row.code, "PASS", `codes ${JSON.stringify(r.row.attemptCodes)}`);
        assert.equal((r.row as LoopRow).editScope, "in-body");
        assert.ok(r.row.attempts! >= 1 && r.row.attempts! <= MAX_ATTEMPTS, `attempts ${r.row.attempts}`);
      } finally { teardown151(m151); rmSync(scratch, { recursive: true, force: true }); }
    },
  },
];
