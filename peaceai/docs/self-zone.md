# PeaceAI self zone (M72 stage 1)

PeaceAI may change a small part of its own repository through the normal task flow (a `peace-task` issue on
PeaceG03/PeaceAI-Workspace, Job A rule, Job B sandboxed grading, Peace's verdict, a reviewed PR). It is off until
`peaceai/targets.json` sets `"selfZone": true` on the Workspace target.

Safe zone (the only non-`src/` paths a Workspace candidate may create or edit):

- new tests: `peaceai/self-tests/NAME.test.ts`, `peaceai/self-tests/helpers/NAME.test.ts`
- docs: `peaceai/docs/NAME.md`
- named helpers: `peaceai/self-tests/helpers/text.ts`, `peaceai/self-tests/helpers/dates.ts`

Everything that judges PeaceAI is protected and refused (`self_protected_path`): generation and grading, leak and
tamper checks, the verdict and approval flow, the allowed-file and deny lists, `lm.ts`, workflows, build config and
both protected lists (`peaceai/lib/selfchange.ts`, `peaceai/lib/self-zone.ts`). Job B also compares a digest of every
protected file before applying the candidate, after applying it and after its tests, and fails it closed on any
difference.
