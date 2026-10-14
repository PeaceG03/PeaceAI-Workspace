// M22: one skill-learner pass. Reads builder-log/tasks.jsonl and the skills already proposed (marker list
// from SKILL_PROPOSED, one per line, written by the workflow from this repo's issues). Writes the proposal
// title/body (if any) and the gap note to PEACEAI_OUT_DIR. The workflow step after it opens the issue.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanText } from "../lib/leak.ts";
import { learnPass, skillProposalBody } from "../lib/skilllearn.ts";

const out = process.env.PEACEAI_OUT_DIR;
if (!out) throw new Error("PEACEAI_OUT_DIR is required");
const log = readFileSync("builder-log/tasks.jsonl", "utf8");
const proposed = new Set((process.env.SKILL_PROPOSED ?? "").split("\n").map((s) => s.trim()).filter(Boolean));
const pass = learnPass(log, proposed);
mkdirSync(out, { recursive: true });
const gap = ["skill\tentries\twhy", ...pass.gaps.map((g) => `${g.skill}\t${g.entries}\t${g.reason}`)].join("\n") + "\n";
writeFileSync(join(out, "gaps.tsv"), gap);
const prop = skillProposalBody(pass, log);
if (prop) {
  const leaks = scanText(prop.body);
  if (leaks.length) throw new Error(`skill proposal refused by the leak scan: ${leaks.length} finding(s)`);
  if (/\/approve-rule|\/verdict|\/promote-self-change/.test(prop.body)) throw new Error("proposal names an approval command");
  writeFileSync(join(out, "title.txt"), prop.title);
  writeFileSync(join(out, "body.md"), prop.body);
}
console.log(`skill-learner pick=${pass.pick?.skill ?? "none"} gaps=${pass.gaps.length}`);
