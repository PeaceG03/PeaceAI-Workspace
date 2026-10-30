// M145: PeaceAI's read-only code search and read tools (peaceai/lib/codesearch.ts) on two vendored MIT repos it was
// never trained on (mesqueeb/is-what, dsherret/code-block-writer) and a synthetic near-miss / escape repo.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as lib from "../lib/codesearch.ts";
import { CASES } from "./m145-codesearch-cases.ts";
import { BUNDLES, BUNDLE_DIR, parseBundle, setup, snapshot, teardown, type Ctx } from "./m145-fixtures.ts";

const root = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

for (const c of CASES) test(`M145: ${c.id}`, () => c.run(lib, ctx));

test("M145: the tools write nothing (every fixture file, size, mtime and hash unchanged after every tool runs)", () => {
  const before = snapshot(ctx.base);
  for (const dir of [ctx.isWhat, ctx.cbw, ctx.near]) {
    const r = lib.openRepo(dir);
    const t = r.tree();
    assert.ok(t.ok);
    for (const p of t.ok ? t.files : []) { r.read(p); r.testsFor(p); }
    r.grep("export");
    r.symbol("default");
    r.relevant({ action: "fix", target: "everything", limits: "nothing", doneCheck: "tests pass" });
  }
  for (const c of CASES) c.run(lib, ctx);
  assert.equal(snapshot(ctx.base), before);
});

test("M145: results are deterministic (two fresh opens give identical JSON)", () => {
  for (const dir of [ctx.isWhat, ctx.cbw, ctx.near]) {
    const run = () => { const r = lib.openRepo(dir); return JSON.stringify([r.tree(), r.grep("export"), r.symbol("isPlainObject"), r.relevant("fix parseCount and isPlainObject")]); };
    assert.equal(run(), run());
  }
});

test("M145: the module only reads (fs reads only, no process, network, eval, dynamic import or require)", () => {
  const src = readFileSync(resolve(root, "peaceai/lib/codesearch.ts"), "utf8");
  const imports = [...src.matchAll(/^import\s+(.*?)\s+from\s+"([^"]+)";$/gm)].map((m) => [m[2], m[1]]);
  assert.deepEqual(imports.map((i) => i[0]), ["node:fs", "node:path", "typescript", "./symbols.ts"]);
  assert.equal(imports[0]![1], "{ readdirSync, readFileSync, realpathSync, statSync }");
  const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  for (const bad of [/\bwrite\w*Sync?\b/i, /\bappend\w*\b/i, /\b(?:mkdir|rmdir|rm|unlink|rename|copyFile|symlink|chmod|chown|utimes|truncate)\w*\(/, /child_process|\bspawn\w*\(|(?<![.\w])exec\w*\(/, /\beval\s*\(|new Function\b|\brequire\s*\(/, /\bimport\s*\(/, /\bfetch\s*\(|node:https?|node:net/, /process\.(?:chdir|env|exit)/, /createProgram|createLanguageService|transpile/]) assert.doesNotMatch(code, bad, String(bad));
});

test("M145: the fixture bundles are verbatim, pinned, MIT, outside the LM training and learned-rule repo sets and the plan-mode task repos", () => {
  const names = readdirSync(BUNDLE_DIR).sort();
  assert.deepEqual(names, [BUNDLES.cbw.file, BUNDLES.isWhat.file].sort());
  const ev = JSON.parse(readFileSync(resolve(root, "peaceai/rules/proposals/m145-search-fixtures-evidence.json"), "utf8")) as { examples: { repo: string; commit: string; fixture: string; files: string[] }[] };
  for (const b of Object.values(BUNDLES)) {
    const parsed = parseBundle(readFileSync(resolve(BUNDLE_DIR, b.file)));
    assert.equal(parsed.repo, b.repo);
    assert.equal(parsed.commit, b.commit);
    assert.ok(parsed.files.some((f) => f.path === "LICENSE" && /^(?:The )?MIT License/.test(f.bytes.toString("utf8"))));
    const e = ev.examples.find((x) => x.repo === b.repo)!;
    assert.equal(e.commit, b.commit);
    assert.deepEqual(e.files, parsed.files.map((f) => f.path));
  }
  const dir = resolve(root, "peaceai/model/ext-manifest");
  const trained = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl")))
    for (const line of readFileSync(resolve(dir, f), "utf8").split("\n")) { const m = /"repo":"([^"]+)"/.exec(line); if (m) trained.add(m[1]!.toLowerCase()); }
  assert.ok(trained.size >= 30, "manifest read");
  for (const b of Object.values(BUNDLES)) assert.ok(!trained.has(b.repo.toLowerCase()), `${b.repo} is in the LM training manifest`);
  // Wider exclusion (the plan-mode rule): no other tracked file names the repo, so it is not in any model/*.json
  // repo list, learned-rule evidence or proposal; and it is none of the plan-mode public task repos.
  for (const b of Object.values(BUNDLES)) {
    const g = spawnSync("git", ["grep", "-il", "-F", "-e", b.repo.split("/")[1]!, "--", ".", ":!peaceai/test/m145-*", ":!peaceai/test/fixtures/m145-search", ":!peaceai/rules/proposals/m145-search-fixtures-evidence.json", ":!THIRD_PARTY_NOTICES"], { cwd: root, encoding: "utf8" });
    assert.equal(g.status, 1, `${b.repo} is named elsewhere in the repo: ${g.stdout}${g.stderr}`); // git grep: 1 = no match
  }
  const planMode = ["valibot", "superstruct", "p-queue", "remeda", "neverthrow", "defu", "destr", "scule", "ohash", "yup", "kysely", "ufo", "mitt", "es-toolkit"];
  for (const b of Object.values(BUNDLES)) assert.ok(!planMode.includes(b.repo.split("/")[1]!.toLowerCase()), `${b.repo} is a plan-mode task repo`);
});
