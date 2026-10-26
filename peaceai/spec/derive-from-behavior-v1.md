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

- number: a parameter, 1, 2, `a + b`, `a - b`, `a * b`, `a * a`, `min(K, a)`, `max(K, a)`, `if (G) a else b`
  (a branch may also be a K constant)
- string: a parameter, a literal L, `a + b`, `if (G) a else b`
- boolean: a parameter, `p === C`, `p <= C`, `C <= p`, `lo <= p && p <= hi`, `p === q`, `p <= q`, `s === ""`,
  `&&`, `||`, `!`
- guards G: `s === ""`, `p === C`
- Every constant comes from the EXAMPLES. The behavior prose is never an input of the search, the constants or the
  test: it only has to pass the anti-credit guard. The header line picks the module, name and signature.
- C (compared with a parameter): an edge the examples witness: two examples that differ only in one number argument,
  by exactly 1 (v and v + 1), and give different results contribute v and v + 1 (S1: 428/429, 429/430, 499/500,
  599/600).
- K (cap, constant result): an integer result that at least two examples produce (S2: 30000, three times; 0).
- L: output pieces with the string arguments cut out that at least two examples produce (a piece of one output is
  that output memorized), plus `""`.
- No memorizing: a string parameter is only tested for emptiness, never compared with a literal, and an integer is
  compared with a parameter only where the examples show the result changing at that value. Without this, the
  smallest fit of a few examples is a lookup table of the example inputs, which fits every example and generalizes
  to nothing. On the upstream evidence
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
- none up to size 13: `derive_no_fit`; more than 4,000,000 programs built (DERIVE_BUDGET; a larger caller budget
  is clamped to it), or more than 32,000,000 kept value cells (MAX_KEPT_CELLS): `derive_budget` (also when the budget runs out while building the slack level);
- bad examples (count 3-40, arity, types, a contradiction, or every example giving the same result):
  `derive_examples`.
A program whose value is the same at every point (`p && !p`, `x - x`) does not count as reading a parameter.

## Witness gates (Auditor #491 B1): the examples must SHOW what the fit relies on

A unique smallest fit is still refused, `derive_under_specified` with the gate and parameter (through the rule:
`derive_under_specified_<gate>: <param>`; the detail names the example to add), unless every gate passes, in order:

- unread: every parameter the program ignores is shown irrelevant at non-degenerate settings (m103, Auditor #494
  backoff/sparse and #497 sibling witnesses): a group of examples differing only in it with the same result, where
  (a) every other number parameter is not 0, 1 or -1 and every other string parameter is non-empty (a product by 0,
  a power of 1 or an empty-string branch hides it), and no min / max cap of the program is at or past its cap value
  (a held cap hides it); (b) it takes at least 3 distinct values (both values for a boolean; a symmetric pair such as
  a = 0 and a = -2 in (a + 1) ** 2 hides it); (c) for a boolean result and for each operand of every && / ||, such a
  group at each of its outcomes some example reaches (a short-circuited operand hides it). Refused otherwise, asking
  at a setting meeting the same conditions with the parameter changed; the answers are the program's result and the
  results of programs that read the parameter and fit every example;
- chars: a string parameter the program reads has example values with upper case, lower case, a digit, an inner
  space, a leading or trailing space, punctuation, and (round 3, the practice generator's conditional suffix) the empty
  string itself, asked for when no example has it;
- edge: both sides of every threshold (`p <= c`: c and c + 1; `c <= p`: c - 1 and c), c - 1, c, c + 1 for an
  equality, both ends of a range, the delta edges of `p === q` / `p <= q`, and `""` against non-empty for an
  emptiness test, each pair with the other arguments equal and different results;
- far: an example at least DERIVE_FAR = 100 past the last edge and one at least 100 before the first edge of every
  compared parameter (two compared parameters: p - q >= 100 and <= -100), so the result past every edge is shown,
  not assumed (S1 without `600 gives false` would otherwise derive `(status === 429) || (500 <= status)`);
  a min / max cap at c is an edge on the value it caps: an example with that value >= c + 100 and one <= c - 100,
  for each side some neighbour or far probe reaches (round 3, upstream scan: keen-slider `sign` from -1, 0, 2, 10, 99
  was accepted as `min(x, 1)`, wrong at every x < -1);
- region (Auditor #491 round 2, the hidden island): inside every region the program's constants cut a compared
  parameter into, no example-free stretch longer than an eighth of the region or 4, whichever is larger (finite; round 3, from the practice generator's hidden islands) or 100 (open);
- span (round 2, the unwitnessed cap): every number parameter the result is computed from is shown over at least
  100, and a number result is shown on every side of 0 the program reaches inside the examples' range;
  (round 3, the practice generator's cap inside the examples' range) and a number result is shown at its largest
  and smallest over the corners of the examples' box (a value past every shown result there asks at that corner);
- branch / cap: each branch of every conditional and each side of every min / max cap is reached by at least
  DERIVE_MIN_REACH = 2 examples (the true branch of a one-parameter `p === c` or emptiness test holds for one input:
  one example);
- rival: a second search DERIVE_RIVAL_EXTRA = 2 sizes past the fit, in two passes, finds no other program that fits
  every example but differs from the fit: near pass with every example value as a constant, on probes inside the
  examples' range; far pass with the witnessed edges as constants, on the far probes past the examples (outermost
  edges +-10 / +-100, 10x the largest value, 0, +-1, cross products; negative probes only for a parameter some example
  makes negative). A spent rival budget is `rival_budget` (refused, never accepted).

The far-probe table: a DERIVE candidate's review comment (peaceai/bin/review-comment.ts, `deriveReviewNote`) shows
the derived expression and the program's output on up to 24 far probes, rebuilt from the candidate's diff only (the
created module must pass `derivedModuleProblem`, the test must be literal `assert.equal` lines, and re-deriving from
those examples must give the module's exact expression; otherwise no note). The verdict PR body is written by
.github/workflows/peace-verdict.yml, which PeaceAI may not edit, so the table is in the review comment the verdict
is given on.

Compilation: `min` / `max` become conditionals (no `Math`), `a * a` stays a product, ranges become
`(lo <= p && p <= hi)`. The text is re-parsed and must pass `derivedExprProblem` (parameters, integer and plain string
literals, `true` / `false`, `!`, unary minus on a number, `+ - * === <= && ||`, `?:`; anything else, including no
parameter read, is refused) and the ADD_FUNCTION `safeBody` check. So no globals, I/O, computed member access,
constructor / eval / prototype paths or timers are reachable.

## Form gate: only forms with upstream evidence are emitted (round 4, Auditor ruling on 6f1ea5e)

After the search and the witness gates (`deriveCandidate`), `deriveProgram` refuses any fit that uses a DSL form
fewer than DERIVE_FORM_BAR = 10 replaying upstream evidence entries show: `derive_unevidenced_form: <forms>`, with a
detail naming each form and its count and asking whether the behavior can be written without it. The forms
(`formsOf`): cap (min / max against a constant), ternary (a general `if`; caps count as cap), strcat (string `+`),
eq (`===`, including "is empty"), or (`||`), range (`lo <= p && p <= hi` and any `&&`), square (`sq`, or `a * a` of one
same subprogram). Parameters, constants, `+ - *` on numbers, `<=` and `!` are the ungated base.

The counts come from one place: each entry of peaceai/rules/proposals/m99-derive-from-behavior-evidence.json records
the forms of the program its examples replay to (`forms`); the runtime counts entries per form from that file, and
fails closed (every form 0, so every gated form is refused) on an unreadable or malformed file or an unknown form
name. The evidence test re-derives every entry with `deriveCandidate`, checks its recorded forms, checks the runtime
counts equal the replayed ones, requires every emittable form to have at least 10 entries, and pins the emittable set.
Only the evidence replay and the miners call `deriveCandidate`; nothing in peaceai/lib or peaceai/bin besides
derive.ts names it (tested).

Entries per form (111 entries, 89 repos): cap 13, ternary 0, strcat 12, eq 17, or 13, range 42, square 25. So cap,
strcat, eq, or, range and square are emitted; ternary (a general `if`: no upstream entry) is refused. S1
(`(status === 429) || (500 <= status && status <= 599)`) and S2 (a cap of a square) derive; S3 (an `if` on
`causeCode === ""`) is `derive_unevidenced_form: ternary`.

## Asking, not only refusing (round 3, Peace)

A witness-gate, rival or ambiguity refusal (and `derive_no_fit`) names up to DERIVE_MAX_QUESTIONS = 3 inputs where
programs that fit every example disagree, with each one's output there: for a rival or an ambiguity the found
programs' outputs (inside the examples for a near rival, past them for a far one, largest difference first); for a
gate the input it names, with the derived program's output and that of a program built to fit every example but
differ there (the other boolean; a cap / floor at the largest / smallest shown result; for a cap's far side, the cap
lifted, or every cap lifted when an outer cap hides that one there, as in clamp01's floor past its ceiling). Deterministic, inside the existing budgets, never at an example input, and never answered from the derived
program: the issue author answers. The refusal record carries them (`fn(args)=a|b; ...`, safe integers and booleans
only), and the no-candidate comment asks them in plain words ("What should f(27) give? One program that fits every
example gives false, another gives true."), leak-scanned like the rest of the comment.

## Mistakes ledger (round 3, Peace)

peaceai/test/m99-derive-mistakes.json lists every wrong program a review found (and the upstream scan's): the
examples, the wrong program, an input where it is wrong and the right output there, why in one plain line, and what
happens now (refuse and ask at the recorded inputs, then the program derived once the answers are added; or a known
limit the review note shows). peaceai/test/m99-derive-mistakes.test.ts replays the whole ledger on every change and
fails if any entry is accepted wrong or its outcome changes. **Each future NOT PASS counterexample is added to the
ledger in the same PR that fixes it** (regenerate with peaceai/proof/m99-derive-mistakes-gen.ts after adding the case).

Since round 4 the ledger is replayed through `deriveCandidate` and each accepted program pins `formGate` (the forms
the form gate refuses, `[]` = emitted); the test checks `deriveProgram` emits exactly those and refuses the others by
name. Known limits are marked `disclosed`; Auditor accepted these as disclosed in its round 3 ruling: caps above every
example (m100-floor-clamp-past and the two m100-kind-floor-clamp entries), eq_or_ge/sparse, s1_shape/sparse, and S1
with 429 dropped. Also disclosed: seed 101's t465 (`!(105 <= n && n <= 180)`, wrong at 140..144, a true band narrower
than the gaps between the examples) and the round 4 upstream scan's isPowerOfTwo (`1 <= x && x <= 4`, wrong at 8, 16,
..., the same hidden-island class).

**The residual count of the practice generator (11 blocking at 6f1ea5e) describes seed 100 only.** Other seeds draw
other example sets and find other wrong picks (seed 101 found t465 above); a seed's count is not a bound for any other.

## The edit and the test

- `src/X.ts`: `export function NAME(TYPED PARAMS): R {\n  return DERIVED;\n}\n` (same path rules as the ADD_FUNCTION new
  module: plain unprotected path, an existing `.ts` sibling in the same directory, no case-insensitive clash).
- `src/X.SLUG-ID7.test.ts`: `node:test` + `node:assert/strict`, exactly one `assert.equal` per issue example and
  nothing else (ID7 hashes the header and the examples, not the prose).
- Shown in m99's "the examples alone determine the program" test: S1-S3 with their prose replaced by unrelated or
  misleading prose (other numbers, another marker) give byte-identical edits; moving one example moves the program.
- Job B grades it like the ADD_FUNCTION new module (the new test calls the function, fails with a type-default stub,
  fails with the module removed, passes with it) and re-checks the created module (`derivedModuleProblem`: exactly one
  exported function, typed number / string / boolean parameters and return, a single return passing
  `derivedExprProblem`), and runs the new tests under TZ=UTC, America/Denver and Asia/Tokyo.

## Refusals by name

derive_behavior_code, derive_sections, derive_signature, derive_examples, derive_no_fit, derive_ambiguous,
derive_budget, derive_under_specified_<unread|chars|edge|far|region|span|branch|cap|rival|rival_budget>[: param],
derive_unevidenced_form[: forms], derive_emit_size,
derive_expr_vocab, derive_expr_*, derive_path, derive_module_exists, new_test_path_exists, derive_params.

## Limits (v1)

- Only forms with at least 10 replaying upstream entries are emitted (form gate above): today no `===` and no general
  `if`, so behaviors needing them are refused until more upstream evidence is found.
- New module only; no edit of an existing function (PR #489 can call `deriveProgram` for that).
- Integers only (no fractions), strings without `"` or `\`, no arrays or objects, at most 3 parameters.
- Issue cleaning drops `#`, backticks, some `*` and `_` and collapses spaces, so an example string holding them
  arrives changed; such issues should avoid those characters in example strings.
- The DSL has no division, modulo, string length, slicing, case changes or loops; behavior needing them is
  `derive_no_fit`. Small DSL + minimal size can still pick a program the examples allow but the prose rules out
  (the prose is deliberately not read). More examples narrow the choice; a threshold needs an example on each side
  of it at v and v + 1, or it is `derive_no_fit`; the witness gates then ask for the examples that show the rest
  (edges, far regions, two per branch, no disagreeing rival), so issues need more examples than the bare fit.

## public-derive-from-behavior-v2 (M111): boolean label chains

A new rule version (decision #466: an approved version never widens). `public-derive-from-behavior-v2` is the v1 spec
with only `id`, `minerVersion` and the param `dsl: typed-dsl-v2` changed; it is off until Peace approves its hash
(`/approve-rule e11ae193d1927c4d26efb430d862763db7f9683170a6438deb7e53d98eadff8c` on its proposal issue). v1 is unchanged:
`typed-dsl-v1` runs the search with `labelChains` off, so its search, gates and refusals are byte-for-byte the M104 ones.

What `typed-dsl-v2` adds (`DeriveInput.labelChains`, peaceai/lib/derive.ts):

- A boolean parameter is a size-1 if-guard, but only over constant branches or other label chains: if / else-if chains
  and decision trees that return constant labels (`failed ? "ERROR" : (silent ? "SILENT" : "OK")`). Existing guards
  (emptiness, `p === C`, `s <= t`) are unchanged.
- In a fully covered all-boolean domain (2 or 3 boolean parameters, an example for every one of the 4 or 8 inputs)
  every output is a constant leaf even when only one example gives it. Elsewhere the v1 rule stands: an output piece
  seen once is never searched (no memorizing).
- Branch reach in an all-boolean domain: a side needs min(2, the inputs that can reach it at all), at least 1; in a
  2-boolean chain the innermost sides are reached by one input each.
- Gate domain: an all-boolean program that branches on a boolean parameter is refused until the examples give every
  input (`derive_under_specified_domain`), and the refusal asks for the missing inputs (at most 3), offering every
  result the examples show; with an input missing the branch order there is a guess. A no-fit in such a domain asks
  the same way.
- Form gate: the ternary bar (and the M104 skeleton bar) does not apply to an all-boolean label tree whose examples
  cover the whole domain. Such a program IS the examples' table: it equals the wanted function on every input it can
  be called with, so there is no unseen input for upstream evidence to vouch for. Every other form and every other
  if program keeps its bar (mixed boolean + number / string chains are searched but refused until evidenced).
- v2 answers only what v1 does not: a task v1 derives is `not_needed` under v2. The review note re-derives v1 first,
  then v2.

Limits (v2): a one-boolean function has 2 inputs, under the v1 minimum of 3 examples (`derive_examples`); a table that
needs a tree larger than size 13 is `derive_no_fit`; string answers to a domain question are not on the public refusal
line (number answers are), as in v1.

## public-derive-from-behavior-v3 (M112): append to an existing module

A new rule version (decision #466). `public-derive-from-behavior-v3` is the v2 spec with only `id`, `minerVersion`,
`trigger` (`DERIVE_APPEND_TRIGGER`: "Append a new function NAME(params): type to the existing module src/....ts") and the
param `placement: end-of-existing-module` changed; it is off until Peace approves its hash
(`/approve-rule 7087afcfdbe365b01816b5db0b518407733c7ce88b9d29d57392358be4bc6f8f` on its proposal issue). Placement and
trigger are bound: a spec pairing one with the other's trigger is `derive_params`. v1 and v2 are unchanged.

The search and every gate are v1's then v2's (`not_needed` does not apply: v1 cannot append). Before the search the named
module must exist (exact path, else `target_file_not_found`) and pass `appendTargetProblem`: a plain non-protected `src/`
path (`derive_path`), LF layout ending in exactly one newline (`derive_append_layout`), parsable, no use of the name
anywhere and no `export *` (`derive_append_name_collision`), no top-level `let` / `var` / `using`
(`derive_append_mutable_state`), and nothing run at import in it or its import closure, no package or unresolved import
(`derive_append_side_effects`; every top-level initializer in the closure must pass the strict inert-at-load
allowlist `importTimeProblem`, fail closed: no call, `new`, member access, tagged template, spread or destructuring). The edit is the old text, one blank line, the function; imports never change
(`derivedAppendProblem` re-checks, `derive_append_not_add_only`). Job B re-checks both against the base commit's text and
runs the module's existing tests with the new test, confined to the module's closure. Details, held-out results and
limits: peaceai/docs/m112-append-to-existing-module.md.

## public-derive-from-behavior-v4 (M113): list inputs

A new rule version. `public-derive-from-behavior-v4` is the v3 spec with only `id`, `minerVersion`, `trigger`
(`DERIVE_LIST_TRIGGER`: either v1/v3 header, with exactly one list parameter) and the params `dsl: typed-dsl-v4-lists`
and `placement: new-or-existing-module` changed; it is off until Peace approves its hash (`/approve-rule
6edd341f45c7e4486bfb727aa90a66db1fcac4f7e3e3ce7ad6bf561240d0d6f8` on its proposal issue). The two params are bound to each
other and to the trigger: any other pairing is `derive_params`. v1, v2 and v3 are unchanged (same specs, hashes,
vocabulary and code paths; their triggers never match a list signature, and v4's never matches a scalar one).

The engine is `peaceai/lib/derive-list.ts`, called from `learned-derive.ts` the same way as v1's `derive.ts`: one list
parameter `xs: T[]` (T number, string, boolean or a one-level record of 1-4 such fields) and at most one number or
string parameter; a bounded enumeration of a small DSL (length; count / filter / some / every where P; sum of a field,
also of the kept elements; max / min of a field with the empty-list result; map to one of two labels or to P; a field of
each (kept) element), every constant cut from the examples. Fail closed in this order: `derive_examples`,
`derive_under_specified_empty` / `_many`, predicates the examples never split are dropped, `derive_budget`,
`derive_no_fit`, `derive_ambiguous` (any two fitting programs that disagree on a probe list),
`derive_under_specified_unread` / `_branch` / `_kept` / `_edge` / `_far`. New modules use the v1 edit; appends use v3's
`appendTargetProblem` and `derivedAppendProblem` unchanged. Emitted text is re-checked by `listExprProblem` (decompiled
to the DSL and recompiled to identical text: only filter / some / every / map / reduce / length over the list parameter,
no mutation, no calls) in Job A and Job B. Details, held-out results, evidence and limits:
peaceai/docs/m113-list-inputs.md.
