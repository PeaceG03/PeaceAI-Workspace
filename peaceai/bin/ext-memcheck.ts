// M37: whole-corpus memcheck for the external pretraining corpus. Runs on the box (needs PeaceAI core). Scans EVERY
// document of the corpus rebuilt by ext-fetch (the exact bytes a runner trains on): no core file by sha256, no core
// line or 4-line shingle, and no 64+ character run of core text. Writes peaceai/model/ext-memcheck.json bound to the
// committed manifest's sha256; the training workflow refuses to train unless that record is PASS for this manifest.
//   PEACEAI_CORE_DIR=<core> ext-memcheck.ts <corpus dir from ext-fetch>
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { indexGitTree } from "../lib/coreindex.ts";
import { emptyIndex, findCoreText } from "../lib/coretext.ts";
import { buildSubstringIndex, countCoreSubstrings } from "../lib/substr.ts";
import { COREFREE_MIN_RUN } from "../lib/lm.ts";
import { sha256Hex } from "../lib/heldout.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { EXT_MEMCHECK_SCHEMA } from "../lib/extcorpus.ts";

const model = resolve(import.meta.dirname, "../model");
const corpus = resolve(process.argv[2] ?? "");
const tree = indexGitTree(resolve(process.env.PEACEAI_CORE_DIR ?? ""), () => true, true);
if (!tree.raw?.length) throw new Error("no core checkout (fail closed)");
const coreShas = new Set(tree.raw.map((t) => sha256Hex(t)));
const sub = buildSubstringIndex(tree.raw, COREFREE_MIN_RUN);
const empty = emptyIndex();
const r = { scannedDocs: 0, coreFileHits: 0, coreLineHits: 0, coreShingleHits: 0, coreRunHits: 0 };
for (const l of readFileSync(join(corpus, "docs.jsonl"), "utf8").split("\n")) {
  if (!l) continue;
  const t: string = JSON.parse(l).text;
  r.scannedDocs += 1;
  if (coreShas.has(sha256Hex(t))) r.coreFileHits += 1;
  const h = findCoreText(t.split("\n"), tree.text, empty);
  r.coreLineHits += h.lineHits; r.coreShingleHits += h.shingleHits; r.coreRunHits += countCoreSubstrings(t, sub);
}
const manifestText = readManifestBytes(model, "ext-manifest"); // M51: one file or split parts
const entries = manifestText.toString().split("\n").filter(Boolean).length - 1;
const pass = r.scannedDocs === entries && r.coreFileHits + r.coreLineHits + r.coreShingleHits + r.coreRunHits === 0;
writeFileSync(join(model, "ext-memcheck.json"), JSON.stringify({ schema: EXT_MEMCHECK_SCHEMA, status: pass ? "PASS" : "FAIL", manifestSha256: sha256Hex(manifestText), entries, ...r, minRun: COREFREE_MIN_RUN }, null, 1) + "\n");
console.log(`ext memcheck status=${pass ? "PASS" : "FAIL"} scanned=${r.scannedDocs}/${entries} core_files=${r.coreFileHits} lines=${r.coreLineHits} shingles=${r.coreShingleHits} runs64=${r.coreRunHits}`);
process.exit(pass ? 0 : 1);
