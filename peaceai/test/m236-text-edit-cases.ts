// Cases for the plain-language repair aim. Fixtures are bakery, shipping, and music code written
// for these tests. None is a practice-set row.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openRepo } from "../lib/codesearch.ts";
import type * as Prop from "../lib/editpropose.ts";

export interface Libs { prop: typeof Prop }
export interface Ctx { base: string }
export interface Case { id: string; run: (l: Libs, ctx: Ctx) => void }

export function setup(): Ctx { return { base: mkdtempSync(join(tmpdir(), "peaceai-m236-")) }; }
export function teardown(ctx: Ctx): void { rmSync(ctx.base, { recursive: true, force: true }); }

let n = 0;
function repo(ctx: Ctx, files: Record<string, string>): ReturnType<typeof openRepo> {
  const d = join(ctx.base, `r${n++}`);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(d, p)), { recursive: true });
    writeFileSync(join(d, p), c);
  }
  return openRepo(d);
}

const DOUGH = "export function foldDough(label: string): string {\n  label.trim();\n  return label;\n}\n";
const KILN = "export function kilnTemp(celsius: number): number {\n  return celsius + 10;\n}\n";
const LANE = "export function quoteLane(miles: number): number {\n  if (miles > 0 && miles < 100) return miles * 2;\n  return miles + 1 - 0;\n}\n";
const STRING = "export function tuneString(note: string): string {\n  note.toLowerCase();\n  return note;\n}\n";

export const CASES: Case[] = [
  { id: "thanks", run(l) { assert.equal(l.prop.editAim("Thanks, handle foldDough"), null); } },
  { id: "question", run(l) { assert.equal(l.prop.editAim("Can you handle foldDough?"), null); } },
  { id: "rename", run(l) { assert.equal(l.prop.editAim("foldDough renamed to kneadDough"), null); } },
  { id: "verb-handle", run(l) { assert.deepEqual(l.prop.editAim("handle foldDough")?.symbols, ["foldDough"]); } },
  { id: "when-cuts", run(l) { assert.deepEqual(l.prop.editAim("fix the parser when input is empty")?.symbols, ["parser"]); } },
  { id: "backtick", run(l) { assert.deepEqual(l.prop.editAim("support the `whisk` bowl")?.symbols, ["whisk"]); } },
  { id: "code-shape", run(l) { assert.deepEqual(l.prop.editAim("support foldDough")?.symbols, ["foldDough"]); } },
  { id: "plain-fallback", run(l) { assert.deepEqual(l.prop.editAim("support whisk")?.symbols, ["whisk"]); } },
  { id: "meta-option", run(l) { assert.equal(l.prop.editAim("add option"), null); } },
  { id: "lead-symbol", run(l) { assert.equal(l.prop.editAim("selected foldDough for the blend"), null); } },
  { id: "no-cue", run(l) { assert.equal(l.prop.editAim("foldDough looks ready"), null); } },
  { id: "lead-only", run(l) { assert.deepEqual(l.prop.editAim("foldDough selected for the kilnTemp schedule")?.symbols, ["foldDough"]); } },
  { id: "plain-with-code", run(l) { assert.deepEqual(l.prop.editAim("handle foldDough tonight")?.symbols, ["foldDough"]); } },
  { id: "add-option-name", run(l) { assert.deepEqual(l.prop.editAim("add option insulated")?.symbols, ["insulated"]); } },
  { id: "fix-when-code", run(l) { assert.deepEqual(l.prop.editAim("fix quoteLane when miles is empty")?.symbols, ["quoteLane"]); } },
  {
    id: "shaped-keep",
    run(l, ctx) {
      const search = repo(ctx, {
        "src/a.ts": "export function foldDough(n: number): number { return n; }\n",
        "src/b.ts": "export function foldDough(n: number): number { return n + 1; }\n",
      });
      assert.deepEqual(l.prop.resolvableSymbols(search, ["foldDough"]), ["foldDough"]);
    },
  },
  {
    id: "plain-unique",
    run(l, ctx) {
      const search = repo(ctx, {
        "src/a.ts": "export function mixer(n: number): number { return n; }\n",
        "src/b.ts": "export function mixer(n: number): number { return n + 1; }\n",
        "src/c.ts": "export function whisk(bowl: string): string { return bowl; }\n",
      });
      assert.deepEqual(l.prop.resolvableSymbols(search, ["mixer"]), []);
      assert.deepEqual(l.prop.resolvableSymbols(search, ["whisk"]), ["whisk"]);
      assert.deepEqual(l.prop.resolvableSymbols(search, ["blender"]), []);
    },
  },
  {
    id: "hide-other",
    run(l, ctx) {
      const search = repo(ctx, { "src/dough.ts": DOUGH, "src/kiln.ts": KILN });
      const aim = l.prop.editAim("foldDough selected for the kilnTemp schedule");
      assert.deepEqual(aim?.symbols, ["foldDough"]);
      const request = l.prop.textRepairRequest("foldDough selected for the kilnTemp schedule", aim!.symbols);
      const sites = l.prop.locate(search, { request, failing: [] }, l.prop.CALLEE_DEPTH.v2);
      assert.ok(sites.some((s) => s.name === "foldDough"));
      assert.equal(sites.some((s) => s.name === "kilnTemp"), false);
    },
  },
  {
    id: "proposer",
    run(l, ctx) {
      const search = repo(ctx, { "src/dough.ts": DOUGH });
      const batches = l.prop.textRepairBatches(search, "handle foldDough");
      assert.ok(batches.length > 0);
      assert.ok(batches.some((edits) => edits.some((e) => e.content.includes("label = label.trim()"))));
    },
  },
  {
    id: "limit",
    run(l, ctx) {
      const search = repo(ctx, { "src/lane.ts": LANE });
      const aim = l.prop.editAim("fix quoteLane when miles is empty");
      assert.ok(aim);
      const many = l.prop.proposeTextEdits(search, l.prop.textRepairRequest("fix quoteLane when miles is empty", aim!.symbols), 8);
      assert.ok(many.length >= 2, `need two repairs to see the cap, got ${many.length}`);
      const one = l.prop.proposeTextEdits(search, l.prop.textRepairRequest("fix quoteLane when miles is empty", aim!.symbols), 1);
      assert.equal(one.length, 1);
    },
  },
  {
    id: "tune",
    run(l, ctx) {
      const search = repo(ctx, { "src/string.ts": STRING });
      const batches = l.prop.textRepairBatches(search, "handle tuneString");
      assert.ok(batches.some((edits) => edits.some((e) => e.content.includes("note = note.toLowerCase()"))));
    },
  },
];
