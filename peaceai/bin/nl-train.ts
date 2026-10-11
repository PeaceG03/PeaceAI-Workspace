// M10: trains the task-wording classifier (peaceai/nl/model.json). Deterministic: same inputs, same file.
// Inputs: the committed public set (peaceai/nl/data/builder-train.jsonl), the static phrasing list, and,
// optionally, extra labeled JSONL files given as arguments (e.g. task texts kept on the box). Extra files
// add counts only for features the committed public set already has, so model.json never contains a word
// that is not already in public, committed text. Prints counts only.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { features, PHRASINGS, readJsonl, trainNb, type Label } from "../lib/nlparse.ts";

const root = join(import.meta.dirname, "../..");
const publicSet = [
  ...(readJsonl(join(root, "peaceai/nl/data/builder-train.jsonl")) as { text: string; label: Label }[]),
  ...Object.entries(PHRASINGS).map(([label, text]) => ({ text: text.replace(/ \(learned rule.*\)$/, ""), label: label as Label })),
];
const allowed = new Set(publicSet.flatMap((e) => features(e.text)));
const extra = process.argv.slice(2).flatMap((f) => readJsonl(f) as { text: string; label: Label }[]);
let dropped = 0;
const model = trainNb([...publicSet, ...extra], (f) => { const ok = allowed.has(f); if (!ok) dropped += 1; return ok; });
const out = process.env.PEACEAI_NL_MODEL_OUT ?? join(root, "peaceai/nl/model.json");
writeFileSync(out, JSON.stringify(model) + "\n");
console.log(`nl-train public=${publicSet.length} extra=${extra.length} vocab=${model.vocab} dropped_private_features=${dropped}`);
