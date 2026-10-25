# M111: boolean label chains (public-derive-from-behavior-v2)

Gap: a behavior-only task whose parameters are booleans and whose result is one of a few labels, e.g. a status word
from two flags, got `derive_no_fit` under v1: a boolean parameter was not an if-guard, and a label given by one
example only was never a constant (v1 refuses to memorize an output seen once). The v1 ternary evidence bar (M104)
would also have refused any such program, since no evidence entry has an if over booleans.

Change: a new rule version, `public-derive-from-behavior-v2` (param `dsl: typed-dsl-v2`), proposal record
`peaceai/rules/proposals/public-derive-from-behavior-v2.json`, spec section in `peaceai/spec/derive-from-behavior-v1.md`.
v1 is unchanged (labelChains off). What v2 adds is described in the spec section; in short: boolean guards over
constant branches, once-seen labels only in a fully covered all-boolean domain, finite-domain branch reach, gate
domain (ask for missing inputs), and the ternary bar lifted only for an all-boolean label tree covering its domain.

## For Auditor: the exemption

The M104 ruling requires DERIVE_FORM_BAR replaying upstream entries per if-program skeleton. v2 lifts that bar for one
case only: every parameter boolean, the examples give every input (4 or 8), and the program is an if-tree over those
parameters with constant leaves. The argument: the program then equals the examples' table on every possible input, so
the risk the bar guards against (a program that fits the examples but is wrong on unseen inputs) does not exist.
The remaining risk is the examples themselves being wrong, which no bar on the program addresses. No upstream evidence
of boolean label chains was mined for this proposal. If Auditor wants frequency evidence anyway, the M102 method applies.

## Held-out results (peaceai/test/m111-derive-boolean-label-chains.test.ts)

The held-out specs were written before they were first run and were not used to build the engine:

| spec | v1 | v2 |
|---|---|---|
| doorLabel(locked, open, alarm): 8-row else-if chain, 4 labels | derive_no_fit | `alarm ? "ALARM" : (open ? "OPEN" : (locked ? "LOCKED" : "CLOSED"))`, equal on all 8 inputs |
| retryDelay(timedOut, rateLimited): number labels 60 / 5 / 0 | derive_no_fit | `rateLimited ? 60 : (timedOut ? 5 : 0)` |
| quadrant(east, north): a decision tree, 4 distinct labels | derive_no_fit | `east ? (north ? "NE" : "SE") : (north ? "NW" : "SW")` |
| switchWord(on): one boolean | derive_examples | derive_examples (count: 2 inputs, under the 3-example minimum; a recorded limit, found on the first run) |

Negative cases: every held-out table with any one input left out is refused (gate domain, or derive_ambiguous) and
asks at exactly that input. A 2-boolean chain missing its 4th input, where both branch orders fit, is refused asking at
(true, true). Seeded random label tables (40 tasks, 2-3 booleans, 2-4 labels): 32 full tables derived, every one equal
to its table; 8 refused derive_no_fit (they need a tree past size 13); 29 partial tables all refused; 0 wrong.

## #516 offline

The issue body of PeaceG03/PeaceAI-Workspace#516, run offline against PeaceSTOCKS main (0bbb039): v1 refuses (`derive_no_fit`);
v2 writes `return failed ? "ERROR" : (silent ? "SILENT" : "OK");` and the four-example test, which passes with the
module and fails with it removed. Not run live: v2 is not approved.
