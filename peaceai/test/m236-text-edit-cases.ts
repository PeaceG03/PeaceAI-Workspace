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
const PARSE = "export function parseDate(text: string): number {\n  return text.length;\n}\n";
const ZONE = "export function zoneId(name: string): string {\n  return name;\n}\n";
const LANE = "export function quoteLane(miles: number): number {\n  if (miles > 0 && miles < 100) return miles * 2;\n  return miles + 1 - 0;\n}\n";
const STRING = "export function tuneString(note: string): string {\n  note.toLowerCase();\n  return note;\n}\n";

export const CASES: Case[] = [
  { id: "thanks", run(l) { assert.equal(l.prop.editAim("Thanks, handle foldDough"), null); } },
  { id: "question", run(l) { assert.equal(l.prop.editAim("Can you handle foldDough?"), null); } },
  { id: "rename", run(l) { assert.equal(l.prop.editAim("handle foldDough renamed to kneadDough"), null); } },
  { id: "verb-handle", run(l) { assert.deepEqual(l.prop.editAim("handle foldDough")?.symbols, ["foldDough"]); } },
  { id: "when-cuts", run(l) { assert.deepEqual(l.prop.editAim("fix the parser when input is empty")?.symbols, ["parser"]); } },
  { id: "if-boundary", run(l) { assert.deepEqual(l.prop.editAim("fix the parser if input is empty")?.symbols, ["parser"]); } },
  { id: "backtick", run(l) { assert.deepEqual(l.prop.editAim("support the `whisk` bowl")?.symbols, ["whisk"]); } },
  { id: "code-shape", run(l) { assert.deepEqual(l.prop.editAim("support foldDough")?.symbols, ["foldDough"]); } },
  { id: "plain-fallback", run(l) { assert.deepEqual(l.prop.editAim("support whisk")?.symbols, ["whisk"]); } },
  { id: "meta-option", run(l) { assert.equal(l.prop.editAim("add option"), null); } },
  { id: "symptom", run(l) { assert.deepEqual(l.prop.editAim("debounce fires twice on the trailing edge")?.symbols, ["debounce"]); } },
  { id: "symptom-subject", run(l) { assert.deepEqual(l.prop.editAim("`parseDate` returns wrong offset for zoneId")?.symbols, ["parseDate"]); } },
  { id: "symptom-throws", run(l) { assert.deepEqual(l.prop.editAim("decodeFrame throws on a short buffer")?.symbols, ["decodeFrame"]); } },
  { id: "symptom-runs", run(l) { assert.deepEqual(l.prop.editAim("useEffect runs twice in Strict Mode")?.symbols, ["useEffect"]); } },
  { id: "symptom-sends", run(l) {
    const got = l.prop.editAim("Server sends duplicate headers when gzip wraps the body");
    assert.deepEqual(got?.symbols, ["Server"]);
    assert.notEqual(got?.symbols.join(""), "ServerSendsDuplicateHeadersGzip");
  } },
  { id: "symptom-run", run(l) { assert.deepEqual(l.prop.editAim("loader run before the build")?.symbols, ["loader"]); } },
  { id: "verb-clause", run(l) { assert.deepEqual(l.prop.editAim("Server sends duplicate headers when gzip wraps the body")?.symbols, ["Server"]); } },
  { id: "fronted-clause", run(l) { assert.deepEqual(l.prop.editAim("When the buffer is short, fix the parser")?.symbols, ["parser"]); } },
  { id: "generic-object", run(l) { assert.equal(l.prop.editAim("Make it faster"), null); } },
  { id: "generic-clearer", run(l) { assert.equal(l.prop.editAim("Make them clearer"), null); } },
  { id: "complement-use", run(l) { assert.deepEqual(l.prop.editAim("Make the retry budget use jitter")?.symbols, ["retryBudget"]); } },
  { id: "complement-return", run(l) { assert.deepEqual(l.prop.editAim("Make the parser return zero")?.symbols, ["parser"]); } },
  { id: "noun-phrase", run(l) { assert.deepEqual(l.prop.editAim("Make the cache eviction respect TTL")?.symbols, ["cacheEviction"]); } },
  { id: "make-object", run(l) { assert.deepEqual(l.prop.editAim("Make the cache eviction respect TTL")?.symbols, ["cacheEviction"]); } },
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
      const search = repo(ctx, { "src/date.ts": PARSE, "src/zone.ts": ZONE });
      const sentence = "`parseDate` returns wrong offset for zoneId";
      const aim = l.prop.editAim(sentence);
      assert.deepEqual(aim?.symbols, ["parseDate"]);
      const request = l.prop.textRepairRequest(sentence, aim!.symbols);
      const sites = l.prop.locate(search, { request, failing: [] }, l.prop.CALLEE_DEPTH.v2);
      assert.ok(sites.some((s) => s.name === "parseDate"));
      assert.equal(sites.some((s) => s.name === "zoneId"), false);
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
    id: "summary-cap",
    run(l, ctx) {
      const search = repo(ctx, { "src/lane.ts": LANE });
      const aim = l.prop.editAim("fix quoteLane when miles is empty");
      assert.ok(aim);
      const open = l.prop.proposeTextEdits(search, l.prop.textRepairRequest("fix quoteLane when miles is empty", aim!.symbols), 8);
      assert.ok(open.length >= 6, `need six repairs to see the summary cap, got ${open.length}`);
      assert.equal(l.prop.textRepairBatches(search, "fix quoteLane when miles is empty", 8).length, 5);
    },
  },
  {
    id: "member-ref",
    run(l) {
      assert.deepEqual(l.prop.editAim("Fix `oven.rack` for a warped pan")?.symbols, ["oven.rack"]);
      assert.deepEqual(l.prop.editAim("Fix oven.class for a warped pan")?.symbols, ["oven.class"]);
    },
  },
  {
    id: "member-ext",
    run(l) { assert.deepEqual(l.prop.editAim("fix quoteLane in src/index.ts")?.symbols, ["quoteLane"]); },
  },
  {
    id: "member-path",
    run(l, ctx) {
      const search = repo(ctx, {
        "src/oven.ts": "export function heatRack(label: string): string {\n  label.trim();\n  return label;\n}\nexport const oven = { rack: heatRack, class: heatRack };\nexport const kiln = Object.assign({}, { shelf: heatRack });\n",
      });
      assert.deepEqual(l.prop.resolvableSymbols(search, ["oven.rack"]), ["heatRack"]);
      assert.deepEqual(l.prop.resolvableSymbols(search, ["oven.class"]), ["heatRack"]);
      assert.deepEqual(l.prop.resolvableSymbols(search, ["kiln.shelf"]), ["heatRack"]);
      assert.deepEqual(l.prop.resolvableSymbols(search, ["oven.missing"]), []);
      assert.deepEqual(l.prop.resolvableSymbols(search, ["pan.rack"]), []);
      const batches = l.prop.textRepairBatches(search, "fix oven.rack for a warped pan");
      assert.ok(batches.some((edits) => edits.some((e) => e.content.includes("label = label.trim()"))));
    },
  },
  {
    id: "dot-call",
    run(l, ctx) {
      const one = repo(ctx, { "src/check.ts": "export function is(value: string): string {\n  value.trim();\n  return value;\n}\n" });
      assert.deepEqual(l.prop.editAim("Fix NaN detection in `.is()`")?.symbols, [".is"]);
      assert.deepEqual(l.prop.resolvableSymbols(one, [".is"]), ["is"]);
      const two = repo(ctx, {
        "src/a.ts": "export function is(value: string): string { return value; }\n",
        "src/b.ts": "export function is(value: string): string { return value; }\n",
      });
      assert.deepEqual(l.prop.resolvableSymbols(two, [".is"]), []);
    },
  },
  {
    id: "shaped-exists",
    run(l, ctx) {
      const search = repo(ctx, { "src/a.ts": "export function foldDough(n: number): number { return n; }\n" });
      assert.deepEqual(l.prop.resolvableSymbols(search, ["proofDough"]), []);
      assert.deepEqual(l.prop.resolvableSymbols(search, ["foldDough"]), ["foldDough"]);
    },
  },
  {
    id: "member-short",
    run(l, ctx) {
      const search = repo(ctx, {
        "src/tags.ts": [
          "export function readTag(label: string): string { label.trim(); return label; }",
          "export const z = { string: readTag };",
          "export function readMark(label: string): string { return label; }",
          "export const _ = { x: readMark };",
          "export function readFlag(label: string): string { return label; }",
          "export const t = { is: readFlag };",
          "export function join(dir: string, name: string): string { return dir + name; }",
        ].join("\n"),
      });
      assert.deepEqual(l.prop.editAim("fix z.string")?.symbols, ["z.string"]);
      assert.deepEqual(l.prop.editAim("fix _.x")?.symbols, ["_.x"]);
      assert.deepEqual(l.prop.editAim("fix t.is")?.symbols, ["t.is"]);
      assert.deepEqual(l.prop.resolvableSymbols(search, ["z.string"]), ["readTag"]);
      assert.deepEqual(l.prop.resolvableSymbols(search, ["_.x"]), ["readMark"]);
      assert.deepEqual(l.prop.resolvableSymbols(search, ["t.is"]), ["readFlag"]);
      assert.deepEqual(l.prop.resolvableSymbols(search, ["path.join"]), []);
      const call = l.prop.editAim("fix path.join(dir, name) for an empty segment");
      assert.ok(!call?.symbols.includes("path.join"));
    },
  },
  {
    id: "verb-inflection",
    run(l) {
      const sentences: [string, string][] = [
        ["fixes the parser", "parser"],
        ["handled foldDough", "foldDough"],
        ["corrected the parser", "parser"],
        ["supported whisk", "whisk"],
        ["added insulated", "insulated"],
        ["implemented the parser", "parser"],
        ["allowed the parser", "parser"],
        ["enabled the parser", "parser"],
        ["exposed the parser", "parser"],
        ["improved the parser", "parser"],
        ["updated the parser", "parser"],
        ["changed the parser", "parser"],
        ["included the parser", "parser"],
        ["accepted the parser", "parser"],
        ["rejected the parser", "parser"],
        ["dropped the parser", "parser"],
        ["removed the parser", "parser"],
        ["wrapped the parser", "parser"],
        ["defaulted the parser", "parser"],
        ["guarded the parser", "parser"],
        ["checked the parser", "parser"],
        ["validated the parser", "parser"],
        ["kept the parser", "parser"],
        ["made the parser return zero", "parser"],
      ];
      for (const [sentence, symbol] of sentences) assert.deepEqual(l.prop.editAim(sentence)?.symbols, [symbol], sentence);
    },
  },
  {
    id: "complement-honor",
    run(l) { assert.deepEqual(l.prop.editAim("Make the cache eviction honor TTL")?.symbols, ["cacheEviction"]); },
  },
  {
    id: "complement-follow",
    run(l) { assert.deepEqual(l.prop.editAim("Make the retry budget follow jitter")?.symbols, ["retryBudget"]); },
  },
  {
    id: "complement-preserve",
    run(l) { assert.deepEqual(l.prop.editAim("Make the parser preserve the offset")?.symbols, ["parser"]); },
  },
  {
    id: "symptom-emits",
    run(l) { assert.deepEqual(l.prop.editAim("socket emits twice")?.symbols, ["socket"]); },
  },
  {
    id: "symptom-yields",
    run(l) { assert.deepEqual(l.prop.editAim("parser yields zero")?.symbols, ["parser"]); },
  },
  {
    id: "symptom-crashes",
    run(l) { assert.deepEqual(l.prop.editAim("decoder crashes on a short buffer")?.symbols, ["decoder"]); },
  },
  {
    id: "symptom-hangs",
    run(l) { assert.deepEqual(l.prop.editAim("loader hangs before the build")?.symbols, ["loader"]); },
  },
  {
    id: "after-boundary",
    run(l) { assert.deepEqual(l.prop.editAim("fix the parser after the buffer fills")?.symbols, ["parser"]); },
  },
  {
    id: "fronted-after",
    run(l) { assert.deepEqual(l.prop.editAim("After the buffer fills, fix the parser")?.symbols, ["parser"]); },
  },
  {
    id: "generic-words",
    run(l) {
      for (const word of ["faster", "clearer", "better", "worse", "slower", "simpler", "easier", "harder", "safer", "cleaner", "smaller", "larger", "stronger", "weaker", "quicker", "nicer", "robust"]) {
        assert.equal(l.prop.editAim(`Make it ${word}`), null, word);
      }
      assert.equal(l.prop.editAim("Make it more robust"), null);
      assert.deepEqual(l.prop.editAim("Make the parser simpler")?.symbols, ["parser"]);
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
