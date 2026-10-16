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

`coverage.ts` (printed in the `builder-log` Actions job summary) measures, of **Builder's** logged tasks **plus PeaceAI real tasks**, what percentage PeaceAI could do end-to-end:

- **Builder rows:** countable only with a **live-proven** skill and a non-`missing skill` mark (Auditor #216: history keeps the mark).
- **PeaceAI real tasks** count in **both** the numerator and the denominator when all of: `by: PeaceAI`, asked contains `(source: peace)`, `PeaceSTOCKS@<sha>` is an ancestor of PeaceSTOCKS main, and the entry is not a proof / no-coverage record. Seqs **97** and **101** stay excluded; any asked/why text with `live proof` or `no coverage` is excluded too. Sha-on-main is checked via `PEACESTOCKS_CLONE` (`git merge-base --is-ancestor`); without a clone the check **fails closed** (no real-task credit).
- A skill is live-proven if (a) the log has a `by: PeaceAI` entry with a `PeaceSTOCKS@<sha>` or `PeaceAI-Workspace@<sha>` landing on/before the asOf date, or (b) it is listed in `LIVE_PROVEN_SINCE` in `check.ts`.
- Every `LIVE_PROVEN_SINCE` entry must name a builder-log `seq` that backs it (`by: PeaceAI`, same skill, `repo@sha` in `changed`). `check.ts` / `validateLog` fail if a map entry is unbacked.
- Approved-but-unproven skills (`APPROVED_SINCE` only) do **not** count toward Builder rows.
- Windows: last 7 calendar days (MT, inclusive of asOf) and all-time.
- Remaining Builder tasks are ranked by missing skill count (`top missing`).

Counting is over `tasks.jsonl` only; the optional PeaceSTOCKS clone is read-only ancestry, not a network call from the coverage math itself.
