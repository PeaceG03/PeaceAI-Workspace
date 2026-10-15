# Set C v2 grader (M50, protected, unwired)

Grades predictions for the 138 #176 tasks (`peaceai/model/heldout-c-tasks.json`).

- `peaceai/lib/setc-grade.ts`, CLI `peaceai/bin/setc-grade.ts <predictions.jsonl> [EXT_DIR]` (aggregate counts only).
- Prediction: `{ "id", "body" }`, the body block from `{` to `}`.
- pass: the produced file parses, the named function's body closes exactly at the original span end, and its tokens
  (TypeScript scanner, trivia ignored) equal the original's. fail: no output, or parses but differs.
  ungradable: does not parse, or does not close at the original boundary, or longer than 20,000 chars.
- Every task is counted: pass + fail + ungradable = 138 (a missing prediction is a fail). Unknown ids are counted and
  ignored; duplicate predictions are refused. A pinned file or body span whose sha256 differs is refused, not graded.
- Static only: nothing from the target repos or the predictions is executed (no process, vm, eval or import);
  a test enforces it.
- Not wired into any workflow. Protected so PeaceAI cannot edit how it is graded.
