// Limit-breaker step 2: the training-data cleaner (box only; rules in peaceai/lib/lbclean.ts, spec peaceai/spec/lb-clean-v1.md).
//   lb-clean.ts --in <corpus dir> --out <dir> --exclusions <file> [--refs <dir>] [--config <file>] [--dry-run]
//     <corpus dir>: docs.jsonl + manifest.jsonl (nl-pairs.ts / ft_prepare.py / eval_dedup.py output). Writes <out>/docs.jsonl,
//     <out>/manifest.jsonl, <out>/clean-report.json (counts only) and <out>/fingerprint.json. --dry-run writes nothing
//     and prints the counts. --refs: the public task-set repos' code (docs.jsonl + manifest.jsonl, from --build-refs).
//   lb-clean.ts --build-refs --tasks <tasks json> --trees <dir> --out <dir> --exclusions <file>
//     Collects the code files of each task's checkout (<trees>/<task id>/) into a refs corpus. A task repo must be
//     named in the exclusion file (public set by name); a repo that is only hash-listed is never read or named.
//   lb-clean.ts --build-refs --tree <dir> [--tree <dir> ...] --out <dir> --exclusions <file>
//     Collects the code files of any local directory into a refs corpus. Rows carry the label local/tree and an
//     opaque path (t<i>/f<n>): no repo or file name is written or printed, so a hidden checkout can be used as refs.
//   lb-clean.ts --in <cleaned corpus dir> --refs <dir> --report-only --exclusions <file> [--config <file>]
//     Check-only: the taskset_near_dup test alone over every doc of an already-cleaned corpus. Writes nothing and
//     prints counts only; exits 2 with code taskset_near_dup_found when the count is above 0.
// Refuses without the exclusion file or without any sha256 (hidden-half) line in it. Prints counts and codes only.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { typescriptEntry, useTypescript } from "../lib/tsresolve.ts";

const refuse = (code: string): never => { console.log(`lb-clean refused: ${code}`); process.exit(1); };
const tsEntry = typescriptEntry();
if (!tsEntry || !useTypescript(tsEntry)) refuse("typescript_not_found");
const L = await import("../lib/lbclean.ts");
const { parseExclusions } = await import("../lib/nlpairs.ts");
const { CODE_FILE } = await import("../lib/lmcorpus.ts");

const ROOT = new URL("../../", import.meta.url).pathname;
const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const opt = (k: string): string | null => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; if (!v || v.startsWith("--")) refuse(`arg_${k.slice(2)}`); argv.splice(i, 2); return v!; };
const buildRefs = flag("--build-refs"), dry = flag("--dry-run"), reportOnly = flag("--report-only");
const exPath = opt("--exclusions");
if (exPath === null) refuse("exclusions_missing");
const exBuf = existsSync(exPath!) ? readFileSync(exPath!) : null;
const ex = parseExclusions(exBuf);
if ("code" in ex) refuse(ex.code);
if (!("repos" in ex)) throw new Error("unreachable");
if (ex.hashes.size === 0) refuse("exclusions_no_hidden_hashes");

function readCorpus(dir: string): { docs: Map<number, string>; man: any[]; docsBuf: Buffer; manBuf: Buffer } {
  const dp = join(dir, "docs.jsonl"), mp = join(dir, "manifest.jsonl");
  if (!existsSync(dp) || !existsSync(mp)) refuse("input_missing");
  const docsBuf = readFileSync(dp), manBuf = readFileSync(mp);
  const docs = new Map<number, string>();
  try {
    for (const l of docsBuf.toString("utf8").split("\n")) if (l.trim()) { const o = JSON.parse(l); if (!Number.isInteger(o.doc) || typeof o.text !== "string" || docs.has(o.doc)) refuse("input_docs"); docs.set(o.doc, o.text); }
  } catch { refuse("input_docs"); }
  let man: any[] = [];
  try { man = manBuf.toString("utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch { refuse("input_manifest"); }
  // the pretrain corpus format (lm-corpus.ts) names the repo `source`: used as the repo for every rule, kept as is
  for (const m of man) if (m && typeof m.repo !== "string" && typeof m.source === "string") m.repo = m.source;
  if (man.length !== docs.size || man.some((m) => !docs.has(m.doc) || typeof m.repo !== "string" || typeof m.path !== "string" || !["train", "heldout"].includes(m.split)) || new Set(man.map((m) => m.doc)).size !== man.length) refuse("input_docs_manifest_differ");
  return { docs, man, docsBuf, manBuf };
}

// a tree entry that cannot be listed, stat-ed or read refuses with a fixed code: the error (its path) is never printed
const treeRead = <T>(f: () => T): T => { try { return f(); } catch { return refuse("tree_read"); } }; // m150-guard:tree-read
const walk = (d: string): string[] => treeRead(() => readdirSync(d, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) => e.isDirectory() ? (["node_modules", ".git"].includes(e.name) ? [] : walk(join(d, e.name))) : e.isFile() ? [join(d, e.name)] : []);
const refFile = (dir: string, f: string) => { const p = relative(dir, f); return CODE_FILE.test(p) && !p.endsWith(".d.ts") && treeRead(() => statSync(f).size) <= 1_000_000; };
const writeRefs = (out: string, docs: string[], man: string[]) => {
  if (!docs.length) refuse("refs_empty");
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "docs.jsonl"), docs.map((l) => l + "\n").join(""));
  writeFileSync(join(out, "manifest.jsonl"), man.map((l) => l + "\n").join(""));
};
const trees: string[] = [];
for (let t = opt("--tree"); t !== null; t = opt("--tree")) trees.push(t);
if (buildRefs && trees.length) {
  // any local directory: no repo name needed, none written (the label is local/tree, paths are opaque)
  const out = opt("--out") ?? refuse("arg_out");
  if (argv.length || opt("--tasks") !== null) refuse("usage");
  const docs: string[] = [], man: string[] = [];
  trees.forEach((dir, ti) => {
    if (!existsSync(dir) || !treeRead(() => statSync(dir)).isDirectory()) refuse("tree_missing");
    for (const f of walk(dir)) {
      if (!refFile(dir, f)) continue;
      man.push(JSON.stringify({ doc: docs.length, split: "train", repo: L.LOCAL_TREE_REPO, path: `t${ti}/f${docs.length}`, function: `tree:${ti}` }));
      docs.push(JSON.stringify({ doc: docs.length, text: treeRead(() => readFileSync(f, "utf8")) }));
    }
  });
  writeRefs(out, docs, man);
  console.log(`lb-clean refs files=${docs.length} trees=${trees.length}`);
  process.exit(0);
}
if (trees.length) refuse("usage");
if (buildRefs) {
  const tasksPath = opt("--tasks") ?? refuse("arg_tasks"), trees = opt("--trees") ?? refuse("arg_trees"), out = opt("--out") ?? refuse("arg_out");
  if (argv.length) refuse("usage");
  const tasks = JSON.parse(readFileSync(tasksPath, "utf8")).tasks as { id: string; repo: string }[];
  if (!Array.isArray(tasks) || !tasks.length) refuse("tasks_empty");
  const docs: string[] = [], man: string[] = [];
  let missing = 0;
  for (const t of [...tasks].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(t.repo) || !ex.repos.has(t.repo.toLowerCase())) refuse("refs_repo_not_public_by_name");
    const dir = join(trees, t.id);
    if (!/^[\w.-]+$/.test(t.id) || !existsSync(dir) || !treeRead(() => statSync(dir)).isDirectory()) { missing++; continue; }
    for (const f of walk(dir)) {
      if (!refFile(dir, f)) continue;
      const p = relative(dir, f);
      man.push(JSON.stringify({ doc: docs.length, split: "train", repo: t.repo, path: p, function: `task:${t.id}` }));
      docs.push(JSON.stringify({ doc: docs.length, text: treeRead(() => readFileSync(f, "utf8")) }));
    }
  }
  writeRefs(out, docs, man);
  console.log(`lb-clean refs files=${docs.length} tasks=${tasks.length} missingTrees=${missing}`);
  process.exit(0);
}

const inDir = opt("--in"), outDir = opt("--out"), refsDir = opt("--refs"), cfgPath = opt("--config") ?? join(ROOT, "peaceai/model/lb-clean.json");
if (inDir === null || argv.length) refuse("usage");
if (reportOnly ? (outDir !== null || dry || refsDir === null) : outDir === null && !dry) refuse("usage");
if (!existsSync(cfgPath)) refuse("config_missing");
const cfgBuf = readFileSync(cfgPath);
let cfg: any; try { cfg = JSON.parse(cfgBuf.toString("utf8")); } catch { refuse("config_json"); }
const probs = L.configProblems(cfg);
if (probs.length) refuse(probs.join(","));
const inp = readCorpus(inDir!);
let refs = null, refsSha: { docsSha256: string; manifestSha256: string } | null = null;
if (refsDir !== null) {
  const r = readCorpus(refsDir);
  if (r.man.some((m) => !L.refsRowOk(String(m.repo), ex))) refuse("refs_repo_not_public_by_name");
  refs = L.buildRefs(r.man.map((m) => r.docs.get(m.doc)!), cfg.taskset.shingleTokens);
  refsSha = { docsSha256: L.sha256(r.docsBuf), manifestSha256: L.sha256(r.manBuf) };
}
if (reportOnly) {
  // counts only: no output docs, no file names, no text
  const rep = L.tasksetReport(inp.man.map((m) => inp.docs.get(m.doc)!), refs!, cfg.taskset.maxContainment);
  console.log(`lb-clean report-only docs=${rep.docs} refFiles=${refs!.files} taskset_near_dup=${rep.taskset_near_dup}`);
  if (rep.taskset_near_dup > 0) { console.log("lb-clean report-only: taskset_near_dup_found"); process.exit(2); }
  process.exit(0);
}
const res = L.clean(inp.man.map((m) => ({ doc: m.doc, text: inp.docs.get(m.doc)!, man: m })), cfg, ex, refs);
const CODE = ["peaceai/lib/lbclean.ts", "peaceai/bin/lb-clean.ts", "peaceai/lib/nlpairs.ts", "peaceai/lib/lmcorpus.ts", "peaceai/lib/tsresolve.ts"];
const parts = {
  cleanerVersion: L.LB_CLEAN_VERSION, codeSha256: Object.fromEntries(CODE.map((p) => [p, L.sha256(readFileSync(join(ROOT, p)))])),
  typescriptVersion: JSON.parse(readFileSync(join(tsEntry!, "..", "..", "package.json"), "utf8")).version as string,
  configSha256: L.sha256(cfgBuf), exclusionsSha256: ex.fileSha256,
  input: { docsSha256: L.sha256(inp.docsBuf), manifestSha256: L.sha256(inp.manBuf) }, refs: refsSha,
};
const fingerprint = L.fingerprintOf(parts);
const report: Record<string, any> = { ...res.report, fingerprint };
const line = `lb-clean ${dry ? "dry-run " : ""}docsIn=${report.docsIn} pieces=${report.piecesChecked} kept=${report.keptPieces} docsOut=${report.docsOut} repeats=${report.repeats} fim=${report.fim} splitDocs=${report.splitDocs} drops=${Object.entries(report.drops as Record<string, number>).map(([k, v]) => `${k}:${v}`).join(",")} fingerprint=${fingerprint}`;
if (dry) { console.log(line); console.log(JSON.stringify(report)); process.exit(0); }
rmSync(outDir!, { recursive: true, force: true }); mkdirSync(outDir!, { recursive: true });
writeFileSync(join(outDir!, "docs.jsonl"), res.out.map((o) => JSON.stringify({ doc: o.man.doc, text: o.text }) + "\n").join(""));
writeFileSync(join(outDir!, "manifest.jsonl"), res.out.map((o) => JSON.stringify(o.man) + "\n").join(""));
writeFileSync(join(outDir!, "clean-report.json"), JSON.stringify(report, null, 1) + "\n");
writeFileSync(join(outDir!, "fingerprint.json"), JSON.stringify({ schema: L.LB_FINGERPRINT_SCHEMA, fingerprint, parts, outManifestSha256: L.sha256(readFileSync(join(outDir!, "manifest.jsonl"))) }, null, 1) + "\n");
console.log(line);
