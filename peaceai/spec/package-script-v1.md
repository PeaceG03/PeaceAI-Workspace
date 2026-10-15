# PACKAGE_SCRIPT v1 (M45 proposal; OFF by default, not in approved.json)

Add or change ONE `scripts` entry in the root `package.json`. Refused unless all hold:

1. **One script, nothing else.** Every key other than `scripts` is identical; exactly one script differs, and it is
   added or changed (never removed). The file is standard `JSON.stringify` formatting before and after, with the
   same indent and trailing newline, so no other byte moves.
2. **Name.** `^[a-z][a-z0-9:-]{0,40}$` and not a lifecycle script (`pre*`, `post*`, `install`, `prepare`, `publish`,
   `start`, `test`, `version`, ...).
3. **Command.** At most 300 characters; one allowed tool (`tsc`, `tsx`, `eslint`, `prettier`, `vitest`, `jest`,
   `mocha`, `rollup`, `vite`, or `npm run <script>`) followed by flags and relative paths only. No `curl`, `wget`,
   `sh`, `bash`, `node`, `npx`, `eval`, `$`, backticks, `;`, `&`, `|`, `<`, `>`, `\` or `../`.
4. **Behavior proof.** The workflow or check that runs the script fails before and passes after.
5. **Off by default.** Only `PEACEAI_PACKAGE_SCRIPT=true` turns the check on; not in RULE_KINDS until a separate,
   Auditor-reviewed wiring PR; approval is Peace's. Builder never posts /approve-rule. package.json stays on
   PROTECTED_SELF for self-changes; this kind applies to target repos only.

Evidence: 12 licensed external commits across 4 repos, 7 from apollo-client (`peaceai/rules/proposals/m45-evidence.json`).

Live-proof plan (after approval only): one valid peace-task on PeaceSTOCKS (add a `typecheck:<x>` script running
`tsc -p <tsconfig> --noEmit`, as in builder-log entry 39) must yield a counted candidate; one bad task (a
`postinstall` script, or a command with `curl`) must be refused with 0 candidates. Actions run ids recorded on each issue.
