Target: PeaceG03/PeaceSTOCKS

add complex function `storageUtilizationPercent(mbPerDay: number): number` to `src/storage.ts` with body:
const gbPerYear = (mbPerDay * 252) / 1024;
return gbPerYear * 10;
- storageUtilizationPercent(128) is 315
- storageUtilizationPercent(1024) is 2520
- storageUtilizationPercent(0) is 0

(Builder pre-file, COMPLEX_FUNCTION, public-complex-function-v1): Peace's task (source: peace). storage.ts and object-storage.ts both compute targetUtilizationPercent inline as `((mbPerDay * 252) / 1024 / 10) * 100` (252 sessions a year against a 10 GB target). This is the same math as one tested helper (written as gbPerYear * 10 so the test values are exact). Production safety: additive only; one new exported pure function appended to src/storage.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-complex-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/storage.ts. Expected COUNTS.)
