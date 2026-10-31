# PLAN-ONLY mode v1

Status: RUNNABLE, no longer the default (Builder, 2026-10-30; default moved to v3 (#650), then v4, in `peaceai/lib/plandefault.ts`,
see `peaceai/spec/plan-default.md`). Files byte-identical to main, plannerSha256 275e559b... unchanged; still runs via
`peaceai/bin/plan-only.ts run` or `peaceai/bin/plan.ts run --planner=v1`, and `plan-only.ts lock` still locks files.
Hidden half (Auditor, 20 tasks): mean 0.229, runTests 0.350 (the best runTests of v1/v2/v3). Code: `peaceai/lib/plan.ts` (planner, task files, training
check), `peaceai/lib/plangrade.ts` (grader, public log), `peaceai/lib/planrun.ts` + `peaceai/bin/plan-only.ts`
(runner). Tests: `peaceai/test/m144-plan-only.test.ts`.

## Why

Peace's direction: PeaceAI becomes a general coding agent, not a set of PeaceSTOCKS rules. The first step is to make
him say, for a plain task on a repo he has never seen, what the work is and which parts of it he can already do.
Plan-only measures that honestly and turns every gap into a named capability the team can teach as a skill.

## What a plan is

Input: a plain-language request and a repository pinned at a commit. Output (`peaceai-plan:v1`):

- `understanding`: clause count, the NB intent per clause, the M10 parse result, the anchors found.
- `files`: the relevant source and test files, each with a reason (named symbol, imports, same name, keyword match).
- `steps`: `edit-source` / `add-source` / `edit-test` / `add-test` / `run-tests`, each with a file and symbol, and:
  - `can-do` + `rule`: an approved learned rule (`id@sha256` from `approved.json`) produces that edit today, or for
    `run-tests`, `pipeline:job-b-tests` (Job B, only for a `targets.json` repo);
  - `missing` + one capability from a fixed list: `understand-request`, `locate-code`, `edit-existing-function`,
    `add-function-or-member`, `edit-constant`, `extend-existing-test`, `add-test-file`, `run-target-tests`.
- `tests`: the test files to extend and the repo's own test command.

Plan-only writes nothing to the target: the runner fetches the pinned commit into a temp checkout, plans from a
read-only view, then requires `git status --porcelain` empty and HEAD unchanged (else `TARGET_CHANGED`), and removes
the checkout. Missing steps are filled by the team teaching skills (new learned rules through the existing
derive/proposal/approval path), never by writing the task's code.

## Where the understanding comes from

Only PeaceAI's own code and his own small model, all already in the pipeline: the M10 clause splitter and naive
Bayes intent model (`nlparse.ts`, `peaceai/nl/model.json`), the M6 symbol and BM25 index (`symbols.ts`), and the
hash-pinned approved rules (`admitRules`, `applyRule`). No outside model API, no network beyond `git fetch` of the
pinned public commit, no paid compute, no training. The transformer LM is not consulted in v1 (its weights live in
the Results repo, not on the runner); wiring it in is a later, separately reviewed step. No parallel framework: rules,
approvals, targets and the training lists are read from their existing files, never copied.

## Task files

`peaceai-plan-tasks:v1`, `set` = `public` or `hidden`. Each task: `id`, `repo`, `license` (MIT, Apache-2.0,
BSD-2-Clause, BSD-3-Clause, ISC), `licensePath` + `licenseSha256` (checked at run time, else `LICENSE_CHANGED`),
`commit` (the pre-change commit), `request` (plain words, written by the task author, not copied from the issue),
`tests` (command + the test files that prove it done), `reference` (the real merged change: PR number, merge sha,
files, steps with symbols, doc files not graded), `trainingCheck` (the Workspace commit and number of training lists
the check read, `inTraining: false`).

Public half: `peaceai/plan/tasks-public-v1.json`, 12 tasks from 11 repos in 8 orgs, all MIT. Hidden half: owned by
Auditor; Builder never sees or creates it. The runner accepts any task file path, so Auditor runs the same code on a
file Builder has never seen; a hidden-set run row carries a task key, codes and numbers only (no repo, commit or id).

## Training-data exclusion (Auditor's condition, binding)

No repo, issue or fix in the task set may appear in PeaceAI's training data. Checked by repository identifier
(case-insensitive) against `trainingRepos()`: every `name` / `repo` / `repos` value in `peaceai/model/*.json` (corpus
sources, held-out sets, LM retrain config and data lists) and in the pretraining manifest parts
(`peaceai/model/ext-manifest/*.jsonl`), plus every repo named as evidence by a learned rule, proposal or evidence
file in `peaceai/rules`. Over-inclusive on purpose (a held-out or refused repo also counts) and fail-closed (an
unreadable list refuses the whole run: `TRAINING_LIST_UNREADABLE`).

- The runner refuses a task whose repo is in that set (`TRAINING_OVERLAP`) before fetching anything.
- m144 re-checks every public task live, so a future source or rule that names a public task repo fails CI.
- Consequence: PeaceSTOCKS and the Workspace are training sources, so the "few PeaceSTOCKS tasks" asked for are not
  in v1. unjs/ufo and toss/es-toolkit were dropped too (named as rule evidence).
- Future retrain sources: before any retrain, the new source list is checked against the FULL task-set repo list,
  hidden half included. Auditor holds that list and runs the check, by repo identifier only. Builder does not get the
  hidden list or a hash of it (repo names are guessable, so a hash would leak them).

## Locked and logged

`peaceai/plan/runs.jsonl` is add-only (every committed version is a byte prefix of the next; m144 walks the git
history). `plan-only.ts lock <file>` appends a lock row (`peaceai-plan-lock:v1`: set, sha256 of the file bytes, task
count). `plan-only.ts run <file>` refuses unless that sha's lock row is in the COMMITTED log at HEAD
(`TASK_FILE_UNLOCKED`), so a file is pinned in history before any run and any edit to it needs a new lock. Each task
appends a run row (`peaceai-plan-run:v1`): task key, repo + commit (public only), Workspace HEAD, planner version and
sha256 of the planner code, plan sha256, a fixed code, and the grade numbers. A validator fixes the keys and value
shapes, so no URL or error text can be logged. Full plans go to `.peaceai-out/plan/` (gitignored).

Codes: `OK`, `TASK_FILE_UNLOCKED`, `TASK_FILE_INVALID`, `TASK_INVALID`, `LICENSE_NOT_ALLOWED`, `TRAINING_OVERLAP`,
`TRAINING_LIST_UNREADABLE`, `FETCH_FAILED`, `LICENSE_CHANGED`, `COMMIT_MISMATCH`, `TARGET_CHANGED`, `PLAN_FAILED`.

Follow-up: a CI job that checks the add-only rule on every PR (workflows are protected, so it is proposed separately).

## Grading (grader plan-grade-v2)

Auditor FAILed the first grader (v1, rows without a `grader` key) at b90cddd because it inflated the score: the
run-tests step was free credit and the step share was recall only. v2:

- Work steps are the source and test steps (`edit-source`, `add-source`, `edit-test`, `add-test`). A plan step
  matches a reference step when the action class agrees (source / test) and the file is the same; each reference
  step matches at most once.
- Headline per task: `score` = matched / max(required, planned) over work steps. Chosen over F1 because it is one
  simple ratio that drops for every missed step AND every extra or wrong step (a padded plan scores strictly lower
  than the exact plan; m144 checks this). `recall` and `precision` are reported beside it.
- `runTests` (0 or 1) is reported on its own and never folded into `score`: 1 only when the plan has a run-tests
  step and names a reference test file or the task's exact test command. A run-tests-only plan scores 0.
- `fileRecall`, `filePrecision`, `testRecall`; `canDoClaimed`, `canDoVerified` (the named rule is still approved
  and, re-run on that file, still edits it, and the step matched; run-tests only for a targets.json repo);
  `canDoAccuracy` = verified / claimed (null when none claimed); `ownShare` = matched and verified work steps /
  max(required, planned); `teamShare` = 1 - ownShare, credited to the team.

Which number counts: on the public half the score is a DEVELOPMENT score only. The planner was built while reading
the public wording (written by Builder), so it says how the code behaves, not how well PeaceAI plans. The headline
score is the hidden half's (Auditor's tasks, real issue text), run by Auditor. The runner prints `devScore` for a
public file and `score` for a hidden one. Planner changes are never tuned on the hidden half.

Log rows written by v2 carry `"grader": "plan-grade-v2"` and the v2 grade shape; the v1 rows stay in the add-only
log unchanged and are told apart by the missing `grader` key.
