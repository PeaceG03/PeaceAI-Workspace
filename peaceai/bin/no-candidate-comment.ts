// M59: writes the no-candidate issue comment, with the matching rules' refusal reasons (re-validated in
// lib/refusal-reason.ts) when there are any, and (M99 round 3) a DERIVE refusal's questions in plain words. Reads
// RULE_REFUSALS and RULE_QUESTIONS, writes PEACEAI_BODY_FILE.
import { writeFileSync } from "node:fs";
import { noCandidateComment } from "../lib/refusal-reason.ts";

const out = process.env.PEACEAI_BODY_FILE;
if (!out) throw new Error("PEACEAI_BODY_FILE is required");
writeFileSync(out, noCandidateComment(process.env.RULE_REFUSALS ?? "", process.env.RULE_QUESTIONS ?? "") + "\n");
