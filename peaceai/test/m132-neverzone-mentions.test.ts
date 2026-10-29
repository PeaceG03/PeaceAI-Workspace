// M132 (Auditor ruling after #575): a name mention pulls a path into the never-zone only when the mentioning file
// reads, hashes, pins or runs it (as tamper-proof or a scope rule does). A name in a comment, a note or an upstream
// proposal coordinate does not. Every real read / hash / pin / run mention on main still does, and the exact set of
// files the ruling takes out of the never-zone on main is pinned below (a new leaver is a scope change: review it).
// Round 2: the #136 allowlist of files learned rules MAY edit (EDITABLE_PATHS["PeaceG03/PeaceAI-Workspace"] in
// learned-body.ts) is a grant, not a read / hash / pin / run: that mention alone no longer pulls its entries in.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeNeverZone, EDITABLE_ALLOWLIST_FILE, mentionSegments, rawMentionSegments, stage2ZoneRefusal } from "../lib/selfchange.ts";
import { EDITABLE_PATHS } from "../lib/learned-body.ts";

const repo = join(import.meta.dirname, "../..");
const SCRIPT = /(?<![A-Za-z0-9_.\/-])(?:peaceai|builder-log|src)\/[A-Za-z0-9_.\/-]+\.(?:ts|mts|mjs|js|sh)(?![A-Za-z0-9_])/g;
const named = (path: string, text: string) => new Set(mentionSegments(path, text).flatMap((s) => [...s.matchAll(SCRIPT)].map((m) => m[0])));
const ROOT = "peaceai/lib/verdict.ts"; // a NEVER_ZONE file, so whatever it names is scanned

function zoneOf(files: Record<string, string>) {
  return computeNeverZone(Object.keys(files), (p) => files[p] ?? null);
}

test("M132: a prose, note or proposal mention does not pull a file into the never-zone", () => {
  const files: Record<string, string> = {
    [ROOT]: "// see src/a.ts for the shape\n/** Built by peaceai/bin/b.ts (not run here). */\nexport const v = 1; /* src/c.ts */\n",
    ".github/workflows/x.yml": "jobs:\n  a:\n    steps:\n      # later: npx tsx peaceai/bin/d.ts\n      - run: echo ok\n",
    "peaceai/bin/run.sh": "#!/bin/bash\n# peaceai/bin/e.ts used to run here\necho ok\n",
    "peaceai/rules/p.json": JSON.stringify({ note: "derived from src/f.ts", examples: [{ repo: "someone/upstream", module: "src/g.ts", path: "src/h.ts" }] }),
    "src/a.ts": "", "peaceai/bin/b.ts": "", "src/c.ts": "", "peaceai/bin/d.ts": "", "peaceai/bin/e.ts": "", "src/f.ts": "", "src/g.ts": "", "src/h.ts": "",
  };
  const z = zoneOf(files);
  for (const p of ["src/a.ts", "peaceai/bin/b.ts", "src/c.ts", "peaceai/bin/d.ts", "peaceai/bin/e.ts", "src/f.ts", "src/g.ts", "src/h.ts"]) assert.equal(z.why.get(p), undefined, p);
  // the same files under the pre-ruling scan were all pulled in (so the test above is not vacuous)
  const raw = computeNeverZone(Object.keys(files), (p) => files[p] ?? null, rawMentionSegments);
  for (const p of ["src/a.ts", "peaceai/bin/b.ts", "src/c.ts", "peaceai/bin/d.ts", "peaceai/bin/e.ts", "src/f.ts", "src/g.ts", "src/h.ts"]) assert.match(raw.why.get(p) ?? "", /run or named by/, p);
});

test("M132: a read, hash, pin or run mention still pulls the file in (and unclear cases fail closed)", () => {
  const files: Record<string, string> = {
    [ROOT]: '/// <reference path="src/r.ts" />\nimport { readFileSync } from "node:fs";\nexport const t = readFileSync("src/a.ts", "utf8");\nexport const ok = ["src/b.ts"];\nexport const msg = "edit src/c.ts please";\n',
    ".github/workflows/x.yml": "jobs:\n  a:\n    steps:\n      - run: npx tsx peaceai/bin/d.ts # src/q.ts\n",
    "peaceai/bin/run.sh": "#!/bin/bash\nnpx tsx peaceai/bin/e.ts\n",
    "peaceai/rules/pin.json": JSON.stringify({ sets: [{ repo: "PeaceG03/PeaceAI-Workspace", paths: ["src/f.ts"] }, { paths: ["src/g.ts"] }, { repo: "someone/upstream", fixture: "peaceai/test/fixtures/x/h.ts", path: "src/u.ts" }] }),
    "peaceai/rules/bad.json": "{ not json: src/i.ts",
    "peaceai/rules/keys.json": JSON.stringify({ "src/k.ts": "sha" }),
  };
  for (const p of ["src/a.ts", "src/b.ts", "src/c.ts", "src/r.ts", "peaceai/bin/d.ts", "src/q.ts", "peaceai/bin/e.ts", "src/f.ts", "src/g.ts", "peaceai/test/fixtures/x/h.ts", "src/i.ts", "src/k.ts", "src/u.ts"]) files[p] ??= "";
  const z = zoneOf(files);
  for (const p of [
    "src/a.ts", // read
    "src/b.ts", // a scope list (string literal)
    "src/c.ts", // any string literal: we cannot prove it is prose, so it counts
    "src/r.ts", // triple-slash reference: tsc reads it
    "peaceai/bin/d.ts", "src/q.ts", // a run line (a trailing # on a run line is not a full-line comment: counts)
    "peaceai/bin/e.ts", // run by a shell script
    "src/f.ts", "src/g.ts", // pinned in a data file for this repo / with no repo scope
    "peaceai/test/fixtures/x/h.ts", // our own fixture, named inside an upstream record
    "src/i.ts", // unparsable JSON is scanned whole
    "src/k.ts", // JSON keys always count
  ]) assert.match(z.why.get(p) ?? "", /run or named by/, p);
  assert.equal(z.why.get("src/u.ts"), undefined, "control: the upstream record's own src/ path names the upstream file");
});

test("M132: every mention of the 5 src modules on main, classified (Auditor's one line each)", () => {
  const rd = (p: string) => readFileSync(join(repo, p), "utf8");
  // REAL: reads / hashes / pins / runs -> still names the module
  const real: [string, string[]][] = [
    ["peaceai/proof/tamper-proof.ts", ["src/text.ts"]], // reads src/text.ts and rewrites greet in a scratch tree
    ["peaceai/model/heldout.json", ["src/presets.ts", "src/presets.test.ts"]], // held-out paths + contentSha256 pins (lm-corpus.ts excludes them)
  ];
  for (const [f, ps] of real) for (const p of ps) assert.ok(named(f, rd(f)).has(p), `${f} -> ${p}`);
  // PROSE: comments, upstream proposal coordinates -> no longer names it
  const prose: [string, string][] = [
    ["peaceai/lib/fill.ts", "src/config.ts"], ["peaceai/lib/symbols.ts", "src/config.ts"], ["peaceai/lib/taskmap.ts", "src/text.ts"],
    ["peaceai/rules/proposals/m93-test-case-existing-v6-evidence.json", "src/config.ts"], // OrangeproAI/orangepro-mcp's src/config.ts
    ["peaceai/rules/proposals/m113-derive-list-evidence.json", "src/numbers.ts"], // jrmybtlr/usemods's src/numbers.ts
    ["peaceai/lib/learned-body.ts", "src/config.ts"], ["peaceai/lib/learned-body.ts", "src/numbers.ts"], // the #136 allowlist grant
    ["peaceai/lib/learned-body.ts", "src/presets.ts"], ["peaceai/lib/learned-body.ts", "src/status.ts"],
    ["peaceai/lib/nlparse.ts", "peaceai/bin/nl-train.ts"], ["peaceai/proof/m99-derive-mistakes-gen.ts", "peaceai/bin/derive-practice-dedup.ts"],
  ];
  for (const [f, p] of prose) {
    assert.ok([...rd(f).matchAll(SCRIPT)].some((m) => m[0] === p), `${f} really mentions ${p}`);
    assert.ok(!named(f, rd(f)).has(p), `${f} -> ${p} is prose only`);
  }
  // nlparse.ts PHRASINGS names src/config.ts inside a string literal: kept (fail closed), though it is refusal-comment text
  assert.ok(named("peaceai/lib/nlparse.ts", rd("peaceai/lib/nlparse.ts")).has("src/config.ts"));
});

const SETS = JSON.parse(readFileSync(join(repo, "peaceai/test/m132-neverzone-sets.json"), "utf8")) as { before: string[]; after: string[] };

test("M132: the never-zone on main before and after the ruling (exact sets)", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
  const read = (p: string) => { try { return readFileSync(join(repo, p), "utf8"); } catch { return null; } };
  const before = computeNeverZone(tracked, read, rawMentionSegments), after = computeNeverZone(tracked, read);
  // exact sets (m132-neverzone-sets.json, sorted): 412 before, 408 after
  assert.deepEqual([...before.why.keys()].sort(), SETS.before);
  assert.deepEqual([...after.why.keys()].sort(), SETS.after);
  assert.equal(before.why.size, 412);
  assert.equal(after.why.size, 408);
  const left = [...before.why.keys()].filter((p) => !after.why.has(p)).sort();
  assert.deepEqual(left, ["peaceai/bin/derive-practice-dedup.ts", "peaceai/bin/nl-train.ts", "src/numbers.ts", "src/status.ts"]);
  assert.deepEqual([...after.why.keys()].filter((p) => !before.why.has(p)), []);
  assert.deepEqual([...after.shadows].sort(), [...before.shadows].sort());
  for (const p of left) assert.doesNotMatch(stage2ZoneRefusal(p, after) ?? "", /never-zone/, `${p} is out of the never-zone`);
  // leaving the never-zone does not widen stage 2: src/ is still outside its areas (peaceai/**, docs/*.md)
  for (const p of ["src/numbers.ts", "src/status.ts"]) assert.equal(stage2ZoneRefusal(p, after), "outside the stage-2 areas (peaceai/**, docs/*.md)", p);
  for (const p of ["peaceai/bin/derive-practice-dedup.ts", "peaceai/bin/nl-train.ts"]) assert.equal(stage2ZoneRefusal(p, after), null, p);
  // what still holds the src modules, each a real reference
  assert.equal(after.why.get("src/presets.ts"), "never-zone: run or named by peaceai/model/heldout.json"); // content pin
  assert.equal(after.why.get("src/presets.test.ts"), "never-zone: run or named by peaceai/model/heldout.json");
  assert.equal(after.why.get("src/text.ts"), "never-zone: run or named by peaceai/proof/tamper-proof.ts"); // read + rewrite
  // src/config.ts is allowlisted but still reached by the import closure: src/presets.ts (pinned) has
  // `import type { Profile } from "./config"`. The type-only narrowing is a separate ruling; until then it stays.
  assert.equal(after.why.get("src/config.ts"), "never-zone: imported by src/presets.ts");
  assert.match(readFileSync(join(repo, "src/presets.ts"), "utf8"), /^import type \{ Profile \} from "\.\/config";$/m);
});

test("M132 round 2: the real EDITABLE_PATHS allowlist is the only exemption, and it matches learned-body.ts", () => {
  const text = readFileSync(join(repo, EDITABLE_ALLOWLIST_FILE), "utf8");
  const ws = EDITABLE_PATHS["PeaceG03/PeaceAI-Workspace"]!;
  assert.deepEqual([...ws], ["src/config.ts", "src/numbers.ts", "src/presets.ts", "src/status.ts"]);
  const n = named(EDITABLE_ALLOWLIST_FILE, text);
  for (const p of ws) assert.ok(!n.has(p), `${p}: allowlist entry is not a mention`);
  for (const p of EDITABLE_PATHS["PeaceG03/PeaceSTOCKS"]!) assert.ok(n.has(p), `${p}: another repository's entry still counts`);
  // the same file under any other path gets no exemption
  const other = named("peaceai/lib/learned-body-copy.ts", text);
  for (const p of ws) assert.ok(other.has(p), `${p}: exemption is tied to learned-body.ts`);
});

const LB = (allow: string, extra = "") =>
  `export const EDITABLE_PATHS: Readonly<Record<string, readonly string[]>> = {\n  "PeaceG03/PeaceAI-Workspace": [${allow}],\n  "PeaceG03/PeaceSTOCKS": ["src/stocks.ts"],\n};\n${extra}`;
const withLb = (lb: string, more: Record<string, string> = {}) => {
  const files: Record<string, string> = { [ROOT]: 'import "./learned-body.ts";\nexport {};\n', [EDITABLE_ALLOWLIST_FILE]: lb, ...more };
  for (const p of ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/stocks.ts"]) files[p] ??= "export {};\n";
  return zoneOf(files);
};

test("M132 round 2: an allowlisted path with only the allowlist mention leaves", () => {
  const z = withLb(LB('"src/a.ts", "src/b.ts"'));
  assert.match(z.why.get(EDITABLE_ALLOWLIST_FILE) ?? "", /imported by peaceai\/lib\/verdict\.ts/, "learned-body.ts is scanned");
  assert.equal(z.why.get("src/a.ts"), undefined);
  assert.equal(z.why.get("src/b.ts"), undefined);
  // control: the pre-ruling scan pulled them in
  const files: Record<string, string> = { [ROOT]: 'import "./learned-body.ts";\nexport {};\n', [EDITABLE_ALLOWLIST_FILE]: LB('"src/a.ts"'), "src/a.ts": "" };
  assert.match(computeNeverZone(Object.keys(files), (p) => files[p] ?? null, rawMentionSegments).why.get("src/a.ts") ?? "", /run or named by peaceai\/lib\/learned-body\.ts/);
});

test("M132 round 2: an allowlisted path with another real reference stays", () => {
  // read elsewhere in learned-body.ts itself
  assert.match(withLb(LB('"src/a.ts"', 'import { readFileSync } from "node:fs";\nexport const t = readFileSync("src/a.ts", "utf8");\n')).why.get("src/a.ts") ?? "", /run or named by peaceai\/lib\/learned-body\.ts/);
  // named by another never-zone file (a workflow run line)
  assert.match(withLb(LB('"src/a.ts"'), { ".github/workflows/x.yml": "jobs:\n  a:\n    steps:\n      - run: npx tsx src/a.ts\n" }).why.get("src/a.ts") ?? "", /run or named by \.github\/workflows\/x\.yml/);
  // imported by a never-zone file
  assert.match(withLb(LB('"src/a.ts"'), { "peaceai/lib/gate.ts": 'import "../../src/a.ts";\n' }).why.get("src/a.ts") ?? "", /imported by peaceai\/lib\/gate\.ts/);
  // imported by learned-body.ts itself
  assert.match(withLb(LB('"src/a.ts"', 'import "../../src/a.ts";\n')).why.get("src/a.ts") ?? "", /imported by peaceai\/lib\/learned-body\.ts/);
});

test("M132 round 2: a non-allowlisted path named in learned-body.ts is still pulled in (no blanket exemption)", () => {
  const z = withLb(LB('"src/a.ts"', 'export const note = ["src/c.ts"];\n'));
  assert.match(z.why.get("src/c.ts") ?? "", /run or named by peaceai\/lib\/learned-body\.ts/, "any other string literal");
  assert.match(z.why.get("src/stocks.ts") ?? "", /run or named by peaceai\/lib\/learned-body\.ts/, "another repository's allowlist entry");
  // fail closed: a non-literal entry, a duplicate key, or a differently named object exempts nothing
  assert.match(withLb(LB('"src/a.ts", `src/b.ts`')).why.get("src/a.ts") ?? "", /learned-body/, "template element");
  assert.match(withLb(LB('"src/a.ts"').replace('"PeaceG03/PeaceSTOCKS"', '"PeaceG03/PeaceAI-Workspace"')).why.get("src/a.ts") ?? "", /learned-body/, "duplicate key");
  assert.match(withLb(LB('"src/a.ts"').replace("EDITABLE_PATHS", "OTHER_PATHS")).why.get("src/a.ts") ?? "", /learned-body/, "other name");
  // the allowlist shape in any other file is not exempt
  const files: Record<string, string> = { [ROOT]: 'import "./lb2.ts";\nexport {};\n', "peaceai/lib/lb2.ts": LB('"src/d.ts"'), "src/d.ts": "" };
  assert.match(zoneOf(files).why.get("src/d.ts") ?? "", /run or named by peaceai\/lib\/lb2\.ts/);
});
