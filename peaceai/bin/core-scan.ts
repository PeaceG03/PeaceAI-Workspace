// Backstop: scan the whole public workspace tree for core text. Needs a core checkout; prints counts and workspace paths only.
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { indexGitTree } from "../lib/coreindex.ts";
import { emptyIndex, findCoreText } from "../lib/coretext.ts";

const coreDir = process.env.PEACEAI_CORE_DIR;
if (!coreDir) throw new Error("PEACEAI_CORE_DIR is required");
const core = indexGitTree(coreDir);
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const empty = emptyIndex();
let failures = 0;
for (const path of tracked) {
  // Config files are protected and owner-reviewed; their generic key/value lines are not scanned.
  if (/^(?:package-lock\.json|package\.json|tsconfig[^/]*\.json)$/.test(path)) continue;
  if (core.paths.has(path) && !["README.md", "package.json", "tsconfig.json", ".gitignore", "LICENSE"].includes(path)) {
    failures += 1;
    console.log(`CORE FAIL ${path}: same path as a core file`);
  }
  if (!statSync(path).isFile() || statSync(path).size > 2_000_000) continue;
  const hits = findCoreText(readFileSync(path, "utf8").split("\n"), core.text, empty);
  if (hits.lineHits + hits.shingleHits > 0) {
    failures += 1;
    console.log(`CORE FAIL ${path}: ${hits.lineHits} line, ${hits.shingleHits} shingle match(es)`);
  }
}
if (failures > 0) process.exit(1);
console.log(`CORE PASS files=${tracked.length}`);
