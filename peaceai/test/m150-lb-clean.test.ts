// M150 (limit-breaker step 2): the training-data cleaner. One fixture per rule and a near-miss each rule must keep;
// the split is lossless and cuts only at function / class boundaries; best-code repeats, fill-in-the-middle and the
// difficulty fields; the fingerprint covers the cleaner code version, config and input; the CLI is deterministic,
// refuses without the exclusion file or its hidden-hash half, never names a hash-listed repo, and a mutation check
// shows that removing any filter fails a case. Synthetic names only; no network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as real from "../lib/lbclean.ts";
import { parseExclusions } from "../lib/nlpairs.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const H = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const tsx = join(repo, "node_modules", ".bin", "tsx");
const CFG = JSON.parse(read("peaceai/model/lb-clean.json")) as real.LbConfig;
const SYN = "SynthOwner/Synth-Repo"; // synthetic hash-listed repo (never a real one)
const EXTXT = `# public half\nunjs/defu\n*/fixture-name\n# hidden half (hashes)\nsha256:${H(SYN.toLowerCase())}\n`;
const EX = parseExclusions(Buffer.from(EXTXT)) as Exclude<ReturnType<typeof parseExclusions>, { code: string }>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// fixture code: distinct identifiers per prefix, ~40 lines, normal shape
const block = (p: string, n = 40, from = 0) => Array.from({ length: n }, (_, i) => `export const ${p}V${i + from} = ${p}Compute${i + from}(${p}Alpha${i + from}, ${p}Beta${i + from}) + ${(i + from) * 7};`).join("\n") + "\n";
const fn = (name: string, k: number, body = 6) => `/** ${name} returns a value for ${k}. */\nexport function ${name}(a: number, b: number): number {\n` + Array.from({ length: body }, (_, i) => `  const ${name}T${i} = a * ${k + i} + b - ${i};\n  if (${name}T${i} > ${k * 3 + i}) { return ${name}T${i} - ${k}; }\n`).join("") + `  return [a, b].reduce((s, x) => s + x, ${k});\n}\n`;
type Mod = typeof real;
const doc = (i: number, text: string, man: Partial<real.InDoc["man"]> = {}): real.InDoc => ({ doc: i, text, man: { doc: i, split: "train", repo: "clean/lib", path: `src/f${i}.ts`, function: `fn${i}`, ...man } });
const noFim = (c: real.LbConfig) => { const x = clone(c); x.fim.rate = 0; return x; };

/** The rule case table. Returns the names of failing cases (empty = all pass). Used on the real module and on mutants. */
function runCases(m: Mod): string[] {
  const fails: string[] = [];
  const ok = (name: string, cond: () => boolean) => { try { if (!cond()) fails.push(name); } catch { fails.push(name); } };
  const cfg = noFim(CFG);
  const run = (docs: real.InDoc[], c = cfg, refs: real.TasksetRefs | null = null) => m.clean(docs, c, EX, refs);
  /** the rule that dropped the second doc (the first is a clean control), or "kept" */
  const fate = (text: string, man: Partial<real.InDoc["man"]> = {}, c = cfg, refs: real.TasksetRefs | null = null) => {
    const r = run([doc(0, block("ctl")), doc(1, text, man)], c, refs);
    if (!r.out.some((o) => o.man.src === 0)) return "control_dropped";
    const hit = Object.entries(r.report.drops as Record<string, number>).filter(([, v]) => v > 0);
    return hit.length === 0 ? "kept" : hit.length === 1 && hit[0]![1] === 1 ? hit[0]![0] : "many";
  };
  // task-set exclusion: manifest repo (public name, name-only entry, hash), text (public name, hash-listed name)
  ok("taskset-repo-public", () => fate(block("a"), { repo: "UNJS/Defu" }) === "taskset_repo");
  ok("taskset-repo-name-only", () => fate(block("a"), { repo: "someone/fixture-name" }) === "taskset_repo");
  ok("taskset-repo-hash", () => fate(block("a"), { repo: "synthowner/synth-repo" }) === "taskset_repo" && fate(block("a"), { repo: "SYNTHOWNER/SYNTH-REPO" }) === "taskset_repo");
  ok("taskset-repo-near-miss", () => fate(block("a"), { repo: "synthowner/synth-repo2" }) === "kept" && fate(block("a"), { repo: "unjs/defu-like" }) === "kept");
  ok("taskset-name", () => fate(block("a") + "// port of unjs/defu's merge\n") === "taskset_name");
  ok("taskset-name-near-miss", () => fate(block("a") + "// uses defu() here\n") === "kept");
  ok("taskset-hidden-name", () => fate(block("a") + "// adapted from https://github.com/SynthOwner/Synth-Repo/blob/x.ts\n") === "taskset_hidden_name");
  ok("taskset-hidden-near-miss", () => fate(block("a") + "// synthowner/synth-repository and other/synth-repo\n") === "kept");
  // junk: paths (manifest path and diff file paths)
  for (const p of ["pnpm-lock.yaml", "web/package-lock.json", "yarn.lock", "npm-shrinkwrap.json", "bun.lockb", "x/deps-lock.json", "dist/index.js", "pkg/build/a.ts", "vendor/x.ts", "src/generated/api.ts", "a.min.js", "lib/app.bundle.js", "src/a.js.map", "test/__snapshots__/a.snap"])
    ok(`junk-path ${p}`, () => fate(block("a"), { path: p }) === "junk_path");
  ok("junk-path-in-diff", () => fate(`// peaceai-nl-pair:v1 kind=pr\ndiff --git a/dist/out.js b/dist/out.js\ndeleted file mode 100644\n--- a/dist/out.js\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n` + block("a")) === "junk_path");
  ok("junk-path-in-patch-header", () => fate(`// peaceai-nl-pair:v1 kind=commit\n--- a/src/x.ts\n+++ b/build/x.js\n@@ -1 +1 @@\n-a\n+b\n` + block("a")) === "junk_path");
  ok("junk-path-near-miss", () => ["src/distance.ts", "src/lockfile.ts", "src/build-tools/a.ts", "src/admin.js", "src/outline.ts", "src/vendors-list.ts", "src/minify.ts"].every((p) => fate(block("a"), { path: p }) === "kept"));
  // junk: generated header
  ok("junk-gen-header", () => fate("// Code generated by protoc-gen-ts. DO NOT EDIT.\n" + block("a")) === "junk_generated_header");
  ok("junk-gen-header-block", () => fate("/* eslint-disable */\n/**\n * @generated by a tool\n */\n" + block("a")) === "junk_generated_header");
  ok("junk-gen-header-diff", () => fate(`// peaceai-nl-pair:v1 kind=pr\n/* Request:\nadd api\n*/\n` + block("b") + `diff --git a/src/api.ts b/src/api.ts\n--- /dev/null\n+++ b/src/api.ts\n@@ -0,0 +1,3 @@\n+// This file was automatically generated.\n+export const a = 1;\n`) === "junk_generated_header");
  ok("junk-gen-header-near-miss", () => fate(`const banner = "// @generated by tool"; // emits the header\n` + block("a")) === "kept" && fate(block("a", 30) + "// DO NOT EDIT the list above by hand\n") === "kept");
  // junk: long lines, minified, low alnum, data runs
  ok("junk-long-line", () => fate(block("a") + `// ${"w ".repeat(500)}\n`) === "junk_long_line");
  ok("junk-long-line-near-miss", () => fate(block("a") + `//${"x ".repeat(499)}\n`.slice(0, 1000) + "\n") === "kept");
  const wide = (p: string, w: number) => Array.from({ length: 30 }, (_, i) => `var ${p}${i}=` + Array.from({ length: Math.floor(w / 8) }, (_, j) => `a${j}+b${j}`).join(",") + ";").join("\n") + "\n";
  ok("junk-minified", () => fate(wide("m", 260)) === "junk_minified");
  ok("junk-minified-near-miss", () => fate(wide("m", 150)) === "kept");
  ok("junk-low-alnum", () => fate(Array.from({ length: 30 }, (_, i) => `/* ${"=-".repeat(30)} ${i} */`).join("\n") + "\nexport const x = 1;\n") === "junk_low_alnum");
  ok("junk-low-alnum-near-miss", () => fate(`export const f = (a: number[]) => a.map((x) => (x > 0 ? [x, -x] : [{ y: x }])).flat();\n` + block("a")) === "kept");
  ok("junk-long-token", () => fate(block("a") + `export const blob = "${"QUJD".repeat(51)}";\n`) === "junk_long_token");
  ok("junk-long-token-near-miss", () => fate(block("a") + `export const blob = "${"QUJD".repeat(50)}";\nexport const re = /^(?:${Array.from({ length: 40 }, (_, i) => `kw${i}`).join("|")})$/;\n`) === "kept");
  // exact and near duplicates
  ok("exact-dup", () => fate(block("ctl").replace(/ = /g, "   =   ").replace(/\n/g, "\n\n")) === "exact_dup");
  ok("exact-key-near-miss", () => m.normKey(block("a")) !== m.normKey(block("a").replace("aV3 ", "aV33 ")) && m.normKey("a  b\n c") === m.normKey("a b c"));
  ok("near-dup", () => fate(block("ctl").replace("+ 35;", "+ 36;")) === "near_dup");
  ok("near-dup-near-miss", () => fate(block("ctl", 20) + block("nm", 20, 20)) === "kept");
  ok("near-jaccard-exact", () => { const a = m.shingles(m.tokens("a b c d e f"), 2), b = m.shingles(m.tokens("a b c d e g"), 2); return Math.abs(m.jaccard(a, b) - 4 / 6) < 1e-9; });
  ok("near-threshold", () => { const c = clone(cfg); c.dedup.nearJaccard = 0.99; return fate(block("ctl").replace("+ 35;", "+ 36;"), {}, c) === "kept"; });
  // task-set near duplicates (public task-set repos' code)
  const refSrc = block("task", 60), refs = m.buildRefs([refSrc, "export default 1;\n"], CFG.taskset.shingleTokens);
  ok("taskset-near-dup", () => fate(refSrc.split("\n").slice(10, 45).join("\n") + "\n", {}, cfg, refs) === "taskset_near_dup");
  ok("taskset-near-dup-short-exact", () => fate("export   default 1;", {}, cfg, refs) === "taskset_near_dup");
  // refs from any local tree (unnamed) or a public repo by name; check-only report (counts only)
  ok("refs-any-dir", () => m.LOCAL_TREE_REPO === "local/tree" && m.refsRowOk(m.LOCAL_TREE_REPO, EX));
  ok("refs-public-by-name", () => m.refsRowOk("UNJS/defu", EX));
  ok("refs-near-miss", () => !m.refsRowOk(SYN, EX) && !m.refsRowOk(SYN.toLowerCase(), EX) && !m.refsRowOk("local/tree2", EX) && !m.refsRowOk("Local/Tree", EX) && !m.refsRowOk("other/repo", EX));
  const near35 = refSrc.split("\n").slice(10, 45).join("\n") + "\n";
  ok("report-counts", () => JSON.stringify(m.tasksetReport([near35, block("own"), "export default 1;\n"], refs, CFG.taskset.maxContainment)) === JSON.stringify({ docs: 3, taskset_near_dup: 2 }));
  ok("report-near-miss", () => JSON.stringify(m.tasksetReport([block("own", 40) + refSrc.split("\n")[3] + "\n", "export default 2;\n"], refs, CFG.taskset.maxContainment)) === JSON.stringify({ docs: 2, taskset_near_dup: 0 }) && m.tasksetReport([], refs, 0.5).taskset_near_dup === 0);
  ok("taskset-near-dup-near-miss", () => fate(block("own", 40) + refSrc.split("\n")[3] + "\n", {}, cfg, refs) === "kept" && fate("export default 2;", {}, cfg, refs) === "kept");
  ok("taskset-no-refs-kept", () => fate(refSrc) === "kept");
  // split at function / class boundaries
  const big = `import { x } from "./x";\n\n` + ["alpha", "beta", "gamma", "delta", "eps", "zeta", "eta", "theta"].map((n, i) => fn(n, i + 2, 8)).join("\n") + `\nexport class Box {\n  v = 1;\n  get(): number { return this.v; }\n}\n`;
  const pieces = (t: string, path = "src/big.ts") => m.splitUnits(path, t, CFG.split);
  ok("split-fixture-size", () => big.length > CFG.split.minChars);
  ok("split-pieces", () => { const p = pieces(big); return p.length >= 2 && p.join("") === big && p.every((x) => x.length <= CFG.split.maxChunkChars); });
  ok("split-at-units", () => pieces(big).slice(1).every((x) => /^\s*\/\*\*[^]*?\*\/\s*export (?:function|class) /.test(x) || /^\s*export class /.test(x)));
  ok("split-pieces-parse", () => pieces(big).every((x) => ((ts.createSourceFile("p.ts", x, ts.ScriptTarget.Latest, true) as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).length === 0));
  ok("split-near-miss-small", () => pieces(fn("one", 1)).length === 1);
  ok("split-near-miss-below-min", () => big.length < 1_000_000 && m.splitUnits("src/big.ts", big, { minChars: 1_000_000, maxChunkChars: 200 }).length === 1 && m.splitUnits("src/big.ts", big, { minChars: 1, maxChunkChars: 200 }).length > 2);
  ok("split-near-miss-diff", () => pieces(`diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n` + big).length === 1);
  ok("split-near-miss-one-unit", () => { const one = fn("huge", 3, 60); return one.length > CFG.split.minChars && pieces(one).length === 1; });
  ok("split-in-pass", () => { const r = run([doc(0, big)]); return r.report.splitDocs === 1 && r.out.length >= 2 && r.out.map((o) => o.text).join("") === big && r.out.every((o, i) => o.man.part === i + 1 && o.man.parts === r.out.length && o.man.function === `fn0#p${i + 1}of${r.out.length}`); });
  // best-code repeats
  const bestCfg = clone(cfg); bestCfg.best.paths = [{ repo: "clean/lib", pathPrefix: "src/best/" }]; bestCfg.best.weight = 3;
  ok("best-repeat", () => { const r = run([doc(0, block("bst"), { path: "src/best/a.ts" })], bestCfg); return r.out.length === 3 && r.report.repeats === 2 && r.out.every((o) => o.text === r.out[0]!.text) && r.out[1]!.man.repeatOf === 0 && new Set(r.out.map((o) => o.man.function)).size === 3; });
  ok("best-by-sha", () => { const c = clone(cfg); c.best.textSha256 = [H(block("bst"))]; c.best.weight = 2; return run([doc(0, block("bst"))], c).out.length === 2; });
  ok("best-near-miss", () => run([doc(0, block("bst"), { path: "src/bestish/a.ts" })], bestCfg).out.length === 1 && run([doc(0, block("bst"), { path: "src/best/a.ts", repo: "other/lib" })], bestCfg).out.length === 1);
  ok("best-heldout-not-repeated", () => run([doc(0, block("bst"), { path: "src/best/a.ts", split: "heldout" })], bestCfg).out.length === 1);
  ok("best-cap", () => { const c = clone(bestCfg); c.best.maxDocs = 1; const r = run([doc(0, block("b1"), { path: "src/best/a.ts" }), doc(1, block("b2"), { path: "src/best/b.ts" })], c); return r.report.bestDocs === 1 && r.out.length === 4; });
  // fill-in-the-middle
  const fimCfg = clone(cfg); fimCfg.fim.rate = 1;
  const F = CFG.fim, src = block("fim");
  ok("fim-example", () => { const r = run([doc(0, src)], fimCfg); const f = r.out.find((o) => o.man.fimOf === 0); if (!f || r.report.fim !== 1) return false;
    const t = f.text; const a = t.indexOf(F.prefix), b = t.indexOf(F.suffix), c = t.indexOf(F.middle);
    return a === 0 && b > a && c > b && t.slice(F.prefix.length, b) + t.slice(c + F.middle.length) + t.slice(b + F.suffix.length, c) === src && t.slice(c + F.middle.length).length > 0 && f.man.function === "fn0#fim"; });
  ok("fim-deterministic", () => run([doc(0, src)], fimCfg).out[1]!.text === run([doc(0, src)], fimCfg).out[1]!.text);
  ok("fim-rate-zero", () => run([doc(0, src)], cfg).out.length === 1);
  ok("fim-rate-partial", () => { const c = clone(cfg); c.fim.rate = 0.5; const r = run(Array.from({ length: 40 }, (_, i) => doc(i, block(`r${i}x`))), c); return r.report.fim > 5 && r.report.fim < 35; });
  ok("fim-near-miss-short", () => run([doc(0, "export const a = 1;\n")], fimCfg).report.fim === 0);
  ok("fim-near-miss-short-many-lines", () => { const t = "a;\n".repeat(F.minLines + 4); return t.length < F.minChars && run([doc(0, t)], fimCfg).report.fimSkips.fim_short === 1; });
  ok("fim-near-miss-long-few-lines", () => { const t = `const s = "${"ab ".repeat(F.minChars / 3 + 1)}";\n`; return t.split("\n").length < F.minLines && run([doc(0, t)], fimCfg).report.fimSkips.fim_short === 1; });
  ok("fim-near-miss-sentinel", () => { const r = run([doc(0, src + `// ${F.middle}\n`)], fimCfg); return r.report.fim === 0 && r.report.fimSkips.fim_sentinel_in_text === 1; });
  ok("fim-heldout-none", () => run([doc(0, src, { split: "heldout" })], fimCfg).out.length === 1);
  // difficulty per sample
  const D = (t: string) => m.difficulty(t, CFG.difficulty);
  ok("diff-fields", () => run([doc(0, src)]).out.every((o) => { const d = o.man.difficulty as real.Difficulty; return Number.isInteger(d.score) && d.score >= 0 && d.score <= 100 && ["easy", "medium", "hard"].includes(d.level) && d.chars === src.length; }));
  ok("diff-nesting", () => D("f(a[b({c})]);").nesting === 4 && D("f(a);").nesting === 1);
  ok("diff-nesting-near-miss-string", () => D(`const s = "((((({{{{[[[[";`).nesting === 0 && D("// (((((\nconst a = 1;").nesting === 0);
  ok("diff-identifiers", () => D("const alpha = beta + alpha * gamma;").identifiers === 3 && D("const n = 1 + 2;").identifiers === 1);
  ok("diff-score-order", () => D("const a = 1;").score < D(fn("deep", 4, 20)).score && D(fn("deep", 4, 20)).score < D(fn("deep", 4, 20).replace(/return \[a, b\]/, "return [[[[[[[[[a]]]]]]]], b]")).score);
  ok("diff-level", () => D("const a = 1;").level === "easy");
  // fingerprint
  const parts = (): real.FingerprintParts => ({ cleanerVersion: m.LB_CLEAN_VERSION, codeSha256: { "peaceai/lib/lbclean.ts": "a".repeat(64) }, typescriptVersion: "5.9.3", configSha256: "b".repeat(64), exclusionsSha256: "c".repeat(64), input: { docsSha256: "d".repeat(64), manifestSha256: "e".repeat(64) }, refs: null });
  ok("fp-stable", () => m.fingerprintOf(parts()) === m.fingerprintOf(parts()) && /^[0-9a-f]{64}$/.test(m.fingerprintOf(parts())));
  ok("fp-covers-each-part", () => { const base = m.fingerprintOf(parts());
    const muts: ((p: real.FingerprintParts) => void)[] = [(p) => { p.codeSha256["peaceai/lib/lbclean.ts"] = "f".repeat(64); }, (p) => { p.configSha256 = "f".repeat(64); }, (p) => { p.input.manifestSha256 = "f".repeat(64); },
      (p) => { p.input.docsSha256 = "f".repeat(64); }, (p) => { p.exclusionsSha256 = "f".repeat(64); }, (p) => { p.refs = { docsSha256: "1".repeat(64), manifestSha256: "2".repeat(64) }; }, (p) => { p.typescriptVersion = "5.9.4"; }];
    return muts.every((f) => { const p = parts(); f(p); return m.fingerprintOf(p) !== base; }); });
  ok("fp-key-order-free", () => { const p = parts(), q = { refs: p.refs, input: { manifestSha256: p.input.manifestSha256, docsSha256: p.input.docsSha256 }, exclusionsSha256: p.exclusionsSha256, configSha256: p.configSha256, typescriptVersion: p.typescriptVersion, codeSha256: p.codeSha256, cleanerVersion: p.cleanerVersion }; return m.fingerprintOf(p) === m.fingerprintOf(q); });
  ok("fp-version-required", () => { for (const v of ["", "peaceai-lb-clean:v0"]) { try { m.fingerprintOf({ ...parts(), cleanerVersion: v }); return false; } catch { /* refused */ } } return true; });
  ok("fp-code-required", () => { try { m.fingerprintOf({ ...parts(), codeSha256: {} }); return false; } catch { return true; } });
  // config
  const probs = (f: (c: any) => void) => { const c = clone(CFG) as any; f(c); return m.configProblems(c); };
  ok("cfg-ok", () => probs(() => {}).length === 0);
  ok("cfg-schema", () => probs((c) => { c.schema = "x"; }).includes("config_schema"));
  ok("cfg-bands", () => probs((c) => { c.dedup.bands = 7; }).includes("config_dedup") && probs((c) => { c.dedup.nearJaccard = 0.3; }).includes("config_dedup"));
  ok("cfg-best", () => probs((c) => { c.best.weight = 0; }).includes("config_best") && probs((c) => { c.best.weight = 9; }).includes("config_best") && probs((c) => { c.best.textSha256 = ["zz"]; }).includes("config_best"));
  ok("cfg-best-cap", () => probs((c) => { c.best.maxDocs = 1; c.best.textSha256 = ["a".repeat(64), "b".repeat(64)]; }).includes("config_best_over_cap"));
  ok("cfg-fim", () => probs((c) => { c.fim.middle = c.fim.prefix; }).includes("config_fim") && probs((c) => { c.fim.rate = 1.5; }).includes("config_fim"));
  ok("cfg-junk", () => probs((c) => { c.junk.minAlnumRatio = -1; }).includes("config_junk"));
  // determinism and counts of the pass
  ok("pass-deterministic", () => { const ds = [doc(2, block("q")), doc(0, block("p")), doc(1, block("p"))]; return JSON.stringify(run(ds, fimCfg)) === JSON.stringify(run([...ds].reverse(), fimCfg)); });
  ok("pass-ids", () => { const r = run([doc(5, block("p")), doc(9, block("q"))], fimCfg); return r.out.every((o, i) => o.man.doc === i && o.man.textSha256 === H(o.text)) && r.report.docsOut === r.out.length; });
  ok("pass-unique-keys", () => { const r = run([doc(0, big, { path: "src/best/a.ts" }), doc(1, src)], (() => { const c = clone(bestCfg); c.fim.rate = 1; return c; })());
    return new Set(r.out.map((o) => `${o.man.repo}\0${o.man.path}\0${o.man.function}`)).size === r.out.length; });
  return fails;
}

test("m150: the rule case table passes on the real module", () => {
  assert.deepEqual(runCases(real), []);
});

test("m150: mutation check: removing any filter or transform fails at least one case", async () => {
  const src = read("peaceai/lib/lbclean.ts");
  const lib = pathToFileURL(join(repo, "peaceai", "lib")).href;
  const tsUrl = pathToFileURL(createRequire(import.meta.url).resolve("typescript")).href;
  const fixed = src.replace(/from "\.\/([\w.-]+)"/g, (_, f) => `from "${lib}/${f}"`).replace(`from "typescript"`, `from "${tsUrl}"`);
  const mutants: [string, string, string][] = [
    ["task-set repo not checked", `if (isExcludedRepo(repo, ex)) return "taskset_repo";`, ``],
    ["task-set name not checked", `if (mentionsExcluded(text, ex)) return "taskset_name";`, ``],
    ["hash-listed name not checked", `if (namesHashedRepo(text, ex)) return "taskset_hidden_name";`, ``],
    ["lockfile names kept", `(?:package-lock\\.json|npm-shrinkwrap\\.json|yarn\\.lock|pnpm-lock\\.ya?ml|bun\\.lockb?|deno\\.lock|composer\\.lock|cargo\\.lock|gemfile\\.lock|poetry\\.lock)$|`, `(?:never-a-lockfile)$|`],
    ["lockfiles kept (suffix forms)", `|\\.lock$|-lock\\.(?:json|ya?ml)$/i`, `|\\.lock-never$/i`],
    ["build dirs kept", `/(?:^|\\/)(?:dist|build|out|bundle|`, `/(?:^|\\/)(?:never-dir|`],
    ["minified / bundle files kept", `/\\.(?:min|bundle|umd|prod|production)\\.[cm]?js$|\\.(?:map|snap)$/i`, `/$^/`],
    ["junk path rule off", `if (docPaths(path, text).some((p) => JUNK_PATH.some((r) => r.test(p)))) return "junk_path";`, ``],
    ["patch header paths not read", `for (const m of text.matchAll(/^\\+\\+\\+ b\\/(\\S+)$/gm)) out.add(m[1]!);`, ``],
    ["diff paths not read", `for (const m of text.matchAll(/^diff --git a\\/(\\S+) b\\/(\\S+)$/gm)) { out.add(m[1]!); out.add(m[2]!); }`, ``],
    ["generated header off", `if (/^(?:\\/\\/|\\/\\*|\\*|#)/.test(l) && GENERATED.test(l)) return true;`, ``],
    ["generated header anywhere on a line", `if (/^(?:\\/\\/|\\/\\*|\\*|#)/.test(l) && GENERATED.test(l))`, `if (GENERATED.test(l))`],
    ["generated header only at doc start", `lines.forEach((l, i) => { if (l.startsWith("diff --git ")) starts.push(i + 1); });`, ``],
    ["generated header rule off", `if (generatedHeader(text, j.headerLines)) return "junk_generated_header";`, ``],
    ["long lines kept", `if (lines.some((l) => l.length > j.maxLineChars)) return "junk_long_line";`, ``],
    ["long line off by one", `l.length > j.maxLineChars`, `l.length >= j.maxLineChars`],
    ["minified kept", `if (text.length / lines.length > j.maxMeanLineChars) return "junk_minified";`, ``],
    ["low alnum kept", `if (vis.length > 0 && alnum / vis.length < j.minAlnumRatio) return "junk_low_alnum";`, ``],
    ["data runs kept", `if (new RegExp(\`[A-Za-z0-9+/=]{\${j.maxTokenChars + 1},}\`).test(text)) return "junk_long_token";`, ``],
    ["any long token dropped", `if (new RegExp(\`[A-Za-z0-9+/=]{\${j.maxTokenChars + 1},}\`).test(text))`, `if (text.split(/\\s+/).some((w) => w.length > j.maxTokenChars))`],
    ["near duplicates kept", `for (const i of [...cand].sort((a, b) => a - b)) if (jaccard(sh, this.sets[i]!) >= this.cfg.nearJaccard) return i;`, ``],
    ["near threshold ignored", `if (jaccard(sh, this.sets[i]!) >= this.cfg.nearJaccard) return i;`, `return i;`],
    ["exact duplicates kept", `if (seen.has(key)) { drops.exact_dup!++; return; }`, ``],
    ["task-set near duplicates kept", `if (refs && tasksetContainment(text, refs) >= cfg.taskset.maxContainment) { drops.taskset_near_dup!++; return; }`, ``],
    ["local tree refs refused", `if (repo === LOCAL_TREE_REPO) return true;`, ``],
    ["any refs repo accepted", `return ex.repos.has(repo.toLowerCase());`, `return true;`],
    ["report-only counts nothing", `for (const t of texts) if (tasksetContainment(t, refs) >= maxContainment) hits++;`, ``],
    ["report-only threshold ignored", `if (tasksetContainment(t, refs) >= maxContainment) hits++;`, `hits++;`],
    ["task-set short exact copies kept", `if (refs.exact.has(sha256(tt.join(" ")))) return 1;`, ``],
    ["no split", `if (bounds[i + 1]! - start > s.maxChunkChars && bounds[i]! > start) { out.push(text.slice(start, bounds[i])); start = bounds[i]!; }`, ``],
    ["split ignores minChars", `if (text.length < s.minChars) return [text];`, ``],
    ["split of unparsable text", `if (!parseOk(sf)) return [text];`, ``],
    ["no best repeats", `if (best) for (let r = 2; r <= cfg.best.weight; r++) { out.push({ text, man: { ...man, function: \`\${base}#rep\${r}\`, repeatOf: d.doc, best: true } }); repeats++; }`, ``],
    ["fim on short text", `if (text.length < f.minChars) return { skip: "fim_short" };`, ``],
    ["fim rate ignored", `if (u32(h, 0) / 0x100000000 >= f.rate) return { skip: "fim_not_selected" };`, ``],
    ["fim sentinel collision kept", `if ([f.prefix, f.suffix, f.middle].some((s) => text.includes(s))) return { skip: "fim_sentinel_in_text" };`, ``],
    ["identifiers not counted", `ids.add(sc.getTokenText());`, `void 0;`],
    ["nesting not measured", `nesting = Math.max(nesting, ++depth);`, `++depth;`],
    ["score ignores nesting", `0.3 * f(nesting, c.capNesting)`, `0`],
    ["fingerprint without code version", `if (!p.cleanerVersion || p.cleanerVersion !== LB_CLEAN_VERSION) throw new Error("fingerprint_cleaner_version");`, ``],
    ["fingerprint ignores its parts", `return sha256(JSON.stringify(canon({ schema: LB_FINGERPRINT_SCHEMA, ...p })));`, `return sha256(LB_FINGERPRINT_SCHEMA);`],
  ];
  // every guard tagged m150-guard:<name> in the lib has a mutant on its line
  const tagged = src.split("\n").filter((l) => /\/\/ m150-guard:[\w-]+/.test(l));
  assert.ok(tagged.length >= 25, String(tagged.length));
  for (const l of tagged) assert.ok(mutants.some(([, from]) => l.includes(from.trim())), `untested guard: ${/m150-guard:([\w-]+)/.exec(l)![1]}`);
  const dir = mkdtempSync(join(tmpdir(), "m150-mut-"));
  try {
    for (const [name, from, to] of mutants) {
      assert.ok(fixed.includes(from), `mutant site not found: ${name}`);
      const f = join(dir, `${H(name).slice(0, 12)}.ts`);
      writeFileSync(f, fixed.replace(from, to));
      const mod = (await import(pathToFileURL(f).href)) as Mod;
      assert.ok(runCases(mod).length > 0, `mutant survived: ${name}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("m150: the committed config is valid and the committed exclusion file carries the hidden-hash half", () => {
  assert.deepEqual(real.configProblems(CFG), []);
  const cx = parseExclusions(readFileSync(join(repo, "peaceai/model/nl-pairs-exclusions-hidden-hashes.txt")));
  assert.ok("hashes" in cx && cx.hashes.size === 15 && cx.repos.has("unjs/defu"));
  assert.deepEqual([...real.DROP_RULES].sort(), ["exact_dup", "junk_generated_header", "junk_long_line", "junk_long_token", "junk_low_alnum", "junk_minified", "junk_path", "near_dup", "taskset_hidden_name", "taskset_name", "taskset_near_dup", "taskset_repo"]);
});

test("m150: the CLI is deterministic, writes the fingerprint with the output, and refuses fail-closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "m150-cli-"));
  try {
    const run = (...a: string[]) => spawnSync(tsx, [join(repo, "peaceai/bin/lb-clean.ts"), ...a], { cwd: repo, encoding: "utf8" });
    const corpus = (d: string, rows: { text: string; repo: string; path: string; split?: string }[]) => {
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "docs.jsonl"), rows.map((r, i) => JSON.stringify({ doc: i, text: r.text }) + "\n").join(""));
      writeFileSync(join(d, "manifest.jsonl"), rows.map((r, i) => JSON.stringify({ doc: i, split: r.split ?? "train", repo: r.repo, path: r.path, function: `f${i}` }) + "\n").join(""));
    };
    const task = block("task", 60);
    corpus(join(dir, "in"), [
      { text: block("keep1"), repo: "clean/a", path: "src/a.ts" },
      { text: block("keep1").replace("+ 35;", "+ 36;"), repo: "clean/a", path: "src/b.ts" }, // near_dup
      { text: block("keep1"), repo: "clean/b", path: "src/c.ts" }, // exact_dup
      { text: block("hid"), repo: SYN, path: "src/d.ts" }, // taskset_repo (hash)
      { text: block("hn") + `// from ${SYN.toLowerCase()}\n`, repo: "clean/a", path: "src/e.ts" }, // taskset_hidden_name
      { text: block("pub") + "// see unjs/defu\n", repo: "clean/a", path: "src/f.ts" }, // taskset_name
      { text: block("lock"), repo: "clean/a", path: "pnpm-lock.yaml" }, // junk_path
      { text: task.split("\n").slice(5, 40).join("\n") + "\n", repo: "clean/a", path: "src/g.ts" }, // taskset_near_dup
      { text: block("keep2"), repo: "clean/a", path: "src/h.ts", split: "heldout" },
    ]);
    corpus(join(dir, "refs"), [{ text: task, repo: "unjs/defu", path: "src/defu.ts" }]);
    writeFileSync(join(dir, "ex.txt"), EXTXT);
    const args = (out: string, ...more: string[]) => ["--in", join(dir, "in"), "--out", join(dir, out), "--exclusions", join(dir, "ex.txt"), "--refs", join(dir, "refs"), ...more];
    let r = run(...args("o1"));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^lb-clean docsIn=9 .*drops=taskset_repo:1,taskset_name:1,taskset_hidden_name:1,junk_path:1,junk_generated_header:0,junk_long_line:0,junk_minified:0,junk_low_alnum:0,junk_long_token:0,taskset_near_dup:1,exact_dup:1,near_dup:1 fingerprint=[0-9a-f]{64}$/m);
    assert.ok(!r.stdout.toLowerCase().includes(SYN.toLowerCase()) && !r.stdout.includes(H(SYN.toLowerCase())), "a hash-listed repo is never named");
    assert.equal(run(...args("o2")).status, 0);
    for (const f of ["docs.jsonl", "manifest.jsonl", "clean-report.json", "fingerprint.json"]) assert.equal(H(readFileSync(join(dir, "o1", f))), H(readFileSync(join(dir, "o2", f))), `deterministic ${f}`);
    const fp = JSON.parse(readFileSync(join(dir, "o1", "fingerprint.json"), "utf8"));
    assert.equal(fp.fingerprint, real.fingerprintOf(fp.parts));
    assert.equal(fp.parts.cleanerVersion, real.LB_CLEAN_VERSION);
    assert.equal(fp.parts.codeSha256["peaceai/lib/lbclean.ts"], H(readFileSync(join(repo, "peaceai/lib/lbclean.ts"))));
    assert.equal(fp.parts.configSha256, H(readFileSync(join(repo, "peaceai/model/lb-clean.json"))));
    assert.equal(fp.parts.input.manifestSha256, H(readFileSync(join(dir, "in", "manifest.jsonl"))));
    assert.equal(fp.outManifestSha256, H(readFileSync(join(dir, "o1", "manifest.jsonl"))));
    assert.equal(JSON.parse(readFileSync(join(dir, "o1", "clean-report.json"), "utf8")).fingerprint, fp.fingerprint);
    const man = readFileSync(join(dir, "o1", "manifest.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(man.filter((x) => !x.fimOf && x.fimOf !== 0).map((x) => x.src), [0, 8]);
    assert.ok(man.every((x) => x.difficulty && typeof x.difficulty.score === "number"));
    const refused = (code: RegExp, ...a: string[]) => { const x = run(...a); assert.equal(x.status, 1, x.stdout); assert.match(x.stdout, code); };
    // --build-refs --tree: any local directory, nothing named in the refs corpus or the output
    const tree = join(dir, "secret-checkout-zq"); mkdirSync(join(tree, "srcdirq"), { recursive: true }); mkdirSync(join(tree, "node_modules"), { recursive: true });
    writeFileSync(join(tree, "srcdirq", "hiddenfileq.ts"), task); writeFileSync(join(tree, "README.md"), "x"); writeFileSync(join(tree, "node_modules", "dep.ts"), block("dep"));
    r = run("--build-refs", "--tree", tree, "--out", join(dir, "trefs"), "--exclusions", join(dir, "ex.txt"));
    assert.equal(r.status, 0, r.stdout); assert.equal(r.stdout, "lb-clean refs files=1 trees=1\n");
    const tman = readFileSync(join(dir, "trefs", "manifest.jsonl"), "utf8");
    assert.deepEqual(JSON.parse(tman), { doc: 0, split: "train", repo: "local/tree", path: "t0/f0", function: "tree:0" });
    assert.ok(!/secret-checkout|srcdirq|hiddenfileq/.test(tman + r.stdout), "no dir or file name is written");
    refused(/^lb-clean refused: tree_missing$/m, "--build-refs", "--tree", join(dir, "nope"), "--out", join(dir, "trefs2"), "--exclusions", join(dir, "ex.txt"));
    refused(/^lb-clean refused: usage$/m, "--build-refs", "--tree", tree, "--tasks", join(dir, "x.json"), "--out", join(dir, "trefs2"), "--exclusions", join(dir, "ex.txt"));
    // tree refs are usable by the cleaner and give the same drop as the named refs
    r = run("--in", join(dir, "in"), "--exclusions", join(dir, "ex.txt"), "--refs", join(dir, "trefs"), "--dry-run");
    assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /taskset_near_dup:1,/);
    // --report-only: counts only, writes nothing, exit 2 with a fixed code when the count is above 0
    const listing = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? listing(join(d, e.name)).map((x) => `${e.name}/${x}`) : [`${e.name}:${H(readFileSync(join(d, e.name)))}`]).sort();
    const snap = listing(dir);
    r = run("--in", join(dir, "o1"), "--refs", join(dir, "trefs"), "--report-only", "--exclusions", join(dir, "ex.txt"));
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /^lb-clean report-only docs=\d+ refFiles=1 taskset_near_dup=0\n$/);
    r = run("--in", join(dir, "in"), "--refs", join(dir, "refs"), "--report-only", "--exclusions", join(dir, "ex.txt"));
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(r.stdout, "lb-clean report-only docs=9 refFiles=1 taskset_near_dup=1\nlb-clean report-only: taskset_near_dup_found\n");
    assert.equal(r.stderr, "");
    assert.deepEqual(listing(dir), snap, "report-only writes nothing");
    refused(/^lb-clean refused: usage$/m, "--in", join(dir, "in"), "--refs", join(dir, "refs"), "--report-only", "--out", join(dir, "o5"), "--exclusions", join(dir, "ex.txt"));
    refused(/^lb-clean refused: usage$/m, "--in", join(dir, "in"), "--report-only", "--exclusions", join(dir, "ex.txt"));
    refused(/^lb-clean refused: usage$/m, "--in", join(dir, "in"), "--refs", join(dir, "refs"), "--report-only", "--dry-run", "--exclusions", join(dir, "ex.txt"));
    assert.throws(() => readFileSync(join(dir, "o5", "docs.jsonl")));
    // a config change changes the fingerprint; dry run writes nothing
    const c2 = clone(CFG); c2.fim.rate = 0.5; writeFileSync(join(dir, "c2.json"), JSON.stringify(c2));
    r = run(...args("o3", "--config", join(dir, "c2.json"), "--dry-run"));
    assert.equal(r.status, 0); assert.match(r.stdout, /^lb-clean dry-run /m);
    assert.notEqual(/fingerprint=([0-9a-f]{64})/.exec(r.stdout)![1], fp.fingerprint);
    assert.throws(() => readFileSync(join(dir, "o3", "docs.jsonl")));
    // refusals
    refused(/^lb-clean refused: exclusions_missing$/m, "--in", join(dir, "in"), "--out", join(dir, "o4"));
    refused(/^lb-clean refused: exclusions_missing$/m, "--in", join(dir, "in"), "--out", join(dir, "o4"), "--exclusions", join(dir, "nope.txt"));
    writeFileSync(join(dir, "pub-only.txt"), "unjs/defu\n");
    refused(/^lb-clean refused: exclusions_no_hidden_hashes$/m, "--in", join(dir, "in"), "--out", join(dir, "o4"), "--exclusions", join(dir, "pub-only.txt"));
    writeFileSync(join(dir, "bad.txt"), `sha256:${H("x").slice(1)}\n`);
    refused(/^lb-clean refused: exclusions_bad_line$/m, "--in", join(dir, "in"), "--out", join(dir, "o4"), "--exclusions", join(dir, "bad.txt"));
    corpus(join(dir, "refs-bad"), [{ text: task, repo: SYN, path: "src/x.ts" }]);
    refused(/^lb-clean refused: refs_repo_not_public_by_name$/m, "--in", join(dir, "in"), "--out", join(dir, "o4"), "--exclusions", join(dir, "ex.txt"), "--refs", join(dir, "refs-bad"));
    const c3 = clone(CFG) as any; c3.dedup.bands = 7; writeFileSync(join(dir, "c3.json"), JSON.stringify(c3));
    refused(/^lb-clean refused: config_dedup$/m, ...args("o4", "--config", join(dir, "c3.json")));
    writeFileSync(join(dir, "in", "manifest.jsonl"), readFileSync(join(dir, "in", "manifest.jsonl"), "utf8").split("\n").slice(1).join("\n"));
    refused(/^lb-clean refused: input_docs_manifest_differ$/m, ...args("o4"));
    // --build-refs: a task repo must be named in the exclusion file
    mkdirSync(join(dir, "trees", "t-one", "src"), { recursive: true });
    writeFileSync(join(dir, "trees", "t-one", "src", "a.ts"), task); writeFileSync(join(dir, "trees", "t-one", "README.md"), "x");
    writeFileSync(join(dir, "tasks.json"), JSON.stringify({ tasks: [{ id: "t-one", repo: "unjs/defu" }] }));
    r = run("--build-refs", "--tasks", join(dir, "tasks.json"), "--trees", join(dir, "trees"), "--out", join(dir, "built"), "--exclusions", join(dir, "ex.txt"));
    assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /^lb-clean refs files=1 tasks=1 missingTrees=0$/m);
    writeFileSync(join(dir, "tasks2.json"), JSON.stringify({ tasks: [{ id: "t-one", repo: SYN }] }));
    refused(/^lb-clean refused: refs_repo_not_public_by_name$/m, "--build-refs", "--tasks", join(dir, "tasks2.json"), "--trees", join(dir, "trees"), "--out", join(dir, "built2"), "--exclusions", join(dir, "ex.txt"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
