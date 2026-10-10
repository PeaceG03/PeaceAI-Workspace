# PeaceAI-Workspace

Public workspace where PeaceAI attempts small coding tasks on GitHub Actions, with no paid model.

## How a task runs

1. The owner opens an issue and adds the `peace-task` label. `peace-intake` (owner author, owner
   labeler, `PEACEAI_ENABLED == 'true'`) only adds `peaceai:queued` and starts a sweep.
2. `peace-task` is a serialized sweep (one run at a time). Each run takes the **oldest** open,
   owner-labeled task without a state label, marks it `peaceai:running`, processes it, then marks it
   `peaceai:done` or `peaceai:failed` and starts another sweep while tasks are waiting. A schedule
   (every 30 minutes) backs this up. GitHub may cancel a *pending* sweep when another is queued; no
   task is lost because tasks wait as labels, not as runs.
3. **Job A (generate)** confirms the issue is still open, owner-authored and running (remove the
   label or close the issue to cancel a task), clones the private kernel with a read-only key into the
   runner temp directory, builds only native synthesis, and generates up to five candidate diffs. The
   leak/scope gate must pass before upload; the kernel checkout is always deleted.
4. **Job B (test)** runs one matrix job per candidate on a fresh runner with read-only tools and no
   secrets: the original suite alone (new test files removed), then the new tests alone. Candidate
   code runs only as the unprivileged `peaceai-cand` user (see *Tamper-proof results*).
5. **Job C (record)** writes the task, every candidate diff, both test passes, the scores, eligibility
   and the blind ranking to the private Results repository, and commits it **before** anything is
   shown. If the task asks for tests, candidates without a new test are rejected before ranking.
6. **Review** (requires Job C) posts one comment listing every eligible candidate as A, B, C... in a
   random order, all formatted identically, with no scores, ranks or preferred candidate.

## Verdicts

Reply on the issue (owner only):

- `/verdict <letter> right`: that candidate is correct; it becomes your pick and a PR is opened for it.
  If an open PeaceAI PR already holds that candidate, no second PR is opened. If an open PeaceAI PR
  holds a different candidate, it is closed with a short comment and the new candidate's PR is opened.
- `/verdict <letter> wrong` naming your current pick (the standing `<letter> right`): withdraws your
  verdict, with the same `verdict-withdrawn` PR marking as below.
- Any other `/verdict <letter> wrong`: a label for that candidate (not a pick); your pick still counts.
- `/verdict none wrong`: no candidate is acceptable (a pick of "none"); any open PeaceAI PR for the issue is closed.
- `/verdict none unsure`, or `/verdict <letter> unsure` naming your current pick (the standing
  `<letter> right`): withdraws your verdict. Any open PeaceAI PR for the issue gets the
  `verdict-withdrawn` label and a "do not merge" comment; picking that candidate again removes it.
- Any other `/verdict <letter> unsure`: a label for that candidate only; your pick still counts.

Malformed commands get a short usage reply. Verdicts are appended to Results.

**Latest verdict wins.** Raw verdict rows are append-only; every reader goes through
`effectiveVerdict` (`peaceai/lib/records.ts` for rows, `peaceai/lib/store.ts` for an issue), applying
rows in time order (then comment id), using only the issue's latest attempt:

- `none unsure`, or `<letter> unsure` / `<letter> wrong` on the standing `right` pick, withdraws: the
  issue is excluded from training and agreement until the next decisive verdict (`A right`, `A unsure`
  = excluded; `A right`, `A wrong` = excluded; `A right`, `none unsure` = excluded; then `B right` counts B);
- any other `<letter> unsure` or `<letter> wrong` is a label only (`A right`, `C unsure` or `C wrong`
  = A still counted); `none wrong` is a decisive pick of "none";
- training uses the latest standing verdict (`latest`);
- agreement uses the latest standing decisive verdict, `<letter> right` or `none wrong` (`pick`).

Branches are `peace-task/issue-<n>-<candidate>-<hex>`, so an open PR never holds a candidate other
than the counted `right` pick.

**Agreement** compares the ranker's blind top pick with that pick. It counts only the latest attempt
per issue, only tasks with two or more eligible candidates, and excludes test tasks.

**Held-out set**: a task is held out when the first 4 bytes of `sha256("peaceai-heldout:v1:<issue>")`,
read as a fraction, are below 0.2 (about 20%). Held-out tasks are recorded and reviewed like any
other but are never used for training; agreement is also reported for them separately.

**Task source**: `source:builder` marks a `peace-task` opened by the Builder agent. The label is read
when the task is picked and stored as `source` (`peace` | `builder`) in `task.json` and the summary.

**Test tasks**: an issue title starting with `[test]` marks the records as test; they are excluded
from training and agreement.

## Results layout (private repository)

```
tasks/<issue>/<run id>/task.json        task text, test/held-out flags, tests-required flag
tasks/<issue>/<run id>/ranking.json     per-candidate tests, scores, eligibility, blind ranking, presentation
tasks/<issue>/<run id>/candidates/*.diff
tasks/<issue>/<run id>/verdicts/<comment id>.json
index.jsonl                             append-only log of task records and verdicts
summary.json                            derived: per-task entries, agreement, held-out agreement
```

Records are never rewritten; `summary.json` is recomputed from the records on each write.

## Shadow ranker (M3)

The deterministic ranking (original suite, then smallest diff, plus the tests-required rule) stays
authoritative. A CPU ranker is trained and recorded in **shadow** mode:

- **Features** (`features:v1`, `peaceai/lib/ranker/features.ts`): from Results records only (ranking,
  task text, candidate diffs): diff size and lines added/removed, files touched, new files, new tests,
  test cases and assertions added, test/typecheck results, edit kinds and task keywords (hashed into
  buckets so no vocabulary is in this repo), smallest-diff flags.
- **Model** (`peaceai/lib/ranker/model.ts`): pairwise logistic regression (linear RankNet), seeded SGD,
  standardized features, L2. Reproducible: same data and seed give the same bytes and version.
- **Training data**: latest attempt per issue, latest standing decisive verdict picking an eligible
  candidate, 2+ eligible, not test, not held out, not withdrawn. Pairs: Peace's pick over each other
  eligible candidate. Both sources by default; `PEACEAI_TRAIN_SOURCES` (`peace,builder`) filters and
  `PEACEAI_SOURCE_WEIGHTS` (e.g. `builder=0.5`) weights; metrics are split by source.
- **`peace-train`** (dispatch, and after every recorded verdict except on `[test]` issues; Results key only) writes
  `models/<version>/metrics.json`, `model.json` (only when trained) and `models/latest.json` to Results.
  Fewer than 10 trainable tasks: "insufficient data", no model. Held-out top-pick agreement (model vs
  baseline, 2+ eligible only) below 5 tasks is also reported as "insufficient data".
- **Shadow scoring**: Job C loads the latest model, if any, and records `shadow` (order, top, scores)
  in `ranking.json` before the review. The review comment is unchanged. No model, nothing extra.
- **Promotion** (off): needs 30+ trainable tasks, 10+ held-out tasks and the model beating the baseline
  on held-out, and only then takes effect if Peace sets the repository variable `PEACEAI_RANKER=model`.
  The record then has `active: "model"` and `activeTop` from the model.

## Tamper-proof results

A candidate's tests must not be able to write or forge their own result. On GitHub-hosted runners the
strongest practical boundary is a separate Unix user (containers would add the same uid split with
more moving parts and Docker-socket risk; a separate job would still need to run the code somewhere).
Job B creates `peaceai-cand` (system user, no home, no shell, no sudo) and the harness:

1. builds the candidate tree in `/tmp` owned by the runner user: readable, not writable, by `peaceai-cand`;
2. runs the type check and both test passes with `sudo -u peaceai-cand env -i ...` (no tokens, private
   `HOME`/`TMPDIR`), and takes pass/fail only from the exit code it captures;
3. kills every `peaceai-cand` process after each command, so nothing can linger and write later;
4. only then writes the result (temp file + rename) under the runner temp directory, which
   `peaceai-cand` cannot write, and a later step uploads it.

A different uid also cannot signal or trace the harness or read its `/proc` environment. The harness
refuses to run without the sandbox in CI (`PEACEAI_REQUIRE_SANDBOX`). `ci` runs
`peaceai/proof/tamper-proof.ts` on every PR: a malicious candidate breaks the code and forges its
result directly and through delayed background writers. Without the sandbox (control) the forgery
lands; with it the recorded result stays correct.

## Kill switch

Set the repository variable `PEACEAI_ENABLED` to anything other than `true`, then cancel any
in-progress `peace-task` run (`gh run cancel <id>` or the Actions page). Intake, the sweep and Job A
all check the variable; a cancelled run leaves its issue `peaceai:running`, which the next sweep marks
`peaceai:failed`. To cancel a single task instead, remove its `peace-task` label.

## Checks

- `leak-check` runs on every PR into `main`: personal info and secret patterns, commit identities,
  and scope rules for protected files. A core-text backstop runs on every push to `main` and weekly.
- `ci` runs the type check, the `src` tests, the tooling tests and the tamper-proof check.
- `peace-verdict` records `/verdict` comments (see above).
- `key-proof` (manual, owner only) proves each deploy key has exactly the access it should.

## Writing tasks

The native edits are narrow. Phrasings that work today, for example:

- `Add a helper that will normalize a title by trimming surrounding whitespace in src/text.ts, with focused tests.`
- `Rename symbol slugify to toSlug in src/text.ts`

## Layout

- `src/`: the code tasks change, with its tests.
- `peaceai/`: workflow tooling (generation driver, gate, test runner, ranking, scans) and its tests.
