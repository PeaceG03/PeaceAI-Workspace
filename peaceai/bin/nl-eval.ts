// M10: held-out parse accuracy. Prints counts and per-label totals only (never task text).
//   nl-eval.ts [heldout.jsonl]            labeled set: {label, text, expect?}
//   NL_ISSUES=issues.json nl-eval.ts      also: real Workspace task issues (gh issue list --json number,title,body)
// A family-labeled example is correct when it parses to that family (and to `expect`, when given);
// a `none` example is correct when the parser refuses. "wrong" counts confident wrong parses (the unsafe kind);
// "refused" counts family examples the parser declined (safe misses).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadModel, nlDecision, readJsonl } from "../lib/nlparse.ts";

const root = join(import.meta.dirname, "../..");
const model = loadModel();
if (!model) throw new Error("no model");
// Learned-rule kinds count as approved only when listed (NL_APPROVED_KINDS, comma-separated); default none, as on main.
const kinds = new Set((process.env.NL_APPROVED_KINDS ?? "").split(",").filter(Boolean));
const file = process.argv[2] ?? join(root, "peaceai/nl/data/builder-heldout.jsonl");
const set = readJsonl(file, true);
let correct = 0, wrong = 0, refused = 0, falseAccept = 0;
const perLabel: Record<string, { n: number; ok: number }> = {};
for (const e of set) {
  const d = nlDecision({ title: "", body: e.text }, undefined, kinds, model);
  const p = (perLabel[e.label] ??= { n: 0, ok: 0 });
  p.n += 1;
  let ok = false;
  if (e.expect?.startsWith("REFUSE:")) { ok = d.status === "unsure" && d.reason === e.expect.slice(7); if (!ok && d.status === "parsed") wrong += 1; else if (!ok) refused += 1; }
  else if (e.label === "plan") { ok = d.status === "parsed" && d.objective === e.expect; if (!ok && d.status === "parsed") wrong += 1; else if (!ok) refused += 1; }
  else if (e.label === "none") { ok = d.status === "unsure"; if (!ok) falseAccept += 1; }
  else if (d.status === "parsed") { ok = d.steps.length === 1 && d.steps[0]!.family === e.label && (!e.expect || d.objective === e.expect); if (!ok) wrong += 1; }
  else if (d.status === "canonical") ok = true; // already in a supported phrasing: passed through unchanged
  else refused += 1;
  if (ok) { correct += 1; p.ok += 1; }
}
console.log(`heldout n=${set.length} correct=${correct} accuracy=${(correct / set.length).toFixed(3)} wrong_parse=${wrong} refused=${refused} none_accepted=${falseAccept}`);
console.log(`per_label ${Object.entries(perLabel).map(([l, v]) => `${l}:${v.ok}/${v.n}`).join(" ")}`);
if (process.env.NL_ISSUES) {
  const issues = JSON.parse(readFileSync(process.env.NL_ISSUES, "utf8")) as { number: number; title: string; body: string }[];
  const tally: Record<string, number> = {};
  const unsure: string[] = [];
  for (const i of issues) {
    const d = nlDecision({ title: i.title, body: i.body }, undefined, new Set(), model);
    tally[d.status] = (tally[d.status] ?? 0) + 1;
    if (d.status === "unsure") unsure.push(`#${i.number}:${d.reason}`);
  }
  console.log(`issues n=${issues.length} ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" ")} unsure=[${unsure.join(" ")}]`);
}
