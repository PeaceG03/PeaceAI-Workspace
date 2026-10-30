// M143 behavior cases for the code search tools, as data so the mutation test can replay them against each
// mutant of peaceai/lib/codesearch.ts. Each case throws (node:assert) on failure.
import assert from "node:assert/strict";
import type * as CodeSearch from "../lib/codesearch.ts";
import type { Ctx } from "./m143-fixtures.ts";

type Lib = typeof CodeSearch;
export interface Case { id: string; run: (lib: Lib, ctx: Ctx) => void }

const ok = <T extends { ok: boolean }>(r: T | { ok: false; reason: string }): Extract<T, { ok: true }> => {
  assert.equal(r.ok, true, `refused: ${(r as { reason?: string }).reason}`);
  return r as Extract<T, { ok: true }>;
};
const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? "ok" : r.reason);

export const CASES: Case[] = [
  // ------------------------------------------------------------- tree
  {
    id: "tree respects root, nested and negated .gitignore rules and skips .git and symlinks",
    run(lib, ctx) {
      const t = ok(lib.openRepo(ctx.near).tree());
      for (const p of ["keep.log", "src/core.ts", "nested/secret-root.txt", "test/core.test.ts", "dist/core.d.ts", "bin.dat", ".gitignore", "src/.gitignore"]) assert.ok(t.files.includes(p), `listed ${p}`);
      for (const p of [".env", "app.log", "build/core.js", "secret-root.txt", "src/generated-x.ts"]) assert.ok(!t.files.includes(p), `ignored ${p}`);
      assert.ok(!t.files.some((p) => p.startsWith(".git/")), "no .git internals");
      assert.ok(!t.files.some((p) => p.startsWith("link-out") || p === "src/link-file.ts" || p.startsWith("gitlink") || p === "test/.gitignore"), "no symlinks");
      assert.equal(t.symlinksSkipped, 4);
      assert.deepEqual(t.files, [...t.files].sort(), "sorted");
    },
  },
  {
    id: "a symlinked .gitignore pointing outside the root is not read",
    run(lib, ctx) {
      const t = ok(lib.openRepo(ctx.near).tree({ under: "test" }));
      assert.deepEqual(t.files, ["test/barrel.test.ts", "test/core.test.ts", "test/more.test.ts"]);
    },
  },
  {
    id: "tree on the vendored repos lists their real layout",
    run(lib, ctx) {
      const w = ok(lib.openRepo(ctx.isWhat).tree());
      assert.equal(w.files.filter((p) => p.startsWith("src/")).length, 44);
      assert.ok(w.files.includes("test/index.test.ts"));
      const c = ok(lib.openRepo(ctx.cbw).tree());
      assert.deepEqual(c.files, [".gitignore", "LICENSE", "_test.deps.ts", "deno.json", "mod.test.ts", "mod.ts", "utils/string_utils.test.ts", "utils/string_utils.ts"]);
    },
  },
  // ------------------------------------------------------------- confinement
  {
    id: "paths outside the root are refused: absolute, .. traversal, symlink escape, .git internals, ignored files",
    run(lib, ctx) {
      const r = lib.openRepo(ctx.near);
      assert.equal(reason(r.read("/etc/passwd")), "absolute_path");
      assert.equal(reason(r.read(`${ctx.outside}/secret.txt`)), "absolute_path");
      assert.equal(reason(r.read("C:\\Windows\\win.ini")), "absolute_path");
      assert.equal(reason(r.read("../outside/secret.txt")), "path_traversal");
      assert.equal(reason(r.read("src/../../outside/secret.txt")), "path_traversal");
      assert.equal(reason(r.read("src\\..\\..\\outside\\secret.txt")), "path_traversal");
      assert.equal(reason(r.read("link-out/secret.txt")), "outside_root");
      assert.equal(reason(r.read("src/link-file.ts")), "outside_root");
      assert.equal(reason(r.tree({ under: "link-out" })), "outside_root");
      assert.equal(reason(r.grep("SECRET", { under: "link-out" })), "outside_root");
      assert.equal(reason(r.testsFor("src/link-file.ts")), "outside_root");
      assert.equal(reason(r.read(".git/config")), "git_internal");
      assert.equal(reason(r.read("gitlink/config")), "git_internal");
      assert.equal(reason(r.read(".env")), "ignored_or_not_listed");
      assert.equal(reason(r.read("build/core.js")), "ignored_or_not_listed");
      assert.equal(reason(r.read("bin.dat")), "unreadable_or_binary");
      assert.equal(reason(r.read("nope.ts")), "not_found");
      assert.equal(reason(r.read("a\0b")), "bad_path");
    },
  },
  {
    id: "grep never returns text from outside the root, ignored files, binaries or .git",
    run(lib, ctx) {
      const r = lib.openRepo(ctx.near);
      const g = ok(r.grep("SECRET"));
      assert.deepEqual(g.hits, []);
      const p = ok(r.grep("parseCount"));
      const paths = new Set(p.hits.map((h) => h.path));
      for (const bad of ["bin.dat", "build/core.js", "src/generated-x.ts", "src/link-file.ts"]) assert.ok(!paths.has(bad), bad);
      assert.ok(paths.has("src/core.ts") && paths.has("src/notes.ts"));
      assert.deepEqual(ok(r.grep("refs/heads")).hits, []);
    },
  },
  // ------------------------------------------------------------- grep
  {
    id: "grep: literal by default, regex on request, case folding, deterministic order, limits, long lines and ReDoS shapes",
    run(lib, ctx) {
      const r = lib.openRepo(ctx.isWhat);
      const lit = ok(r.grep("isPlainObject(", {}));
      assert.ok(lit.hits.length > 3);
      assert.deepEqual(lit.hits.map((h) => `${h.path}:${h.line}`), [...lit.hits].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line)).map((h) => `${h.path}:${h.line}`));
      const re = ok(r.grep("^export function is(Plain|Any)Object\\b", { regex: true }));
      assert.deepEqual(re.hits.map((h) => h.path), ["src/isAnyObject.ts", "src/isPlainObject.ts"]);
      assert.deepEqual(ok(r.grep("EXPORT FUNCTION ISPLAINOBJECT", { ignoreCase: true })).hits.map((h) => h.path), ["src/isPlainObject.ts"]);
      assert.equal(ok(r.grep("export", { limit: 2 })).hits.length, 2);
      assert.equal(ok(r.grep("export", { limit: 2 })).truncated, true);
      assert.equal(reason(r.grep("(a+)+$", { regex: true })), "regex_nested_quantifier");
      assert.equal(reason(r.grep("([a-z]*)*x", { regex: true })), "regex_nested_quantifier");
      assert.equal(reason(r.grep("(", { regex: true })), "bad_regex");
      assert.deepEqual(ok(lib.openRepo(ctx.near).grep("LONGMARK")).hits, []);
    },
  },
  // ------------------------------------------------------------- symbol
  {
    id: "symbol: a name in a comment, a string or a local is not a definition or a reference",
    run(lib, ctx) {
      const s = ok(lib.openRepo(ctx.near).symbol("parseCount"));
      assert.deepEqual(s.definitions.map((d) => `${d.path}:${d.line}:${d.kind}`), ["dist/core.d.ts:1:function", "src/core.ts:2:function"]);
      const refFiles = new Set(s.references.map((r) => r.path));
      assert.ok(!refFiles.has("src/notes.ts"), "comment / string / template text are not references");
      assert.ok(refFiles.has("test/core.test.ts"));
      assert.ok(!refFiles.has("src/generated-x.ts"));
      const text = ok(lib.openRepo(ctx.near).grep("parseCount"));
      assert.ok(text.hits.some((h) => h.path === "src/notes.ts"), "control: text search does see the comment");
    },
  },
  {
    id: "symbol: imports through a renaming re-export (export { a as b } from) and export * resolve to the definition",
    run(lib, ctx) {
      const r = lib.openRepo(ctx.near);
      const s = ok(r.symbol("parseCount"));
      assert.deepEqual(s.imports.map((i) => `${i.path}:${i.kind}:${i.imported}->${i.definedIn}`), ["src/use-barrel.ts:named:countFrom->src/core.ts", "test/barrel.test.ts:named:countFrom->src/core.ts", "test/core.test.ts:named:parseCount->src/core.ts"]);
      assert.deepEqual(s.reexports.map((e) => `${e.path}:${e.exported}<-${e.local}`), ["src/index.ts:countFrom<-parseCount"]);
      const extra = ok(r.symbol("extra"));
      assert.deepEqual(extra.definitions.map((d) => d.path), ["src/more.ts"]);
    },
  },
  {
    id: "symbol: default vs named imports (a default import under another name counts, a named import of a default-only export does not)",
    run(lib, ctx) {
      const s = ok(lib.openRepo(ctx.near).symbol("TextWriter"));
      assert.deepEqual(s.definitions.map((d) => [d.path, d.kind, d.defaultExport]), [["src/writer.ts", "class", true]]);
      assert.deepEqual(s.imports.map((i) => `${i.path}:${i.kind}:${i.local}`), ["src/use-barrel.ts:named:Writer", "src/use-default.ts:default:W"]);
      assert.ok(!s.imports.some((i) => i.path === "src/use-named-wrong.ts"), "named import of a default-only export is not bound to it");
      assert.deepEqual(s.reexports.map((e) => `${e.path}:${e.exported}<-${e.local}`), ["src/index.ts:Writer<-default"]);
    },
  },
  {
    id: "symbol on code-block-writer: the default-exported class and its default import in the test",
    run(lib, ctx) {
      const s = ok(lib.openRepo(ctx.cbw).symbol("CodeBlockWriter"));
      assert.deepEqual(s.definitions.map((d) => `${d.path}:${d.kind}:${d.defaultExport}`), ["mod.ts:class:true"]);
      assert.deepEqual(s.imports.map((i) => `${i.path}:${i.kind}:${i.specifier}`), ["mod.test.ts:default:./mod.ts"]);
      const u = ok(lib.openRepo(ctx.cbw).symbol("escapeForWithinString"));
      assert.deepEqual(u.definitions.map((d) => d.path), ["utils/string_utils.ts"]);
      assert.deepEqual([...new Set(u.imports.map((i) => i.path))], ["mod.ts", "utils/string_utils.test.ts"]);
    },
  },
  {
    id: "symbol on is-what: the barrel's export { x } from './x.js' re-exports and the test's import through the barrel",
    run(lib, ctx) {
      const s = ok(lib.openRepo(ctx.isWhat).symbol("isPlainObject"));
      assert.deepEqual(s.definitions.map((d) => `${d.path}:${d.line}`), ["src/isPlainObject.ts:9"]);
      assert.deepEqual(s.reexports.map((e) => `${e.path}:${e.line}`), ["src/index.ts:33"]);
      assert.deepEqual([...new Set(s.imports.map((i) => i.path))], ["src/isEmptyObject.ts", "src/isFullObject.ts", "src/isObject.ts", "test/index.test.ts"]);
      const ext = ok(lib.openRepo(ctx.isWhat).symbol("expect"));
      assert.deepEqual(ext.imports.map((i) => `${i.path}:${i.specifier}:${i.definedIn}`), ["test/index.test.ts:vitest:null"], "package imports are reported, unresolved");
      assert.equal(reason(lib.openRepo(ctx.isWhat).symbol("a.b")), "bad_symbol");
    },
  },
  // ------------------------------------------------------------- read
  {
    id: "read: whole file and line ranges, clamped, with totals",
    run(lib, ctx) {
      const r = lib.openRepo(ctx.isWhat);
      const all = ok(r.read("src/getType.ts"));
      assert.equal(all.totalLines, 4);
      assert.equal(all.text.split("\n")[1], "export function getType(payload: unknown): string {");
      const part = ok(r.read("./src/isPlainObject.ts", { start: 9, end: 10 }));
      assert.deepEqual([part.startLine, part.endLine], [9, 10]);
      assert.match(part.text, /^export function isPlainObject/);
      const clamp = ok(r.read("src/isPlainObject.ts", { start: 12, end: 999 }));
      assert.equal(clamp.endLine, clamp.totalLines);
    },
  },
  // ------------------------------------------------------------- testsFor
  {
    id: "testsFor: direct import, import through a re-export, and same-name tests; tests importing something else are not related",
    run(lib, ctx) {
      const r = lib.openRepo(ctx.near);
      const core = ok(r.testsFor("src/core.ts"));
      assert.deepEqual(core.tests.map((t) => [t.path, t.score]), [["test/core.test.ts", 7], ["test/barrel.test.ts", 4]]);
      assert.ok(core.tests[1]!.reasons[0]!.includes("via src/index.ts"));
      const more = ok(r.testsFor("src/more.ts"));
      assert.deepEqual(more.tests.map((t) => [t.path, t.reasons]), [["test/more.test.ts", ["same name"]]]);
      assert.deepEqual(ok(r.testsFor("src/shadow.ts")).tests, []);
    },
  },
  {
    id: "testsFor on the vendored repos: barrel re-export (is-what) and co-located *.test.ts (code-block-writer)",
    run(lib, ctx) {
      const w = ok(lib.openRepo(ctx.isWhat).testsFor("src/isPlainObject.ts"));
      assert.deepEqual(w.tests.map((t) => t.path), ["test/index.test.ts"]);
      const c = ok(lib.openRepo(ctx.cbw).testsFor("utils/string_utils.ts"));
      assert.deepEqual(c.tests.map((t) => t.path), ["utils/string_utils.test.ts", "mod.test.ts"]);
      assert.equal(c.tests[0]!.score > c.tests[1]!.score, true);
    },
  },
  // ------------------------------------------------------------- relevant
  {
    id: "relevant: the defining source file ranks first, above generated .d.ts copies, with tests listed separately",
    run(lib, ctx) {
      const r = ok(lib.openRepo(ctx.near).relevant({ action: "fix", target: "parseCount should reject NaN", doneCheck: "test/core.test.ts passes" }));
      assert.equal(r.files[0]!.path, "src/core.ts");
      const m6 = ok(lib.openRepo(ctx.near).relevant({ action: "change", target: "the class TextWriter" }));
      assert.ok(m6.files[0]!.reasons.includes("M6 target: class TextWriter"), "M6 resolveTargets is one of the signals");
      const dist = r.files.findIndex((f) => f.path === "dist/core.d.ts");
      assert.ok(dist === -1 || dist > r.files.findIndex((f) => f.path === "src/use-barrel.ts"), "generated copy ranks below real importers");
      assert.ok(!r.files.some((f) => lib.isTestPath(f.path)), "no tests among edit candidates");
      assert.equal(r.tests[0]!.path, "test/core.test.ts");
      assert.deepEqual(r.unresolved, []);
    },
  },
  {
    id: "relevant: files the limits name are kept out of the candidates; empty slots are reported",
    run(lib, ctx) {
      const r = ok(lib.openRepo(ctx.near).relevant({ target: "rename `extra` and update the barrel; callers like `TextWriter` must keep working", limits: ["do not change src/index.ts", "keep `TextWriter` as is"] }));
      assert.deepEqual(r.keep.map((k) => k.path), ["src/index.ts", "src/writer.ts"]);
      assert.ok(!r.files.some((f) => f.path === "src/index.ts" || f.path === "src/writer.ts"));
      assert.equal(r.files[0]!.path, "src/more.ts");
      assert.deepEqual(r.unresolved, ["action", "doneCheck"]);
      const none = ok(lib.openRepo(ctx.near).relevant({ action: "add", target: "zzqx frobnicator" }));
      assert.ok(none.unresolved.includes("target"));
    },
  },
  {
    id: "relevant on is-what: a plain-English request finds the defining file",
    run(lib, ctx) {
      const r = ok(lib.openRepo(ctx.isWhat).relevant({ action: "fix", target: "isPlainObject returns true for objects created with Object.create(null)", doneCheck: "the isPlainObject test in test/index.test.ts passes" }));
      assert.equal(r.files[0]!.path, "src/isPlainObject.ts");
      assert.equal(r.tests[0]!.path, "test/index.test.ts");
    },
  },
  {
    id: "relevant on code-block-writer: a request about quote escaping finds the utility and its test",
    run(lib, ctx) {
      const r = ok(lib.openRepo(ctx.cbw).relevant({ action: "fix", target: "escapeForWithinString does not escape backslashes before quotes", doneCheck: "string_utils tests pass" }));
      assert.equal(r.files[0]!.path, "utils/string_utils.ts");
      assert.equal(r.tests[0]!.path, "utils/string_utils.test.ts");
    },
  },
  // ------------------------------------------------------------- runTool
  {
    id: "runTool: one JSON entry point, unknown tools refused, results are plain data",
    run(lib, ctx) {
      const r = lib.openRepo(ctx.cbw);
      const out = lib.runTool(r, "symbol", { name: "CodeBlockWriter" });
      assert.equal(out.schema, "peaceai-codesearch:v1");
      assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
      assert.equal(reason(lib.runTool(r, "write_file", { path: "x" }).result as { ok: boolean; reason?: string }), "unknown_tool");
      assert.deepEqual([...lib.TOOL_NAMES], ["tree", "grep", "symbol", "read", "tests_for", "relevant"]);
      for (const t of lib.TOOL_NAMES) assert.notEqual(reason(lib.runTool(r, t, { path: "mod.ts", name: "x1", pattern: "x", request: "x" }).result as { ok: boolean; reason?: string }), "unknown_tool");
    },
  },
];
