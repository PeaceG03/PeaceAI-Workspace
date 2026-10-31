// M167 model-v1 scoring CLI (spec/edit-proposer-model-v1.md). Runs ONLY in the model-v1-score job of
// .github/workflows/peace-model-v1-dev.yml (lib/modelscore.ts scoringJobAllowed; refused on the box and elsewhere).
//   tsx peaceai/bin/model-v1-score.ts candidates --out FILE
//     repair-v1's candidate lists for the pinned public dev task file (anonymous clones of the pinned commits; no team
//     tests, no install, no candidate code). Network is still on here; no model is loaded.
//   tsx peaceai/bin/model-v1-score.ts score --candidates FILE --model RESULTS_DIR --out FILE
//     refuses unless there is no network, the model in RESULTS_DIR/models/lm/<pin version>/ passes verifyModelDir
//     (memcheck) and its weights are the pin; scores each candidate once (infer.py score) and writes the ranking (one
//     compact JSON line) to FILE. The job hands FILE and its sha256 to the attempt job as job outputs.
// Prints counts only (no task text, no repo names, no scores); writes nothing else.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gitCopyFetcher, ROOT } from "../lib/loop.ts";
import { modelFileShas, runInfer, verifyModelDir } from "../lib/lm.ts";
import { MODEL_V1_PIN, modelV1PinProblem, type ModelV1Pin } from "../lib/modelpropose.ts";
import { buildCandidates, buildRanking, CANDIDATES_SCHEMA, modelManifestSha256, offline, scoringJobAllowed, type CandidatesFile } from "../lib/modelscore.ts";
import { sha256, taskFileProblem, type PlanTaskFile } from "../lib/plan.ts";
import { committedLog, isLocked } from "../lib/plangrade.ts";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const refuse = (code: string): never => { console.log(`refused ${code}`); process.exit(1); };
const cmd = args[0];
const out = flag("--out");
if ((cmd !== "candidates" && cmd !== "score") || !out?.startsWith("/")) { console.log("usage: model-v1-score.ts candidates --out /abs | score --candidates /abs --model /abs --out /abs"); process.exit(2); }
if (!scoringJobAllowed(process.env)) refuse("SCORE_JOB_REFUSED"); // never on the box, never where candidate code runs
let pin: ModelV1Pin;
try { pin = JSON.parse(readFileSync(join(ROOT, MODEL_V1_PIN), "utf8")); } catch { refuse("PIN_UNREADABLE"); }
if (modelV1PinProblem(pin!)) refuse("PIN_INVALID");
const taskText = readFileSync(join(ROOT, pin!.taskFile), "utf8");
const fileSha = sha256(taskText);
const tasks = JSON.parse(taskText) as PlanTaskFile;
if (taskFileProblem(tasks) || tasks.set !== "public") refuse("PUBLIC_DEV_ONLY");
if (!isLocked(committedLog(ROOT), fileSha)) refuse("TASK_FILE_UNLOCKED");

if (cmd === "candidates") {
  const { out: c, refused } = buildCandidates(tasks, fileSha, gitCopyFetcher());
  writeFileSync(out, JSON.stringify(c));
  const n = c.entries.reduce((s, e) => s + e.items.length, 0);
  console.log(`candidates tasks=${tasks.tasks.length} lists=${c.entries.length} nonEmpty=${c.entries.filter((e) => e.items.length).length} candidates=${n} refused=${Object.entries(refused).map(([k, v]) => `${k}:${v}`).join(",") || "-"}`);
} else {
  if (!offline()) refuse("NETWORK_PRESENT"); // the score step runs with no network (unshare --net)
  const candPath = flag("--candidates"), resultsDir = flag("--model");
  if (!candPath?.startsWith("/") || !resultsDir?.startsWith("/")) refuse("USAGE");
  const dir = resolve(resultsDir!, "models", "lm", pin!.version);
  const v = verifyModelDir(dir);
  if (!v.ok) refuse(`MODEL_${v.reason}`);
  if (v.ok && v.version !== pin!.version) refuse("MODEL_NOT_PINNED");
  const shas = modelFileShas(dir);
  if (!shas || shas["weights.npz"] !== pin!.weightsSha256) refuse("WEIGHTS_NOT_PINNED");
  const manifest = modelManifestSha256(shas!);
  if (!manifest) refuse("MANIFEST_INVALID");
  let c: CandidatesFile;
  try { c = JSON.parse(readFileSync(candPath!, "utf8")); } catch { refuse("CANDIDATES_UNREADABLE"); }
  if (c!.schema !== CANDIDATES_SCHEMA || c!.taskFileSha256 !== fileSha || !Array.isArray(c!.entries)) refuse("CANDIDATES_INVALID");
  let inferRefusal = "";
  const r = buildRanking(c!, (items) => {
    const res = runInfer("score", dir, { items });
    if (!res.ok) { inferRefusal = res.reason; return null; }
    if (res.response?.model !== pin!.version || !Array.isArray(res.response?.scores)) return null;
    return res.response.scores.map((s: { id: unknown; logprob: unknown; tokens: unknown }) => ({ id: String(s.id), logprob: Number(s.logprob), tokens: Number(s.tokens) }));
  }, { weightsSha256: pin!.weightsSha256, modelManifestSha256: manifest! });
  if (!r.ok) refuse(inferRefusal || r.reason);
  if (r.ok) {
    writeFileSync(out, r.text);
    const n = r.ranking.entries.reduce((s, e) => s + e.order.length, 0);
    const moved = r.ranking.entries.filter((e) => e.order.some((x, i) => x !== i)).length;
    console.log(`scored model=${pin!.version} lists=${r.ranking.entries.length} candidates=${n} reordered=${moved} bytes=${Buffer.byteLength(r.text)}`);
  }
}
