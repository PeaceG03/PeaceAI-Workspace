// M100: rank derive shape families by uncovered PeaceSTOCKS functions they would make derivable, against the official
// builder-log coverage (see peaceai/lib/derive-family-census.ts). Read-only; no network.
// Usage: PEACESTOCKS_CLONE=<PeaceSTOCKS checkout> tsx peaceai/bin/derive-family-census.ts <PeaceSTOCKS checkout> [asOf YYYY-MM-DD] [--json]
import { readFileSync } from "node:fs";
import { LOG_PATH } from "../../builder-log/check.ts";
import { denverYmd, makeGitOnMainChecker } from "../../builder-log/coverage.ts";
import { census } from "../lib/derive-family-census.ts";

const root = process.argv[2];
if (!root) { console.error("usage: derive-family-census.ts <PeaceSTOCKS checkout> [asOf] [--json]"); process.exit(2); }
const asOf = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? denverYmd();
const r = census(readFileSync(LOG_PATH, "utf8"), asOf, makeGitOnMainChecker(root), root);
if (process.argv.includes("--json")) console.log(JSON.stringify({ asOf, ...r }, null, 1));
else {
  console.log(`official coverage ${r.official.covered}/${r.official.total}; ${r.official.uncovered} uncovered rows by skill: ${JSON.stringify(r.official.uncoveredBySkill)}`);
  console.log(`${r.scanned} primitive-param functions scanned, ${r.credited} already PeaceAI-credited, ${r.outOfScope} uncovered out of scope`);
  console.log("| family | uncovered fns | official rows | DSL | examples |\n|---|---:|---:|---|---|");
  for (const x of r.rank) console.log(`| ${x.family} | ${x.functions} | ${x.official} | ${x.dsl} | ${x.examples.join(", ")} |`);
}
