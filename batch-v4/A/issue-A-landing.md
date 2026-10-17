<!-- DRAFT: do not file until #331 and approval #332 have merged. Labels: peace-task. Repo: PeaceG03/PeaceAI-Workspace -->
Title: Self zone: add utcMonthKey to the self-test date helpers

add complex function `utcMonthKey(day: string): string` to `peaceai/self-tests/helpers/dates.ts` with body:
const d = day.slice(0, 10);
if (d.length !== 10) throw new Error("BAD_DAY");
const month = d.slice(0, 7);
return month;
- utcMonthKey("2026-10-16") is "2026-10"
- utcMonthKey("2026-10-16T23:59:00Z") is "2026-10"
- utcMonthKey("2026") throws BAD_DAY

Expected: one candidate that edits only peaceai/self-tests/helpers/dates.ts plus one new
peaceai/self-tests/helpers/dates.*.test.ts. Job B logs no protected_digest line. A Workspace verdict PR follows.
