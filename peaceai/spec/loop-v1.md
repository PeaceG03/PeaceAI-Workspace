# Sandboxed test-and-fix loop v1

Status: draft for Auditor review (Builder, 2026-10-30). Code: `peaceai/lib/loop.ts` (loop, copy, edits, isolated
test runs, rules proposer), `peaceai/lib/looprow.ts` (loop log row + validator), `peaceai/bin/loop.ts` (CLI).
Tests: `peaceai/test/m146-loop.test.ts`, `peaceai/test/m146-loop-mutation.test.ts` (cases in
`m146-loop-cases.ts`, fixtures in `m146-fixtures.ts`). Builds on plan-only v1 (`plan-only-v1.md`, PR #634) and the
code search tools (PR #635).

## What it does

Given a task from a locked plan-only task file (request + repo pinned at a commit, team merge commit and test files):

1. refuse PeaceAI's own repos (`SELF_TARGET`) and refuse without the stage-2 candidate uid (`CAND_UID_*`), before
   anything is fetched;
2. fetch the pinned commit into a throwaway copy (no remote configured; nothing is ever pushed), check the commit and
   license against the task;
3. plan the task (plan-only v1 planner) and search the copy for context (code search tools, read-only);
4. ask the proposer for an edit;
5. check the repo can be run (node:test runner, no dependencies to install in v1), put the team's test files in place,
   install the isolation wrapper, and require the team tests to FAIL on the unedited copy (else `BASELINE_PASSES`);
6. per attempt (1..N, N <= 20, default 3): reset the copy, put the team tests back, apply the edit (all or nothing),
   run the team tests in the stage-2 isolation, read the result as fixed codes plus failing test names;
7. stop on `PASS`, on `ATTEMPT_LIMIT`, or on a refusal (`NO_EDIT`, `NO_MORE_EDITS`, `EDIT_OUTSIDE_COPY`,
   `TEAM_TEST_EDIT`, `ISOLATION_UNAVAILABLE`, ...). The copy is always removed.

## Proposer

Only PeaceAI's own machinery. v1 proposer `rules-v1`: for each `can-do` step of the plan, the edit its approved
learned rule (`applyRule`, hash-pinned `approved.json`) produces; one candidate per attempt; when there is none,
`NO_EDIT` before any run, and `NO_MORE_EDITS` when the candidates run out. The transformer LM is not consulted: its
weights (`config.json`, `tokenizer.json`, `weights.npz`) live in the Results repo and cannot be loaded without Results
secrets, so every row says `lm: "not-loadable"`. No outside model, no paid compute. Solving 0 public tasks is an
honest v1 result.

## Safety (binding)

- Candidate code runs only through the existing stage-2 isolation: `guardedRun` / `isolatedRun` in `selfpropose.ts`
  (M106/M109), as the uid named by `PEACEAI_STAGE2_CAND` (`stage2CandUid`: separate, no sudo), `env -i` with the
  suite allowlist, private HOME/TMPDIR, the copy made read-only to the candidate, leftover processes killed, tamper
  hashes on the team test files. `selfpropose.ts` is not modified; there is exactly one run site.
- No network and no writes outside the copy: the copy's `node_modules/.bin/tsx` is a wrapper that enters a new user,
  network and mount namespace (`unshare -r -n -m`), bind-mounts `/tmp`, `/var/tmp`, `/dev/shm` read-only (the private
  TMPDIR stays writable), maps back to the candidate uid and runs node. If namespaces are unavailable the wrapper
  exits 97/98 and the loop stops with `ISOLATION_UNAVAILABLE` (fail closed; never a run without it).
- The stage-2 self-change flag (`peaceai/self/stage2.json`) stays off and is never read or written by the loop.
  The loop targets external task repos only.
- Edits: relative paths inside the copy only; absolute, `..`, `.git`, `node_modules`, symlink and realpath escapes
  are refused (`EDIT_OUTSIDE_COPY`); edits to the team's test files are refused (`TEAM_TEST_EDIT`). Nothing is written
  until every path is checked.
- Never push: the copy has no remote; the code never runs `git push`.

Each guard is one line tagged `// guard:<id>` (abs, dotdot, git-nm, realpath, symlink, team-tests, wrapper,
isolated, isolation-exit, self-target, cand, lock). The m146 mutation test deletes each tagged line in turn and
requires a case to fail. The isolation guards (wrapper, isolated, isolation-exit, team-tests) are only exercised
where the candidate uid exists; the CI tools job has none, so there they are skipped and the loop cases assert the
`CAND_UID_*` refusal instead.

## Log and scoring

Own add-only log: `peaceai/plan/loop-runs.jsonl`. The task file must be locked in the COMMITTED plan-only log
(`peaceai/plan/runs.jsonl`, `plan-only.ts lock`) first
(`TASK_FILE_UNLOCKED` otherwise), any task file path works (the Auditor's hidden file), the same training-exclusion
and license rules. One `peaceai-plan-loop:v1` row per task:
`attempts`, `maxAttempts`, `result` (pass / fail / refused), `code`, `attemptCodes` (per attempt: `TEST_FAIL`,
`TIMEOUT`, `LEFTOVERS`, `TAMPERED`, `NO_TESTS_RAN`), and `tests` = `{ total, passedByPeaceAI, filledByTeam }` for the
team's tests on the last attempt (null if no attempt ran). Rows carry codes and numbers only: no test names, no
failure text, no file content. Hidden-set rows also carry no repo or commit. Failing test names stay local, in
`.peaceai-out/loop/<taskKey>.json`. `looprow.ts` validates loop rows (`loopRowProblem`, `parseLoopLog`,
`loopAddOnlyProblem`). The plan-only files (`plangrade.ts`, `planrun.ts`, `runs.jsonl`) are not edited, so the
planner fingerprint (`plannerSha256`) is unchanged by the loop.

## v1 limits

- Only node:test suites (`node --test` / `tsx --test` test command) with no dependencies to install: installing
  packages would run outside code at install time, which v1 does not do (`TEST_RUNNER_UNSUPPORTED`,
  `DEPS_UNSUPPORTED`).
- Rules-only proposer; no LM.
- Needs the candidate uid and unprivileged user namespaces on the runner.
