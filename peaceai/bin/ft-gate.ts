// M49 BLOCKING (1): refuse to fine-tune unless the built fine-tune corpus is exactly the one the box core-free proof
// covers (peaceai/model/ft-corefree.json + ft-corefree-proof.json). Usage: ft-gate.ts <ft dir> <repo>@<sha> ...
// Prints PASS or FAIL + reasons only.
import { readFileSync } from "node:fs";
import { ftGateProblems } from "../lib/ftgate.ts";
const [dir, ...specs] = process.argv.slice(2);
const rd = (p: string) => readFileSync(new URL(`../model/${p}`, import.meta.url));
let record: unknown = null; let proofBytes: Buffer = Buffer.from("");
try { record = JSON.parse(rd("ft-corefree.json").toString()); proofBytes = rd("ft-corefree-proof.json"); } catch { record = null; }
const repos = specs.map((s) => { const i = s.lastIndexOf("@"); return { repo: s.slice(0, i), sha: s.slice(i + 1) }; });
let problems: string[];
try { problems = ftGateProblems({ record, proofBytes, manifestBytes: readFileSync(`${dir}/manifest.jsonl`), docsBytes: readFileSync(`${dir}/docs.jsonl`), repos }); } catch { problems = ["fine-tune corpus unreadable"]; }
if (problems.length) { console.log(`ft-gate FAIL ${problems.join("; ")}`); process.exit(1); }
console.log("ft-gate PASS fine-tune corpus matches the box core-free proof");
