// One-off provenance check (memcheck run 38913032640, Architect/Auditor). Re-samples the model exactly as
// lm-memcheck did (same prompts via memprompts.ts, same seed and settings, same core-free-64 exemption), checks the
// regenerated unexplained runs equal the recorded locations (else BLOCK, fail closed), then classifies each distinct
// run string by core file count and public doc count. Prints counts and sequential ids (s01, s02, ...) only, no hash of any text; never the text; writes nothing.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { indexGitTree } from "../lib/coreindex.ts";
import { duplicateSampleIds, promptIdOf, COREFREE_MIN_RUN, LM_FILES, modelFileShas, runInfer, scanSamples, type Sample } from "../lib/lm.ts";
import { emptyIndex } from "../lib/coretext.ts";
import { buildMemcheckPrompts } from "../lib/memprompts.ts";
import { promptOverlap, promptVerdict, provenanceRows, sameRuns, seqId, verdictOf, GENERIC_CORE_FILES, PROMPT_OVERLAP_MIN, type PromptOverlap, type RecordedRun } from "../lib/provenance.ts";
import { buildSubstringIndex } from "../lib/substr.ts";
import { countContaining, isDerivedPath, safeRepoName } from "../lib/sourcehunt.ts";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";

const out = (line: string) => console.log(line);
const fail = (why: string): never => { out(`provenance verdict=BLOCK reason=${why}`); process.exit(1); };
const modelDir = resolve(process.env.PEACEAI_LM_MODEL_DIR ?? "");
const pre = resolve(process.env.PEACEAI_LM_TRAIN_CORPUS ?? "");
const ft = resolve(process.env.PEACEAI_LM_FT_CORPUS ?? "");
const coreDir = resolve(process.env.PEACEAI_CORE_DIR ?? "");
const expectedPath = resolve(process.env.PEACEAI_PROV_EXPECTED ?? "peaceai/model/m49-provenance-38913032640.json");
const CORE_SOURCE = "PeaceG03/PeaceAI";

let exp: { model: string; files: Record<string, string>; prompts: { core: number; public: number; empty: number }; unexplainedRuns: RecordedRun[] };
try { exp = JSON.parse(readFileSync(expectedPath, "utf8")); } catch { fail("EXPECTED_UNREADABLE"); throw 0; }
// Recorded runs must name the exact sample (`<prompt>:<decoding>`); a bare prompt id is ambiguous: fail closed.
if (exp.unexplainedRuns.some((x) => !/^[a-z]+-\d+:(greedy|sampled)$/.test(x.sample))) fail("RECORD_IDS_AMBIGUOUS");
if (!process.env.PEACEAI_LM_TRAIN_CORPUS || !process.env.PEACEAI_LM_FT_CORPUS) fail("CORPORA_REQUIRED");
const files = modelFileShas(modelDir);
if (!files || LM_FILES.some((f) => files[f] !== exp.files[f])) fail("MODEL_FILES_MISMATCH");

// Same prompts as lm-memcheck (memcheck uses PEACEAI_LM_CORPUS = the pretrain corpus in the M49 workflow).
const { prompts, built } = buildMemcheckPrompts(pre, coreDir, exp.prompts, CORE_SOURCE);
if (built.core !== exp.prompts.core || built.public !== exp.prompts.public || built.empty !== exp.prompts.empty) fail("PROMPTS_MISMATCH");
const r = runInfer("sample", modelDir, { prompts, seed: 9, prompt_tokens: 64, new_tokens: 128, temperature: 0.8 }, ["--unverified", "--threads", process.env.PEACEAI_LM_THREADS ?? "8"]);
if (!r.ok) fail(`INFER_${r.reason}`);
const samples = (r as { ok: true; response: { samples: Sample[] } }).response.samples;
// Sample ids are `<prompt>:<decoding>` and must be unique: a duplicate would make the id -> text lookup ambiguous.
if (duplicateSampleIds(samples).length > 0) fail("DUPLICATE_SAMPLE_ID");

const docTexts = (dir: string) => readFileSync(join(dir, "docs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => String(JSON.parse(l).text));
const publicTexts = [...docTexts(pre), ...docTexts(ft)];
const tree = indexGitTree(coreDir, () => true, true);
const coreTexts = tree.raw ?? [];
if (coreTexts.length === 0) fail("CORE_EMPTY");
const exempt = { prompts: new Map(prompts.map((p) => [p.id, p.text])), trainingCorpus: buildSubstringIndex(publicTexts), minRun: COREFREE_MIN_RUN };
const scan = scanSamples(samples, emptyIndex(), emptyIndex(), buildSubstringIndex(coreTexts), exempt);
const got = scan.unexplainedRuns ?? [];
const matched = sameRuns(exp.unexplainedRuns, got);
out(`provenance runs recorded=${exp.unexplainedRuns.length} regenerated=${got.length} match=${matched}`);
if (!matched) fail("RUNS_MISMATCH");

const byId = new Map(samples.map((s) => [s.id, s.text]));
const strings = new Map<string, number>();
// Deterministic id order: runs sorted by sample id (prompt kind, then number) and start; first appearance wins.
const ord = (id: string) => { const [p, dec = ""] = id.split(":"); const [k, n] = p!.split("-"); return [["core", "public", "empty"].indexOf(k!), Number(n), ["greedy", "sampled"].indexOf(dec)] as const; };
const sorted = [...got].sort((a, b) => { const x = ord(a.sample), y = ord(b.sample); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.start - b.start || a.length - b.length; });
for (const run of sorted) { const t = (byId.get(run.sample) ?? "").slice(run.start, run.start + run.length); strings.set(t, (strings.get(t) ?? 0) + 1); }
const rows = provenanceRows(strings, coreTexts, publicTexts);
for (const x of rows) out(`provenance id=${x.id} length=${x.length} occurrences=${x.occurrences} core_files=${x.coreFiles} public_docs=${x.publicDocs} dominated=${x.dominated} class=${x.cls}`);
const n = (c: string) => rows.filter((x) => x.cls === c).length;
const verdict = verdictOf(rows, matched);
// PROMPT_LINKED_ALL never lifts BLOCK: the exit code stays the class verdict; it only justifies a memcheck exemption PR
// and a re-run.
// Prompt overlap per run, against its own sample's prompt (memprompts text, looked up by the id's prompt part).
const promptText = new Map(prompts.map((p) => [p.id, p.text]));
const sampleById = new Map(samples.map((s) => [s.id, s]));
const strId = new Map([...strings.keys()].map((t, i) => [t, seqId(i)]));
const perString = new Map<string, Record<PromptOverlap, number>>();
const classes: PromptOverlap[] = [];
sorted.forEach((run, i) => {
  const s = sampleById.get(run.sample);
  const prompt = s ? promptText.get(promptIdOf(s)) : undefined;
  const t = (s?.text ?? "").slice(run.start, run.start + run.length);
  if (!s || prompt === undefined || t.length !== run.length || !strId.has(t)) fail("PROMPT_LOOKUP");
  const o = promptOverlap(t, run.start, prompt!);
  classes.push(o.cls);
  const sid = strId.get(t)!;
  const c = perString.get(sid) ?? { inside: 0, extends: 0, none: 0 }; c[o.cls] += 1; perString.set(sid, c);
  out(`provenance run=r${String(i + 1).padStart(2, "0")} string=${sid} length=${run.length} overlap=${o.overlap} prompt=${o.cls}`);
});
for (const [sid, c] of perString) out(`provenance string=${sid} prompt_inside=${c.inside} prompt_extends=${c.extends} prompt_none=${c.none}`);
const pv = promptVerdict(classes);
out(`provenance prompt_runs=${classes.length} inside=${classes.filter((c) => c === "inside").length} extends=${classes.filter((c) => c === "extends").length} none=${classes.filter((c) => c === "none").length} overlap_min=${PROMPT_OVERLAP_MIN} prompt_verdict=${pv}`);
// M49 source hunt (PEACEAI_SOURCE_HUNT=1, m49-source-hunt.yml): per string, counts only, in the same order (s01..).
if (process.env.PEACEAI_SOURCE_HUNT === "1") {
  const git = (dir: string, args: string[], input?: string) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 1 << 30, ...(input === undefined ? {} : { input }) });
  const readFiles = (dir: string) => {
    const r: { path: string; text: string }[] = [];
    for (const p of git(dir, ["ls-files", "-z"]).split("\0").filter(Boolean)) {
      try { const f = join(dir, p); if (statSync(f).isFile() && statSync(f).size <= 2 * 1024 * 1024) r.push({ path: p, text: readFileSync(f, "utf8") }); } catch { /* unreadable */ }
    }
    return r;
  };
  const coreNow = readFiles(coreDir);
  const derived = coreNow.filter((f) => isDerivedPath(f.path)).map((f) => f.text), other = coreNow.filter((f) => !isDerivedPath(f.path)).map((f) => f.text);
  // Older core versions: every blob reachable in history (full clone) that is not at HEAD, text-sized.
  if (git(coreDir, ["rev-parse", "--is-shallow-repository"]).trim() !== "false") fail("CORE_HISTORY_SHALLOW");
  const head = new Set(git(coreDir, ["ls-tree", "-r", "HEAD"]).split("\n").filter(Boolean).map((l) => l.split(/\s+/)[2]));
  const objs = new Map<string, string>();
  for (const l of git(coreDir, ["rev-list", "--objects", "--all"]).split("\n")) { const [sha, ...p] = l.split(" "); if (sha && p.length && !head.has(sha)) objs.set(sha, p.join(" ")); }
  const sizes = git(coreDir, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], [...objs.keys()].join("\n") + "\n").split("\n");
  const blobs = sizes.map((l) => l.split(" ")).filter((x) => x[1] === "blob" && Number(x[2]) <= 2 * 1024 * 1024).map((x) => x[0]!);
  const history: { path: string; text: string }[] = [];
  for (let i = 0; i < blobs.length; i += 500) {
    const chunk = blobs.slice(i, i + 500);
    const raw = execFileSync("git", ["-C", coreDir, "cat-file", "--batch"], { input: chunk.join("\n") + "\n", maxBuffer: 1 << 30 });
    let off = 0;
    for (const sha of chunk) {
      const nl = raw.indexOf(10, off); const size = Number(raw.subarray(off, nl).toString().split(" ")[2]);
      history.push({ path: objs.get(sha)!, text: raw.subarray(nl + 1, nl + 1 + size).toString("utf8") }); off = nl + 1 + size + 1;
    }
  }
  // Public Peace repos: one anonymous clone per repo under PEACEAI_SOURCE_REPOS (dir names owner__repo).
  const reposDir = process.env.PEACEAI_SOURCE_REPOS ?? "";
  const repos = reposDir ? readdirSync(reposDir).sort().map((d) => ({ name: d.replace("__", "/"), files: readFiles(join(reposDir, d)).map((f) => f.text) })) : [];
  if (repos.length === 0 || repos.some((r) => !safeRepoName(r.name))) fail("SOURCE_REPOS");
  const preT = docTexts(pre), ftT = docTexts(ft);
  out(`provenance source_hunt core_files=${coreNow.length} derived_files=${derived.length} history_blobs=${history.length} repos=${repos.length} derived_rule=dist|build|out|generated|coverage|fixtures|__snapshots__|data dirs, .generated/.gen/.min files, lockfiles, .snap`);
  [...strings.keys()].forEach((t, i) => {
    const hist = history.filter((h) => h.text.includes(t));
    out(`provenance source id=${seqId(i)} pretrain_docs=${countContaining(t, preT)} finetune_docs=${countContaining(t, ftT)} core_derived_files=${countContaining(t, derived)} core_other_files=${countContaining(t, other)} core_history_blobs=${hist.length} core_history_paths=${new Set(hist.map((h) => h.path)).size}${repos.map((r) => ` repo:${r.name}=${countContaining(t, r.files)}`).join("")}`);
  });
}
out(`provenance distinct=${rows.length} generic=${n("GENERIC")} leak_signal=${n("LEAK_SIGNAL")} review=${n("REVIEW")} generic_core_files_threshold=${GENERIC_CORE_FILES} verdict=${verdict}`);
process.exit(verdict === "PASS" ? 0 : 1);
