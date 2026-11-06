# Self-loop live wiring v1 (M219, batch 55)

Status: EXPERIMENTAL, NOT DEFAULT, NOT FOR CREDIT.
Code: `peaceai/lib/self-loop-live.ts`. CLI: `peaceai/bin/self-loop-live.ts`.
Tests: `peaceai/test/m219-self-loop-live.test.ts`. Builds on M218 `buildSelfLoopTask`.

## Why

M218 built a PlanTask from a self-zone gap. This batch wires the **live entry**: take the real
`PeaceG03/PeaceAI-Workspace` HEAD in a **clean clone** (never the working tree), find an actual failing
safe-zone self-test, or seed a clearly labelled practice break in a scratch copy when none fails, then
run the sandboxed loop end-to-end as the stage-2 candidate and append one experimental / not-for-credit
row.

## Fail closed

| code | when |
|---|---|
| `SELF_LOOP_LIVE_DEST` | clone/scratch not absolute, or resolves inside the host workspace |
| `SELF_LOOP_LIVE_HEAD` | clean clone HEAD !== `--head` |
| `SELF_LOOP_LIVE_DIRTY` | clean clone has a dirty work tree |
| `SELF_LOOP_LIVE_CLONE` | clone / scratch clone failed |
| `SELF_LOOP_LIVE_SEED` | no failing self-test and practice seed disabled or failed |
| `SELF_LOOP_LIVE_NO_TSX` | cannot run self-tests to discover failures |
| plus M218 `SELF_LOOP_*` | protected / outside-safe / bad repo / bad pins |

Protected paths never become a task (`buildSelfLoopTask` / `selfLoopEditRefusal`).

## Practice break

When HEAD's safe-zone self-tests all pass, the scratch copy gets:

1. a MIT `LICENSE` (upstream Workspace has none; the loop needs a pin),
2. a broken `utcDayKey` marked `M219-PRACTICE-BREAK` (experimental, not for credit),
3. a practice self-test, then a reference merge with the fix.

The demo proposer (`practiceBreakProposer`) restores the helper only when that marker is present.

## Row

`self-loop-live-runs.jsonl` under `--out`:

- `schema: peaceai-self-loop-live:v1`
- `experimental: true`, `credit: false`
- loop `code` / `result` / `attempts`, pins, paths (no message text)

## Guards (m219-guard)

`dest`, `outside`, `head`, `dirty`. Each deleted line is caught by its own case.

## Residuals

- Does not flip `stage2.json` or widen SELF_ALLOW.
- Does not write into `peaceai/plan/loop-runs.jsonl` (separate experimental log).
- A real failing self-test without a known fix still builds a task; the demo proposer only repairs the practice marker.
