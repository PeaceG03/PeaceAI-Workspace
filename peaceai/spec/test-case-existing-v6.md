# TEST_CASE_EXISTING v6 (`public-test-case-existing-v6`, M93)

Second pick of the post-v4 census (notes `batch-v4/v9/NEXT-SKILL.md`): `unknown` parameters (5 on PeaceSTOCKS) and
`NodeJS.ProcessEnv` parameters (5, three of them with the default `= process.env`). v6 is a NEW spec with its own
hash; v1-v5 keep their hashes and their accept sets (every v6 branch runs only with the v6 flag).

## Shape

Same trigger, check grammar, output (one new test file next to the module, importing only the named function) and
fix-free grading as v5. Only `params.target` differs: `exported-pure-function-v6`.

- `unknown`: a parameter whose WHOLE type is `unknown` (optionally `p?: unknown`). Checks still pass only
  plain-data literals (the v3 `plain-data-v3` args mode, unchanged), so the body only ever sees strings, numbers,
  booleans, null, arrays, plain objects and fixed Dates. `unknown` nested in another type (`Record<string, unknown>`,
  `unknown[]`, unions), `unknown` as the return type and `any` anywhere stay refused (`test_target_signature`).
- `NodeJS.ProcessEnv`: a parameter whose whole type is the global `NodeJS.ProcessEnv` (no type arguments; refused if
  the module declares or imports a `NodeJS` name), read as `Record<string, string | undefined>`. The body gets the
  normal purity walk, so writing to the env object (`env.X = ...`, `delete env.X`) is refused as impure.
- `= process.env` default: allowed only on a `NodeJS.ProcessEnv` parameter of the tested function itself, and only as
  exactly that expression (the global `process`, never shadowed). That default is skipped by the purity walk; any
  other default keeps the v4 rule (analyzed like the body, so `process` elsewhere is still `test_target_io`), and a
  followed helper's `process.env` default is still walked and refused. In exchange:
  - Job A: every call of the function in every check must pass an object literal at that position (so the default
    never runs). A check that omits it, passes `undefined`, or passes a non-literal is refused (`test_check_refused`).
  - Job B: the graded test file is re-checked the same way (`envArgProblem`): every call passes an object literal for
    each `= process.env` parameter, and the function is never referenced except as a callee or in its import.
    Otherwise the candidate is `UNGRADABLE` (`not-test-only`).
  - Both jobs (Auditor #460, `envTargetReferenced`, re-run by the Job B re-check on the real tree): nothing but the
    test may reach the default. The target is refused (`test_target_io`) when code of its module that runs with it
    (its own body, every followed function or const, every top-level statement other than a function declaration)
    references it except as a direct call passing, at each `= process.env` position, an object literal or (in its own
    body only) its own env parameter that is never assigned in the module nor re-declared inside it; when the module has a dynamic `import()`;
    or when any module of the relative value-import closure imports or re-exports the target module (or the closure
    has more than 64 modules). So `f(n - 1)`, `f(n - 1, undefined)`, `const g = f`, `export const X = f(0)`, a followed
    function calling `f(0)` and a sibling importing `f` back are refused; `f(n - 1, env)` and `f(n - 1, {})` are kept.
  - Auditor #460 (2nd review): the walk also covers every top-level function that load-time code (a top-level
    statement other than a function declaration), the target or a followed function can name, transitively (so
    `export const READY = h()` with `h` calling `f(0)` is refused). In the closure, a relative value or side-effect
    import that is not exactly one readable `.ts` module (`./c.mjs`, `./c.js` with no `c.ts`, `./data.json`) is refused,
    and so are `require(...)`, `import x = require(...)` and dynamic `import(...)` (in the target module, wherever the
    walk reaches; in every other closure module, anywhere). All are `test_target_io`.
- `not_needed`: a target v1-v5 accepts is left to that spec, so two specs never both answer one task.

## Grading

Job B re-checks the target under the v6 analysis only for a candidate whose operation id names
`public-test-case-existing-v6` (with v2-v5 set), then applies the env-argument check above; the candidate is graded
with the v2 object-aware stub. Every other candidate is re-checked exactly as before.

## Census gain

PeaceSTOCKS ef9778e (main): v1 34, v2 78, v3 92, v4 105, v5 112, v6 122 (+10, none lost). The 10: canonicalJson,
stableJson, errorCode, errorClass, tenMinMassiveRequestsOf (unknown); tenMinDailyEnabled, tenMinDailyRedispatchHold,
scanGroupedReplyDustEnabled, tickerIndexDatedEnabled, tickerIndexDatedFullEnabled (NodeJS.ProcessEnv; the last
three with `= process.env`).

## Evidence

`peaceai/rules/proposals/m93-test-case-existing-v6-evidence.json`: see the record for the count, method and picks.
