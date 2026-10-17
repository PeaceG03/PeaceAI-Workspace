<!-- DRAFT: do not file until #335 has merged AND public-date-function-v1 is in approved.json (Peace /approve-rule 0b48c156..., then the bot approved.json PR merged). Labels: peace-task. Repo: PeaceG03/PeaceSTOCKS -->
Title: Add utcMinuteOfDay to et-time

add date function `utcMinuteOfDay(now: Date): number` to `src/et-time.ts` with body:
const h = now.getUTCHours();
const m = now.getUTCMinutes();
return h * 60 + m;
- utcMinuteOfDay(new Date("2026-10-16T05:30:00Z")) is 330
- utcMinuteOfDay(new Date("2026-10-16T00:00:00Z")) is 0
- utcMinuteOfDay(new Date("2026-10-16T23:59:59Z")) is 1439

Expected: one candidate (public-date-function-v1) that appends utcMinuteOfDay to src/et-time.ts and creates one new src/et-time.utcminuteofday-*.test.ts. Job B: the test passes with the function and fails with the module at the task base (box dry run: real PASS, stub FAIL, base FAIL, TZ=America/Denver). Nothing else in the file changes.
