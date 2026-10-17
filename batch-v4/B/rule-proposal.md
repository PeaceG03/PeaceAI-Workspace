<!-- peaceai-rule-proposal:v1 id=public-date-function-v1 sha256=0b48c156542e1d0cdfe06b46e31d5a170cb214264c2517977d52442ffd298ae6 source=public -->
## Learned edit rule proposal: `public-date-function-v1` (COMPLEX_FUNCTION)

Mined deterministically (peaceai-miner:v3, TypeScript AST shapes, no model of any kind) from public commits in: DEADover/DzenAnalytics, Scifi-ally/Mimir, amarbayar/event-os, nbharathik/ifc-viewx, pnp/spfx-copilot-components, tradeblocks-org/tradeblocks, uwblueprint/social-diversity-for-children, vetmogee/schedula.

### Frequency evidence

| shape | hunks | distinct commits | distinct files |
|---|---:|---:|---:|
| DATE_FUNCTION | 10 | 8 | 8 |

| style | value | count |
|---|---|---:|

Example commits:

- [amarbayar/event-os minutesSinceMidnight (MIT)](https://github.com/amarbayar/event-os/blob/e00a720e6a292d4d3d8b2a32ecf3abd10ce7892c/src/lib/agenda-time.ts#L29)
- [pnp/spfx-copilot-components startOfUtcDay (MIT)](https://github.com/pnp/spfx-copilot-components/blob/993a2cfd6de74d3f0565aea83daa14e3e7e5d72c/samples/zava-one-hub/src/shared/utils/evergreenDates.ts#L5)
- [tradeblocks-org/tradeblocks isoDate (MIT)](https://github.com/tradeblocks-org/tradeblocks/blob/a7f07f7410ffcec04bb127af334ee8820650dc7f/packages/lib/calculations/xnys-session-calendar.ts#L31)
- [tradeblocks-org/tradeblocks utcDate (MIT)](https://github.com/tradeblocks-org/tradeblocks/blob/a7f07f7410ffcec04bb127af334ee8820650dc7f/packages/lib/calculations/xnys-session-calendar.ts#L35)
- [nbharathik/ifc-viewx julianCenturies (Apache-2.0)](https://github.com/nbharathik/ifc-viewx/blob/6f831b81595619fd8421c08f35118e11ee5eff7a/src/geo/solar.ts#L31)
- [Scifi-ally/Mimir getMinutesInIST (MIT)](https://github.com/Scifi-ally/Mimir/blob/4e30eb0204db8dee76c89042e0f0dbf645ae7178/backend/src/suggestions/timing.ts#L28)
- [uwblueprint/social-diversity-for-children totalUTCMinutes (MIT)](https://github.com/uwblueprint/social-diversity-for-children/blob/4a04b87d681d539b454c1d572cbc103188ef9195/utils/time/convert.ts#L15)
- [vetmogee/schedula durationToMinutes (MIT)](https://github.com/vetmogee/schedula/blob/c395c2bcd75351ec2728ccf0e6cc1242d3673dbe/src/lib/duration.ts#L11)
- [vetmogee/schedula durationToTimeString (MIT)](https://github.com/vetmogee/schedula/blob/c395c2bcd75351ec2728ccf0e6cc1242d3673dbe/src/lib/duration.ts#L32)
- [DEADover/DzenAnalytics isWeekendUTC (MIT)](https://github.com/DEADover/DzenAnalytics/blob/aa018a7ad6bc32e59d7c94d45550135f1349630a/src/lib/historicalRates.ts#L221)

### What the rule does

Task phrasing: add date function `name(a: T, b: U): R` to `src/file.ts` with body:, then the body lines (COMPLEX_FUNCTION's grammar, no loops, with `Date` also allowed as a parameter, return or local type and only the timezone-free Date API in expressions: `getUTC*()` getters, `getTime()`, `toISOString()`, `Date.UTC(...)` and `new Date(EXPR)` with exactly one argument; refused by name: local-time reads such as getHours/getDay/toLocale*/Date.parse/`new Date(y, m, ...)` (date_local_time), `Date.now()` / `new Date()` (date_now) and setters (date_setter)), then one bullet per test check, with `new Date("ISO")` arguments for a Date parameter (`- CALL is VALUE`, e.g. `- f(new Date("2026-10-16T05:30:00Z")).toISOString() is "..."`). Plain unprotected non-test .ts target only

It appends ONE new exported, fully typed function with a bounded loop-free multi-statement body (2-20 statements, nesting depth up to 3) to the end of a plain, unprotected, non-test `.ts` module, and writes one NEW test file from the task's bullets. `Date` may appear in the signature and in local annotations. Expressions may use only the timezone-free Date API (getUTC* getters, getTime, toISOString, Date.UTC, `new Date(EXPR)` with one argument) on top of COMPLEX_FUNCTION's vocabulary, so the result never depends on the runner's clock or time zone. Local-time reads (`date_local_time`), the clock (`date_now`) and setters (`date_setter`) are refused by name; every other `new`, global or module name is `body_refused`. Refused on a non-plain path, a protected path, a name already in the file, or a new test path that already exists anywhere in the checkout. Job B grades the candidate against itself (the new test passes with the function and fails with the module put back to the task base). Same scope, leak and core-text gates as every other candidate.

### Spec (the hash covers exactly this JSON, canonicalized with sorted keys)

<!-- spec -->
```json
{
  "evidence": {
    "commits": 8,
    "files": 8,
    "hunks": 10,
    "repos": [
      "DEADover/DzenAnalytics",
      "Scifi-ally/Mimir",
      "amarbayar/event-os",
      "nbharathik/ifc-viewx",
      "pnp/spfx-copilot-components",
      "tradeblocks-org/tradeblocks",
      "uwblueprint/social-diversity-for-children",
      "vetmogee/schedula"
    ]
  },
  "id": "public-date-function-v1",
  "kind": "COMPLEX_FUNCTION",
  "minedFrom": "public",
  "minerVersion": "peaceai-miner:date-examples-v1",
  "params": {
    "body": "bounded-block",
    "grading": "self-fail-before-pass-after-and-stub",
    "loops": [
      "none"
    ],
    "params": "typed",
    "placement": "end-of-module",
    "returns": "annotated",
    "test": "new-file",
    "types": "primitive+date"
  },
  "schema": "peaceai-learned-rule:v1",
  "shape": "DATE_FUNCTION",
  "trigger": "^add (?:a )?date function \\x60?(?<fn>[A-Za-z_$][\\w$]*) ?\\((?<sig>[A-Za-z_$][\\w$]*: ?(?:(?:readonly )?(?:string|number|boolean)(?:\\[\\])?|Date)(?:, ?[A-Za-z_$][\\w$]*: ?(?:(?:readonly )?(?:string|number|boolean)(?:\\[\\])?|Date)){0,3})\\) ?: ?(?<ret>(?:(?:readonly )?(?:string|number|boolean)(?:\\[\\])?|Date))\\x60? to \\x60?(?<file>[\\w./-]+\\.ts)\\x60? with body ?:?[ \\t]*$"
}
```
<!-- /spec -->

SHA-256: `0b48c156542e1d0cdfe06b46e31d5a170cb214264c2517977d52442ffd298ae6`

### Approval

To approve, post exactly `/approve-rule 0b48c156542e1d0cdfe06b46e31d5a170cb214264c2517977d52442ffd298ae6` on this issue from the PeaceG03 account. Only that comment makes the approval workflow add the rule to the hash-pinned list. Architect posts `/approve-rule` under Peace's delegation, with a note on what was checked. Until then Job A refuses this rule.