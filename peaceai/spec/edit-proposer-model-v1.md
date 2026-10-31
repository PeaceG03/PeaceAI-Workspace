# Model-backed edit proposer v1

Status: IMPLEMENTED, NOT RUN (Builder, 2026-10-31, batch 8: M166 rows v4, M167 proposer + jobs; design revised with
Auditor's rulings on #662). Nothing has been dispatched. Every model-v1 run needs Auditor and Peace first: Builder
dispatches peace-model-v1-dev.yml only after Auditor PASS on the implementation PRs. The design sections below
describe main ec36fc1; "Implementation (M167)" says what was built and where it differs.

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

## Implementation (M167)

Files: `peaceai/lib/modelpropose.ts` (attempt side), `peaceai/lib/modelscore.ts` (scoring side),
`peaceai/bin/model-v1-score.ts`, `peaceai/bin/model-v1-fetch.sh`, `peaceai/model/model-v1-proposer.json` (the pin),
`.github/workflows/peace-model-v1-dev.yml`, `bin/loop.ts --proposer model-v1`; tests in
`peaceai/test/m167-model-proposer.test.ts` (tiny fixtures, a fake scorer, every `// m167-guard:` line deleted in turn
plus semantic mutants). Rows: M166 `peaceai-plan-loop:v4`, `modelManifestSha256` from the ranking.

- Shared code, so the two lists are the same list: `editpropose.ts` `repairCandidates(sites, files)` (repair-v1's
  queue builder, moved out unchanged) and `loop.ts` `indexFiles(dir)` (the proposer's file index). `repairProposer`
  takes `{ name, order }`; model-v1 is repair-v1 with `order` = apply the ranking, so `next`, the feedback rules, the
  one combination and the refusals are repair-v1's own code. `loopSha256` now also binds `lib/modelpropose.ts`
  (`m167-guard:sha-model`).
- Deviation from step 2 above: model-v1's `prepare` runs repair-v1's search on the request ONLY (`failing: []`),
  not with the baseline's failing test names, because the scoring job runs no tests and so cannot know them; the
  candidate lists must be equal, and both jobs then search the same thing. repair-v1 itself is unchanged.
- Scoring job gate (`modelscore.ts` `scoringJobAllowed`, stricter than `lmJobAllowed`): GITHUB_ACTIONS=true, job
  `model-v1-score`, repository PeaceG03/PeaceAI-Workspace, event workflow_dispatch, ref refs/heads/main, workflow ref
  `.../peace-model-v1-dev.yml@refs/heads/main`, and not PEACEAI_CANDIDATE_JOB. `LM_JOB_WORKFLOWS` pins
  `model-v1-score` to that workflow, so `runInfer`'s own gate passes there and nowhere new. The box is refused.
- Model: the pin is judge-v2.json `promoted` (lm-v1-858573767465, run 40694718190, weights sha256 8585...9255).
  `model-v1-fetch.sh` restores it from Results main into the runtime layout (`models/lm/<v>/` with memcheck.json,
  `runs/lm-retrain/<run>/memcheck-recheck-*.json`), checks the weights against the pin and drops `.git`; the score
  step then requires `verifyModelDir` ok (memcheck PASS or a PASS recheck bound to these files), the version and the
  weights sha256 to be the pin, else it refuses and there is no ranking. infer.py re-checks the memcheck itself.
- Score: per candidate one `infer.py score` item, target = the changed lines (common prefix and suffix lines
  dropped, at most 2000 chars), context = `// <request, whitespace folded, at most 400 chars>`, `// <path>` and up to
  30 lines before the change. Rank = mean log P (logprob / tokens), high first; unscored last; ties keep repair-v1's
  order. Any infer refusal, or scores not exactly one per item in order, gives no ranking (the job fails).
- No network after scoring starts: the candidate lists are built first (anonymous clones of the pinned commits; no
  team tests, no install, no candidate code), then the score step runs under `sudo unshare --net` (as the runner
  user again via setpriv, with a minimal env), and `model-v1-score.ts score` also refuses unless only an
  address-less loopback is left (`offline`). The model is deleted when the job ends.
- Logs: counts only (tasks, lists, candidates, reordered lists, ranking bytes) and the ranking's sha256. No task text,
  repo name, score or code is printed by the scoring job.

## Hand-off without artifacts (resolves open item 2)

The ranking travels as two job outputs of `model-v1-score`: `ranking` (one compact JSON line, at most 64 KiB, of
index lists only) and `ranking_sha256` (sha256 of exactly that text). Nothing is uploaded, cached or committed.

```
{"schema":"peaceai-model-v1-ranking:v1","taskFileSha256":<64 hex>,"weightsSha256":<the pin>,
 "modelManifestSha256":<64 hex>,"entries":[{"taskKey":<16 hex>,"candidatesSha256":<64 hex>,
 "order":[<a permutation of 0..n-1, n <= 60>],"bindingSha256":<64 hex>}, ...]}
candidatesSha256 = sha256(JSON.stringify(<the candidates' keys, in repair-v1 order>))
bindingSha256    = sha256("peaceai-model-v1-ranking:v1\n" + modelManifestSha256 + "\n" + taskKey + "\n"
                          + candidatesSha256 + "\n" + order.join(",") + "\n")
modelManifestSha256 = sha256 of the manifest text defined in ruling (c) above
```

`model-v1-attempt` (`needs: model-v1-score`, no environment, no secrets, PEACEAI_CANDIDATE_JOB=true) writes the
`ranking` output (through an env var, never interpolated into a script) to a file and runs
`bin/loop.ts run <taskFile> --max 20 --proposer model-v1 --ranking FILE --ranking-sha256 <ranking_sha256>`.
`modelpropose.ts` `parseRanking` refuses (and every task then ends PROPOSER_FAILED, with
`modelManifestSha256: null` and no attempts) unless: the text exists, is at most 64 KiB and hashes to
`ranking_sha256`; it is exactly that schema and key set; the manifest sha256 is 64 hex; `taskFileSha256` is the task
file being run; `weightsSha256` is the pin; task keys are unique and well formed; every order is a permutation of at
most 60. Per task, `prepare` refuses unless there is exactly one entry for this task key, and the reorder refuses
unless `candidatesSha256` is the sha256 of the list THIS job rebuilt, `bindingSha256` recomputes, and the order is a
permutation of this list. Never a fallback to repair-v1's order. What this does and does not protect against: a
corrupted or truncated output, a ranking for another task file, another model or another candidate list are all
refused; the sha256 is computed by the same workflow run that produced the ranking, so it is an integrity check
inside one run on main, not a signature (anyone able to change that run could change both; the workflow is
protected and runs pinned code from main). Job outputs carry no secret, and the ranking holds no code or text.

## The pre-registered `--max` (resolves open item 3)

The pre-registered `--max` is 20, fixed in `peaceai/model/model-v1-proposer.json` `maxAttempts` before any run;
`bin/loop.ts` refuses model-v1 at any other `--max` (MODEL_V1_MAX_NOT_PREREGISTERED) and on any task file but
`peaceai/plan/tasks-public-v1.json` (MODEL_V1_DEV_TASK_FILE_ONLY). Why 20: every repair-v1 dev run in
`peaceai/plan/loop-runs.jsonl` (24 rows, the 12 public tasks twice) ran at `--max 20`, so the pairing needs no new
repair-v1 baseline at another budget; it is also `MAX_ATTEMPTS`, the loop's cap, so it is not "small" in absolute
terms, and that is stated here rather than hidden. Because a pass ends the loop, each passing row's `attempts` is the
rank of the first passing candidate, so the same rows also give pass within 1, 3 and 5 attempts as secondary,
descriptive numbers (no gain claim). The attempt job runs repair-v1, model-v1 and rules-v1 at 20 on the same commit,
same planner default and same candidate uid (`peaceai-cand`), in that order, and prints the appended rows (public
set only: codes and numbers, as the committed log) with their sha256, for Builder to commit verbatim.

## Open items

1. Hidden scoring (owned by Peace / Auditor): whether and where hidden tasks can be scored, and whether model weights
   may run where Auditor does hidden runs. Auditor raises it with Peace when the proposer is ready.
2. Resolved in M167 (job outputs + sha256, above), for Auditor's review.
3. Resolved in M167 (`--max 20`, above), for Auditor's review.
4. Not checked from the box: that Results holds a PASS memcheck (or PASS recheck) for the pinned model in the runtime
   layout. The score step fails closed (no ranking) if it does not.
