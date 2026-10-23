# M104: upstream if-form (ternary) evidence

Branch m104/if-evidence, stacked on m102/if-return-chains 1319ebe (the #495 fixes). No change to peaceai/lib or
peaceai/bin: the engine is byte-identical to m102; only the evidence file (the single source of form counts) grew.

## Method (round 4, unchanged)
GitHub code search for if / else-return and ternary functions over numbers and strings; permissive-license classifier
unchanged; every candidate replayed (examples -> the same program) and re-derived on the typed held-out domain (0
wrong); whitespace-identical upstream text deduped against the m99 / m101 / m102 upstreams; modules with emails or
private-core lines dropped; at most 3 entries per repo. No entry uses the M102 string order (sle); the M102
comparator / min / max entries are not counted as if-evidence.

Manual review against upstream dropped two candidates that replayed on the probe grid but differ off it:
iirose-plugins/adapter-iirose `parseAvatar` (a `startsWith('http')` branch) and
ministryofjustice/digital-prison-services `possessive` (an `endsWith('s')` branch). One more was a whitespace duplicate.

## Ternary entries: 12, from 12 repos (all MIT)

| repo | fn | commit | expr | held-out right / wrong |
|---|---|---|---|---|
| AdityaChauhanX07/FairNotice | s | 245972821249 | `(n === 1) ? "" : "s"` | 2378 / 0 |
| Pingid/lickle-bin | s | 3abcff8682dd | `(n === 1) ? "" : "s"` | 2378 / 0 |
| ceski23/pi-notifications | plural | a57346e54a34 | `(n === 1) ? "" : "s"` | 2378 / 0 |
| faradayio/vault-env-js | plural | fa732d7c400d | `(n === 1) ? "" : "s"` | 2378 / 0 |
| Cimera42/geotastic-map-maker | plural | cdf41a45ead9 | `(count === 1) ? "" : "s"` | 2378 / 0 |
| GalaxyPay/canonify | hasComma | 2d76296496cb | `(num === 0) ? "" : ","` | 2378 / 0 |
| HspecialH/HspecialH | plural | 521ac7d91f1d | `(count === 1) ? "" : "s"` | 2378 / 0 |
| crystian/skill-map | pluralSuffix | 0cd3a5b01154 | `(count === 1) ? "" : "s"` | 2378 / 0 |
| jed1978/instrlint | plural | 9c2ed3bd9eac | `(count === 1) ? "" : "s"` | 2378 / 0 |
| kirchDev/coverage-report | join | 445c5909244f | `base + (((base === "") ? base : "/") + path)` | 35338 / 0 |
| lukebward/speculate | indent | 8512b3910bd3 | `((line === "") ? line : "  ") + line` | 181 / 0 |
| volfpe/obsidian-remember | logPath | 2911400156fb | `rootFolder + (((rootFolder === "") ? rootFolder : "/") + name)` | 35338 / 0 |

Diversity note (corrected after the Auditor #498 review): 9 of 12 are an equality guard choosing a suffix (8 plural
"s" with byte-identical 23-row examples, 1 hasComma ","); 2 are "join with a separator unless empty" (join and logPath
share their examples); 1 is an indent. FairNotice and lickle-bin differ only in quote style. These are about 4 distinct
problems, not 12. Ternary is now 12 >= DERIVE_FORM_BAR (10), so the general if is
emitted. Form counts: cap 13, ternary 12, strcat 15, eq 29, or 13, range 42, square 25 (123 entries, 101 repos).

What changed in tests: S3 (scanner refile) now derives; Job A makes a candidate for a general if; the m102 comparator
is emitted. The below-bar refusal by name stays tested end to end (a copy of derive.ts in a child process reading an
evidence file one ternary entry short). The learned spec hash was re-pinned (only its evidence counts changed).

## Practice runs (seed 100, 5000 tasks, budget 100000, cells 16000000)

| family | head | right | refused | blocking | known-limit wrong | right after ask | wrong after ask |
|---|---|---|---|---|---|---|---|
| if-return-chains | m102 d335cff | 361 | 4639 | 0 | 0 | 1339 | 0 |
| if-return-chains | m104 0d0b89f | 723 | 4277 | 0 | 0 | 1860 | 0 |
| family-1 | m102 d335cff | 725 | 4182 | 0 | 93 | 1425 | 97 (+219 known limit) |
| family-1 | m104 0d0b89f | 725 | 4182 | 0 | 93 | 1425 | 97 (+219 known limit) |
| template-joins | m102 d335cff | 1345 | 3655 | 0 | 0 | 2832 | 0 |
| template-joins | m104 0d0b89f | 1345 | 3655 | 0 | 0 | 2832 | 0 |

if-return-chains: 883 tasks change, all from a ternary-form refusal (836 such refusals at m102) to an answer; none
becomes wrong (first pass +362 right; after asking +521 right, 0 wrong). family-1: all 5000 task records identical
(no family-1 task reached the form gate at m102: 0 derive_unevidenced_form refusals). template-joins: 0 tasks reached
the form gate at m102, and all 5000 task records are identical at m104.
