// One-off provenance check (memcheck run 38908186778, Architect/Auditor). Re-samples the model exactly as
// lm-memcheck did (same prompts via memprompts.ts, same seed and settings, same core-free-64 exemption), checks the
// regenerated unexplained runs equal the recorded locations (else BLOCK, fail closed), then classifies each distinct
// run string by core file count and public doc count. Prints counts and hashed ids only; never the text; writes nothing.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { indexGitTree } from "../lib/coreindex.ts";
import { COREFREE_MIN_RUN, LM_FILES, modelFileShas, runInfer, scanSamples, type Sample } from "../lib/lm.ts";
import { emptyIndex } from "../lib/coretext.ts";
import { buildMemcheckPrompts } from "../lib/memprompts.ts";
import { provenanceRows, sameRuns, verdictOf, GENERIC_CORE_FILES, type RecordedRun } from "../lib/provenance.ts";
import { buildSubstringIndex } from "../lib/substr.ts";

const out = (line: string) => console.log(line);
const fail = (why: string): never => { out(`provenance verdict=BLOCK reason=${why}`); process.exit(1); };
const modelDir = resolve(process.env.PEACEAI_LM_MODEL_DIR ?? "");
const pre = resolve(process.env.PEACEAI_LM_TRAIN_CORPUS ?? "");
const ft = resolve(process.env.PEACEAI_LM_FT_CORPUS ?? "");
const coreDir = resolve(process.env.PEACEAI_CORE_DIR ?? "");
const expectedPath = resolve(process.env.PEACEAI_PROV_EXPECTED ?? "peaceai/model/m49-provenance-38908186778.json");
const CORE_SOURCE = "PeaceG03/PeaceAI";

let exp: { model: string; files: Record<string, string>; prompts: { core: number; public: number; empty: number }; unexplainedRuns: RecordedRun[] };
try { exp = JSON.parse(readFileSync(expectedPath, "utf8")); } catch { fail("EXPECTED_UNREADABLE"); throw 0; }
if (!process.env.PEACEAI_LM_TRAIN_CORPUS || !process.env.PEACEAI_LM_FT_CORPUS) fail("CORPORA_REQUIRED");
const files = modelFileShas(modelDir);
if (!files || LM_FILES.some((f) => files[f] !== exp.files[f])) fail("MODEL_FILES_MISMATCH");

// Same prompts as lm-memcheck (memcheck uses PEACEAI_LM_CORPUS = the pretrain corpus in the M49 workflow).
const { prompts, built } = buildMemcheckPrompts(pre, coreDir, exp.prompts, CORE_SOURCE);
if (built.core !== exp.prompts.core || built.public !== exp.prompts.public || built.empty !== exp.prompts.empty) fail("PROMPTS_MISMATCH");
const r = runInfer("sample", modelDir, { prompts, seed: 9, prompt_tokens: 64, new_tokens: 128, temperature: 0.8 }, ["--unverified", "--threads", process.env.PEACEAI_LM_THREADS ?? "8"]);
if (!r.ok) fail(`INFER_${r.reason}`);
const samples = (r as { ok: true; response: { samples: Sample[] } }).response.samples;

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
for (const run of got) { const t = (byId.get(run.sample) ?? "").slice(run.start, run.start + run.length); strings.set(t, (strings.get(t) ?? 0) + 1); }
const rows = provenanceRows(strings, coreTexts, publicTexts);
for (const x of rows) out(`provenance id=${x.id} length=${x.length} occurrences=${x.occurrences} core_files=${x.coreFiles} public_docs=${x.publicDocs} dominated=${x.dominated} class=${x.cls}`);
const n = (c: string) => rows.filter((x) => x.cls === c).length;
const verdict = verdictOf(rows, matched);
out(`provenance distinct=${rows.length} generic=${n("GENERIC")} leak_signal=${n("LEAK_SIGNAL")} review=${n("REVIEW")} generic_core_files_threshold=${GENERIC_CORE_FILES} verdict=${verdict}`);
process.exit(verdict === "PASS" ? 0 : 1);
