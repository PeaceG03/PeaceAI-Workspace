# M104: ternary program-skeleton gate (Auditor #498)

Branch m104/if-evidence. This branch changes the engine gate only: peaceai/rules/** is byte-identical to main, so the
learned spec still hashes to 799182d7 (approved in #499) and the evidence file has no ternary entry. The mined if
evidence (17 entries, `ternaryShapes` on each) is parked on branch m106/ternary-evidence (recounted under the skeleton
key below), to be proposed for a single re-approval once some skeleton has 10 distinct entries.

## Gate (Auditor #498 on 19d6100, b2f0f67, c8ad8ea and 3e6ef9a)
The plain ternary form count is not enough, and since 3e6ef9a there is no per-if key: a program that contains an if
is keyed by its WHOLE expression skeleton (`ternaryShapesOf`), one key per program:
- the full AST: every operator, kept in place and with its operand order (`le(p0,<num>)` is not `le(<num>,p0)`; the
  then and else branches of an if are not sorted, so min `if(sle(p0,p1),p0,p1)` is not max `if(sle(p0,p1),p1,p0)`);
- parameters renamed p0, p1, ... by first appearance in traversal order (left to right; in an if: guard, then,
  else), whether the guard reads them or not;
- literals replaced by a type placeholder: `<num>` for numbers, `<str>` for a non-empty string and `<empty>` for `""`
  (a branch that yields `""` behaves differently from one that yields a separator or a word: concatenation drops it,
  empty tests on the result see it, so `(n === 1) ? "" : "s"` and `(n === 1) ? "-" : "s"` are different problems).
  No other literal is special. Fixed bounds and operands of `range`, `min`, `max` are `<num>` too.
- a header listing each renamed parameter with its type and declared position, e.g. `[string@1,string@0]`. The type
  keeps string and number problems apart (untyped parameters are `unknown`, never covered). The declared position is
  a deliberate addition to pure first-appearance renaming: without it, `(t === "") ? s : t` and `(s === "") ? t : s`
  have the same skeleton (`if(empty(p0),p1,p0)`), and the Auditor's b2f0f67 round required them to differ (a guard on
  the other parameter is another problem for a caller whose arguments are in declared order). Dropping `@position`
  would merge exactly those argument-order permutations; we kept it so as not to loosen that gate.
Examples: `(n === 1) ? "" : "s"` is `[number@0] if(eq(p0,<num>),<empty>,<str>)`; `(s === "") ? t : s` is
`[string@0,string@1] if(empty(p0),p1,p0)`; the join `s + (((s === "") ? s : "/") + t)` is
`[string@0,string@1] cat(p0,cat(if(empty(p0),p0,<str>),p1))`; `t + ((s === "") ? s : "!")` is
`[string@1,string@0] cat(p0,if(empty(p1),p1,<str>))`.

Because the key is the whole program, the surrounding join, a concat inside a branch, comparison direction against a
constant, range vs a single comparison, sibling ifs, nesting and depth are all part of it; the previous notes on two ifs
in one concat sharing a key and on depth >= 4 reusing depth-3 keys no longer apply. Ternary is emitted only when the
ternary form has >= DERIVE_FORM_BAR (10) entries AND the program's skeleton has >= 10 distinct evidence entries
(`evidenceTernaryShapeCounts`): entries with identical examples count once, and at most 2 entries count per
normalized expression (parameters renamed p0, p1, ... outside string literals). Each evidence entry records its
`ternaryShapes` (its skeleton), and a test checks them against replay. The count fails closed (unreadable file or
missing field: 0).

Tests (m104-ternary-keys.test.ts) assert every case's literal skeleton, then that each case is refused under ten
distinct fakes of another case (which do unlock that case), unlocked by ten of its own and not by nine: plural fakes vs
`(s === "") ? t : s`, `s === "x" ? t : "y"`, a nested chain, two ifs in a join; `(p0 === "") ? p1 : p0` fakes vs
`(s === "") ? s : t`, `(t === "") ? s : t`, `(s === "") ? t : u`, `(s === "") ? t : t`; `t : u` vs `t : t`; concat
branch vs literal branch; number vs string result; `""` vs a non-empty string; the three join repros
`t + ((s === "") ? s : "!")`, `t + (((s === "") ? s : "/") + t)`, `t + ((s === "") ? s : "/")` and
`s + (((t === "") ? s : "/") + t)` under ten `s + (((s === "") ? s : "/k") + t)` fakes; and both ways:
`n <= 5 ? n : m` / `5 <= n ? n : m`, range / `n <= 5`, string min / max, a nested chain / its inner if, depth 3 /
depth 4, an if in a join / the same if alone, sibling ifs on two parameters / on one, two ifs in a join / one,
`(s === t)` / `(n === m)`.

End to end (child processes with a minimal environment: PATH and a scratch HOME only): plural-only fakes refuse
`(value === "") ? fallback : value`, its own fakes emit it. Then one child process imports two copies of derive.ts, each
reading its own evidence file. Evidence A (main + ten each of `(p0 === "") ? p1 : p0`, the join, string min, and
`n <= 5 ? n : m`) emits the fallback, the join and min, and refuses, naming the skeleton, `(s === "") ? s : t`,
`(t === "") ? s : t`, `(s === "") ? t : u`, `s + (((t === "") ? s : "/") + t)`, the three join repros and max.
Evidence B (main + ten string max and ten `5 <= n ? n : m`) emits max and refuses min. Limit: the search does not
build `n <= 5 ? n : m` or `5 <= n ? n : m` (no fit within the budget, with or without evidence), so end to end the
child can only check that neither is emitted under the other's fakes; their mutual refusal is checked at the gate
level. Numeric min / max do not derive for the same reason, so the min / max pair is checked end to end with
strings (`sle`).

Mutants of `ternaryShapesOf` checked by hand on 657b0d0 (each applied to derive.ts, the five tests in
m104-ternary-keys.test.ts run, derive.ts restored). Columns: literal skeletons / earlier-round refusals / this round's
refusals / e2e plural vs fallback / batched e2e. Every mutant fails a gate refusal (not only a key string):

| mutant | literal | earlier refusals | 3e6ef9a refusals | e2e 1 | batched e2e |
|---|---|---|---|---|---|
| no parameter renaming (every parameter `p`) | FAIL | FAIL | FAIL | FAIL | FAIL: `(s === "") ? s : t` emitted |
| operand order dropped (binary operands sorted) | FAIL | pass | FAIL (`n <= 5` / `5 <= n`) | pass | FAIL (names another skeleton) |
| `<empty>` merged into `<str>` | FAIL | FAIL (`""` / `"-"`) | pass | pass | pass |
| all literals one placeholder | FAIL | FAIL | pass | pass | FAIL (names another skeleton) |
| parameter types dropped from the header | FAIL | pass | FAIL (`s === t` / `n === m`) | FAIL | FAIL (names another skeleton) |
| declared positions dropped | FAIL | FAIL (`(t === "") ? s : t`) | pass | FAIL | FAIL (names another skeleton) |
| header dropped | FAIL | FAIL | FAIL | FAIL | FAIL (names another skeleton) |
| per-if skeleton only (no surrounding program) | FAIL | pass | FAIL (join repros, depth, siblings) | pass | FAIL (names another skeleton) |
| if branches sorted (min = max, guard-param a / b collapsed) | FAIL | FAIL | FAIL | FAIL | FAIL: `(s === "") ? s : t` emitted |

## Parked evidence (m106/ternary-evidence, not on this branch)


| normalized expr | entries | distinct examples | counted (cap 2) | repo fn |
|---|---:|---:|---:|---|
| `(p0 === 1) ? "" : "s"` | 8 | 1 | 1 | AdityaChauhanX07/FairNotice s, Pingid/lickle-bin s, ceski23/pi-notifications plural, faradayio/vault-env-js plural, Cimera42/geotastic-map-maker plural, HspecialH/HspecialH plural, crystian/skill-map pluralSuffix, jed1978/instrlint plural |
| `(p0 === 0) ? "" : ","` | 1 | 1 | 1 | GalaxyPay/canonify hasComma |
| `p0 + (((p0 === "") ? p0 : "/") + p1)` | 2 | 1 | 1 | kirchDev/coverage-report join, volfpe/obsidian-remember logPath |
| `((p0 === "") ? p0 : "  ") + p0` | 1 | 1 | 1 | lukebward/speculate indent |
| `(p0 === "") ? p1 : p0` | 1 | 1 | 1 | chetto1983/Aura valueOrFallback |
| `((p0 === "") ? p0 : "#") + p0` | 1 | 1 | 1 | dieWehmut/Vorlage canonicalHeadingHash |
| `p0 + (((p0 === "") ? p0 : " ") + p1)` | 1 | 1 | 1 | everx-labs/ever-q-server withPrefix |
| `p0 + ((p0 === "") ? p0 : p1)` | 1 | 1 | 1 | w5s/project-config globAppendIfNotEmpty |
| `((p0 === "") ? p0 : " — ") + p0` | 1 | 1 | 1 | pipeworx-io/mcp-clearlydefined detailSuffix |

Under the whole-program skeleton (recount on m106 with this branch's derive.ts) the 17 entries count:
`[number@0] if(eq(p0,<num>),<empty>,<str>)` 2 distinct (8 plurals with identical examples + hasComma),
`[string@0] cat(if(empty(p0),p0,<str>),p0)` 3 (indent, `#`, detailSuffix),
`[string@0,string@1] cat(p0,cat(if(empty(p0),p0,<str>),p1))` 2 (join and logPath identical, withPrefix),
`[string@0,string@1] if(empty(p0),p1,p0)` 1 (valueOrFallback), `[string@0,string@1] cat(p0,if(empty(p0),p0,p1))` 1
(globAppendIfNotEmpty): 9 distinct in total; no skeleton is near 10. The first 12 (slices 1-2) split as 9 eq-suffix
(8 plural "s" with byte-identical 23-row examples, plus hasComma ","), 2 join (join and logPath, identical examples)
and 1 indent: about 4 distinct problems, as the Auditor found. The later mining added 5 distinct ones. Other mined copies
(more plurals, 7 more `value === "" ? fallback : value`, a second `#` + id) add 0 under the rule and were not added.
Manual review also dropped hoangvantuan/substack-cli `joinOut` (upstream also treats "." as empty).

What the tests on this branch pin: S3 (scanner refile) is refused ("derive_unevidenced_form: ternary", detail names the
program skeleton and its distinct count); Job A has no general-if candidate; the m102 comparator and string min/max are
refused; with the plural skeleton set to 10 only plurals unlock. In a child process with 10 plural entries,
`(n === 4) ? 1 : 0` (`[number@0] if(eq(p0,<num>),<num>,<num>)`) is still refused, naming its skeleton; 10 distinct entries of its skeleton
emit it; likewise `(value === "") ? fallback : value` is refused with plural-only evidence and emitted with its own.

## Practice runs (seed 100, 5000 tasks, budget 100000, cells 16000000)

if-return-chains on this branch: see the PR body for the run at this head (expected as at m102: 361 right, 0 blocking,
1339 right / 0 wrong after asking). With no ternary entry the gate refuses every ternary, exactly as on main;
family-1 and template-joins have no task that reaches the form gate.
