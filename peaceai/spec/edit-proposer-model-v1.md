# Model-backed edit proposer v1 (design only)

Status: DESIGN ONLY, no implementation in this PR (Builder, 2026-10-31, batch 7; revised with Auditor's rulings on
#662). Nothing here is wired, flagged or run. It needs Auditor and Peace before any code. Every claim below is about
code as it is on main ec36fc1.

## The interface it must fit (unchanged)

- `peaceai/lib/loop.ts` `Proposer` = `{ name; prepare?(search, { request, failing }); next(input): Proposal }`, both
  synchronous. `Proposal = { edits: Edit[] } | { refuse: "NO_EDIT" | "NO_MORE_EDITS" }`, `Edit = { path, content }`
  (whole-file content). `next()` gets `ProposeInput` (request, repo, plan, files, context, attempt, feedback with
  per-attempt codes / failing names / test counts, baseline).
- `prepare` runs once per task on the copy reset to the pinned commit without the team's tests
  (`m152-guard:prepare-clean`); all searching happens there.
- PROPOSER_FAILED (spec/edit-proposer-v1.md, loop.ts `ask` and the guards `m152-guard:prepare-failed`,
  `m164-guard:next-failed`, `next-empty`, `next-malformed`): a throwing `prepare`/`next`, a non-object, or a
  non-refusing proposal without a valid dense `edits` array ends the task PROPOSER_FAILED with no error text in the
  row. An empty `edits` array is a legal no-op attempt. A refusal ends the task with that code.
- `LoopOptions.makeProposer` gives a fresh proposer per task; `bin/loop.ts --proposer` picks one of a closed list
  (`rules-v1`, `repair-v1`; anything else is the usage error). `loopSha256()` hashes the proposer code into every row.

## Proposal: `model-v1` = repair-v1's candidates, reranked by a model (rerank only, ruling e)

Keep the model out of code generation for v1. `peaceai/lib/editpropose.ts` `repairProposer` already builds up to
`MAX_CANDIDATES` (60) parsed, deduplicated, single-site candidates in a fixed template order. `model-v1` splits into
two jobs (ruling b):

1. Scoring job (holds the weights, runs no candidate code): for each task, run repair-v1's `prepare` on the pinned
   commit (no team tests in the copy), build the candidate list, score each candidate once with the model (log P of
   the changed hunk given the request and the surrounding lines: the existing `infer.py score` mode through
   `peaceai/lib/lm.ts` `runInfer`), and emit only a ranked index list (a permutation of 0..n-1, ties broken by
   repair-v1's order) bound by sha256 to the task key and the candidate list. Generating code (`infer.py fill`, free
   text) is out of scope for v1.
2. Attempt job (runs candidate code, holds no weights): `model-v1`'s `prepare` runs repair-v1's `prepare`, rebuilds the
   candidate list, and accepts the ranking only if its sha256 binding matches this task and this exact candidate
   list. `next` returns the k-th ranked candidate at attempt k, keeps repair-v1's feedback rules (stop on TAMPERED /
   LEFTOVERS, the one pairwise combination) and refuses `NO_EDIT` / `NO_MORE_EDITS` exactly as repair-v1.
3. Failure: no ranking, a binding mismatch, a ranking that is not a permutation of the candidate indices -> `prepare`
   throws -> PROPOSER_FAILED. In the scoring job, a load refusal (`verifyModelDir`: MODEL_MISSING, MEMCHECK_*,
   RECHECK_*) or a not-ok `runInfer` (LM_JOB_REFUSED, MEMCHECK_REQUIRED, INFER_FAILED) produces no ranking. Never a
   silent fallback to repair-v1's order: the row would then claim a model ran when it did not.

Because only the order changes, every model-v1 edit is one repair-v1 could also have proposed; the question is "does
the model put the right candidate earlier", measured at a small fixed `--max` pre-registered before the first run.

## Constraints and rulings

- Hidden inputs (Auditor ruling): hidden requests must never reach the repo, workflow inputs, secrets, artifacts,
  logs, Results, or any runner running code we author. So model-v1 has NO hidden evaluation on Actions; it is built
  and measured on the public dev split only, with no gain claim. How hidden scoring can happen, and whether model
  weights may run where Auditor does hidden runs, is Peace's decision, which Auditor will raise when the proposer is
  ready. This design does not plan around it (open item, owned by Peace / Auditor).
- Model (ruling a): only the memchecked Results LM (`LM_FILES` config.json / tokenizer.json / weights.npz; lm.ts
  `verifyModelDir`, infer.py's memcheck rule), pinned by its weights sha256. An lb-daily save is not eligible; it
  becomes eligible only after export + M49 memcheck + provenance check, in its own reviewed PR.
- Weights never on a bot computer, no model on the box: `lmJobAllowed` (lm.ts) currently ALLOWS off Actions ("Off
  Actions (the box) is allowed"). The scoring job needs its own check that refuses unless `GITHUB_ACTIONS === "true"`
  and the job id is pinned in `LM_JOB_WORKFLOWS` to one new manual-dispatch workflow. Unit tests use an injected fake
  scorer and a fake ranking (tiny fixtures), never infer.py with real weights.
- Isolation (ruling b): no weights in any job that runs candidate code. The loop runs the team's tests as the stage-2
  candidate uid (`PEACEAI_STAGE2_CAND`, loop.ts header) in the attempt job only; lm.ts already refuses LM jobs where
  candidate code runs (`PEACEAI_CANDIDATE_JOB`).
- Scoring job output (ruling d): prints counts only, runs pinned code, uploads no artifacts, and makes no network call
  after scoring starts. How the ranked index list reaches the attempt job without an artifact is part of the
  implementation PR's review.
- No paid compute: a standard GitHub-hosted runner, CPU numpy inference (`infer.py --threads`), one manual dispatch
  per evaluation, a job timeout; at most 60 candidates per task (`score` already caps at 64 items).
- Rows (ruling c): a loop row carrying the model manifest sha256, in its own schema PR before any model-v1 row is
  written. Rows stay codes and numbers only (loop-v1.md / loop-v2.md). M166 implements it as
  `peaceai-plan-loop:v4` (the "v3" this ruling first named was already M162's planner row; see loop-v2.md
  "Rows v4"): v3 + `modelManifestSha256`. The model manifest is the text of one line per LM file, in `LM_FILES`
  order (config.json, tokenizer.json, weights.npz), each `<sha256 of the file>  <file name>` and ending in a newline
  (the `sha256sum` format); its sha256 is the row's `modelManifestSha256`.

## Evaluation (honest reporting, ruling f)

- Dev only for now: `peaceai/plan/tasks-public-v1.json` (12 public tasks). No hidden runs, no hidden rows read.
- Primary metric: pass count at the pre-registered fixed `--max`, paired against repair-v1 on the same tasks, same
  commit, same planner (`selectPlanner` default, plan-only-v4) and same candidate uid; rules-v1 reported alongside.
  Raw counts per proposer (pass / fail / refused, attempts used, PROPOSER_FAILED and DEPS_* / infra codes separately).
- The ranking prompt, score formula, tie rule and `--max` are frozen before the first run. The dev result is reported
  as dev, with no gain claim. Any claim later needs at least 10 held-out tasks (lm.ts `LM_PROMOTION_RULE`
  `minHeldOutTasks: 10`, `mustBeatBaseline: true`) and uses all 20 hidden tasks when that path exists. repair-v1 and
  rules-v1 stay the defaults (`bin/loop.ts` default stays rules-v1).

## Open items

1. Hidden scoring (owned by Peace / Auditor): whether and where hidden tasks can be scored, and whether model weights
   may run where Auditor does hidden runs. Auditor raises it with Peace when the proposer is ready.
2. Hand-off without artifacts (implementation PR review): how the scoring job's ranked index list (sha256-bound to the
   task and the candidate list) reaches the attempt job under ruling d.
3. The value of the fixed `--max` to pre-register (to be proposed in the implementation PR, before any run).
