<!-- DRAFT: file only after the landing proof, under the same conditions. Labels: peace-task. Repo: PeaceG03/PeaceSTOCKS -->
Title: Add etHourNow to et-time (expected refusal)

add date function `etHourNow(now: Date): number` to `src/et-time.ts` with body:
const h = now.getHours();
return h;
- etHourNow(new Date("2026-10-16T13:30:00Z")) is 9

Expected: no candidate. Results records the refusal reason date_local_time (getHours is a local-time read, so the result would depend on the runner time zone). No PR.
