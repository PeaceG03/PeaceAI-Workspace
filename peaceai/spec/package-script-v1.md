# PACKAGE_SCRIPT v1 (M45 proposal; OFF by default, not in approved.json)

Add ONE new `scripts` entry in the root `package.json`. Refused unless all hold:

1. **One script, nothing else.** Every key other than `scripts` is identical; exactly one script differs, and it is
   NEW (an existing script is never changed or removed; Auditor #167 M1). No script name that a target workflow runs
   (`npm run x`, `pnpm x`, `yarn x`, ...) may be added. The file is standard `JSON.stringify` formatting before and after, with the
   same indent and trailing newline, so no other byte moves.
2. **Name.** `^[a-z][a-z0-9:-]{0,40}$` and not a lifecycle script (`install`, `prepare`, `publish`, `shrinkwrap`,
   `start`, `test`, `version`, ...), nor a `pre`/`post` hook of any lifecycle event or existing script.
3. **Command (#167 round 2: allow list).** At most 300 characters, single spaces; either `npm run <script>` alone,
   or one tool with ONLY its allowed flags (`--flag` or `--flag=<[\w.-]{1,40}>`), its subcommands, and relative
   paths/globs (no leading `/`, no `..`, no shell syntax):
   `tsc` --noEmit -p --project --pretty --incremental; `eslint` --fix --cache --quiet --max-warnings;
   `prettier` --write --check --list-different; `vitest` run --run --watch --coverage --passWithNoTests;
   `jest` --watch --coverage --ci --passWithNoTests --runInBand. (`mocha` dropped in round 3; the tool table is a
   Map, so prototype names such as `__proto__`, `constructor` and `toString` are never tools.)
   Every other flag (e.g. `--require`, `--config`, `--setupFilesAfterEnv`, `--testEnvironment`, `--reporters`,
   `--file=`, `--ui=`, `--plugin`) and every other tool (`tsx`, `node`, `npx`, `vite`, `rollup`, shells) is refused.
   The target's workflow files must be supplied: a missing or empty workflow list is refused.
4. **Behavior proof.** The workflow or check that runs the script fails before and passes after.
5. **Off by default.** Only `PEACEAI_PACKAGE_SCRIPT=true` turns the check on; not in RULE_KINDS until a separate,
   Auditor-reviewed wiring PR; approval is Peace's. Builder never posts /approve-rule. package.json stays on
   PROTECTED_SELF for self-changes; this kind applies to target repos only.

Evidence: after the #167 review rules, 5 of 24 mined licensed external commits (new scripts only; corpus repos plus the M56 example-only repos) replay through the engine; below the 10-example bar, so this kind does not qualify yet (`peaceai/rules/proposals/m45-evidence.json`).

Live-proof plan (after approval only): one valid peace-task on PeaceSTOCKS (add a `typecheck:<x>` script running
`tsc -p <tsconfig> --noEmit`, as in builder-log entry 39) must yield a counted candidate; one bad task (a
`postinstall` script, or a command with `curl`) must be refused with 0 candidates. Actions run ids recorded on each issue.
