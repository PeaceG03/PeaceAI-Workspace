# M104: upstream if-form (ternary) evidence

Branch m104/if-evidence (stacked on m102 #495; main merged in after #495 landed). The engine change is the Auditor #498
sub-shape gate in peaceai/lib/derive.ts; the rest is the evidence file (the single source of form counts) and tests.

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

## Method (round 4, unchanged)
GitHub code search for if / else-return and ternary functions over numbers and strings; permissive-license classifier
unchanged; every candidate replayed (examples -> the same program) and re-derived on the typed held-out domain (0
wrong); whitespace-identical upstream text deduped against the m99 / m101 / m102 upstreams; modules with emails or
private-core lines dropped; at most 3 entries per repo. No entry uses the M102 string order (sle); the M102
comparator / min / max entries are not counted as if-evidence.

Manual review against upstream dropped two candidates that replayed on the probe grid but differ off it:
iirose-plugins/adapter-iirose `parseAvatar` (a `startsWith('http')` branch) and
ministryofjustice/digital-prison-services `possessive` (an `endsWith('s')` branch). One more was a whitespace duplicate.

## Ternary entries: 17, from 17 repos (all MIT); distinct per sub-shape: eq-const/string 9 (< 10, so no ternary is emitted)

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
and 1 indent: about 4 distinct problems, as the Auditor found. Slices 3-4 add 5 distinct ones. Other mined copies
(more plurals, 7 more `value === "" ? fallback : value`, a second `#` + id) add 0 under the rule and were not added.
Manual review also dropped hoangvantuan/substack-cli `joinOut` (upstream also treats "." as empty).

What the tests pin: S3 (scanner refile) is refused again ("derive_unevidenced_form: ternary", detail names the
sub-shape and its distinct count); Job A has no general-if candidate; the m102 comparator and string min/max are
refused; with eq-const/string set to 10 only that shape unlocks. The learned spec hash is re-pinned to 2136ccd8 (only its
evidence counts change: 128 examples, 106 repos). #499 landed the approval of 799182d7 (the 111-example spec), so on this
branch that approval reads HASH_CHANGED: the two approval tests (approved.json entries hash-match a spec; any
approved.json entry pins the exact hash) fail until Peace approves the new hash. Every other test passes.

## Practice runs (seed 100, 5000 tasks, budget 100000, cells 16000000)

| family | head | right | refused | blocking | known-limit wrong | right after ask | wrong after ask |
|---|---|---|---|---|---|---|---|
| if-return-chains | m102 d335cff | 361 | 4639 | 0 | 0 | 1339 | 0 |
| if-return-chains | m104 0d0b89f (plain form gate, superseded) | 723 | 4277 | 0 | 0 | 1860 | 0 |
| if-return-chains | m104 547118d (sub-shape gate) | 361 | 4639 | 0 | 0 | 1339 | 0 |
| family-1 | m102 d335cff | 725 | 4182 | 0 | 93 | 1425 | 97 (+219 known limit) |
| family-1 | m104 0d0b89f | 725 | 4182 | 0 | 93 | 1425 | 97 (+219 known limit) |
| template-joins | m102 d335cff | 1345 | 3655 | 0 | 0 | 2832 | 0 |
| template-joins | m104 0d0b89f | 1345 | 3655 | 0 | 0 | 2832 | 0 |

With the sub-shape gate, if-return-chains is back to m102: all 5000 task records are identical to m102 (no ternary
sub-shape reaches 10). family-1 and template-joins had 0 tasks reaching the form gate at m102 and were identical at
0d0b89f, where the gate was looser, so the stricter gate cannot change them. The later evidence additions (slices 3-4)
only raise counts that are already >= 10 (strcat, eq) or a ternary sub-shape that stays < 10.
