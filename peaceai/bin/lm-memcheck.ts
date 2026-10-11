// M9 memorization check. Samples the model (greedy and sampled continuations of core, public and empty
// prompts), scans every output with the core-text scanner (public corpus as baseline) and the personal-info
// scanner, and writes memcheck.json bound to the model files' sha256. Fail closed: any hit, too few samples,
// an inference error or files that changed during the check -> FAIL (exit 1). Prints counts only; no
// sample text is written anywhere. Runs where the core checkout is (the box), never on public runners.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { indexGitTree } from "../lib/coreindex.ts";
import { addText, emptyIndex } from "../lib/coretext.ts";
import { buildSubstringIndex } from "../lib/substr.ts";
import { MEMCHECK_SCHEMA, memcheckStatus, modelFileShas, runInfer, scanSamples, type Sample, type SampleScan } from "../lib/lm.ts";
import type { ManifestEntry } from "../lib/lmcorpus.ts";

const modelDir = resolve(process.env.PEACEAI_LM_MODEL_DIR ?? "");
const corpus = resolve(process.env.PEACEAI_LM_CORPUS ?? "");
const coreDir = resolve(process.env.PEACEAI_CORE_DIR ?? "");
const counts = { core: Number(process.env.PEACEAI_MEMCHECK_CORE ?? 96), public: Number(process.env.PEACEAI_MEMCHECK_PUBLIC ?? 32), empty: 8 };
const CORE_SOURCE = "PeaceG03/PeaceAI";

const before = modelFileShas(modelDir);
const manifest: ManifestEntry[] = readFileSync(join(corpus, "manifest.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const texts = new Map<number, string>();
for (const l of readFileSync(join(corpus, "docs.jsonl"), "utf8").split("\n")) if (l) { const d = JSON.parse(l); texts.set(d.doc, d.text); }
const h = (s: string) => createHash("sha256").update(s).digest("hex");
const pick = (list: ManifestEntry[], n: number) => [...list].sort((a, b) => (h(`m9:${a.path}`) < h(`m9:${b.path}`) ? -1 : 1)).slice(0, n);
const promptOf = (m: ManifestEntry) => {
  const t = texts.get(m.doc) ?? "";
  const lines = t.split("\n");
  const start = parseInt(h(`off:${m.path}`).slice(0, 8), 16) % Math.max(1, lines.length - 8);
  return lines.slice(start).join("\n").slice(0, 400);
};
const prompts = [
  ...pick(manifest.filter((m) => m.source === CORE_SOURCE), counts.core).map((m, i) => ({ id: `core-${i}`, text: promptOf(m) })),
  ...pick(manifest.filter((m) => m.source !== CORE_SOURCE), counts.public).map((m, i) => ({ id: `public-${i}`, text: promptOf(m) })),
  ...Array.from({ length: counts.empty }, (_, i) => ({ id: `empty-${i}`, text: "" })),
];

let scan: SampleScan | null = null;
let reason = "";
const r = before ? runInfer("sample", modelDir, { prompts, seed: 9, prompt_tokens: 64, new_tokens: 128, temperature: 0.8 }, ["--unverified", "--threads", process.env.PEACEAI_LM_THREADS ?? "8"]) : { ok: false as const, reason: "MODEL_MISSING" };
if (!r.ok) reason = r.reason;
else {
  const tree = indexGitTree(coreDir, () => true, true);
  const core = tree.text;
  const coreRaw = buildSubstringIndex(tree.raw ?? []);
  const baseline = emptyIndex();
  for (const m of manifest) if (m.source !== CORE_SOURCE) addText(baseline, texts.get(m.doc) ?? "");
  scan = scanSamples(r.response.samples as Sample[], core, baseline, (tree.raw ?? []).length ? coreRaw : null);
}
const after = modelFileShas(modelDir);
if (JSON.stringify(before) !== JSON.stringify(after)) { scan = null; reason = "FILES_CHANGED"; }
const status = memcheckStatus(scan);
const report = {
  schema: MEMCHECK_SCHEMA,
  status,
  ...(reason ? { reason } : {}),
  files: before,
  model: r.ok ? r.response.model : null,
  prompts: counts,
  settings: { promptTokens: 64, newTokens: 128, decoding: ["greedy", "sampled t=0.8 top-k 40 seed 9"], minSamples: 100 },
  scanners: ["core-text (hashed long lines and 4-line shingles; public corpus as baseline)", "core-substring (any 32+ character run of generated text found in core; no baseline)", "personal-info (leak.ts)"],
  scan,
};
writeFileSync(join(modelDir, "memcheck.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`memcheck status=${status} samples=${scan?.samples ?? 0} core_line_hits=${scan?.coreLineHits ?? "-"} core_shingle_hits=${scan?.coreShingleHits ?? "-"} core_substring_hits=${scan?.coreSubstringHits ?? "-"} personal_info=${scan?.personalInfo ?? "-"}${reason ? ` reason=${reason}` : ""}`);
process.exit(status === "PASS" ? 0 : 1);
