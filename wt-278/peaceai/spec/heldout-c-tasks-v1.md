# Set C v2 task list (M48, proposal, unwired)

Purpose: measure task success, not only loss, on the 7 held-out set C v2 repositories (axios, fastify, zx, preact,
trpc, typeorm, vitest), using only files already held out by content sha256 in `peaceai/model/heldout-c.json`.

- Builder: `peaceai/bin/heldout-c-tasks.ts` (deterministic; selection rule in the JSON's `rule` field).
- List: `peaceai/model/heldout-c-tasks.json`: 138 function-body tasks (20 per repo, preact 18, all of its eligible).
- Task and grading: in the JSON's `task` field. Static grading only (token-equal body); the target repositories'
  code is never run. Pass, fail and ungradable are all reported; the denominator is always the full list.
- Not wired into any workflow and not used for training. Wiring as an eval needs Architect's decision.
- Protected (PROTECTED_SELF), so PeaceAI cannot edit the list it is measured on.
