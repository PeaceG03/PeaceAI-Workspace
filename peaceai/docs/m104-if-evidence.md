# M104: ternary if-key gate (Auditor #498)

Branch m104/if-evidence. This branch changes the engine gate only: peaceai/rules/** is byte-identical to main, so the
learned spec still hashes to 799182d7 (approved in #499) and the evidence file has no ternary entry. The mined if
evidence (17 entries, `ternaryShapes` on each) is parked on branch m106/ternary-evidence (d7c16d5, recounted under the
key below), to be proposed for a single re-approval once some key has 10 distinct entries.

## Gate (Auditor #498 on 19d6100 and b2f0f67)
The plain ternary form count is no longer enough. Each if node in a derived program gets a key
`guard|thenKind,elseKind|resultType@place` (`ternaryShapesOf`):
- guard: `eq-num-const` (a number parameter `===` a number), `eq-str-empty` (a string parameter tested for `""`),
  `eq-str-const` (a string parameter `===` a non-empty string), `eq-<type>-const` otherwise; any other guard is its op
  (`le`, `sle`, `eq` for two parameters, `and`, ...);
- branch kinds: `lit` (a literal), `param`, `concat` (a join or template), `nested` (another if), else the op;
- result type: number, string, boolean, unknown (untyped parameter branches are never covered);
- place: `top`, `concat` (inside a join or template), `if` (inside another if), `expr` (inside any other node).
A nested if and every if inside a concat has its own key. Ternary is emitted only when the ternary form has >=
DERIVE_FORM_BAR (10) entries AND every key in the program has >= 10 distinct evidence entries
(`evidenceTernaryShapeCounts`): entries with identical examples count once, and at most 2 entries count per normalized
expression (parameters renamed p0, p1, ... outside string literals). Each evidence entry records its `ternaryShapes`,
and a test checks them against replay. The count fails closed (unreadable file or missing field: 0). So 10 distinct
plural entries (`eq-num-const|lit,lit|string@top`) unlock only plurals: not `(s === "") ? t : s`, `s === "x" ? t : "y"`,
a nested eq chain, or two ifs in a concat (m104-ternary-keys.test.ts; 10 distinct entries of each case's own keys do).

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

Under the key above (m106 d7c16d5) the 17 entries count: `eq-num-const|lit,lit|string@top` 2 distinct (8 plurals + hasComma),
`eq-str-empty|param,lit|string@concat` 5 (join/logPath, indent, `#`, withPrefix, detailSuffix),
`eq-str-empty|param,param|string@top` 1 (valueOrFallback), `eq-str-empty|param,param|string@concat` 1
(globAppendIfNotEmpty). No key is near 10. The first 12 (slices 1-2) split as 9 eq-suffix
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
