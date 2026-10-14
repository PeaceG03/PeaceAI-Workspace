// M31: fails (exit 1) unless the training manifest holds only allowlisted public files and NO heldout.json sha256.
// Usage: lm-manifest-check.ts MANIFEST.jsonl DOCS.jsonl (each doc re-hashed against its manifest entry). Prints counts only.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { heldOutHashes } from "../lib/lmcorpus.ts";
import { docsProblems, manifestProblems, validAllow, type PublicManifestEntry } from "../lib/lmpublic.ts";

const allow = validAllow(JSON.parse(readFileSync(resolve(import.meta.dirname, "../model/lm-public-allow.json"), "utf8")));
if (!allow) { console.log("lm-manifest-check FAIL allowlist invalid"); process.exit(1); }
const heldOut = heldOutHashes(JSON.parse(readFileSync(resolve(import.meta.dirname, "../model/heldout.json"), "utf8")));
const manifest = readFileSync(resolve(process.argv[2] ?? ""), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as PublicManifestEntry);
if (!process.argv[3]) { console.log("lm-manifest-check FAIL docs.jsonl required"); process.exit(1); }
const docs = readFileSync(resolve(process.argv[3]), "utf8").split("\n").filter(Boolean);
const problems = [...manifestProblems(manifest, heldOut, allow), ...docsProblems(manifest, docs, (t) => createHash("sha256").update(t).digest("hex"))];
if (problems.length) { console.log(`lm-manifest-check FAIL ${problems.join("; ")}`); process.exit(1); }
console.log(`lm-manifest-check PASS files=${manifest.length} heldout_hashes=${heldOut.size} heldout_present=0`);
