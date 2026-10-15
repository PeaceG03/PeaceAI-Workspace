# PACKAGE_SCRIPT v1 (M45 proposal; OFF by default, not in approved.json)

Add ONE new `scripts` entry in the root `package.json`. Refused unless all hold:

1. **One script, nothing else.** Every key other than `scripts` is identical; exactly one script differs, and it is
   NEW (an existing script is never changed or removed; Auditor #167 M1). No script name that a target workflow runs
   (`npm run x`, `pnpm x`, `yarn x`, ...) may be added. The file is standard `JSON.stringify` formatting before and after, with the
   same indent and trailing newline, so no other byte moves.
2. **Name.** `^[a-z][a-z0-9:-]{0,40}$` and not a lifecycle script (`install`, `prepare`, `publish`, `shrinkwrap`,
   `start`, `test`, `version`, ...), nor a `pre`/`post` hook of any lifecycle event or existing script.
3. **Command.** At most 300 characters; one allowed tool (`tsc`, `eslint`, `prettier`, `vitest`, `jest`,
   `mocha`, `rollup`, `vite`, or `npm run <script>`) followed by flags and relative paths only. `tsx` is not allowed (Auditor #167 M2). Refused arguments: `--require`/`-r`,
   `--config`/`-c`, `--loader`, `--import`, setup/transform/preset/reporter/resolver flags, eslint `--plugin`/`--rulesdir`,
   any jest/vitest/vite/rollup/eslint/prettier/mocha config file, and any argument starting with `/`. No `curl`, `wget`,
   `sh`, `bash`, `node`, `npx`, `eval`, `$`, backticks, `;`, `&`, `|`, `<`, `>`, `\` or `../`.
4. **Behavior proof.** The workflow or check that runs the script fails before and passes after.
5. **Off by default.** Only `PEACEAI_PACKAGE_SCRIPT=true` turns the check on; not in RULE_KINDS until a separate,
   Auditor-reviewed wiring PR; approval is Peace's. Builder never posts /approve-rule. package.json stays on
   PROTECTED_SELF for self-changes; this kind applies to target repos only.

Evidence: after the #167 review rules, 4 of 14 mined licensed external commits (new scripts only) replay through the engine; below the 10-example bar, so this kind does not qualify yet (`peaceai/rules/proposals/m45-evidence.json`).

Live-proof plan (after approval only): one valid peace-task on PeaceSTOCKS (add a `typecheck:<x>` script running
`tsc -p <tsconfig> --noEmit`, as in builder-log entry 39) must yield a counted candidate; one bad task (a
`postinstall` script, or a command with `curl`) must be refused with 0 candidates. Actions run ids recorded on each issue.
