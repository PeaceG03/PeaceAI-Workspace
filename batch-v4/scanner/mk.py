import json
tail = lambda skill, rule, fn, why: f"\n\n(Builder pre-file, {skill}, {rule}): Peace's task (source: peace). {why} Production safety: one new pure function in a new module plus one new src/*.test.ts file only: nothing imports it yet, so the running scanner, the scan and the ten-minute chain are unchanged. Wiring it in is a separate task that needs a skill PeaceAI does not have yet (see batch-v4/scanner/DIAGNOSIS.md). Job B grades it against itself: the new test passes with the function and fails with the source put back. Disjoint file: each task in this batch creates its own new module and test file. Expected COUNTS.)"
tasks = [
 ("S1", "[r2-retry-status] isRetryableR2Status: which R2 reply statuses are worth retrying",
  "add function `isRetryableR2Status(status: number): boolean` to `src/r2-retry-status.ts` returning status === 429 || (500 <= status && status <= 599)\n- isRetryableR2Status(500) is true\n- isRetryableR2Status(503) is true\n- isRetryableR2Status(599) is true\n- isRetryableR2Status(429) is true\n- isRetryableR2Status(404) is false\n- isRetryableR2Status(403) is false\n- isRetryableR2Status(200) is false\n- isRetryableR2Status(600) is false",
  "ADD_FUNCTION", "public-add-function-v2", "isRetryableR2Status",
  "The ten-minute chain stopped on R2_PUT_500 (run 39451888891) and R2_GET_500 (run 39467160610) because R2ObjectClient.request never retries; this is the status test the future retry uses: 5xx and 429 retry, every other status does not."),
 ("S2", "[r2-retry-delay] r2RetryDelayMs: bounded backoff for an R2 retry attempt",
  "add function `r2RetryDelayMs(attempt: number, baseMs: number): number` to `src/r2-retry-delay.ts` returning Math.min(baseMs * (attempt + 1) * (attempt + 1), 30000)\n- r2RetryDelayMs(0, 1000) is 1000\n- r2RetryDelayMs(1, 1000) is 4000\n- r2RetryDelayMs(2, 1000) is 9000\n- r2RetryDelayMs(10, 1000) is 30000\n- r2RetryDelayMs(0, 0) is 0",
  "ADD_FUNCTION", "public-add-function-v2", "r2RetryDelayMs",
  "The future R2 retry needs a wait that grows per attempt and never exceeds 30 s, so one retry cannot stall a scan; this pins that delay."),
 ("S3", "[host-failure-line] hostFailureLine: host failure line that keeps the error cause code",
  "add function `hostFailureLine(message: string, causeCode: string): string` to `src/host-failure-line.ts` returning causeCode.length === 0 ? \"MARKETS_SCHEDULER_HOST_FAILED:\" + message : \"MARKETS_SCHEDULER_HOST_FAILED:\" + message + \":cause=\" + causeCode\n- hostFailureLine(\"fetch failed\", \"ECONNRESET\") is \"MARKETS_SCHEDULER_HOST_FAILED:fetch failed:cause=ECONNRESET\"\n- hostFailureLine(\"fetch failed\", \"\") is \"MARKETS_SCHEDULER_HOST_FAILED:fetch failed\"\n- hostFailureLine(\"R2_GET_500\", \"\") is \"MARKETS_SCHEDULER_HOST_FAILED:R2_GET_500\"\n- hostFailureLine(\"\", \"UND_ERR_SOCKET\") is \"MARKETS_SCHEDULER_HOST_FAILED::cause=UND_ERR_SOCKET\"",
  "ADD_FUNCTION", "public-add-function-v2", "hostFailureLine",
  "Every scheduled scan since 2026-10-14 ends with only MARKETS_SCHEDULER_HOST_FAILED:fetch failed because src/host.ts main().catch drops error.cause; this is the line the host will print once wired, with the cause code (never a URL) appended when there is one."),
]
out = {"schema": "peaceai-stress-suite:v1", "target": "PeaceG03/PeaceSTOCKS", "base": "0ab37c85f9d28791cfb7eaedbe56906885b74fab", "tasks": []}
for i, t, line, skill, rule, fn, why in tasks:
    body = "Target: PeaceG03/PeaceSTOCKS\n\n" + line + tail(skill, rule, fn, why)
    out["tasks"].append({"id": i, "rule": rule, "skill": skill, "expect": "solve", "title": t, "body": body, "accept": {"mutate": {"file": line.split("`")[3], "fn": fn}}})
json.dump(out, open("tasks.json", "w"), indent=1, ensure_ascii=True)
