// M56: IMPORT_EDIT v2 proposal (a new kind; v1 unchanged). Evidence replay, acceptance and refusal proofs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { importEditV2Enabled, importEditV2Problem, V2_MAX_NAMES } from "../lib/import-edit-v2.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const EV = JSON.parse(read("peaceai/rules/proposals/m56-import-edit-v2-evidence.json"));
const REC = JSON.parse(read("peaceai/rules/proposals/public-import-edit-v2.json"));
const FILES = new Set(["src/x.ts", "src/lib/x.ts", "y/b.ts", "peaceai/lib/gate.ts"]);
const SRC = 'import { a, b } from "./x";\nimport type { T } from "zod";\nimport path from "node:path";\nimport "./side";\n\nexport const k: T = a + b + path.sep;\n';
const P = (s: string) => importEditV2Problem("src/m.ts", SRC, s, FILES);
let refusals = 0;
const refuse = (r: string | null, msg: string) => { assert.notEqual(r, null, msg); refusals++; };

test("off by default; not approved; v1 untouched", () => {
  assert.equal(importEditV2Enabled({}), false);
  assert.equal(importEditV2Enabled({ PEACEAI_IMPORT_EDIT_V2: "1" }), false);
  assert.equal(importEditV2Enabled({ PEACEAI_IMPORT_EDIT_V2: "true" }), true);
  assert.ok(!read("peaceai/rules/approved.json").includes("public-import-edit-v2"));
  assert.match(REC.status, /^proposal-off/);
  assert.ok(!read("peaceai/lib/learned.ts").includes("import-edit-v2"));
});

test("evidence: licensed external (corpus or example-only list), none from set C, replays, meets the bar", () => {
  const setc = new Set((JSON.parse(read("peaceai/model/heldout-c.json")).sets.C as { repo: string }[]).map((r) => r.repo));
  const lic = new Map([...JSON.parse(read("peaceai/model/ext-corpus.json")).repos, ...JSON.parse(read("peaceai/rules/proposals/m45-example-repos.json")).repos].map((r: { name: string; licenseSha256: string }) => [r.name, r.licenseSha256]));
  const FIX = "peaceai/test/fixtures/m56/";
  const gitBlob = (b: Buffer) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest("hex");
  const fx = (n: string, blob: string) => { assert.match(n, /^[\w.-]+-[0-9a-f]{12}\.(before|after)\.txt$/); const b = readFileSync(join(root, FIX + n)); assert.ok(b.length <= 65536, n); assert.equal(gitBlob(b), blob, `${n}: not the real blob`); return b.toString("utf8"); };
  const xs = EV.examples as { repo: string; commit: string; path: string; licenseSha256: string; origin: string; beforeBlob: string; afterBlob: string; beforeFixture: string; afterFixture: string; repoFiles: string[]; shape: string }[];
  assert.deepEqual(readdirSync(join(root, FIX)).filter((n) => !/\.(before|after)\.txt$/.test(n)), [], "fixtures hold only before/after files (no LICENSE text; license pinned by sha256 in the repo records)");
  const seen = new Set<string>();
  for (const x of xs) {
    assert.ok(!setc.has(x.repo), `${x.repo} is set C`);
    assert.equal(x.licenseSha256, lic.get(x.repo), x.repo);
    assert.equal(x.origin, "external");
    assert.match(x.commit, /^[0-9a-f]{40}$/);
    assert.ok(["single-line", "multi-line"].includes(x.shape));
    assert.ok(!seen.has(x.commit)); seen.add(x.commit);
    assert.equal(importEditV2Problem(x.path, fx(x.beforeFixture, x.beforeBlob), fx(x.afterFixture, x.afterBlob), new Set(x.repoFiles)), null, `${x.repo} ${x.commit}`);
  }
  assert.equal(REC.evidence.examples, xs.length);
  assert.equal(REC.evidence.qualifies, xs.length >= EV.bar);
  assert.equal(EV.bar, 10);
});

test("IMPORT_EDIT v2 accepts names added/removed, type flips, node: toggles and v1 specifier changes", () => {
  const SRC2 = SRC.replace("a + b", "a + b + c");
  assert.equal(importEditV2Problem("src/m.ts", SRC2.replace("{ a, b }", "{ a, b }"), SRC2.replace("{ a, b }", "{ a, b, c }"), FILES), null, "add a used name");
  const S3 = 'import { a, b, z } from "./x";\nexport const k = a + b;\n';
  assert.equal(importEditV2Problem("src/m.ts", S3, S3.replace("{ a, b, z }", "{ a, b }"), FILES), null, "remove an unused name");
  assert.equal(P(SRC.replace('import type { T } from "zod"', 'import { type T } from "zod"')), null, "type modifier moves into the braces");
  assert.equal(P(SRC.replace('"node:path"', '"path"')), null, "node: prefix toggled");
  assert.equal(P(SRC.replace('"./x"', '"./x.ts"')), null, "extension-only change");
  assert.equal(P(SRC.replace('"./x"', '"./lib/x"')), null, "directory move");
  const JSX = 'import { a } from "./x";\nexport const C = () => <div>{a}{b}</div>;\n';
  assert.equal(importEditV2Problem("src/c.tsx", JSX, JSX.replace("{ a }", "{ a, b }"), FILES), null, "M57: .tsx files parse as TSX");
});

test("IMPORT_EDIT v2 refuses everything else", () => {
  const S3 = 'import { a, b, z } from "./x";\nexport const k = a + b;\n';
  const cases: [string, string, string, string][] = [
    ["src/m.ts", SRC, SRC, "no change"],
    ["src/m.ts", SRC, SRC.replace("{ a, b }", "{ b, a }"), "order only"],
    ["src/m.ts", SRC, SRC.replace("{ a, b }", "{a,b}"), "formatting only"],
    ["src/m.ts", SRC, SRC.replace('"zod"', '"zod/v4"'), "bare package swap"],
    ["src/m.ts", SRC, SRC.replace('"zod"', '"valibot"'), "bare package swap 2"],
    ["src/m.ts", SRC, SRC.replace('"./x"', '"lodash"'), "relative -> bare"],
    ["src/m.ts", SRC, SRC.replace('"zod"', '"./zod"'), "bare -> relative"],
    ["src/m.ts", SRC, SRC.replace('"node:path"', '"node:fs"'), "builtin swap"],
    ["src/m.ts", SRC, SRC.replace('"node:path"', '"path-browserify"'), "builtin -> package"],
    ["src/m.ts", SRC, SRC.replace('"./x"', '"./y"'), "different module"],
    ["src/m.ts", SRC, SRC.replace('"./x"', '"./nope/x"'), "does not resolve"],
    ["src/m.ts", SRC, SRC.replace('"./x"', '"../../../../x"'), "climbs too far"],
    ["src/m.ts", 'import { g } from "../peaceai/gate";\nexport const k = g;\n', 'import { g } from "../peaceai/lib/gate";\nexport const k = g;\n', "resolves to protected"],
    ["src/m.ts", SRC, SRC.replace("{ a, b }", "{ a }"), "removed binding still used"],
    ["src/m.ts", SRC, SRC.replace("{ a, b }", "{ a, b, q }"), "added binding unused"],
    ["src/m.ts", SRC, SRC.replace("{ a, b }", "{ a, b, path }"), "added binding already bound"],
    ["src/m.ts", SRC, SRC.replace("{ a, b }", "{ a, b as a }"), "duplicate local"],
    ["src/m.ts", SRC, SRC.replace("{ a, b }", "{ a as b, b as a }"), "swap of names"],
    ["src/m.ts", S3.replace("a + b", "a + b + __proto__"), S3.replace("{ a, b, z }", "{ a, b, z, __proto__ }").replace("a + b", "a + b + __proto__"), "reserved name"],
    ["src/m.ts", S3.replace("a + b", "a + b + constructor"), S3.replace("{ a, b, z }", "{ a, b, z, constructor }").replace("a + b", "a + b + constructor"), "reserved name 2"],
    ["src/m.ts", SRC, SRC.replace("import path from", "import p2 from"), "default binding renamed"],
    ["src/m.ts", SRC, SRC.replace("import path from", "import * as path from"), "default -> namespace"],
    ["src/m.ts", SRC, SRC.replace('import "./side"', 'import { a2 } from "./side"'), "side-effect import gains a clause"],
    ["src/m.ts", SRC, SRC.replace("{ a, b }", "{ a, b }").replace('import type { T } from "zod"', 'import { T } from "zod"').replace("{ a, b }", "{ a }"), "two imports changed"],
    ["src/m.ts", SRC, SRC + "export const z = 1;\n", "code changed"],
    ["src/m.ts", SRC, SRC.replace('import "./side";\n', ""), "import removed"],
    ["src/m.ts", SRC, SRC.replace('import "./side";', 'import "./side";\nimport "./x";'), "import added"],
    ["src/m.ts", SRC, SRC.replace('"zod"', '"zod" with { type: "json" }'), "import attributes"],
    ["src/m.ts", SRC, SRC.replace("{ a, b }", "{ a, b, c } "), "added binding unused (only in a comment)"],
    ["src/m.ts", SRC + "// c\n", SRC.replace("{ a, b }", "{ a, b, c }") + "// c\n", "comment mention is not a use"],
    ["src/m.ts", SRC.replace("a + b", "a + b + c + d + e2 + f + g + h"), SRC.replace("{ a, b }", "{ a, b, c, d, e2, f, g, h }").replace("a + b", "a + b + c + d + e2 + f + g + h"), `more than ${V2_MAX_NAMES} changes`],
    ["src/m.ts", SRC, SRC.replace("{ a, b }", "{ a, b").replace("a + b", "a + b"), "syntax error"],
    ["src/m.js", SRC, SRC.replace('"./x"', '"./x.ts"'), "not a .ts path"],
    ["src/m.d.ts", SRC, SRC.replace('"./x"', '"./x.ts"'), ".d.ts"],
    ["../m.ts", SRC, SRC.replace('"./x"', '"./x.ts"'), "path climbs"],
    ["peaceai/lib/gate.ts", SRC, SRC.replace('"./x"', '"./x.ts"'), "protected path"],
    ["peaceai/lib/import-edit-v2.ts", SRC, SRC.replace('"./x"', '"./x.ts"'), "own engine protected"],
  ];
  for (const [p, a, b, msg] of cases) refuse(importEditV2Problem(p, a, b, FILES), msg);
  refuse(importEditV2Problem("src/m.ts", 'import type T from "zod";\nexport type K = T;\n', 'import T from "zod";\nexport type K = T;\n', FILES), "type-only flip without named bindings");
  assert.equal(refusals, REFUSALS_STATED);
});
const REFUSALS_STATED = 38;

test("engine, spec and this test are protected; spec pinned", () => {
  for (const p of ["peaceai/lib/import-edit-v2.ts", "peaceai/spec/import-edit-v2.md", "peaceai/test/m56-import-edit-v2.test.ts", "peaceai/rules/proposals/m56-import-edit-v2-evidence.json", "peaceai/rules/proposals/public-import-edit-v2.json"])
    assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  assert.equal(createHash("sha256").update(read("peaceai/spec/import-edit-v2.md")).digest("hex"), SPEC_SHA);
});
const SPEC_SHA = "84616d669dc84374df690d351be0d78e722e00011524400f94438a3ce54b23a4";

test("no overlap: no example repo is in the training corpus list or manifest (Architect M60)", () => {
  const corpus = new Set<string>((JSON.parse(read("peaceai/model/ext-corpus.json")).repos as { name: string }[]).map((r) => r.name));
  for (const l of read("peaceai/model/ext-manifest.jsonl").split("\n")) if (l.trim()) { const r = JSON.parse(l).repo; if (r) corpus.add(r); }
  const ex = JSON.parse(read("peaceai/rules/proposals/m56-import-edit-v2-evidence.json")).examples as { repo: string }[];
  for (const x of ex) assert.ok(!corpus.has(x.repo), `${x.repo} is in the training corpus`);
});
