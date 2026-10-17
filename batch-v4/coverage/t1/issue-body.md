Target: PeaceG03/PeaceSTOCKS

add date function `utcDateKey(d: Date): string` to `src/et-time.ts` with body:
return d.toISOString().slice(0, 10);
- utcDateKey(new Date("2026-10-16T23:59:59Z")) is "2026-10-16"
- utcDateKey(new Date("2024-02-29T00:00:00Z")) is "2024-02-29"
- utcDateKey(new Date("2026-01-01T04:59:00Z")) is "2026-01-01"

(Builder pre-file, DATE_FUNCTION, public-date-function-v1): Peace's task (source: peace). The UTC date key `toISOString().slice(0, 10)` is written inline about a dozen times across src (tenmin-history, storage, daily-bars-coverage, gap-refill, us-calendar, session-open...). A named, tested helper gives one place for it. Production safety: additive only; one new exported pure function appended to src/et-time.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-date-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/et-time.ts. Expected COUNTS.)
