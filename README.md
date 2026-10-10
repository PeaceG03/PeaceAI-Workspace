# PeaceAI-Workspace

Public workspace where PeaceAI attempts small coding tasks on GitHub Actions, with no paid model.

## How a task runs

1. The owner opens an issue and adds the `peace-task` label. The workflow runs only when the issue
   author and the labeler are the owner and the repository variable `PEACEAI_ENABLED` is `true`.
2. **Job A (generate)**: re-checks the kill switch, clones the private kernel with a read-only deploy key
   into the runner temp directory, builds only the native synthesis entry point, and generates up to five
   candidate diffs against `src/`. A leak/scope gate must pass before anything is uploaded: candidates may
   only touch `src/**/*.ts`, may add but never change or delete tests, and may not contain kernel text.
   The kernel checkout is deleted in every case.
3. **Job B (test)**: no secrets. Each candidate is applied to a clean checkout. The original test suite
   runs on its own with new test files removed; new tests run in a separate pass.
4. **Publish**: passing candidates are ranked (original suite passes, then smallest diff). One PR is
   opened with the top candidate; the PR body lists every passing candidate in shuffled order with no
   scores. If nothing passes, the issue gets a comment.

## Checks

- `leak-check` runs on every PR into `main`: personal info and secret patterns, commit identities,
  and scope rules for protected files. A core-text backstop runs on every push to `main` and weekly.
- `ci` runs the type check, the `src` tests and the tooling tests.
- `key-proof` (manual, owner only) proves each deploy key has exactly the access it should.

## Writing tasks

The native edits are narrow. Phrasings that work today, for example:

- `Add a helper that will normalize a title by trimming surrounding whitespace in src/text.ts, with focused tests.`
- `Rename symbol slugify to toSlug in src/text.ts`

## Layout

- `src/`: the code tasks change, with its tests.
- `peaceai/`: workflow tooling (generation driver, gate, test runner, ranking, scans) and its tests.
