Target: PeaceG03/PeaceSTOCKS

add date function `isUtcWeekend(d: Date): boolean` to `src/scan-backstop.ts` with body:
const day = d.getUTCDay();
return day === 0 || day === 6;
- isUtcWeekend(new Date("2026-10-17T12:00:00Z")) is true
- isUtcWeekend(new Date("2026-10-18T00:00:00Z")) is true
- isUtcWeekend(new Date("2026-10-16T23:30:00Z")) is false
- isUtcWeekend(new Date("2026-10-19T00:00:00Z")) is false

(Builder pre-file, DATE_FUNCTION, public-date-function-v1): Peace's task (source: peace). The backstop's slot logic works on UTC weekdays (getUTCDay), but there is no Date-level weekend check; tenmin-backfill's isWeekendIndex takes a bare index. This is the timezone-free Date version, tested at the UTC day edges. Production safety: additive only; one new exported pure function appended to src/scan-backstop.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-date-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/scan-backstop.ts. Expected COUNTS.)
