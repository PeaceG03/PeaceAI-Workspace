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

## Lane v1

Peace approved this lane on 2026-11-17 at about 13:48 MT, with the condition that a self-edit must not quietly
degrade him over time. It is a gate on the existing self-change tool (`lane1`), not a second framework. Stage 1 and
stage 2 are unchanged and still refuse these files.

A lane proposal may touch only these four files:

- `peaceai/bin/generate.ts`
- `peaceai/bin/test-candidates.ts`
- `peaceai/lib/derive.ts`
- `peaceai/lib/editpropose.ts`

Anything else is refused, including the baseline, the ratchet (`peaceai/lib/selfchange.ts`, `peaceai/lib/selfpropose.ts`,
`peaceai/lib/self-zone.ts`), coverage, graders, leak checks, workflows and tests. An uncertain path is refused.

The frozen baseline is `peaceai/self/lane-v1-baseline.json` (never-zone). The copy in git is unlocked, with empty
passing lists, until a box replay fills it. The generator does not invent counts. Held-out rows contribute pass,
fail and unmeasured counts only; their diffs and reasons are not read or stored. Builder-log replay and the dev
practice set store the passing row ids as well as the counts.

```
tsx peaceai/bin/lane-baseline.ts --capability <capability-report.json> --practice <replay.json> --source-sha <40-hex> --out peaceai/self/lane-v1-baseline.json
```

`<capability-report.json>` is a `peaceai-capability-report:v1` report. `<replay.json>` is a `peaceai-practice-replay:v1`
document. `--source-sha` is the measured commit, and it is recorded as the last-good version. A lane pull request is
one commit whose parent is that last-good commit, so `git revert <head>` restores it. The before/after scorecard is
the artifact `lane1` writes. The ratchet compares the after scorecard with the frozen baseline, not with the previous
change, and refuses a lost passing row, a dropped pass count, or more refusals even when other rows are gained.

Drift is re-measured on the box, not by a public scheduled workflow. Public Workspace workflows do not run the
self-change tool, and a public runner must not re-measure held-out counts. Before the next lane proposal:

```
tsx peaceai/bin/lane-drift.ts --baseline peaceai/self/lane-v1-baseline.json --capability <capability-report.json> --practice <replay.json> --source-sha <40-hex> --out peaceai/self/lane-v1-drift.json
```

The script prints any lost row, dropped count, or rise in refusals in plain words and writes
`peaceai/self/lane-v1-drift.json`. `lane1` refuses while that file is unchecked, unresolved, or measured at a commit
other than the recorded last-good. Filling a real baseline or clearing a drift is a human step with the generator;
the lane cannot edit either file.

A new `PEACEAI_SELF_CHANGE` task counts only when it was filed at or after 2026-11-17 13:48 MT and the skill is
live-proven. Nothing in the old log is backdated, and there is no `LIVE_PROVEN_SINCE` entry until a real repo@sha
landing exists. The rows already marked missing stay uncredited.

