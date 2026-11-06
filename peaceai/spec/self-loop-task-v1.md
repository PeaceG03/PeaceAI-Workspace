# Self-loop task source v1 (M218, batch 54)

Status: EXPERIMENTAL, NOT DEFAULT, NOT FOR CREDIT. Code: `peaceai/lib/self-loop-task.ts`.
Tests: `peaceai/test/m218-self-loop-task.test.ts`. Builds on loop-v1 SELF_ALLOW (#715) and the M72 self zone.

## Why

PeaceAI's sandboxed loop may now target `PeaceG03/PeaceAI-Workspace` and `PeaceG03/PeaceAI` (SELF_ALLOW). Stage-2 is
about to flip. Readiness (PeaceAI product readiness + Workspace `peaceai/docs/self-zone.md`) already names the
safe-zone helpers (`peaceai/self-tests/helpers/{text,dates}.ts`) as the surface PeaceAI may edit through the normal
task flow. What was missing: a **task source** that turns a failing self-test (or the same shape of readiness gap)
into a `PlanTask` the loop can plan -> edit -> verify, with fail-closed refusals for protected paths.

This batch does not enable for-credit, does not flip `stage2.json`, and does not widen SELF_ALLOW / PROTECTED_SELF /
NEVER_ZONE. It reuses `isSelfAllowForbiddenPath`, `SELF_ALLOW`, `inSafeZone`, and `SAFE_HELPERS`.

## What it does

`buildSelfLoopTask(gap)` returns a `PlanTask` or a fixed refusal:

| code | when |
|---|---|
| `SELF_LOOP_REPO` | repo not on SELF_ALLOW (lookalikes / other peaceg03 stay refused) |
| `SELF_LOOP_PROTECTED` | edit or test path hits PROTECTED_SELF / never-zone (`isSelfAllowForbiddenPath`) |
| `SELF_LOOP_OUTSIDE_SAFE` | edit path not a named SAFE_HELPERS source (or not inSafeZone) |
| `SELF_LOOP_TEST` | test path not a peaceai/self-tests/**/*.test.ts safe-zone test |
| `SELF_LOOP_REQUEST` / `SELF_LOOP_ID` / `SELF_LOOP_PIN` | malformed request, id, or commit/merge/license pins |

An admitted task pins `repo` to the SELF_ALLOW name, `tests.files` to the failing self-test, and
`reference.files` to `{editPath: modify, testPath: add}` so the loop's team tests are the self-test and the only
source edit is the safe helper.

## End to end

On a synthetic SELF_ALLOW fixture (same shape as M146): buggy helper at `commit`, fixed helper + failing-then-passing
self-test at `merge` -> `buildSelfLoopTask` -> `runLoopTask` with a fixed proposer that writes the fix -> `PASS`
(stage-2 cand uid). A protected edit path never becomes a task.

## Guards (m218-guard)

`protected`, `safe`, `helper`, `test-protected`, `test-safe`, `allow`. Each deleted line is caught by its own case.

## Residuals (honest)

- Does not invent the fix: the proposer (rules / repair / model) still has to edit. This batch only builds the task.
- Does not run against live Workspace HEAD in CI (synthetic fixture; no network). Wiring a live failing self-test is
  a later batch once stage-2 is on and Peace asks for it.
- Docs-only gaps (`docs/*.md`) are inSafeZone but not SAFE_HELPERS; this v1 admits helper source edits only.
