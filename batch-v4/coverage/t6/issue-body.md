Target: PeaceG03/PeaceSTOCKS

add function `monthKeyOf(sessionDate: string): string` to `src/daily-bar-sessions.ts` returning sessionDate.slice(0, 7)
- monthKeyOf("2024-10-31") is "2024-10"
- monthKeyOf("2025-01-02") is "2025-01"

(Builder pre-file, ADD_FUNCTION, public-add-function-v1): Peace's task (source: peace). The YYYY-MM month key `sessionDate.slice(0, 7)` is written inline about ten times (daily-bars-coverage, object-storage, gap-refill-lib, daily-bar-sessions, ticker-reference-index). A named helper next to requireMonth. Production safety: additive only; one new exported pure function appended to src/daily-bar-sessions.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-add-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/daily-bar-sessions.ts. Expected COUNTS.)
