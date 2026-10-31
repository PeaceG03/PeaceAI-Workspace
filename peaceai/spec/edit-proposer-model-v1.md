# Model-backed edit proposer v1 (design only)

Status: DESIGN ONLY, no implementation in this PR (Builder, 2026-10-31, batch 7). Nothing here is wired, flagged or
run. It needs Auditor and Peace before any code. Every claim below is about code as it is on main ec36fc1.

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

## Proposal: `model-v1` = repair-v1's candidates, reranked by a model

Keep the model out of code generation for v1. `peaceai/lib/editpropose.ts` `repairProposer` already builds up to
`MAX_CANDIDATES` (60) parsed, deduplicated, single-site candidates in a fixed template order. `model-v1` would:

1. `prepare`: run repair-v1's `prepare` unchanged, then score every candidate once with the model (log P of the
   changed hunk given the request and the surrounding lines, the existing `infer.py score` mode called through
   `peaceai/lib/lm.ts` `runInfer`, which is a synchronous `spawnSync` and so fits the synchronous interface). Order
   the candidates by score, ties broken by repair-v1's order. All model calls happen here, before any attempt.
2. `next`: return the k-th ranked candidate at attempt k; keep repair-v1's feedback rules (stop on TAMPERED /
   LEFTOVERS, the one pairwise combination) unchanged; `NO_EDIT` / `NO_MORE_EDITS` exactly as repair-v1.
3. Failure: no model dir, a load refusal (`verifyModelDir`: MODEL_MISSING, MEMCHECK_*, RECHECK_*), `runInfer`
   returning not-ok (LM_JOB_REFUSED, MEMCHECK_REQUIRED, INFER_FAILED) or a score list that does not match the
   candidate list -> `prepare` throws -> PROPOSER_FAILED. Never a silent fallback to repair-v1's order: the row would
   then claim a model ran when it did not.

Because only the order changes, every model-v1 edit is one repair-v1 could also have proposed; the comparison is
"does the model put the right candidate earlier", which is measurable within `--max` attempts. Generating new code
(e.g. `infer.py fill` over template options, or free text) is out of scope for v1.

## Constraints and how the design meets them

- Weights never on a bot computer, no model on the box: `lmJobAllowed` (lm.ts) currently ALLOWS off Actions ("Off
  Actions (the box) is allowed"). model-v1 must not use that path: it needs its own check that refuses unless
  `GITHUB_ACTIONS === "true"` and the job id is pinned in `LM_JOB_WORKFLOWS` to one new manual-dispatch workflow.
  Off Actions, `prepare` throws -> PROPOSER_FAILED, and no weights are fetched. Unit tests use an injected fake scorer
  (tiny fixture), never infer.py with real weights.
- Where weights come from: either the memchecked LM (`LM_FILES` config.json / tokenizer.json / weights.npz, from the
  Results repo, as lm.ts) or an lb-daily chain save from the private R2 bucket (`peaceai/bin/lm-saves-r2.sh get`,
  verified against a trusted record's manifest sha256 as lb_daily.py does). See open question 1.
- No paid compute: a standard GitHub-hosted runner, CPU numpy inference (`infer.py --threads`), one manual dispatch
  per evaluation, a job timeout; scoring 60 candidates per task at most (`score` already caps at 64 items).
- Candidate code isolation: the loop runs the team's tests as the stage-2 candidate uid (`PEACEAI_STAGE2_CAND`,
  loop.ts header). lm.ts never lets an LM job be one where candidate code runs (`PEACEAI_CANDIDATE_JOB`, "never Job
  B/B2"). Since all model calls happen in `prepare`, the job could score, then delete the weights before the first
  attempt; but the baseline (team tests on the unedited copy) already ran before `prepare`. See open question 2.
- Rows: codes and numbers only (loop-v1.md / loop-v2.md). The model identity (weights sha256 / save name) must be
  bound to the row, not just the proposer code via `loopSha256`. See open question 3.

## Evaluation (honest reporting)

- Dev: `peaceai/plan/tasks-public-v1.json` (12 public tasks). Hidden: Auditor's hidden task file, run by Auditor only
  (loop-v1.md: "any task file path works (the Auditor's hidden file)"); Builder never reads hidden rows or tasks.
  Hidden rows keep `runner`/`deps`/`baseline` null (loop-v2.md `hidden_detail`).
- Same task files, same commit, same planner (`selectPlanner` default, plan-only-v4), same `--max`, same candidate
  uid for all three proposers: rules-v1, repair-v1 and model-v1. Report per proposer: pass / fail / refused counts,
  attempts used, PROPOSER_FAILED and DEPS_* / infra codes separately (an infra refusal is not a model loss).
- The ranking prompt, score formula and tie rule are frozen before the first hidden run and are not tuned on hidden
  results. With 12 dev tasks any dev difference is anecdotal; claim a gain only from the hidden half, and only as
  "model-v1 vs repair-v1 on the same N tasks", with the counts. If it does not beat repair-v1, say so; repair-v1 and
  rules-v1 stay the defaults either way (`bin/loop.ts` default stays rules-v1).
- lm.ts `LM_PROMOTION_RULE` (`minHeldOutTasks: 10`, `mustBeatBaseline: true`) is the natural bar for making it a
  default; the hidden set size decides whether that bar can be met.

## Open questions for Auditor

1. Which model: the memchecked LM (lm.ts, Results repo, has a memcheck PASS bound to its shas) or an lb-daily save
   from R2 (newer, but no memcheck; `infer.py score` refuses without one)? If lb, does it first need the M49
   memcheck/provenance path, and which save (the trusted record's latest) is pinned for an evaluation?
2. Isolation: is it acceptable for one job to hold the weights (scoring in `prepare`) and then run candidate code
   (attempts) after deleting them, given the baseline already ran candidate-uid tests? Or must scoring be a separate
   job that hands only the ranked candidate order (no weights) to the loop job, which would need `prepare` to read a
   precomputed ranking bound by sha256 to the task and candidate list?
3. Row binding: new row field (a v3 loop row with `model` = weights manifest sha256) or keep v2 and record the model
   only in the local `.peaceai-out/loop/<taskKey>.json` plus the workflow run id? Hidden rows must not leak more.
4. Is a precomputed ranking from scoring the request text a leak risk for hidden tasks (the request is scored inside
   a runner log)? Should the score job print nothing but counts?
5. Is "rerank only" a fair first step, or should v1 already compare a generate mode (`infer.py fill`)? Reranking
   cannot solve any task repair-v1 cannot reach within 60 candidates.
6. Minimum hidden-task count and the exact comparison (pass count at the same `--max`, or attempts-to-pass) Auditor
   wants before any claim.
