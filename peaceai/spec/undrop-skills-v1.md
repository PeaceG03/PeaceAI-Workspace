# M67 un-drop batch: LOOP_WHILE, WORKFLOW_JOB, TSCONFIG_SCRIPT, ENV_FIX (v1, proposal-off-wired)

Peace un-dropped these four skills (Architect, 2026-10-16). Each is its own learned rule, off until Peace posts
`/approve-rule` for it; Builder never approves. Dev paths need their flag to be exactly `"true"`.

| rule | kind | engine | trigger |
|---|---|---|---|
| public-loop-function-v2 | COMPLEX_FUNCTION (shape LOOP_WHILE) | learned-complex.ts, loops `while-literal-counter` | `add while loop function ...` |
| public-workflow-job-v1 | WORKFLOW_JOB | workflow-job.ts | `add workflow job JOB to .github/workflows/F.yml running pnpm run SCRIPT [as step NAME]` |
| public-tsconfig-script-v1 | TSCONFIG_SCRIPT | tsconfig-script.ts | `add typecheck script typecheck:NAME with new tsconfig.NAME.json excluding GLOB / checking only FILE / checking GLOB with checkJs` |
| public-env-fix-v1 | ENV_FIX | env-fix.ts | `make env NAME strict in src/F.ts as a flag / as an integer 1..MAX` |

## LOOP_WHILE
Only `while (C < LIT)` / `while (C <= LIT)`: C an own `let` with an integer-literal start 0..1000, LIT 0..1000, exactly
one top-level `C += 1`, no `continue`, C assigned nowhere else, so at most LIT - start + 1 iterations. Everything else
(PARAM.length or parameter bounds, `++`, `+= 2`, decrements, while(true)) is `loop_unbounded`; labels `loop_label`,
closures `closure_not_allowed`, async `loop_async`. v1 is unchanged and still refuses every while (`loop_while_unsupported`).

## WORKFLOW_JOB
One new job appended to an existing workflow the target opts in (`workflowPattern`). Fixed header (`runs-on:
ubuntu-24.04`, `timeout-minutes: 10`, `permissions: contents: read`); setup steps copied from an existing job only when
every one is checkout / pnpm action-setup / setup-node (with: version, node-version, cache, persist-credentials: false) /
install; then `- name` + `run: <pm> run SCRIPT`, SCRIPT an existing read-only `tsc ... --noEmit` or `tsx --test <paths>`.
Refusals: `workflow_job_secrets`, `workflow_job_write_permission`, `workflow_job_privileged_trigger` (pull_request_target,
workflow_run), `workflow_job_no_read_permissions`, `workflow_job_exists`, `workflow_job_script_unsafe`,
`workflow_job_no_setup`, `workflow_job_layout`. scope.ts re-checks the appended block. PeaceAI's push path still never
carries `.github/workflows/**` (lands through a normal Architect-merged PR).

## TSCONFIG_SCRIPT
One new root `tsconfig.NAME.json` extending `./tsconfig.json` in exactly one shape (exclude: base include + one
exclude; files: `include: []` + one existing file; checkJs: allowJs+checkJs + one js/mjs glob) and one package.json
line `"typecheck:NAME": "tsc -p tsconfig.NAME.json --noEmit",` right after the existing `"typecheck"` line. Refusals:
`tsconfig_script_exists`, `tsconfig_script_name_taken`, `tsconfig_script_no_base`, `tsconfig_script_no_anchor`,
`tsconfig_script_bad_pattern`, `tsconfig_script_file_missing`, `tsconfig_script_pkg_unparsed`. scope.ts accepts the pair
only on a target with `tsconfigScript: true` (set on no target yet; needed before the live proof).

## ENV_FIX
One env var (`process.env.NAME` or `env.NAME`) in one `src/` module. Flag: every read is `X === "1"` / `X !== "1"` and
becomes `strictNAME(X)` / `!strictNAME(X)` (unset/""/"0" false, "1" true, else throws `NAME_INVALID`). Integer: the one
read is `Number(X) > 0 ? Number(X) : DEFAULT` and becomes `strictNAME(X)` (blank -> DEFAULT, digits 1..MAX, else throws).
Plus one new value-table test file. Refusals: `env_fix_read_not_found`, `env_fix_mixed_reads`, `env_fix_helper_taken`,
`env_fix_bad_max`, `env_fix_test_exists`, `path_not_plain`, `protected_path`, `target_missing`.

## Fixtures
PeaceSTOCKS workflow files at 0ce20d4 and four MIT workflow files from the pinned example-only repos (licence pins in
m45-example-repos.json). PeaceSTOCKS source may not be copied here (core-text guard), so the package.json / tsconfig /
env-read examples are synthetic stand-ins with the same shapes; with PEACESTOCKS_CLONE set, one test also rebuilds the
real example edits from the clone (seq 39 f1dc065 and f2200a7 tsconfigs reproduced exactly; E1/E2/E3c build).
