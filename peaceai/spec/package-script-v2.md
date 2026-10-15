# PACKAGE_SCRIPT v2 (M57 proposal; a NEW kind, OFF by default, not in approved.json, below the bar)

PACKAGE_SCRIPT v1 is unchanged. v2 adds ONE new script to the root `package.json` (engine:
`peaceai/lib/package-script-v2.ts`) and is refused unless all hold:

1. **One new script, nothing else.** Every key outside `scripts` is identical; existing scripts keep their values and
   order; the new script may sit at ANY position in `scripts` (v1: appended last only; on real commits it rarely is).
   The file is in standard JSON formatting before and is byte-identical after, apart from the inserted entry.
2. **Name.** `[a-z][a-z0-9:-]{0,40}`, not a lifecycle script or a pre/post hook of one or of an existing script, not a
   package-manager built-in or a v1 tool name, and not a script name any `.github/workflows` file runs (the workflow
   list must be read and non-empty; fail closed).
3. **Command.** A v1 command (one allowed tool with allowed flags, or `npm run <x>`), or:
   - `pnpm run x`, `yarn run x`, `pnpm x`, `yarn x` where `x` is an EXISTING script (not a built-in or tool name);
   - `pnpm <tool> ...`, `yarn <tool> ...`, `pnpm exec <tool> ...` for a v1 tool that is a declared dependency and
     not shadowed by a script, with v1's flag allow list;
   - `run-s` / `run-p` of 1 to 8 existing scripts when `npm-run-all` (or `npm-run-all2`) is a declared dependency.
   Never: npx, dlx, install/add, node, tsx, cargo, make, cross-env, env assignments, `&&`, `||`, `;`, pipes,
   redirects, quotes, `$`, backticks or `--` pass-through.
4. **Behavior proof and off by default** as v1: `PEACEAI_PACKAGE_SCRIPT_V2=true` only; approval is Peace's.

Evidence (`peaceai/rules/proposals/m57-package-script-v2-evidence.json`): 1 of 25 mined licensed external commits
passes on its real files (apollo-client f0bb56c8 and hono fb0b9d42 dropped in M59) and real workflows; below the 10-example bar, so this kind does not qualify yet.
