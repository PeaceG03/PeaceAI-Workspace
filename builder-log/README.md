# Builder task log (public, append-only)

`tasks.jsonl` has one compact JSON object per line, one per task Builder did:

| field | meaning |
|---|---|
| seq | 1, 2, 3, ... with no gaps |
| date, time | America/Denver (MT) |
| asked | what was asked |
| changed | diff ref: `PeaceSTOCKS@<sha>`, `PeaceAI-Workspace@<sha>`, `PeaceAI-Workspace#<PR>` (comma-separated), or `none (reason)` |
| why | why it was done |
| skill | the PeaceAI edit kind it would have needed |
| mark | `PeaceAI-able today` (skill has an approved learned rule) or `missing skill <SKILL>` |
| by | `Builder` or `PeaceAI` (PeaceAI entries must use an approved skill) |

The skill lists live in `check.ts`. A mark follows the rules approved at the time the entry is written; old entries are never rewritten when a skill is approved later.

Rules: public data only. No secrets, no private-repo code, paths or diffs, no bar values, predictions or scores. PeaceSTOCKS changes are referred to by SHA and a plain description.

CI (`.github/workflows/builder-log.yml`) checks the schema and that the file at the PR base is a byte prefix of the new file: lines may only be appended.

## PeaceAI vs Builder coverage

`coverage.ts` (run in Actions by `builder-log.yml` and the skill-learner report) measures, of **Builder's** logged tasks, what percentage PeaceAI could do end-to-end using **only live-proven skills**:

- A skill is live-proven if (a) the log has at least one entry with `by: PeaceAI` and a `changed` landing that includes `PeaceSTOCKS@<sha>` or `PeaceAI-Workspace@<sha>`, or (b) it is listed in `LIVE_PROVEN_SINCE` in `check.ts` (with its proof landing time).
- Approved-but-unproven skills (`APPROVED_SINCE` only, not yet in `LIVE_PROVEN_SINCE` and with no PeaceAI `@sha` landing) do **not** count.
- Windows: last 7 calendar days (MT, inclusive of asOf) and all-time.
- Remaining Builder tasks are ranked by missing skill count (`top missing`).

No box or network: counting over `tasks.jsonl` only.
