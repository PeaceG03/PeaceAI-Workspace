# PeaceSTOCKS scanner diagnosis (2026-10-22, Builder, diagnosis only)

Base: PeaceSTOCKS main 0ab37c8. PeaceAI-Workspace main 1e8448a (30-rule approved list).
Read-only: gh run list/view/logs only. No code pushed to PeaceSTOCKS, no PR, no dispatch/rerun, no issue filed.
R2 was not read (that would mean using a credential); see "Open checks".

## State of the schedules / limits
- All workflows active (none disabled). Crons in scanner.yml: scan `30 5 * * 2-6`, `30 9 * * 2-6`;
  restarter `47 * * * *`; ten-minute daily `20 6/10 * * 2-6`. gap-refill.yml: `40 14 * * 0` (weekly, Sunday).
- Repo is public: no Actions-minutes limit. Repo vars: TENMIN_AUTO_REDISPATCH=true, TENMIN_DAILY_ENABLED=true,
  TENMIN_AUTO_REDISPATCH_MAX_CHAIN unset (default cap 24). Secrets not read or printed.
- Massive plan probe: status=403 olderReachable=false. This is the plan's history limit (informational) and is NOT the cause.
  Massive pacing is 12.5 s per request (DEFAULT_MIN_REQUEST_INTERVAL_MS), with 3 transient attempts.

## Problem 1: daily bars stale (latest stored 2026-10-15, expected 2026-10-20)
Evidence:
- Every scheduled scan since 2026-10-14 fails the same way. Runs: 38548746122 38549152900 38582001414 38692584970
  38718050992 38750153271 38860950918 38884095006 38913119832 39021440119 39035105710 39379686212 39406360415
  39439049597 39556304036 39584106656 39617990129 39762452408 39797087212.
  In each, step "Run online scanner host" (`pnpm scheduler`, scanner.yml:153-156) prints nothing for 46-53 min, then
  `MARKETS_SCHEDULER_HOST_FAILED:fetch failed`, exit 2.
- The coverage step then reports, e.g. 39797087212 (2026-10-22 15:30Z = 09:30 MDT):
  `DAILY_BARS_COVERAGE_GAP:3:2026-10-16..2026-10-20 | DAILY_BARS_COVERAGE_STALE:latest=2026-10-15:expected=2026-10-20 | CORPORATE_ACTIONS_COVERAGE_GAP:3:...`
- Last scanner.run success: 38047807291 (2026-10-10, 37 min, COMPLETED NO_MISSED_SESSION, session 2026-10-09).
  2026-10-13 scans returned NOT_DUE / ALREADY_COMPLETE (no run()).
- 10-14 and 10-15 exist only because weekly gap refill 39149992952 (Sunday 2026-10-18) filled them in about 2 min
  (massiveRequests=2, VERIFY PASS 2/2). Gap refill 38338034112 (2026-10-13) had added 159 sessions.
- The green "Scanner" runs are restarter / ten-minute daily runs; those never scan.

Root cause (strongly supported; exact throw site unconfirmed because the host drops the error cause):
1. src/scanner.ts:481-496 `finish()` always calls `await this.storage.measureStorage()` before writeRunReport.
   Every run path (including early returns) goes through finish().
2. src/object-storage.ts:251-272 `measureStorage()` lists the whole bucket (`client.list("")`) and then does
   `await this.client.get(key)` for EVERY object, one at a time, only to sum byteLength. It has done this since 15f957e (2026-10-03).
   The bucket grew sharply after 2026-10-10 from the ten-minute Reply Dust history chain (thousands of objects per range),
   so this whole-bucket download now runs for about 50 min. That matches the silent 46-53 min.
3. src/object-store.ts:233-258 `R2ObjectClient.request` is a bare `this.fetchImpl(url, init)` with no try and no retry.
   One network blip in tens of thousands of sequential GETs throws undici's raw `TypeError: fetch failed`
   (Massive errors would carry the `MASSIVE_NETWORK:` prefix; this one does not, so it is the R2 path).
4. src/host.ts: the missed-session loop runs scanner.run per session, but `saveSchedulerState(nextState)` (host.ts:342)
   only happens after the whole loop, and the run report is written only after measureStorage. A throw loses everything,
   and the next run retries the same oldest missed session. It is stuck forever.
5. src/host.ts:450-456 `main().catch` prints only `error.message`. It drops error.cause and the stack, which is why
   the log says only "fetch failed".
Contributing causes:
- A coverage failure does not trigger gap refill. That runs weekly only (next: Sunday 2026-10-25 14:40Z = 08:40 MDT).
- src/object-storage.ts:112-120 loadBars GETs every month file in parallel. A box simulation (25 files / 4.1M rows /
  2.42 GB: OK in 29 s, heap 2.4 of 4.35 GB) did NOT reproduce a failure, so it is not the primary cause.

## Problem 2: ten-minute history chain stopped (issue #10 open)
- Chain started 39150140071 (2026-10-18 17:33Z, dispatched by gap refill's release step) and ran 24 runs.
- #23 39451888891 failed with `R2_PUT_500`, which led to CONTINUE_TRANSIENT_RETRY:attempt=1.
- #24 39467160610 failed with `R2_GET_500` on range 2025-03-01_2025-04-30 (7736 fetches planned).
  decideTenMinRedispatch checks the cap before the transient path (src/tenmin-redispatch.ts:377), so it decided
  `STOP_CHAIN_CAP:24`, nextChain 25.
- The hourly restarter / fallback (e.g. 39840784415) decides `STOP_ERROR:R2_GET_500`, dispatch=false, every hour.
  The alert is deduped ("already reported in #10"). The fallback only restarts when the cap is raised or a new range
  closes (src/tenmin-redispatch.ts:371-401), so after a cap stop it needs a person.
- 2 of 11 ranges sealed, 9 remaining (issue #10).
- Both 500s point to the same missing R2 retry (root cause 3 above).

## Fixes (change specs)
A. Host error detail (src/host.ts main().catch, 450-456). Print `MARKETS_SCHEDULER_HOST_FAILED:<message>` plus
   `:cause=<cause.code or cause.name>` when error.cause exists. Never print URLs, query strings or headers.
   Optional: a phase marker (e.g. HOST_PHASE:measure_storage) before finish().
   Test: an Error with cause {code:"ECONNRESET"} gives "...:fetch failed:cause=ECONNRESET"; no cause means the line is unchanged.
B. measureStorage without downloads (src/object-storage.ts:251-272 + src/object-store.ts list). Take sizes from the
   ListObjectsV2 `<Size>` elements (list returns key+size), with no client.get calls. Better still, let finish()
   treat a storage-measure failure as "storage: unavailable" instead of failing the run.
   Test: with a fake client, totals equal the old per-object sum, get() is called 0 times, and a throwing list
   still writes the run report.
C. R2 retry (src/object-store.ts R2ObjectClient.request 233-258). Bounded retry (3 attempts, backoff for example 1 s / 3 s / 9 s)
   on network errors (fetch throws), 5xx and 429, for idempotent ops (GET/HEAD/LIST/PUT of the same bytes/DELETE).
   Re-sign each attempt (SigV4 date). Never retry 4xx other than 429. Error codes stay R2_<OP>_<status>.
   Test with a fake fetchImpl: 500 then 200 succeeds; three 500s throw R2_GET_500; 404 is called once; a throwing
   fetch then 200 succeeds.
D. Host progress survives a throw (src/host.ts missed-session loop). Save scheduler state (and the run report)
   after each completed session, or catch per session and record FAILED, so one failure cannot pin the oldest session forever.
   Test: a fake scanner throwing on the 2nd session leaves session 1 recorded.
E. Chain-cap recovery policy (src/tenmin-redispatch.ts decideTenMinRedispatch / fallback). This is a decision for Peace.
   Option 1 (recommended): keep cap 24 as a human checkpoint; recovery is a manual dispatch (below).
   Option 2: the fallback may start a new chain (chain=0) once per day when the stop was STOP_CHAIN_CAP or a transient
   STOP_ERROR, never during guard windows.
F. Self-healing gap (.github/workflows/gap-refill.yml). Change cron `40 14 * * 0` to daily `40 14 * * *`
   (a no-op in seconds when nothing is missing; it never replaces stored objects). Alternative: dispatch gap-refill
   when the coverage step fails.

## Skill fit (against approved.json at 1e8448a)
Approved rules cover only: new pure helper functions (ADD_FUNCTION / COMPLEX_FUNCTION / COMPLEX_CALLS / LOOP;
primitive params/returns, end of module or new module), entry throw guards, env strictness, single if/return
replacement on an allow-list of 8 leaf modules (NOT scanner-chain code), new characterization tests of exported
pure functions, tsc-only workflow steps/jobs (and not in workflows that mention secrets, like scanner.yml / gap-refill.yml).
Result: no fix can be landed end to end with today's rules. Each fix's pure core can be landed now as an unwired helper
(no production effect); the wiring needs new skills.

| Fix | Pure part that fits now | Wiring part | Needed skill |
|---|---|---|---|
| A | S3 hostFailureLine (public-add-function-v2) | use it in host.ts main().catch | G1 |
| B | (none clean; sizes need XML parsing) | measureStorage + list sizes | G1 + G2 |
| C | S1 isRetryableR2Status, S2 r2RetryDelayMs (public-add-function-v2) | loop in R2ObjectClient.request | G1 + G2 + G3 |
| D | none | host loop persistence | G1 + G2 |
| E | Peace decision first | decision branch | G1 + G2 |
| F | none | cron edit in a workflow with secrets | G4 |

## Gaps, ranked by scanner fixes unlocked
1. G1 SCANNER_BODY_EDIT: edit statements inside an existing (non-exported or class) function in scanner-chain code,
   graded by a new test plus the full suite and the 4 typechecks. Unlocks A, B, C, D, E (5).
2. G2 ASYNC_FAKE_TEST: new tests that drive async functions / class methods with injected fakes (fake fetchImpl,
   fake ObjectClient, fake scanner). Needed to grade B, C, D, E (4).
3. G3 RETRY_LOOP: a bounded retry/backoff loop around an awaited call (try/catch, attempt counter, injected sleep).
   Unlocks C (and later Massive/other clients) (1+).
4. G4 WORKFLOW_EDIT: change a cron / step `if:` in a workflow that mentions secrets (today refused outright). Unlocks F (1).

## Recommended order
1. Ops now (needs Peace's OK): dispatch gap-refill.yml once. That refills 10-16..10-21 bars + corporate actions (it worked on
   2026-10-18 in about 2 min), and its release step re-dispatches tenmin_history, which also restarts the chain.
   Safe/idempotent: it never replaces or deletes a stored object and verifies every session; there is a held-key
   guard, and it runs outside guard windows (avoid 05:15-06:15Z / 09:15-10:15Z).
2. File S1-S3 (fit approved rules; pure, unwired, zero production effect).
3. Teach G1 + G2 (biggest unlock), then PeaceAI lands B (stops the 50-min download), then C (R2 retry), then A, then D.
4. G4, then F (daily gap refill). Decide E with Peace.
Until B lands, every scheduled scan will keep failing after about 50 min. Gap refill (manual or Sunday) is the only
thing filling bars.

## Open checks (need approval)
- A read-only R2 count of objects/bytes in the bucket would confirm root-cause 2's scale. It needs the R2 credential, so not done.

## Drafted tasks (NOT filed; filing needs Peace's OK): issues/S1..S3 (.md body, .json title+body)
Box dry-run: PeaceSTOCKS 0ab37c8, Workspace 1e8448a, kernel /workspace/stress/kernel.cjs, Node 20.
Each produced exactly one candidate (public-add-function-v2). Job B graded COUNTS, suite 599/599, 4 typechecks ok,
and the new test fails with the body stubbed. (The v10 harness prints WRONG only because it expects test-only, one-file
tasks; these add a module plus a test.)
- S1 isRetryableR2Status(status) in src/r2-retry-status.ts (fix C core)
- S2 r2RetryDelayMs(attempt, baseMs) in src/r2-retry-delay.ts (fix C core)
- S3 hostFailureLine(message, causeCode) in src/host-failure-line.ts (fix A core). A template-literal phrasing was
  refused (task_unparsed), so the body uses `+` concatenation.
Wiring tasks for A-F are not drafted as issues: no approved rule can build them (G1-G4). They are specced above
for when the skills exist.
