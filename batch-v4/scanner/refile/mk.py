# Behavior-only refile of S1-S3 (#486-#488). Auditor FAIL on credit: the old bodies spelled out the code.
# These bodies give purpose, name/signature/module and input -> output examples only. No code, no expressions.
import json, re
TAIL = ("\n\nContext (Builder pre-file, refile of #{old}, behavior only): Peace's task (source: peace). {why} "
        "This issue states only the wanted behavior and example cases; PeaceAI has to work out the implementation itself. "
        "Production safety: one new function in a new module plus one new test file under src/ only. Nothing imports it yet, "
        "so the running scanner, the scan and the ten-minute chain are unchanged. Wiring it in is a separate task "
        "(see batch-v4/scanner/DIAGNOSIS.md).")
T = [
 ("S1", 486, "src/r2-retry-status.ts", "isRetryableR2Status",
  "[r2-retry-status] isRetryableR2Status: which R2 reply statuses are worth retrying",
  "Add a new module `src/r2-retry-status.ts` exporting `isRetryableR2Status(status: number): boolean`.\n\n"
  "Behavior: given the HTTP status code of a reply from R2, answer true when the request is worth retrying and false when it is not. "
  "Worth retrying: 429 (too many requests) and every server error status from 500 through 599. "
  "Not worth retrying: everything else, including success, redirect and other client error statuses, and anything above 599.\n\n"
  "Examples:\n"
  "- 429 gives true\n- 500 gives true\n- 502 gives true\n- 503 gives true\n- 504 gives true\n- 550 gives true\n- 599 gives true\n"
  "- 428 gives false\n- 430 gives false\n- 499 gives false\n- 600 gives false\n- 700 gives false\n- 200 gives false\n- 204 gives false\n"
  "- 301 gives false\n- 400 gives false\n- 403 gives false\n- 404 gives false\n- 0 gives false",
  "The ten-minute chain stopped on R2_PUT_500 (run 39451888891) and R2_GET_500 (run 39467160610) because R2ObjectClient.request never retries; this is the status check the future retry will use."),
 ("S2", 487, "src/r2-retry-delay.ts", "r2RetryDelayMs",
  "[r2-retry-delay] r2RetryDelayMs: bounded backoff for an R2 retry attempt",
  "Add a new module `src/r2-retry-delay.ts` exporting `r2RetryDelayMs(attempt: number, baseMs: number): number`.\n\n"
  "Behavior: how many milliseconds to wait before retry number `attempt` (counting from 0), given a base wait of `baseMs`. "
  "Attempt 0 waits exactly the base. Each later attempt waits longer than the one before, following the pattern in the examples. "
  "The wait is never more than 30000 ms, whatever the attempt or base. A base of 0 always gives 0.\n\n"
  "Examples (attempt, baseMs gives wait):\n"
  "- 0, 1000 gives 1000\n- 1, 1000 gives 4000\n- 2, 1000 gives 9000\n- 3, 1000 gives 16000\n- 4, 1000 gives 25000\n"
  "- 5, 1000 gives 30000\n- 10, 1000 gives 30000\n- 0, 500 gives 500\n- 1, 500 gives 2000\n- 2, 250 gives 2250\n"
  "- 0, 0 gives 0\n- 7, 0 gives 0\n- 0, 40000 gives 30000",
  "The future R2 retry needs a wait that grows per attempt and never exceeds 30 seconds, so one retry cannot stall a scan."),
 ("S3", 488, "src/host-failure-line.ts", "hostFailureLine",
  "[host-failure-line] hostFailureLine: host failure line that keeps the error cause code",
  "Add a new module `src/host-failure-line.ts` exporting `hostFailureLine(message: string, causeCode: string): string`.\n\n"
  "Behavior: build the one-line failure report the scheduler host prints. The line always starts with the marker MARKETS_SCHEDULER_HOST_FAILED, then a colon, then the message exactly as given. "
  "When a cause code is given, the line ends with a colon, the word cause, an equals sign and the cause code. When the cause code is empty, nothing is added after the message. "
  "The message and cause code are copied as they are, with no trimming or escaping.\n\n"
  "Examples (message, causeCode gives line):\n"
  "- \"fetch failed\", \"ECONNRESET\" gives \"MARKETS_SCHEDULER_HOST_FAILED:fetch failed:cause=ECONNRESET\"\n"
  "- \"fetch failed\", \"\" gives \"MARKETS_SCHEDULER_HOST_FAILED:fetch failed\"\n"
  "- \"R2_GET_500\", \"\" gives \"MARKETS_SCHEDULER_HOST_FAILED:R2_GET_500\"\n"
  "- \"\", \"UND_ERR_SOCKET\" gives \"MARKETS_SCHEDULER_HOST_FAILED::cause=UND_ERR_SOCKET\"\n"
  "- \"\", \"\" gives \"MARKETS_SCHEDULER_HOST_FAILED:\"\n"
  "- \"R2_PUT_500\", \"ETIMEDOUT\" gives \"MARKETS_SCHEDULER_HOST_FAILED:R2_PUT_500:cause=ETIMEDOUT\"\n"
  "- \" fetch failed \", \"ECONNRESET\" gives \"MARKETS_SCHEDULER_HOST_FAILED: fetch failed :cause=ECONNRESET\"\n"
  "- \"R2_GET_500\", \" err 42 \" gives \"MARKETS_SCHEDULER_HOST_FAILED:R2_GET_500:cause= err 42 \"",
  "Every scheduled scan since 2026-10-14 ends with only MARKETS_SCHEDULER_HOST_FAILED:fetch failed because src/host.ts drops the error cause; this is the line the host will print once wired, with the cause code (never a URL) appended when there is one."),
]
# Lint: no backslash-u escapes, no control characters except newline, no code operators or keywords outside the
# signature (the backticked name/module/signature parts and the quoted example strings are data, not code).
BAD = re.compile(r"===|!==|==|<=|>=|&&|\|\||=>|\?|\bMath\.|\breturn\b|\breturning\b|\bconst\b|\bif\s*\(|\.length\b|\*|\+|%")
out = {"schema": "peaceai-stress-suite:v1", "target": "PeaceG03/PeaceSTOCKS", "base": "0ab37c85f9d28791cfb7eaedbe56906885b74fab", "tasks": []}
for i, old, f, fn, title, line, why in T:
    body = "Target: PeaceG03/PeaceSTOCKS\n\n" + line + TAIL.format(old=old, why=why)
    prose = re.sub(r"`[^`\n]*`", "", body); prose = re.sub(r'"[^"\n]*"', "", prose)
    assert not BAD.search(prose), (i, BAD.search(prose).group(0))
    assert "\\u" not in body and not re.search(r"[\x00-\x09\x0b-\x1f\x7f]", body + title), i
    out["tasks"].append({"id": i, "replaces": f"#{old}", "rule": "none (behavior-only)", "skill": "DERIVE_FROM_BEHAVIOR", "expect": "solve",
                         "title": title, "body": body, "accept": {"mutate": {"file": f, "fn": fn}}})
    open(f"{i}.md", "w").write(f"# {title}\n\n{body}\n")
    json.dump({"title": title, "body": body}, open(f"{i}.json", "w"), indent=1, ensure_ascii=True)
json.dump(out, open("tasks.json", "w"), indent=1, ensure_ascii=True)
print("ok", [t["id"] for t in out["tasks"]])
