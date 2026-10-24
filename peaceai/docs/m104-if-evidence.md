# M104: ternary if-key gate (Auditor #498)

Branch m104/if-evidence. This branch changes the engine gate only: peaceai/rules/** is byte-identical to main, so the
learned spec still hashes to 799182d7 (approved in #499) and the evidence file has no ternary entry. The mined if
evidence (17 entries, `ternaryShapes` on each) is parked on branch m106/ternary-evidence (recounted under the key
below), to be proposed for a single re-approval once some key has 10 distinct entries.

## Gate (Auditor #498 on 19d6100, b2f0f67 and c8ad8ea)
The plain ternary form count is no longer enough. Each if node in a derived program gets a key
`guard(positions)|thenKind,elseKind|resultType@place` (`ternaryShapesOf`):
- guard: `eq-num-const` (a number parameter `===` a number), `eq-str-empty` (a string parameter tested for `""`),
  `eq-str-const` (a string parameter `===` a non-empty string), `eq-<type>-const` otherwise; any other guard is its op
  (`le`, `sle`, `eq` for two parameters, `and`, ...). Then the parameter positions the guard reads, in order:
  `(p0)`, `(p1)`, `(p0,p1)`. A guard on the other parameter is another key.
- branch kinds: `lit` (a literal); `guard-param` (the parameter the guard reads; `guard-param-a`, `-b`, ... in the guard's
  order when it reads several); `other-param-a`, `other-param-b`, ... for other parameters, lettered by first
  appearance in then, else (so `t : t` and `t : u` differ); `concat` (a join or template); `nested` (another if); else
  the op.
- result type: number, string, boolean, unknown (untyped parameter branches are never covered).
- place: `top`, `concat` (inside a join or template), `if` (inside another if), `expr` (inside any other node).
Examples: `(n === 1) ? "" : "s"` is `eq-num-const(p0)|lit,lit|string@top`; `(s === "") ? t : s` is
`eq-str-empty(p0)|other-param-a,guard-param|string@top`; the join `s + (((s === "") ? s : "/") + t)` has
`eq-str-empty(p0)|guard-param,lit|string@concat`.

A nested if and every if inside a concat has its own key. Ternary is emitted only when the ternary form has >=
DERIVE_FORM_BAR (10) entries AND every key in the program has >= 10 distinct evidence entries
(`evidenceTernaryShapeCounts`): entries with identical examples count once, and at most 2 entries count per normalized
expression (parameters renamed p0, p1, ... outside string literals). Each evidence entry records its `ternaryShapes`,
and a test checks them against replay. The count fails closed (unreadable file or missing field: 0).

Tests (m104-ternary-keys.test.ts): 10 distinct plural entries unlock only plurals, not `(s === "") ? t : s`,
`s === "x" ? t : "y"`, a nested eq chain, or two ifs in a concat. Ten `(p0 === "") ? p1 : p0` entries unlock none of
`(s === "") ? s : t`, `(t === "") ? s : t`, `(s === "") ? t : u`, `(s === "") ? t : t`. Join entries (then = guard
parameter) do not unlock a join whose then is the other parameter. Literal-branch entries do not unlock a concat branch,
and string-result and number-result entries do not unlock each other. For each case, 10 distinct entries of its own key
unlock it. End to end, one child process with ten `(p0 === "") ? p1 : p0` and ten join fakes: deriveProgram emits
`(value === "") ? fallback : value` but refuses `(s === "") ? s : t`, `(t === "") ? s : t`, `(s === "") ? t : u` and
`s + (((t === "") ? s : "/") + t)`, each naming its key. Mutants checked by hand on 17c05bd: concat branch classified as `lit`, result type dropped, parameter
branches unnamed, guard positions dropped, other parameters not lettered. Each one fails a gate assertion in this file
(not only a key-string assertion).

Known coarseness, acceptable while no key has evidence: the key looks at one if and its place, not at the whole program.
- Two ifs in one concat each get the single-if key a lone if in a concat would get. Nothing records that they are
  siblings.
- Place records only the immediate parent. An if at depth 4 or more gets the same kind of `@if` key as one at depth 3
  (its own guard and branches); no deeper key exists.
Before any evidence for such programs is proposed, this needs a finer key.

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

Under the key above (m106 e05d02a) the 17 entries count: `eq-num-const(p0)|lit,lit|string@top` 2 distinct (8 plurals +
hasComma), `eq-str-empty(p0)|guard-param,lit|string@concat` 5 (join/logPath, indent, `#`, withPrefix, detailSuffix),
`eq-str-empty(p0)|other-param-a,guard-param|string@top` 1 (valueOrFallback),
`eq-str-empty(p0)|guard-param,other-param-a|string@concat` 1 (globAppendIfNotEmpty). No key is near 10. The first 12 (slices 1-2) split as 9 eq-suffix
(8 plural "s" with byte-identical 23-row examples, plus hasComma ","), 2 join (join and logPath, identical examples)
and 1 indent: about 4 distinct problems, as the Auditor found. The later mining added 5 distinct ones. Other mined copies
(more plurals, 7 more `value === "" ? fallback : value`, a second `#` + id) add 0 under the rule and were not added.
Manual review also dropped hoangvantuan/substack-cli `joinOut` (upstream also treats "." as empty).

What the tests on this branch pin: S3 (scanner refile) is refused ("derive_unevidenced_form: ternary", detail names the
if key and its distinct count); Job A has no general-if candidate; the m102 comparator and string min/max are
refused; with the plural key set to 10 only plurals unlock. In a child process with 10 plural entries,
`(n === 4) ? 1 : 0` (`eq-num-const|lit,lit|number@top`) is still refused, naming its key; 10 distinct entries of its key
emit it; likewise `(value === "") ? fallback : value` is refused with plural-only evidence and emitted with its own.

## Practice runs (seed 100, 5000 tasks, budget 100000, cells 16000000)

if-return-chains on this branch: see the PR body for the run at this head (expected as at m102: 361 right, 0 blocking,
1339 right / 0 wrong after asking). With no ternary entry the gate refuses every ternary, exactly as on main;
family-1 and template-joins have no task that reaches the form gate.
