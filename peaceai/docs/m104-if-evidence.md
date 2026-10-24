# M104: ternary sub-shape gate (Auditor #498)

Branch m104/if-evidence. This branch changes the engine gate only: peaceai/rules/** is byte-identical to main, so the
learned spec still hashes to 799182d7 (approved in #499) and the evidence file has no ternary entry. The mined if
evidence (17 entries, `ternaryShapes` on each) is parked on branch m106/ternary-evidence (b4061c1), to be proposed for a
single re-approval once a 10th distinct eq-const/string entry exists.

## Gate (Auditor #498 on 19d6100)
The plain ternary form count is no longer enough. Each if node in a derived program gets a sub-shape
`guardClass/branchType` (`ternaryShapesOf`): guardClass is `eq-const` for a parameter `===` a constant (or an empty
test), else the guard's op (`le`, `sle`, `and`, ...); branchType is the type of the branches (number, string,
boolean, unknown). Ternary is emitted only when the ternary form has >= DERIVE_FORM_BAR (10) entries AND every
sub-shape in the program has >= 10 distinct evidence entries (`evidenceTernaryShapeCounts`): entries with identical
examples count once, and at most 2 entries count per normalized expression (parameters renamed p0, p1, ... outside
string literals). Each evidence entry records its `ternaryShapes`, and a test checks them against replay. The count
fails closed (unreadable file or missing field: 0). So a `<=` guard with number branches (max, the m102 comparator),
or `===` with number branches, stays refused however many plural entries are added.

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

All 17 are sub-shape eq-const/string; no other sub-shape has any entry. The first 12 (slices 1-2) split as 9 eq-suffix
(8 plural "s" with byte-identical 23-row examples, plus hasComma ","), 2 join (join and logPath, identical examples)
and 1 indent: about 4 distinct problems, as the Auditor found. The later mining added 5 distinct ones. Other mined copies
(more plurals, 7 more `value === "" ? fallback : value`, a second `#` + id) add 0 under the rule and were not added.
Manual review also dropped hoangvantuan/substack-cli `joinOut` (upstream also treats "." as empty).

What the tests on this branch pin: S3 (scanner refile) is refused ("derive_unevidenced_form: ternary", detail names the
sub-shape and its distinct count); Job A has no general-if candidate; the m102 comparator and string min/max are
refused; with eq-const/string set to 10 only that shape unlocks.
In a child process with 10 test eq-const/string entries, `(n === 4) ? 1 : 0` (eq-const/number) is still refused, naming
its sub-shape; 10 distinct eq-const/number entries emit it.

## Practice runs (seed 100, 5000 tasks, budget 100000, cells 16000000)

if-return-chains on this branch: see the PR body for the run at this head (expected as at m102: 361 right, 0 blocking,
1339 right / 0 wrong after asking). With no ternary entry the gate refuses every ternary, exactly as on main;
family-1 and template-joins have no task that reaches the form gate.
