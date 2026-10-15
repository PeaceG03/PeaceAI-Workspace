# Set C v2 grader (M50, protected, unwired)

Grades predictions for the 138 #176 tasks (`peaceai/model/heldout-c-tasks.json`).

- `peaceai/lib/setc-grade.ts`, CLI `peaceai/bin/setc-grade.ts <predictions.jsonl> [EXT_DIR]` (aggregate counts only).
- Prediction: `{ "id", "body" }`, the body block from `{` to `}`.
- pass: the produced file parses, the named function's body closes exactly at the original span end, and its tokens
  (TypeScript scanner, trivia ignored; template literals are rescanned after each `${...}` so template text is compared verbatim) equal the original's. fail: no output, or parses but differs.
  ungradable: does not parse, or does not close at the original boundary, or longer than 20,000 chars.
- gradeAll and the CLI refuse to grade unless the task list holds exactly its declared count (sum of per-repo `chosen`, 138).
- Every task is counted: pass + fail + ungradable = 138 (a missing prediction is a fail). Unknown ids are counted and
  ignored; duplicate predictions are refused. A pinned file or body span whose sha256 differs is refused, not graded.
- Static only: nothing from the target repos or the predictions is executed (no process, vm, eval or import);
  an AST test enforces it (exact import allow-list: lib = typescript, node:crypto; CLI = node:fs and the lib; no eval, require, Function, globalThis, computed member access or dynamic import).
- Not wired into any workflow. Protected so PeaceAI cannot edit how it is graded.

Auditor #177 follow-up: the no-exec AST audit allows only the listed `ts` members (no `createProgram`, `sys`,
`transpile*`) and only `readFileSync` from `node:fs` (named import); it bans `getPrototypeOf`,
`getOwnPropertyDescriptor(s)`, `getOwnPropertyNames` and `setPrototypeOf`. The tokenizer treats `/` as a regex only
after a token that cannot end an operand. `gradeAll(list, readSource, predictions)` takes the task list and checks
`tasks.length` against the list's own `declaredCount`.
