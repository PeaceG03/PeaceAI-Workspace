// Verdict job: find an open PeaceAI PR for the issue so a second `right` never opens a duplicate.
import { appendFileSync } from "node:fs";
import { findOpenPeacePr, verdictReply, type OpenPr } from "../lib/prguard.ts";

const prs = JSON.parse(process.env.PR_LIST_JSON ?? "[]") as OpenPr[];
const issue = Number(process.env.ISSUE_NUMBER);
const existing = findOpenPeacePr(Array.isArray(prs) ? prs : [], issue);
const wantsPr = process.env.CHOSEN === "true";
const reply = verdictReply(process.env.LABEL ?? "", process.env.VERDICT ?? "", existing, wantsPr);
const out = [`existing=${existing ?? ""}`, `open_pr=${wantsPr && existing === null}`, `reply=${reply}`];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out.join("\n") + "\n");
console.log(out.slice(0, 2).join(" "));
