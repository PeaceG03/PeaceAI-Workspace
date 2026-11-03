// lb-corpus v2 builder (box or a GitHub-hosted runner; builds data only, never trains). Rules: peaceai/lib/lbcorpus2.ts,
// spec peaceai/spec/lb-corpus2-v1.md, sources and pins peaceai/model/lb-corpus2.json.
//   lb-corpus2.ts --list --repo <clone> [--sources <file>]
//     Prints (JSON) the admitted files the source rule gives at the sources tip: the "files" array of lb-corpus2.json.
//   lb-corpus2.ts --repo <clone> --base <chain-1 out dir> --refs <dir> --exclusions <file> --out <dir> [--drop-hashes <file> ...] [--sources <file>]
//     <clone>: a full-history clone of PeaceAI-Workspace containing the sources tip. <base>: lb-corpus-rebuild.sh's out/
//     (docs.jsonl, manifest.jsonl, fingerprint.json, all three equal to the pinned chain-1 pins). <refs>: the public
//     task-set refs (lb-clean --build-refs). Writes <out>/docs.jsonl and manifest.jsonl (the base bytes verbatim, then
//     the new docs), new-manifest.jsonl (the appended manifest rows alone), report.json (counts only), fingerprint.json, and <out>/check/{docs,manifest}.jsonl: the new docs
//     alone in lb-clean's split vocabulary (heldout_v2 written as heldout), for lb-clean --report-only (the hidden check).
//     Refuses (writes nothing) when any non-overlap count is above 0.
//     Dev-task rule: every admitted file whose text hits a public dev task (lbcorpus2.ts devTaskHits; the set file and
//     the devfix file at the sha256s pinned in sources.devTasks) needs a listed decision (drop, or heldout_v2); no new
//     train doc may hit. [--dev-set <file>] [--dev-fix <file>] override the two paths (m180's synthetic ones).
//   lb-corpus2.ts --dev-hits --repo <clone> [--sources <file>] [--dev-set <file>] [--dev-fix <file>]
//     Prints (JSON) [{path, hits}] for every admitted file that hits a dev task (to write the decisions from).
//   lb-corpus2.ts --devfix --diffs <dir> --base <chain-1 out dir> --out <file> [--sources <file>] [--dev-set <file>]
//     Builds the devfix file: <dir>/<task id>.diff is each task's reference diff (sources.devTasks.diffs says how it is
//     fetched); fix shingles that occur in the pinned base corpus are left out.
//   lb-corpus2.ts --check <out dir>
//     Recomputes the non-overlap counts of a built v2 corpus; prints them; exit 2 when any is above 0.
// Prints counts, shas and fixed codes only (never text). Every refusal: `lb-corpus2 refused: <code>`, exit 1.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { typescriptEntry, useTypescript } from "../lib/tsresolve.ts";

const refuse = (code: string): never => { console.log(`lb-corpus2 refused: ${code}`); process.exit(1); };
const io = <T>(code: string, f: () => T): T => { try { return f(); } catch { return refuse(code); } };
const tsEntry = typescriptEntry();
if (!tsEntry || !useTypescript(tsEntry)) refuse("typescript_not_found");
const L = await import("../lib/lbclean.ts");
const C = await import("../lib/lbcorpus2.ts");
const { parseExclusions } = await import("../lib/nlpairs.ts");

const ROOT = new URL("../../", import.meta.url).pathname;
const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const opt = (k: string): string | null => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; if (!v || v.startsWith("--")) refuse(`arg_${k.slice(2)}`); argv.splice(i, 2); return v!; };
const SOURCES = opt("--sources") ?? join(ROOT, "peaceai/model/lb-corpus2.json"); // default: the committed sources (the pinned build); m180 passes synthetic ones
const cfgPath = join(ROOT, "peaceai/model/lb-clean.json");

function readLines(dir: string) {
  const dp = join(dir, "docs.jsonl"), mp = join(dir, "manifest.jsonl");
  if (!existsSync(dp) || !existsSync(mp)) refuse("input_missing");
  const docsBuf = io("input_read", () => readFileSync(dp)), manBuf = io("input_read", () => readFileSync(mp));
  let docs: { doc: number; text: string }[] = [], man: any[] = [];
  try {
    docs = docsBuf.toString("utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    man = manBuf.toString("utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch { refuse("input_json"); }
  if (docs.length !== man.length || docs.some((d, i) => d.doc !== i || typeof d.text !== "string" || man[i]?.doc !== i)) refuse("input_docs_manifest_differ");
  return { docsBuf, manBuf, docs, man };
}
function loadCfg() {
  const buf = io("config_read", () => readFileSync(cfgPath));
  let cfg: any; try { cfg = JSON.parse(buf.toString("utf8")); } catch { refuse("config_json"); }
  const p = L.configProblems(cfg); if (p.length) refuse(p.join(","));
  return { cfg, buf };
}

const check = opt("--check");
if (check !== null) {
  if (argv.length) refuse("usage");
  const { cfg } = loadCfg();
  const { docs, man } = readLines(check);
  const baseCount = man.findIndex((m) => m.origin === "auditor-passed-pr");
  const r = C.overlapProblems(docs.map((d, i) => ({ text: d.text, split: String(man[i].split) })), baseCount < 0 ? docs.length : baseCount, cfg.dedup);
  const bad = Object.values(r).some((v) => v > 0);
  console.log(`lb-corpus2 check docs=${docs.length} base=${baseCount < 0 ? docs.length : baseCount} ${Object.entries(r).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  process.exit(bad ? 2 : 0);
}

const list = flag("--list"), devHits = flag("--dev-hits"), devfix = flag("--devfix");
const devSetArg = opt("--dev-set"), devFixArg = opt("--dev-fix");
const srcBuf = io("sources_read", () => readFileSync(SOURCES));
let S: any; try { S = JSON.parse(srcBuf.toString("utf8")).sources; } catch { refuse("sources_json"); }
const sp = C.sourcesProblems(S); if (sp.length && !((list || devHits) && sp.every((c) => c === "sources_files" || c === "sources_dev")) && !(devfix && sp.every((c) => c === "sources_dev"))) refuse(sp.join(","));
const devSetBuf = () => io("dev_set_read", () => readFileSync(devSetArg ?? join(ROOT, S.devTasks?.set ?? "peaceai/plan/tasks-public-v1.json")));
const devSetJson = (b: Buffer) => { try { return JSON.parse(b.toString("utf8")); } catch { return refuse("dev_set_json"); } };
if (devfix) {
  const diffDir = opt("--diffs") ?? refuse("arg_diffs"), baseDir = opt("--base") ?? refuse("arg_base"), out = opt("--out") ?? refuse("arg_out");
  if (argv.length) refuse("usage");
  const set = devSetJson(devSetBuf()); if (C.devSetProblems(set).length) refuse("dev_set_invalid");
  const diffs = new Map<string, string>(set.tasks.map((t: any) => [t.id, io("devfix_diff_missing", () => readFileSync(join(diffDir, `${t.id}.diff`), "utf8"))]));
  const base = readLines(baseDir);
  const baseFp = io("base_read", () => JSON.parse(readFileSync(join(baseDir, "fingerprint.json"), "utf8")).fingerprint);
  if ([L.sha256(base.docsBuf), L.sha256(base.manBuf), baseFp].join() !== [S.base.docs, S.base.manifest, S.base.fingerprint].join()) refuse("devfix_base_pins_differ");
  const f = C.devFixOf(set, diffs, base.docs.map((d) => d.text));
  io("output_write", () => writeFileSync(out, JSON.stringify(f, null, 1) + "\n"));
  console.log(`lb-corpus2 devfix tasks=${f.tasks.length} hashes=${f.tasks.reduce((n, t) => n + t.hashes.length, 0)} sha256=${L.sha256(readFileSync(out))}`);
  process.exit(0);
}
const repo = opt("--repo") ?? refuse("arg_repo");
const git = (...a: string[]) => io("git", () => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }));
const gitBuf = (...a: string[]) => io("git", () => execFileSync("git", ["-C", repo, ...a], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }));
git("cat-file", "-e", `${S.tip}^{commit}`);
// every passed PR: a single-parent (squash) commit, subject ending in (#N), an ancestor of the tip
const passed = new Set<string>(), prOf = new Map<string, number>();
for (const p of S.passed) {
  const parents = git("rev-list", "--parents", "-n", "1", p.mergeCommit).trim().split(" ");
  if (parents[0] !== p.mergeCommit || parents.length !== 2) refuse("passed_not_squash"); // c2-guard:bin-squash
  if (!git("log", "-1", "--format=%s", p.mergeCommit).trim().endsWith(`(#${p.pr})`)) refuse("passed_subject_pr"); // c2-guard:bin-subject
  try { execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", p.mergeCommit, S.tip], { stdio: "ignore" }); } catch { refuse("passed_not_on_tip"); } // c2-guard:bin-ancestor
  passed.add(p.mergeCommit); prOf.set(p.mergeCommit, p.pr);
}
const tree = git("ls-tree", "-r", "-z", S.tip).split("\0").filter(Boolean).map((l) => { const [m, p] = l.split("\t"); const [mode, type, id] = m!.split(" "); return { mode, type, id: id!, path: p! }; })
  .filter((e) => e.type === "blob" && (e.mode === "100644" || e.mode === "100755")).sort((a, b) => (a.path < b.path ? -1 : 1));
const files: { path: string; blob: string; prs: number[] }[] = [];
const texts = new Map<string, string>();
for (const e of tree) {
  if (!C.SOURCE_EXT.test(e.path)) continue;
  const hist = git("log", "--no-renames", "--full-history", "--format=%H", S.tip, "--", e.path).split("\n").filter(Boolean);
  if (!C.attributable(hist, passed)) continue;
  const text = gitBuf("cat-file", "blob", e.id).toString("utf8");
  if (C.sourceProblem(e.path, text)) continue;
  files.push({ path: e.path, blob: e.id, prs: [...new Set(hist.map((h) => prOf.get(h)!))].sort((a, b) => a - b) });
  texts.set(e.path, text);
}
if (list) { console.log(JSON.stringify(files)); process.exit(0); }
// the dev-task rule: the set and devfix files at their pins; every hit file decided
const dsBuf = devSetBuf(), dfBuf = io("dev_fix_read", () => readFileSync(devFixArg ?? join(ROOT, S.devTasks?.fix ?? "peaceai/model/lb-corpus2-devfix.json")));
if (!devHits && L.sha256(dsBuf) !== S.devTasks.setSha256) refuse("devtask_set_differs"); // c2-guard:bin-dev-set
if (!devHits && L.sha256(dfBuf) !== S.devTasks.fixSha256) refuse("devtask_fix_differs"); // c2-guard:bin-dev-fix
let dev: ReturnType<typeof C.devSetOf>;
try { dev = C.devSetOf(devSetJson(dsBuf), JSON.parse(dfBuf.toString("utf8"))); } catch (e) { refuse((e as Error).message.match(/^[a-z_]+$/) ? (e as Error).message : "devfix_json"); }
const hitsOf = new Map(files.map((f) => [f.path, C.devTaskHits(texts.get(f.path)!, dev!)]));
if (devHits) { console.log(JSON.stringify([...hitsOf].filter(([, h]) => h.length).map(([path, hits]) => ({ path, hits })))); process.exit(0); }
if (JSON.stringify(files) !== JSON.stringify(S.files)) refuse("sources_files_differ"); // c2-guard:bin-files
const decP = C.devDecisionProblems(hitsOf, S.devTasks.decisions);
if (decP.length) refuse(decP[0]!.split(":")[0]!); // c2-guard:bin-dev-decisions
const decided = new Map<string, string>(S.devTasks.decisions.map((d: any) => [d.path, d.to]));

const baseDir = opt("--base") ?? refuse("arg_base"), refsDir = opt("--refs") ?? refuse("arg_refs"), exPath = opt("--exclusions") ?? refuse("arg_exclusions"), outDir = opt("--out") ?? refuse("arg_out");
const dropPaths: string[] = [];
for (let p = opt("--drop-hashes"); p !== null; p = opt("--drop-hashes")) dropPaths.push(p);
if (argv.length) refuse("usage");
const ex = parseExclusions(existsSync(exPath) ? io("exclusions_read", () => readFileSync(exPath)) : null);
if ("code" in ex) refuse(ex.code);
if (!("repos" in ex)) throw new Error("unreachable");
if (ex.hashes.size === 0) refuse("exclusions_no_hidden_hashes");
const drop = new Set<string>(), dropSha: string[] = [];
for (const p of dropPaths) {
  const buf = io("drop_hashes_read", () => readFileSync(p)); const r = L.parseDropHashes(buf);
  if ("code" in r) refuse(r.code);
  for (const h of "hashes" in r ? r.hashes : []) drop.add(h);
  dropSha.push(L.sha256(buf));
}
dropSha.sort();
const { cfg, buf: cfgBuf } = loadCfg();
// the base: exactly the pinned chain-1 corpus
const base = readLines(baseDir);
const baseFp = io("base_read", () => JSON.parse(readFileSync(join(baseDir, "fingerprint.json"), "utf8")).fingerprint);
if (L.sha256(base.docsBuf) !== S.base.docs || L.sha256(base.manBuf) !== S.base.manifest || baseFp !== S.base.fingerprint) refuse("base_pins_differ"); // c2-guard:bin-base
const refsC = readLines(refsDir);
if (refsC.man.some((m) => !L.refsRowOk(String(m.repo), ex))) refuse("refs_repo_not_public_by_name");
const refs = L.buildRefs(refsC.docs.map((d) => d.text), cfg.taskset.shingleTokens);
// new input docs: one per admitted file not dropped by a dev-task decision, in path order; a moved file is heldout_v2
const input = files.filter((f) => decided.get(f.path) !== "drop").map((f, i) => { // c2-guard:bin-dev-drop
  const text = texts.get(f.path)!;
  const split = decided.get(f.path) === C.HELDOUT2 ? C.HELDOUT2 : C.sliceOf(f.path, S.slice.salt, S.slice.rate); // c2-guard:bin-dev-move
  return { doc: i, text, man: { doc: i, stage: "pretrain", repo: S.repo, commit: S.tip, license: S.license, path: f.path, sha256: L.sha256(text), bytes: Buffer.byteLength(text), origin: "auditor-passed-pr", prs: f.prs, split: split as string } };
});
const newDocsBuf = Buffer.from(input.map((d) => JSON.stringify({ doc: d.doc, text: d.text }) + "\n").join("")), newManBuf = Buffer.from(input.map((d) => JSON.stringify(d.man) + "\n").join(""));
const baseDocs = base.docs.map((d, i) => ({ text: d.text, split: String(base.man[i].split) }));
const res = C.appendCorpus(baseDocs, input, cfg, ex, refs, drop);
const ov = C.overlapProblems([...baseDocs, ...res.out.map((o) => ({ text: o.text, split: o.man.split }))], baseDocs.length, cfg.dedup);
if (Object.values(ov).some((v) => v > 0)) refuse("overlap_found"); // c2-guard:bin-overlap
if (C.devTrainHits(res.out.map((o) => ({ text: o.text, split: o.man.split })), dev!) > 0) refuse("devtask_in_train"); // c2-guard:bin-dev-train
const outDocs = Buffer.concat([base.docsBuf, Buffer.from(res.out.map((o) => JSON.stringify({ doc: o.man.doc, text: o.text }) + "\n").join(""))]);
const newMan = Buffer.from(res.out.map((o) => JSON.stringify(o.man) + "\n").join(""));
const outMan = Buffer.concat([base.manBuf, newMan]);
const CODE = ["peaceai/lib/lbcorpus2.ts", "peaceai/bin/lb-corpus2.ts", "peaceai/lib/lbclean.ts", "peaceai/lib/nlpairs.ts", "peaceai/lib/tsresolve.ts"];
const parts = {
  version: C.LB_CORPUS2_VERSION, codeSha256: Object.fromEntries(CODE.map((p) => [p, L.sha256(io("code_read", () => readFileSync(join(ROOT, p))))])),
  typescriptVersion: io("code_read", () => JSON.parse(readFileSync(join(tsEntry!, "..", "..", "package.json"), "utf8")).version) as string,
  configSha256: L.sha256(cfgBuf), exclusionsSha256: ex.fileSha256, sourcesSha256: L.sha256(JSON.stringify(S)),
  base: { docs: S.base.docs, manifest: S.base.manifest, fingerprint: S.base.fingerprint }, newInput: { docsSha256: L.sha256(newDocsBuf), manifestSha256: L.sha256(newManBuf) },
  refs: { docsSha256: L.sha256(refsC.docsBuf), manifestSha256: L.sha256(refsC.manBuf) }, dropHashesSha256: dropSha, out: { docs: L.sha256(outDocs), manifest: L.sha256(outMan) },
};
const fingerprint = C.fingerprint2Of(parts);
const devTask = { hitFiles: [...hitsOf.values()].filter((h) => h.length).length, movedToHeldoutV2: [...decided.values()].filter((v) => v === C.HELDOUT2).length, dropped: [...decided.values()].filter((v) => v === "drop").length, newTrainHits: 0 };
const report = { ...res.report, devTask, overlap: ov, docsBytes: outDocs.length, fingerprint };
io("output_write", () => {
  rmSync(outDir, { recursive: true, force: true }); mkdirSync(join(outDir, "check"), { recursive: true });
  writeFileSync(join(outDir, "docs.jsonl"), outDocs); writeFileSync(join(outDir, "manifest.jsonl"), outMan);
  writeFileSync(join(outDir, "new-manifest.jsonl"), newMan);
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1) + "\n");
  writeFileSync(join(outDir, "fingerprint.json"), JSON.stringify({ schema: C.FINGERPRINT2_SCHEMA, fingerprint, parts }, null, 1) + "\n");
  writeFileSync(join(outDir, "check", "docs.jsonl"), res.out.map((o, i) => JSON.stringify({ doc: i, text: o.text }) + "\n").join(""));
  writeFileSync(join(outDir, "check", "manifest.jsonl"), res.out.map((o, i) => JSON.stringify({ ...o.man, doc: i, split: o.man.split === C.HELDOUT2 ? "heldout" : o.man.split }) + "\n").join(""));
});
console.log(`lb-corpus2 docsOut=${report.docsOut} base=${report.baseDocs} newFiles=${report.newFiles} newDocs=${report.newDocs} newTrain=${report.newTrain} newHeldoutV2=${report.newHeldoutV2} cross=${JSON.stringify(res.report.cross)} overlap=0 docs=${parts.out.docs} manifest=${parts.out.manifest} fingerprint=${fingerprint}`);
