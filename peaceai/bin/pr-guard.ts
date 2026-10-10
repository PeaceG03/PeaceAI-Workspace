// Verdict job: decide which PeaceAI PRs to close and whether to open one (see lib/prguard.ts).
import { appendFileSync } from "node:fs";
import { openPeacePrs, planPr, type OpenPr } from "../lib/prguard.ts";

const prs = JSON.parse(process.env.PR_LIST_JSON ?? "[]") as OpenPr[];
const issue = Number(process.env.ISSUE_NUMBER);
const verdict = process.env.VERDICT;
if (verdict !== "right" && verdict !== "wrong" && verdict !== "unsure") throw new Error("invalid verdict");
const label = process.env.LABEL ?? "";
if (!/^([A-Z]|none)$/.test(label)) throw new Error("invalid label");
const candidate = process.env.CANDIDATE ?? "";
if (candidate && !/^candidate-\d{1,3}$/.test(candidate)) throw new Error("invalid candidate");
const withdrew = process.env.WITHDREW === "true";
const plan = planPr({ label, verdict, candidateId: candidate || null, withdrew }, openPeacePrs(Array.isArray(prs) ? prs : [], issue));
const out = [
  `close=${plan.close.join(" ")}`,
  `open_pr=${plan.open}`,
  `mark=${plan.markWithdrawn.join(" ")}`,
  `unmark=${plan.unmarkWithdrawn.join(" ")}`,
  `reply=${plan.reply}`,
];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out.join("\n") + "\n");
console.log(out.slice(0, 4).join(" "));
