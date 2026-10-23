# DERIVE_FROM_BEHAVIOR v1 (public-derive-from-behavior-v1)

Gap: `batch-v4/scanner/refile/GAP.md` (notes/batch-v4 2d86632). Every earlier code-writing rule copies the implementation
from the issue (`returning EXPR`, `with body:`, `replace statement OLD with NEW`). That is placement, not PeaceAI's own
work. This rule takes a behavior-only task and PeaceAI writes the body itself.

## Task shape

```
Add a new module src/r2-retry-status.ts exporting isRetryableR2Status(status: number): boolean.

Behavior: <plain prose: what the function answers, in words; no code>

Examples:
- 429 gives true
- 0, 1000 gives 1000
- "fetch failed", "" gives "MARKETS_SCHEDULER_HOST_FAILED:fetch failed"
```

- Header (the trigger): a NEW module under `src/` and ONE function, 1-3 parameters, every type `number`, `string` or
  `boolean`, return type the same set. v1 never edits an existing file.
- `Behavior:` paragraph, then one `Examples...:` line, then 3-40 bullets `ARGS gives OUT`. Values are integer literals,
  `true` / `false` or double-quoted printable ASCII without `"` or `\`.

## Anti-credit guard (fail closed)

The behavior section must be prose. `derive_behavior_code` when it holds any of: `= < > ! & | ? ; { } [ ] + * % ^ ~ \ " / $`
or a backtick; a call `name(`; member access `a.b`; a minus between operands (`3-4`, `a - b`); a quoted `'...'`
literal; or a code keyword (`return`, `returning`, `const`, `let`, `var`, `typeof`, `instanceof`, `null`,
`undefined`, `ternary`, `function body`, `Math`, `JSON`, `Number`, `String`, `Boolean`, `Array`, `Object`, `NaN`,
`Infinity`). Prose such as "500 through 599", "an equals sign" or "never more than 30000 ms" is fine. Every other line of
the issue (title, context) may not carry a strong code marker (`=>`, `===`, `!==`, `&&`, `||`, `return`, `returning`,
`with body:`, `Math.`, `const `, `let `, `function (`, `replace statement`). Job A also refuses a raw body holding a
fenced code block, an HTML comment or an indented code block (cleaning drops those, so they could hide code).

## Derivation (peaceai/lib/derive.ts, reusable)

Bottom-up enumeration by program size (node count, at most 13) over a typed DSL, with observational equivalence on
the points = examples + a deterministic probe set:

- number: a parameter, 1, 2, `a + b`, `a - b`, `a * b`, `a * a`, `min(C, a)`, `max(C, a)`, `if (G) a else b`
- string: a parameter, a literal L, `a + b`, `if (G) a else b`
- boolean: a parameter, `p === C`, `p <= C`, `C <= p`, `lo <= p && p <= hi`, `p === q`, `p <= q`, `s === ""`,
  `&&`, `||`, `!`
- guards G: `s === ""`, `p === C`
- C: the integers in the examples (arguments and outputs) that the behavior prose also writes; L: output pieces with
  the string arguments cut out that at least two examples produce (a piece of one output is that output
  memorized), plus `""`.
- No memorizing: a string parameter is only tested for emptiness, never compared with a literal, and an integer the
  prose does not write is never compared with a parameter. Without this, the smallest fit of a few examples is a
  lookup table of the example inputs, which fits every example and generalizes to nothing. On the upstream evidence
  scan an earlier draft (string equality allowed against example inputs) derived e.g. `!(name === "read_file")` for
  a tool-name check from 4 names, wrong on unseen names; with the rule such tasks are `derive_no_fit`.
  `derivedExprProblem` also refuses `===` with a non-empty string literal (`derive_expr_memorize`), so Job B
  re-checks it.

Probe set: each example with every number argument moved by -1 and +1, each string argument replaced by `""` and by
the other examples' values, each boolean flipped; examples themselves are dropped; at most 400.

Result. Let s be the first size where a program reading a parameter fits every example; the search also builds
size s + 1 (DERIVE_SLACK = 1). One program is kept per behavior on (examples + probes), so:
- exactly one fitting behavior up to size s + 1: the program of size s (`ok`);
- two or more: `derive_ambiguous` (they agree on every example, so they disagree on at least one probe; the
  refusal names the programs and a probe). The slack catches a unique smallest fit that a slightly larger,
  different program also explains (e.g. examples -2, -1, 0 giving 1, 0, 1: `(x + 1) * (x + 1)` and its square);
- none up to size 13: `derive_no_fit`; more than 4,000,000 programs built, or more than 64,000,000 characters of
  kept value vectors: `derive_budget` (also when the budget runs out while building the slack level);
- bad examples (count 3-40, arity, types, a contradiction, or every example giving the same result):
  `derive_examples`.
A program whose value is the same at every point (`p && !p`, `x - x`) does not count as reading a parameter.

Compilation: `min` / `max` become conditionals (no `Math`), `a * a` stays a product, ranges become
`(lo <= p && p <= hi)`. The text is re-parsed and must pass `derivedExprProblem` (parameters, integer and plain string
literals, `true` / `false`, `!`, unary minus on a number, `+ - * === <= && ||`, `?:`; anything else, including no
parameter read, is refused) and the ADD_FUNCTION `safeBody` check. So no globals, I/O, computed member access,
constructor / eval / prototype paths or timers are reachable.

## The edit and the test

- `src/X.ts`: `export function NAME(TYPED PARAMS): R {\n  return DERIVED;\n}\n` (same path rules as the ADD_FUNCTION new
  module: plain unprotected path, an existing `.ts` sibling in the same directory, no case-insensitive clash).
- `src/X.SLUG-ID7.test.ts`: `node:test` + `node:assert/strict`, one `assert.equal` per issue example. Only for a
  one-number-parameter yes/no function, a second test adds the boundaries the description itself names: for each
  integer d written in the behavior prose, d - 1, d and d + 1 that are not examples, with the derived program's answer.
  No other probes are written into the test (the issue fixes nothing else).
- Job B grades it like the ADD_FUNCTION new module (the new test calls the function, fails with a type-default stub,
  fails with the module removed, passes with it) and re-checks the created module (`derivedModuleProblem`: exactly one
  exported function, typed number / string / boolean parameters and return, a single return passing
  `derivedExprProblem`), and runs the new tests under TZ=UTC, America/Denver and Asia/Tokyo.

## Refusals by name

derive_behavior_code, derive_sections, derive_signature, derive_examples, derive_no_fit, derive_ambiguous,
derive_budget, derive_expr_*, derive_path, derive_module_exists, new_test_path_exists, derive_params.

## Limits (v1)

- New module only; no edit of an existing function (PR #489 can call `deriveProgram` for that).
- Integers only (no fractions), strings without `"` or `\`, no arrays or objects, at most 3 parameters.
- Issue cleaning drops `#`, backticks, some `*` and `_` and collapses spaces, so an example string holding them
  arrives changed; such issues should avoid those characters in example strings.
- The DSL has no division, modulo, string length, slicing, case changes or loops; behavior needing them is
  `derive_no_fit`. Small DSL + minimal size can still pick a program the examples allow but the prose rules out; the
  boundary probes in the test cover only the one-number yes/no case. More examples narrow the choice.
