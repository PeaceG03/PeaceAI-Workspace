Target: PeaceG03/PeaceSTOCKS

add date function `utcDaysBetween(from: Date, to: Date): number` to `src/us-calendar.ts` with body:
const ms = to.getTime() - from.getTime();
return Math.round(ms / 86400000);
- utcDaysBetween(new Date("2024-02-28T00:00:00Z"), new Date("2024-03-01T00:00:00Z")) is 2
- utcDaysBetween(new Date("2024-03-01T00:00:00Z"), new Date("2024-02-28T00:00:00Z")) is -2
- utcDaysBetween(new Date("2026-10-16T05:00:00Z"), new Date("2026-10-16T20:00:00Z")) is 1
- utcDaysBetween(new Date("2026-10-16T05:00:00Z"), new Date("2026-10-16T10:00:00Z")) is 0

(Builder pre-file, DATE_FUNCTION, public-date-function-v1): Peace's task (source: peace). Whole-day differences are computed inline from millisecond deltas (gap-refill-lib's session gap check, tenmin-range-entries' daysSinceEpoch). A UTC-only helper with tests (rounding, negative spans) gives one tested home for that arithmetic. Production safety: additive only; one new exported pure function appended to src/us-calendar.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-date-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/us-calendar.ts. Expected COUNTS.)
