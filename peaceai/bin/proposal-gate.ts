// M8: leak gate for a PUBLIC rule-proposal body before it is posted to a Workspace issue: no core text
// (line or shingle match against a core checkout), no core-only paths, no personal info or secrets.
// Usage: PEACEAI_CORE_DIR=<core> proposal-gate.ts <body.md>... Prints counts only; exit 1 on any finding.
import { readFileSync } from "node:fs";
import { indexGitTree } from "../lib/coreindex.ts";
import { emptyIndex, findCoreText } from "../lib/coretext.ts";
import { scanText } from "../lib/leak.ts";

export function gateProposal(body: string, core: ReturnType<typeof indexGitTree>): string[] {
  const why: string[] = [];
  const leaks = scanText(body);
  if (leaks.length) why.push(`personal-info:${[...new Set(leaks.map((l) => l.kind))].join("+")}`);
  const hits = findCoreText(body.split("\n").map((l) => l.replace(/^[+-]/, "")), core.text, emptyIndex());
  if (hits.lineHits + hits.shingleHits > 0) why.push(`core-text:${hits.lineHits}+${hits.shingleHits}`);
  for (const p of core.paths) if (p.includes("/") && body.includes(p)) { why.push("core-path"); break; }
  if (/PeaceG03\/PeaceAI(?![-\w])/.test(body)) why.push("core-repo-reference");
  return why;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const coreDir = process.env.PEACEAI_CORE_DIR;
  if (!coreDir) throw new Error("PEACEAI_CORE_DIR is required");
  const core = indexGitTree(coreDir);
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    const why = gateProposal(readFileSync(f, "utf8"), core);
    console.log(`proposal-gate ${why.length ? "FAIL" : "PASS"} ${f.split("/").pop()}${why.length ? ` ${why.join(",")}` : ""}`);
    if (why.length) bad += 1;
  }
  if (bad) process.exit(1);
}
