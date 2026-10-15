// M37: runner-side check before training on the external corpus. Fails (exit 1) on: a refused stage (finetune is a
// reserved hook), a config/manifest mismatch, any file whose sha256 differs from the manifest, any A/B/C or set C v2
// content hash, any file from a set C v2 repo, and a missing or non-PASS whole-corpus memcheck record (the box
// memcheck attests core exclusion: runners never see core). Prints counts only.
//   ext-manifest-check.ts <corpus dir from ext-fetch> [stage]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sha256Hex } from "../lib/heldout.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { allHeldOutHashes } from "../lib/lmcorpus.ts";
import { extCorpusProblems, safetyToolShas } from "../lib/extcorpus.ts";

const model = resolve(import.meta.dirname, "../model");
const corpus = resolve(process.argv[2] ?? "");
const stage = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "pretrain";
const rd = (p: string) => readFileSync(join(model, p), "utf8");
const c = JSON.parse(rd("heldout-c.json"));
const docs = new Map<number, string>();
for (const l of readFileSync(join(corpus, "docs.jsonl"), "utf8").split("\n")) if (l) { const d = JSON.parse(l); docs.set(d.doc, d.text); }
const manifestBytes = readManifestBytes(model, "ext-manifest"); // M51: one file or split parts, never both
const pin = process.argv.indexOf("--manifest-sha");
if (pin >= 0 && sha256Hex(manifestBytes) !== process.argv[pin + 1]) { console.log(`ext-manifest-check: manifest sha256 ${sha256Hex(manifestBytes)} is not the pinned ${process.argv[pin + 1]}`); console.log("ext-manifest-check FAIL"); process.exit(1); }
const problems = extCorpusProblems({
  manifestText: manifestBytes.toString("utf8"), cfg: JSON.parse(rd("ext-corpus.json")), memcheck: JSON.parse(rd("ext-memcheck.json")),
  manifestSha256: sha256Hex(manifestBytes), heldOut: allHeldOutHashes(JSON.parse(rd("heldout.json")), c),
  cRepos: new Set(c.sets.C.map((e: { repo: string }) => e.repo)), docs, sha256: sha256Hex, stage, safetyTools: safetyToolShas(JSON.parse(rd("safety-tool-sha256.json"))),
});
for (const p of problems) console.log(`ext-manifest-check: ${p}`);
console.log(`ext-manifest-check ${problems.length ? "FAIL" : "PASS"} docs=${docs.size} stage=${stage}`);
process.exit(problems.length ? 1 : 0);
