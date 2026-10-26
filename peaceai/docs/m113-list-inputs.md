# M113: derive functions over a list (public-derive-from-behavior-v4)

Gap: DERIVE_FROM_BEHAVIOR v1-v3 derive functions of scalar parameters only. Health-check slice 2 needs functions over a
LIST of check-ins: a summary (how many errored, the oldest age, is any part silent, are all healthy) and pruning (keep
only the check-ins inside the keep window).

Change: a new rule version, `public-derive-from-behavior-v4` (params `dsl: typed-dsl-v4-lists`,
`placement: new-or-existing-module`, trigger `DERIVE_LIST_TRIGGER`), proposal record
`peaceai/rules/proposals/public-derive-from-behavior-v4.json`, evidence
`peaceai/rules/proposals/m113-derive-list-evidence.json`, spec section in `peaceai/spec/derive-from-behavior-v1.md`.
It extends the learned-derive architecture (one more engine module, `peaceai/lib/derive-list.ts`, routed from
`runDeriveRule`; the v1 new-module edit, the v3 append checks, Job A and Job B are reused). v1, v2 and v3 are unchanged:
same specs and hashes, same `DERIVE_VOCAB`, same code paths (the m99 / m111 / m112 tests pass unchanged).

Issue phrasing (either header):

    Add a new module `src/health/summary.ts` exporting `countErrored(checkins: { part: string; ok: boolean }[]): number`.
    Append a new function `pruneOld(checkins: { part: string; ageDays: number }[], keepDays: number): { part: string; ageDays: number }[]` to the existing module `src/health/summary.ts`.

followed by the `Behavior:` paragraph and `Examples:` bullets as in v1; bullets may write lists `[1, 2]` and records
`{ part: "scan", ageDays: 3 }` (one level, scalar fields).

## The DSL

One list parameter `xs: T[]` (T number, string, boolean or a record of 1-4 fields of those types), at most one more
number or string parameter `t`. x is the element, E is x or one field x.f, P a predicate on one element:

| result | programs |
|---|---|
| number | `xs.length`; count where P; sum of E; sum of E over the elements where P (sum of kept); max / min of E, D when the list is empty |
| boolean | `xs.some(P)`; `xs.every(P)` |
| T[] | `xs.filter(P)` (prune: keep the elements where P holds, in order) |
| string[] / boolean[] | `xs.map(P ? A : B)` (A, B output strings); `xs.map(P)` |
| field[] | `xs.map(x.f)`; `xs.filter(P).map(x.f)` (records) |

P: `E <= C`, `C <= E`, `E === C` (C an integer: an example value of that field, or one more / one less); `E <= t`,
`t <= E`, `E < t`, `t < E`, `E === t`, `E !== t`; `E`, `!E` (boolean); `E === S`, `E !== S` (S a string seen in the
examples). D is the output of the empty-list example. Compiled code calls only filter / some / every / map / reduce
and reads `.length` on the list parameter, with arrow callbacks; sort, push, splice, assignment, other calls and
globals are not in the DSL, and `listExprProblem` re-checks the emitted text (decompile to the DSL, recompile to the
identical text) in Job A and Job B. String parsing (split, number parsing, regexes) is out of scope.

## Fail closed, in this order

| refusal | when |
|---|---|
| `derive_signature`, `derive_reserved_name` | not exactly one list parameter, more than one scalar, nested lists, optional fields, more than 4 fields, a reserved name (`__proto__`, `constructor`, ...) |
| `derive_examples` | fewer than 3 or more than 40 examples, a value not of its declared type, a list longer than 12, a contradiction, all outputs equal |
| `derive_under_specified_empty` / `_many` | no example with the empty list / none with 3 or more elements |
| (dropped, not a refusal) | a P that is true on every example element or false on every one: the examples cannot place its cut |
| `derive_budget` | more than 50,000 candidate programs or 40,000,000 evaluations |
| `derive_no_fit` | no program fits every example |
| `derive_ambiguous` | two fitting programs disagree on some probe list (every fitting program is checked); the detail names a probe list and both answers |
| `derive_under_specified_unread` | the scalar parameter is never read |
| `derive_under_specified_branch` | P is not true and false on enough example elements each |
| `derive_under_specified_kept` | a count, a kept list, a sum of kept elements or a field of kept elements, and no example list has 2 or more elements where P holds; the detail names P |
| `derive_under_specified_edge` | a threshold's two sides are not both shown (E = C and E = C + 1, or E - t = 0 and 1) |
| `derive_under_specified_far` | no element 100 or more past the threshold on each side |
| `derive_list_expr`, `derive_params` | the emitted text fails the re-check; a dsl / placement / trigger mismatch |

The v1 path refusals and the v3 append refusals (`target_file_not_found`, `derive_path`, `derive_append_*`) apply
unchanged.

The kept gate was added after the first held-out run, when a negative exposed a wrong program: a running max seeded
with 0 (`[] -> 0, [-5, -3, -9] -> 0, [2, 7, 1] -> 7, [5, 6, 2] -> 6, [-1] -> 0, [150, -150, 3] -> 150`) was derived as
"sum of the elements >= 6", which fits every example (each list has at most one element >= 6) but is wrong on `[7, 8]`.
Now it is refused `derive_under_specified_kept: xs`; with `[7, 8, -150] -> 8` added it is `derive_no_fit` (a running max
is not in the DSL). The held-out specs, shapes and seeded results were re-run with the gate and are unchanged.

## Held-out results (peaceai/test/m113-derive-list-inputs.test.ts)

Eight slice-2-shaped specs, written before their first run and not used to build the engine (synthetic names, not
real issue texts). First run: three derived, five refused, each naming what it lacked; one asked row each (answered by
the reference function) and all eight derive, as a new module and appended, equal to the reference on 150 seeded random
lists each; the module's own test and the new tests pass, each new test fails without its function.

| spec | first run | after one asked row | derived |
|---|---|---|---|
| countErrored | derived | - | `checkins.filter((x) => !x.ok).length` |
| oldestAge | derived | - | max of `ageMin`, 0 when empty |
| anySilent(checkins, limit) | `derive_under_specified_far: ageMin` | derived | `checkins.some((x) => limit < x.ageMin)` |
| pruneOld(checkins, keepDays) | `derive_under_specified_far: ageDays` | derived | `checkins.filter((x) => x.ageDays <= keepDays)` |
| allHealthy | derived | - | `checkins.every((x) => x.ok)` |
| statusLabels | `derive_under_specified_far: ageMin` | derived | `checkins.map((x) => (x.ageMin <= 60 ? "FRESH" : "STALE"))` |
| totalErrors | `derive_ambiguous` (plain sum or sum of `errors >= 1`; asked `[{ part: "scan", errors: -1 }]` gives -1 or 0) | derived | plain sum of `errors` |
| stalePartNames(checkins, limit) | `derive_under_specified_far: ageMin` | derived | `checkins.filter((x) => limit < x.ageMin).map((x) => x.part)` |

Every DSL shape: 13 more specs (length, map to P, field of each, count `===` string, filter `!==` t, some `!E`, some
`=== C`, min, count `<=` t, count `<` t, sum of kept, filter `>=`, every `t <=`), each derived to the intended program
and equal to the reference on seeded random lists; two needed one asked row (scanCount was `derive_ambiguous`,
hasExitThree `derive_under_specified_far`).

Negatives (all refused by name): ambiguous fits (two thresholds, a field or a filter, plain sum or sum of kept), no fit
(string parsing, a product, an index, the running max), the kept gate, every other gate, signature / examples /
reserved names, side effects (sort, push, splice, assignment, calls, globals never pass the re-check), append
collisions and placement, path and `derive_params`; the v1-v3 and v4 triggers are disjoint.

Seeded random (m112 style, 70 tasks over 14 families per seed, each checked on its examples and 100 probe lists):

| seed | derived | refused | wrong |
|---|---|---|---|
| 112 | 50 | 20 (`derive_ambiguous` 13, `derive_examples` 5, `_edge` 1, `_far` 1) | 0 |
| 7 | 50 | 20 (`derive_ambiguous` 11, `derive_examples` 9) | 0 |
| 2026 | 49 | 21 (`derive_ambiguous` 10, `derive_examples` 11) | 0 |

## Upstream evidence

28 exported pure functions over one array parameter from 25 MIT / Apache-2.0 / ISC repos (GitHub code search; no
license, NOASSERTION, GPL and AGPL dropped). Examples are the upstream function run on a seeded grid (seed 113); the
first 6 rows train, extended only by following PeaceAI's own refusals (an ambiguity question answered by the upstream
function; a kept refusal answered by one list of the first two grid elements where its named condition holds; else the
next grid row; every added row is recorded with the refusal that asked for it). 26 derive and are right on every
held-out row (2932 rows, 0 wrong); 2 (a running max seeded with 0) are `derive_no_fit`. Shapes with evidence: sum (8),
sum of kept (3), count (2), some (3), every (2), filter (2), field of kept (1), max (3), min (2). The rule's evidence
counts the 26 derived functions (23 repos). No third-party code is run by the tests; they re-derive each expression from
the recorded examples.

## Self-protection

`peaceai/lib/derive-list.ts` is imported by the protected `learned-derive.ts`, so the closure test (m96) requires it to be
protected: it is added to the M99 `PROTECTED_SELF` entry and `PROTECTED_DIGEST` is re-pinned (one path added, nothing
removed or loosened). The v4 learned spec, proposal record, evidence and test are not added (v2 and v3 were not either).

## Dry runs against real task texts

None. There are no slice-2 issue texts yet; no real PeaceSTOCKS or scanner task text was run through v4. The held-out
specs above are synthetic, written for this PR, and use their own names.

## Limits

- Integer cuts only, as in v1: `x > 0` is derived as `1 <= x` (equal on integers only).
- One list parameter and at most one scalar; no nested lists, optional fields, string parsing, sorting, grouping,
  index-based access, averages, running state (a running max seeded with 0 is `derive_no_fit`), or two-field predicates.
- A list `derive_ambiguous` names its probe list and both answers in the refusal detail; the issue-comment question
  formatter (`formatDeriveQuestions`) shows scalar questions only, so list questions are not yet surfaced as questions.
- Shapes without an upstream function in the evidence (length, label, map to P, field of each, the `not` / `!==` /
  `<=` / `<` predicates on t) rest on the unit tests and the seeded eval only.
