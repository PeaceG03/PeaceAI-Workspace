# NEXT-SKILL: a future test-case-existing v8 that soundly recovers the ONEOFF_SESSIONS 12

Status: design notes only, nothing implemented. Engine base: PR #466 head e9ea32d
(the v7-only fresh-local-Date setter allowance). Census repo: PeaceSTOCKS 0ab37c8.

## What is lost and why

At e9ea32d these accept on main d668ffa v6 but are refused at every head version
(head is stricter because the load-call allowance now analyses the load-time callee
instead of accepting it blindly):

- oneoff (6): errorClass, inOneOffGuardWindow, oneOffPauseReason, parseChainIndex,
  parseOneOffBudgetMs, readbackVerdict
- gap-refill (4): asOfVerdict, inRefillGuard, refillPauseReason, strictRefillBudgetMs
  (gap-refill imports `timedFetch` from oct2024-tenmin-oneoff, so it pulls in the same module load)
- plus at v7: oneoff dollarVolumeBySecurity, storedByFetchFrom
  (accepted at 71ef75d v7, refused now)

That makes 12. They share one root cause: module load of
`src/oct2024-tenmin-oneoff.ts` runs
`export const ONEOFF_SESSIONS = tradingSessionsBetween(ONEOFF_FIRST_FLOOR, ONEOFF_CAL_TO);`

The 13th main-only function, backfill.ts:backfillRequiresObjectStore, is a separate
blocker. It is NOT recovered by anything below and still needs triage.

Downstream: landed tests oneoff 1ae882e/9ea4a3c/b2ad4ef, gap-refill 4903c45 and
strictrefillbudgetms-strict-env, plus batch-v10 Z4 (errorClass), are blocked by this chain.

## Blockers (all five are needed; checked by ablation, see "Evidence")

1. **Returned Date mutated by the caller** (interprocedural freshness).
   src/us-calendar.ts has:
   - `nyseClosedDates`: `const goodFriday = easterSunday(year); goodFriday.setUTCDate(...)`
   - `nyseHalfDayDates`: `const thanksgiving = dateUtc(...); thanksgiving.setUTCDate(...)`
   The v7 rule (`freshDateSetters`) only treats `new Date(<non-clock args>)` as fresh.
2. **Exported array from a load call.** `export const ONEOFF_SESSIONS = tradingSessionsBetween(...)`.
   The load-call rule only allows NON-exported read-only results; `containerEscapes`
   refuses call-initialised module consts. The test file imports ONEOFF_SESSIONS
   (indexes it read-only).
3. **Object-constant default param.**
   `tradingSessionsBetween(from, to, calendar: SessionCalendar = US_EQUITY_MARKET_CALENDAR)`
   is a signature refusal (non-primitive param), even if the body never uses it.
4. **Method dispatch on an object const.** `calendar.getSession(date)` resolves to the
   object-literal method `US_EQUITY_MARKET_CALENDAR.getSession`. The walker does not
   follow it, so it is impure.
5. **`Object.keys(<module const record>)` feeding `new Set([...])` (v7 Set feature).**
   Minimal case: `return new Set([...Object.keys(SPECIAL)]);` is v7 impure, while
   `return [...Object.keys(SPECIAL)];` is accepted. In nyseClosedDates this is
   `...Object.keys(NYSE_SPECIAL_CLOSURES).filter(...)`.

## Sound extension designs

A. **Interprocedural freshness for returned Dates.** Mark a same-repo function F
   "returns-fresh-Date" if every `return` in F is either:
   - `new Date(args)`, where the args are not clock-fed and have no local-time `dateRefusal`, or
   - a local `const` that meets the existing freshDateSetters conditions (not captured,
     not escaped before return, no shadowing).

   F must also be load-call/purity clean under the same opts, with no closure capture
   and no Date stored elsewhere. Then `const x = F(...)` counts as a fresh Date for
   freshDateSetters, with the same ordering and loop rules. Keep it v8-only, use UTC
   setters only, and pin the TZ demo tests. Soundness argument: each call allocates a
   new object that is unreachable from anywhere else.

B. **Exported read-only arrays from pure load calls.** Allow
   `export const X = pureCall(<literal or const-primitive args>)` when all of these hold:
   - the callee passes the load-call check and returns a fresh array of primitives
     (`string[]`/`number[]`), with all of the array built locally;
   - every importer in the census closure (non-test files, plus the analysed test
     file) uses X only read-only: index, `.length`, `.indexOf`/`.includes`/`.at`/
     `.slice`, `for…of`, or spread into a new array;
   - no mutating method, assignment, or passing X to an unknown callee.

   Simpler and stronger: require the type annotation `readonly string[]` / `ReadonlyArray`
   AND scan importers. A per-test-run copy is not required because the value is
   deterministic. The risk is cross-test mutation, which the read-only importer scan
   closes.

C. **Object-constant defaults.** Accept a param `p: T = K`, where K is a module
   `const` object literal that is exported or local, never reassigned, never mutated
   (aliasFree), and has only method or primitive members, when the call sites in the
   analysed closure omit p (or pass K itself). Then specialise `p.m(...)` to the
   literal's method body and analyse it with the same opts (this is blocker 4).
   Refuse if any call site passes a non-K value, or if p escapes (it is
   stored or passed on).
   Note: the target signature check must still refuse a target whose own exported
   signature takes an object. This allowance is for load-call callees and same-repo helpers only.

D. **Object.keys/values/entries of a frozen-shape record const** returns a fresh array
   of primitives (keys are always strings). Treat it as fresh for the v7 Set/Map
   construction checks when the record is a module const that is never mutated
   (aliasFree, typed `Readonly<Record<string, string>>`, or `as const`).

## Census estimate (simulated on PeaceSTOCKS 0ab37c8, engine e9ea32d)

Scratch tree /tmp/oo5 has source rewrites that emulate A–D:
- A: `new Date(easterSunday(year))` / `new Date(dateUtc(...))` copies
- B: de-exported ONEOFF_SESSIONS
- C: dropped the default and hoisted getSession into `usSession`
- D: inlined the keys literal

Census on it vs e9ea32d (only keys present in both):

| | v1 | v2 | v3 | v4 | v5 | v6 | v7 |
|---|---|---|---|---|---|---|---|
| e9ea32d | 34 | 72 | 83 | 95 | 102 | 111 | 123 |
| simulated v8 tree | 34 | 72 | 83(+0) | 95(+0) | 102 | 111 | 136 (+13) |

(Raw totals on the scratch tree are higher only because it exports helper fns for bisection.)

The +13 at v7 are the 12 above plus tenmin-history:tradingSessionsBetween. Zero gains
and zero losses at v1–v6, which is consistent with "only v8 widens".
Estimate for a real v8: about 136 accepted, i.e. +13 over v7, with the 5 landed tests
and batch-v10 Z4 expected to flip to accept. backfillRequiresObjectStore stays refused.

## Evidence

- Ablation from /tmp/oo5: revert one emulation at a time (/tmp/ab-date,
  /tmp/ab-export, /tmp/ab-hoist, /tmp/ab-keys, /tmp/ab-default). errorClass and
  asOfVerdict are refused v6+v7 in every ablation, so all five are necessary.
  ab-default gives tradingSessionsBetween test_target_signature.
- Literal `const ONEOFF_SESSIONS: readonly string[] = ["2024-10-11"]` (/tmp/oo4)
  gives errorClass/inOneOffGuardWindow/asOfVerdict accepted at v6 AND v7. So the
  load call is the only blocker for those, and for v6 the 10 recover only if the whole
  chain (incl. the Set-returning helpers) is allowed as a load-call callee.
- Micro cases: /tmp/three.mts.
- Earlier partial attempt /tmp/oo (blockers 1+3 only, with a bug that left `calendar`
  free) recovered nothing.

## Test plan for v8

- Negative proofs for each of A–D:
  - A: a returned Date that is also stored or cached in a module, a callee that returns
    a param Date, a callee returning a Date captured by a closure, a local setter on the
    returned Date, and TZ variance.
  - B: an importer that mutates (`push`/`sort`/`splice`/index assign), X passed to an
    unknown fn, and X re-exported then mutated.
  - C: a call site passing another object, K mutated somewhere, and p stored.
  - D: a record mutated via `Object.assign` or index assignment.
- Subset proof: v1–v7 accepted sets unchanged; v8 gains only.
