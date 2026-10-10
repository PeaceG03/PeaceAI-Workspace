// Review job: build the blind review comment. Every eligible candidate is shown the same way, in the
// shuffled presentation order, with no scores, ranks or chosen marker.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateSummary } from "../lib/gate.ts";
import { reviewBody, validatePresentation } from "../lib/review.ts";
import { isRepoName, loadTargets } from "../lib/target.ts";

const inDir = resolve(process.env.PEACEAI_IN_DIR ?? "");
const presentation = JSON.parse(process.env.PRESENTATION ?? "null");
const summary = JSON.parse(readFileSync(join(inDir, "summary.json"), "utf8"));
if (!validateSummary(summary)) throw new Error("candidate summary failed validation");
const ids = summary.candidates.map((c) => c.id);
if (!validatePresentation(presentation, ids)) throw new Error("presentation failed validation");
const diffs = new Map(summary.candidates.map((c) => [c.id, readFileSync(join(inDir, c.file), "utf8")]));
const target = process.env.PEACEAI_TARGET ?? "";
const shownTarget = target && isRepoName(target) && target !== loadTargets().default ? target : null;
writeFileSync(resolve(process.env.PEACEAI_BODY_FILE ?? ""), reviewBody(presentation, diffs, shownTarget));
console.log(`review comment built for ${presentation.length} candidate(s)`);
