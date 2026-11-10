# CI watch

Experimental. credit is false. One ordinary Node program reads GitHub Actions for the current pull request head and, only when that set has settled, POSTs JSON to a Builder webhook. It does not call a model. It does not install a cron job.

HTTP 200 from the webhook means the routine was accepted and started, not that Builder finished. The server documents no idempotency contract. A retry can deliver the same result twice. This program does not claim exactly-once delivery.

## What the host runs

Copy peaceai/dist/ci-watch.mjs to the host. Node 20 or newer. No repository checkout and no npm install on that host. Run it as an unprivileged user. Do not pass the webhook URL or key on the command line.

Environment:

- PEACEAI_CI_NOTIFY_URL: https URL from the routine panel field "POST to". Required.
- PEACEAI_CI_NOTIFY_KEY: sender key. Required. Sent only as Authorization: Bearer. Never printed.
- PEACEAI_CI_WATCH_STATE: path of the state file on the host, outside the repo. Required. Mode 0600. If the file is corrupt, the program refuses and does not rewrite it.
- PEACEAI_CI_WATCH_GITHUB_TOKEN: optional. Public repositories can be read without it at an hourly cadence. If set, it is a header only, never argv and never a log line.

The program exits 2 when URL, key, or state path is missing or the URL is not plain https. Missing or pending checks are not green. Runs for an older head are ignored.

## One finite watch

Allowed workflow names are only ci, leak-check, and builder-log. One record per repository and pull request. A second add is refused, including after the record is inactive. Deadline is at most 168 hours and rearm does not move it. When the required runs have all settled, or the pull request is closed or merged, or the deadline passes, the program POSTs once and marks the watch inactive. A later tick does not POST that same result again.

A GitHub rerun keeps the same run id and raises run_attempt. The fingerprint includes that attempt. An alert sent by an older build, whose fingerprint has no attempt, still counts as the attempt-1 result.

```
node ci-watch.mjs add --repo PeaceG03/PeaceAI-Workspace --pr 724 --workflows ci,leak-check,builder-log --hours 48
node ci-watch.mjs tick
node ci-watch.mjs show
node ci-watch.mjs rearm --repo PeaceG03/PeaceAI-Workspace --pr 724
```

rearm does not POST and does not edit the file by hand. It marks that one inactive terminal record active again and appends the stored fingerprint to deliveredFingerprints. It refuses a missing record, a record that is already active, and a corrupt file. A corrupt file is left unchanged.

After rearm, tick reads CI:

- The same head, same run ids, and attempt 1 that were already sent are not sent again. The stored fingerprint is updated to the attempt-aware hash.
- A missing or in-progress attempt is not sent. The record stays active.
- A new settled result is sent once, then the record is inactive again. New means a new head, a new run id, or a run_attempt greater than 1. A new attempt whose conclusion is still failure is sent once. The next tick does not send it again.
- Closed, merged, and deadline still settle once when that result is not the one already sent.
- If the POST fails, the fingerprint is left in place and a later tick retries. A retry after HTTP 200 can still deliver twice. This program does not claim exactly-once delivery.

The coordinator runs tick on the host. This repository does not install cron, systemd, or any other scheduler. A host without crontab still needs its own hourly tick.

Pull request 724 is one watch record. The same commands work for a later public repository that uses these three workflows.

## Not done by this program

The webhook routine, the sender key, and the host tick are provisioned outside this repository. The build c61c80e delivered one failure alert for pull request 724, and the next tick did not send it again. This tree adds rearm. The host has not run this tree yet. Readiness files docs/PEACEAI_FINAL_PRODUCT_READINESS.md, packages/core/src/ProductReadiness.ts, and docs/PEACEAI_OVERNIGHT_PROGRESS.md are absent here.
