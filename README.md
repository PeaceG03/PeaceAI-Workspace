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
   secrets: the original suite alone (new test files removed), then the new tests alone.
5. **Job C (record)** writes the task, every candidate diff, both test passes, the scores, eligibility
   and the blind ranking to the private Results repository, and commits it **before** anything is
   shown. If the task asks for tests, candidates without a new test are rejected before ranking.
6. **Review** (requires Job C) posts one comment listing every eligible candidate as A, B, C... in a
   random order, all formatted identically, with no scores, ranks or preferred candidate.

## Verdicts

Reply on the issue (owner only):

- `/verdict <letter> right`: that candidate is correct; it becomes your pick and a PR is opened for it.
- `/verdict <letter> wrong` or `/verdict <letter> unsure`: a label for that candidate (not a pick).
- `/verdict none wrong`: no candidate is acceptable (a pick of "none"). `/verdict none unsure` is recorded only.

Malformed commands get a short usage reply. Verdicts are appended to Results.

**Agreement** compares the ranker's blind top pick with your latest decisive verdict (`<letter> right`
or `none wrong`). It counts only tasks with two or more eligible candidates; `unsure` is recorded but
never counted; test tasks are excluded.

**Held-out set**: a task is held out when the first 4 bytes of `sha256("peaceai-heldout:v1:<issue>")`,
read as a fraction, are below 0.2 (about 20%). Held-out tasks are recorded and reviewed like any
other but are never used for training; agreement is also reported for them separately.

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

## Kill switch

Set the repository variable `PEACEAI_ENABLED` to anything other than `true`, then cancel any
in-progress `peace-task` run (`gh run cancel <id>` or the Actions page). Intake, the sweep and Job A
all check the variable; a cancelled run leaves its issue `peaceai:running`, which the next sweep marks
`peaceai:failed`. To cancel a single task instead, remove its `peace-task` label.

## Checks

- `leak-check` runs on every PR into `main`: personal info and secret patterns, commit identities,
  and scope rules for protected files. A core-text backstop runs on every push to `main` and weekly.
- `ci` runs the type check, the `src` tests and the tooling tests.
- `peace-verdict` records `/verdict` comments (see above).
- `key-proof` (manual, owner only) proves each deploy key has exactly the access it should.

## Writing tasks

The native edits are narrow. Phrasings that work today, for example:

- `Add a helper that will normalize a title by trimming surrounding whitespace in src/text.ts, with focused tests.`
- `Rename symbol slugify to toSlug in src/text.ts`

## Layout

- `src/`: the code tasks change, with its tests.
- `peaceai/`: workflow tooling (generation driver, gate, test runner, ranking, scans) and its tests.
