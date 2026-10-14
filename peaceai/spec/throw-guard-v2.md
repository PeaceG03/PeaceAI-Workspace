# public-throw-guard-v2 (ADD_THROW_GUARD, `calls: regex-test+noarg-methods`)

Same edit as v1: one `if (COND) throw new Error("CODE");` line at the entry of a uniquely named exported
function, plus one new test file that must fail without the guard and pass with it (self-graded). Only the
condition grammar grows. Off until approved through the bulk-teaching flow.

evidence: 38 function-entry guard lines in 27 source files of 22 of Peace's public commits (PeaceSTOCKS 37, PeaceAI-Workspace 1)
of the forms `!/^...$/u.test(param)`, `Number.isNaN(param.getTime())` and `!param.trim()`.

v1 grammar (unchanged): parameters, literals, property reads, comparisons, `!`, `&&`/`||`, `typeof`, and
`Number.isFinite/isInteger/isNaN/isSafeInteger`, `Array.isArray` with one argument.

v2 adds exactly two call forms:
1. `REGEX.test(X)`: REGEX is a regex LITERAL of at most 80 characters, flags only `i`/`u`, with no
   backreference (`\1`..`\9`, `\k`), no quantified group (`)*`, `)+`, `)?`, `){`) and no lookaround;
   X is a parameter or a plain property chain rooted at one. Exactly one argument.
2. `X.getTime()` / `X.trim()`: X is a parameter or a plain property chain rooted at one; no arguments.

Everything else is refused: any other method, any argument to `getTime`/`trim`, a receiver that is not
parameter-rooted (module names, globals, call results, `this`), optional chaining, a regex held in a
variable, a non-literal `test` receiver, or `test` with zero or two arguments. The v1 spec (no `calls` key)
keeps the v1 grammar exactly.
