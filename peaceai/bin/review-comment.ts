// Review job: build the blind review comment. Every eligible candidate is shown the same way, in the
// shuffled presentation order, with no scores, ranks or chosen marker.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateSummary, loadSummaryContext } from "../lib/gate.ts";
import { deriveReviewNote } from "../lib/learned-derive.ts";
import { hasPlaceholder, validateRepairRecord } from "../lib/repairrecord.ts";
import { PLACEHOLDER_NOTE, reviewBody, validatePresentation } from "../lib/review.ts";
import { isRepoName, loadTargets } from "../lib/target.ts";

const inDir = resolve(process.env.PEACEAI_IN_DIR ?? "");
const presentation = JSON.parse(process.env.PRESENTATION ?? "null");
const summary = JSON.parse(readFileSync(join(inDir, "summary.json"), "utf8"));
if (!validateSummary(summary, loadSummaryContext())) throw new Error("candidate summary failed validation");
const ids = summary.candidates.map((c) => c.id);
if (!validatePresentation(presentation, ids)) throw new Error("presentation failed validation");
const diffs = new Map(summary.candidates.map((c) => [c.id, readFileSync(join(inDir, c.file), "utf8")]));
const target = process.env.PEACEAI_TARGET ?? "";
const targets = loadTargets();
const shownTarget = target && isRepoName(target) && target !== targets.default ? target : null;
const route = (shownTarget && targets.targets[shownTarget]?.verdictRoute) || "pr";
// M7.1: candidates whose shown (repaired) diff contains a placeholder value get one neutral note.
const notes = new Map<string, string>();
for (const c of summary.candidates) {
  const p = join(inDir, "testresults", "repair", `${c.id}.json`);
  if (!existsSync(p)) continue;
  const r = JSON.parse(readFileSync(p, "utf8"));
  if (!validateRepairRecord(r) || r.id !== c.id) throw new Error("repair record failed validation");
  if (hasPlaceholder(r)) notes.set(c.id, PLACEHOLDER_NOTE);
}
// M99 (Auditor #491 B1): a DERIVE candidate shows its derived expression and far-probe outputs, rebuilt from its diff.
for (const c of summary.candidates) {
  if (notes.has(c.id)) continue;
  const note = deriveReviewNote(diffs.get(c.id) ?? "");
  if (note) notes.set(c.id, note);
}
writeFileSync(resolve(process.env.PEACEAI_BODY_FILE ?? ""), reviewBody(presentation, diffs, shownTarget, route, notes));
console.log(`review comment built for ${presentation.length} candidate(s)`);
