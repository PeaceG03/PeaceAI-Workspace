# M114: derive string parsers (public-derive-from-behavior-v5)

Gap: DERIVE_FROM_BEHAVIOR v1-v4 derive functions of numbers, booleans, string labels and lists, but not small string
parsers. The health-check work needs them to read a check-in line `part|status|note` back: split on one delimiter, pick
the Nth field, trim, parse an integer, test startsWith / endsWith / includes / ===, strip a prefix or suffix.

Change: a new rule version, `public-derive-from-behavior-v5` (params `dsl: typed-dsl-v5-strings`,
`placement: new-or-existing-module-v5`, trigger `DERIVE_STRING_TRIGGER`), proposal record
`peaceai/rules/proposals/public-derive-from-behavior-v5.json`, evidence
`peaceai/rules/proposals/m114-derive-string-evidence.json`, spec section in `peaceai/spec/derive-from-behavior-v1.md`.
It extends the learned-derive architecture: one more engine module, `peaceai/lib/derive-string.ts`, routed from
`runDeriveRule` (the v1 new-module edit, the v3 append checks, Job A and Job B are reused). v1-v4 are unchanged: same
specs and hashes, same `DERIVE_VOCAB`, same code paths (the m99 / m111 / m112 / m113 tests pass unchanged).

Issue phrasing (its own words, "string parser", so no v1-v4 header matches it and it matches none of theirs):

    Add a new module `src/checkin-read.ts` exporting the string parser `statusOf(line: string): string`.
    Append a new string parser `fieldAt(line: string, n: number): string` to the existing module `src/checkin-read.ts`.

followed by the `Behavior:` paragraph and `Examples:` bullets as in v1. Example strings are double-quoted printable
ASCII with no `"` or `\`, at most 120 characters; a `string[]` result is written `["a", "b"]`.

## The DSL

The first parameter is the text; at most one more, `q`, a number (a field index) or a string (a prefix, suffix or
needle). A piece B of the text is one of: the text; field i of a split on one single-character delimiter seen in the
examples (i a constant or q), with the missing-field result; the last field; everything from field i on (delimiters
kept); the text with a constant (or q) prefix or suffix stripped. Each piece may be trimmed before and / or after.

| result | programs |
|---|---|
| string | B (with the missing-field default D) |
| number | the field count; the length of B; an integer read from B with the fixed test `/^-?\d{1,12}$/` and a failed-parse default |
| boolean | B `===` / startsWith / endsWith / includes a literal from the examples or q, optionally negated; B is an integer |
| string[] | a split on one delimiter, optionally each trimmed and empty items dropped |

The only regular expression ever emitted is that fixed literal; none is built from input. Nothing loops (split / slice /
join / trim / includes are bounded by the input length), nothing is written, no global but Number is read.
`strExprProblem` re-checks the emitted text by decompiling it to the DSL and recompiling it to identical text, in Job A
and again in Job B.

## Fail closed, in this order

1. `derive_examples`: 1-40 examples, typed as declared, the character rules above, no contradiction.
2. `derive_examples_raw`: issue cleaning rewrites `#`, backticks, `*`, tabs and space runs, so any example literal that
   holds a space is read from the raw issue text instead. The raw Examples list is cross-checked line by line against
   the cleaned one; it is refused if the raw text is missing, if a line differs in a way cleaning does not explain, or if
   lines are hidden in an HTML comment or a code fence, or there is a second Examples heading. Only v5 reads the raw
   text; v1-v4 build the same edit with or without it (tested).
3. `derive_under_specified_outputs`: at least 2 distinct results (a boolean: DERIVE_MIN_REACH of each). A string
   parser whose every example returns the text unchanged is refused here too. This gate was found by the near-rival
   test below: examples that never show a strip were fitted by the bare text, because a strip constant is only drawn
   from changes the examples show.
4. `derive_budget`: more than 20000 fitting programs or 20000 probes.
5. `derive_no_fit`.
6. `derive_ambiguous`: every fitting program is run on the probes, not only the smallest, and two that disagree on a
   probe are refused. The probes are a finite sample of variants of the examples, so two fits that differ only on
   inputs no probe covers are not told apart (see Limits). A test true on every example stays a rival; it is not
   silently dropped (Auditor #523 lesson). Up to 3 asked rows go in the detail. Each
   row is chosen greedily as the probe that splits the most remaining rival behaviors (the first one on a tie), with a
   bounded scan. One round can then drop a whole family of rivals (e.g. a run of endsWith constants), not one at a time.
7. `derive_under_specified_unread`: q is never read.
8. `derive_under_specified_path`: the fit has a fallback no example takes, e.g. a missing field, a strip that does not
   apply or a parse that fails. Refused with the row it asks for. An unpinned default or constant is never chosen
   silently; it becomes an asked row (Auditor #523 lesson). A split on a delimiter that gives no example two
   non-empty fields (the delimiter is absent, or only at an edge: the `-` of `-3`, a padding space) is refused here
   too, with a row that has two fields (Auditor #530 (2)): such examples fit a split on any of those delimiters.

Probes: the examples, their fields and trims, the constants of every fit with and without padding, and, for a string q,
cuts of each example line around each delimiter (`v+d`, `d+v`, the first field plus d, d plus the last field, each
field and its trim). Cuts skip values already present and are capped at 150. They were added after a seeded case where a
field-startsWith and a line-startsWith with q holding a delimiter agreed on every earlier probe. Each example is also
cut to its first k fields (every k) and padded with a space on the left, the right and both (Auditor #530 (1)):
`s.split(d)[i]` and `s.trim().split(d)[i]` differ only when field i is the last field of a padded line, which neither
padding the whole line nor cutting it shows alone. The Auditor's repro (`Number(s.trim().split(",")[1])` or 0, from
`a,12,c` 12, `b,7,d` 7, `x,zz,q` 0, `y` 0, ` k,5,m ` 5) derived the untrimmed program, wrong on `a,12 `; it now asks
`a,12 ` and derives the trimmed one (regression test with three harness variants).

## Held-out results (peaceai/test/m114-held-out.ts, committed before the engine)

Twelve synthetic specs with their own names: partOf, statusOf, noteOf, fieldCount, ageOf, isErrorLine,
stripPartPrefix, hasTag, fieldAt, isComment, lastSegment, listItems. As first written, four derive (partOf,
statusOf, fieldCount, listItems); the other eight are refused as `derive_ambiguous`, each with asked rows. Answering
the rows with the reference function takes these rows: noteOf 1, ageOf 3, isErrorLine 5, stripPartPrefix 3, hasTag 14
(a test on its second parameter; rivals test a field, the trimmed line, or a constant cut from the examples), fieldAt 1,
isComment 1, lastSegment 1. With those rows all 12 derive, both as a new module and appended to an existing module. Each
equals the reference on 300 seeded random lines, the compiled text and the evaluator agree, and all generated tests pass.

## Negatives

- escapeCheckinNote (backslash, `|` and newline escaped): the engine refuses it as `derive_examples` (backslashes are
  not allowed in literals), and the issue form as `derive_examples` or `derive_examples_raw`. A replace-only variant
  (`replaceAll("|", "/")`) is `derive_no_fit`. replace, replaceAll and join-after-split never pass `strExprProblem`.
- Side effects, regexes built from input and loops: `new RegExp(q)`, match / search, while, spread-every, console,
  globalThis, assignment, eval, sort, repeat, padStart and process are all rejected by the emit re-check. Extra exports,
  `let` state and `for (;;)` are rejected by the module re-check.
- Signature, reserved names (`v` and `constructor`), examples, append collisions, placement, path and `derive_params`
  refusals.
- Auditor #523 lessons: an unpinned default (statusOf's "unknown") is asked; a trim rival is asked; an
  unchanged-line example set is refused.
- Near-rival families on random examples (the Auditor #523 lesson, not fixed rows): 8 families × 8 trials × seeds 112,
  7 and 2026, 1000 random lines each. Asked rows were answered by the reference. 73 derived, 119 refused, 0 wrong.

## Seeded eval

Random in-vocabulary truths (string / number / boolean / string[], one of 7 delimiters, optional q) with random
examples that witness every path, asked rows answered by the truth, and each derived program checked on 300 random
lines:

- In the test file (40 tasks per seed): seed 112 derived 36, seed 7 derived 33, seed 2026 derived 37; 0 wrong.
- The 200-task runs: seed 112 derived 171 (refused 10, 19 unwitnessed); seed 7 derived 167 (refused 15, 18
  unwitnessed); seed 2026 derived 166 (refused 10, 24 unwitnessed); 0 wrong on every seed. Refusals were
  `derive_budget`, `derive_under_specified_outputs` and `derive_ambiguous` after 8 rounds. (Before the Auditor #530
  fixes seed 7 derived 170 with 10 refused; the padded-cut probes cost it three `derive_budget` / gate refusals.)

## Random harness (after Auditor #530)

The Auditor's own harness is not in the repo, so this is one built from its description: the seeded generator with
field indices 0-3, `_` added to the delimiters, defaults `none` / `?` / 99 / 7, lines padded on the left, right or both,
and one task in ten whose example lines all have a single field. Each derived program is checked on 300 fresh lines
plus, for 120 of them and for every example, each first-k-fields cut bare, padded left / right / both and with a
trailing delimiter, and the line re-joined on every other delimiter. 9 seeds (1-9) × 200 tasks:

- this branch: 1381 derived, 150 refused, 246 unwitnessed, **0 wrong**, plus 23 wrong on tasks whose reference splits
  on a delimiter that gives no example (asked rows included) two fields. No example-only search can recover that
  delimiter; the harness counts these separately as unreachable (the Limits section discloses it). 5 of them derive
  `line.trim()`; every one fits all its examples and asked rows.
- the engine before the fixes (5a23b1c): 1372 derived, 3 wrong (all the padded-last-field rival: `isint(trim.field 1
  on =)`, `int(trim.field 3 on :) ?? 99`, `int(trim.field 2 on ;) ?? 0`), 41 unreachable.

## Upstream evidence

34 one-expression string functions from 25 MIT / Apache-2.0 repos; GPL, AGPL, unlicensed and NOASSERTION repos were
dropped. Each entry is re-derived from a seeded grid of input lines built from its own tokens and delimiters, plus only
the rows its refusals asked for (answered by the upstream function). It is then checked against the upstream function
on every held-out grid row.

- In vocabulary: 30 derived (18 tests, 10 string pieces, 2 splits) from 23 repos, right on all 12806 held-out rows,
  0 wrong.
- Out of vocabulary, kept on purpose to show the limit:
  - three are derived WRONG: `line.startsWith("x ")` after a trimStart (7 rows wrong), `.pop() || path` (43 wrong) and
    `split("#")[1] || "main"` (25 wrong);
  - one is refused `derive_no_fit`.

## Self-protection

`peaceai/lib/derive-string.ts` is imported by the protected `learned-derive.ts`, so it is added to the M99
`PROTECTED_SELF` entry (add-only, next to M113's derive-list.ts). On the current main (M117's tightened existing-tests
entry, digest `dccfce3f...`), `PROTECTED_DIGEST` is re-pinned to
`4835719685595edffaf76fab32e8f881f3fead0608d91b7012d59fd0a9e07617`. `applyRule` / `generate.ts` pass the raw issue text
as one more optional argument, which only the v5 path reads.

## Dry runs against real task texts

None. No real PeaceSTOCKS or scanner task text was run through v5; the held-out specs are synthetic and use their own
names.

## Limits

- Known limit (disclosed): when the true function is outside v5's vocabulary, the examples can be fitted by an
  in-vocabulary program that is wrong elsewhere; 3 of the 4 out-of-vocabulary evidence entries show this. Examples of
  such functions are trimStart before a two-character prefix, `.pop() || path`, `split()[1] || default`, a fixed
  slice, escaping, and a case-insensitive startsWith when every example is lowercase (it derives the case-sensitive
  `s.startsWith("ok")`, wrong on `OK x`).
- The probes carry no expected outputs, so nothing checks the program against the true function beyond the examples
  and asked rows. That no in-vocabulary rival fit was missed rests on sampled harnesses (the held-out set, the seeded
  eval, the near-rival families and a 9-seed random harness), not on a proof: the probes are a finite sample, and a
  rival that differs only on inputs no probe covers is not caught. Auditor #530 found one
  (`s.split(d)[i]` vs `s.trim().split(d)[i]`), now probed. Credit still rests on Peace's verdict on each real candidate.
- A delimiter that appears in no example cannot be derived. A split that gives no example two non-empty fields is
  refused, but the examples can still be fitted by a program that does not split (`line.trim()`) or splits on another
  delimiter the examples show; the random harness counts these separately (see the harness section).
- A `-0` example read by the strict-integer parse returns `-0`, which fails the generated test's comparison at
  self-grade (fail-safe: the candidate does not count). Not fixed in v5.
- Single-character delimiters only. No escapes, newlines or tabs inside literals. Non-integer q values are not probed.
  Large searches refuse with `derive_budget`. Tests on q (hasTag) can need many asked rows (14).
- A behavior the examples never show (a strip no example applies) is outside what can be derived; the
  unchanged-line gate refuses the plainest form of it.

## Escaping is v6 scope (decided)

escapeCheckinNote does not fit v5 cleanly. It needs backslashes in literals (a new lexer), a replace chain (a new
operation family) and newline handling, and that would widen the gates. Sketch for v6:

- An ordered `replaceAll` chain where the backslash always comes first.
- The (from, to) pairs read from the examples.
- An escape-aware literal lexer, cross-checked against the raw text.
- Asked rows when the order or a pair is not pinned by the examples.

v5 refuses escapeCheckinNote today, and the test pins that refusal.
