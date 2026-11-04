# Loop runners, batch 22: ava (stacked on batch 21)

Status: implemented in `peaceai/lib/loopdeps.ts` (`detectRunner`, `avaOptions` and its helpers, the shim's ava branch,
the three ava files the shim installs, `shimArgs`) and `peaceai/lib/looprow.ts` (`LOOP_RUNNERS` gains `ava`). Tests:
`peaceai/test/m187-ava.test.ts` (detection cases in `m187-cases.ts`), `peaceai/test/m187-mutation.test.ts`,
`peaceai/test/m187-forge.test.ts` (report channel and forging on a real ava install). Chosen by failure category only:
ava is the most common runner still in `OTHER_RUNNERS` for TypeScript / ESM libraries, so admitting it is a general
TEST_RUNNER_UNSUPPORTED reduction. No hidden-set row, task, result, fix or reference diff was read; the probe task
(p-queue) that surfaced the category was not inspected; fixtures are unrelated synthetic shapes (leap years, roman
numerals, a todo file).

## Cause

A package whose test script runs ava was refused before any install with TEST_RUNNER_UNSUPPORTED, because ava was in
`OTHER_RUNNERS` (`guard:runner-other`). The loop never ran such a task, so no proposer could be judged on it. ava is a
widely used runner, so this is a general gap, not a task-specific one.

## Why ava needs more than vitest / jest

ava has no pluggable reporter API (you cannot hand it a reporter module the way mocha, jest and vitest take one), and
it runs each test file in its own worker PROCESS, aggregating results in a main process over IPC. Two consequences:

1. PeaceAI cannot inject a reporter that writes the one trusted report line. Instead the shim runs ava with its
   built-in `--tap` reporter and reads ava's TAP finish block (`\n1..N\n# tests T\n# pass P\n[# skip S\n]# fail F\n`,
   anchored to the end of ava's stdout) in the MAIN process, which runs no code under test, and turns it into the
   M173 report. supertap (ava's TAP writer) flattens newlines in a test title to spaces, so a malicious title cannot
   inject a fake finish block into the stream.
2. A worker is the one place code under test runs, and an ava worker reports every test result to the main process
   through `process.send` (child-process mode). So a worker could forge an IPC `test-passed` (or drop a `test-failed`)
   to make the main process miscount. The worker guard below closes that.

## Change

1. Detection. ava leaves `OTHER_RUNNERS` and becomes a named runner like vitest, jest and mocha: the package's test
   script (or one level of named package scripts, as before) must hold exactly one `ava` command (`m187-guard:ava-one-command`;
   a single `npx` / `c8` / `nyc` wrapper is stripped, two ava commands or none is refused), and ava must be a
   dependency (`guard:runner-dep`). There is no dependency-only fallback (as with mocha).
2. Script options. `avaOptions` reads ava's CLI flags and passes on only an allowlist, as config keys: boolean flags
   `--serial/-s`, `--fail-fast`, and the no-op display flags (`--verbose`, `--tap`, `--color`, `--no-worker-threads`,
   dropped); value flags `--timeout/-T` (integer ms or `N(ms|s|m)`, `m187-guard:ava-timeout`/`-flag-value`) and
   `--concurrency/-c` (integer 1..64, `m187-guard:ava-concurrency`/`-flag-value`). Any other flag refuses the task
   (`m187-guard:ava-flag`), so an unknown flag cannot be swallowed even when it carries a numeric value. The script's
   positional globs are dropped (the loop names the team's files itself).
3. The package.json `"ava"` key. Only an object with allowlisted keys and value shapes is accepted (`m187-guard:ava-key`
   is defense in depth; `avaKeyValue` returns undefined, which refuses, for every other key / shape):
   - `serial` / `failFast` / `failWithoutAssertions` (and the dropped `verbose` / `tap` / `workerThreads` / `cache`)
     must be booleans (`m187-guard:ava-bool`);
   - `timeout` and `concurrency` as the flags above;
   - `extensions` a short (1-8 char) word list, or an object mapping such words to `true` / `"module"` / `"commonjs"`;
     any other shape refuses;
   - `require` only regular files inside the package (no absolute path, no `..`, resolved through no symlink,
     `m187-guard:ava-require`): ava would load a bare package name through a stub it writes under
     `node_modules/.cache/ava`, which the read-only copy cannot do, so such a run is refused up front;
   - `nodeArguments` only safe no-value node flags, or a hook (`--import` / `--loader` / `--experimental-loader` /
     `--require`) whose value is an in-package file or a bare package name (`m187-guard:ava-node-args`);
   - `files` is read and dropped (the loop names the files).
   A script flag and the key combine; the script wins on a shared key (as on ava's CLI).
4. Config files. ava reads `ava.config.js` / `.cjs` / `.mjs` / `.json` on its own, searching from the package dir up
   to the repo root. PeaceAI does not interpret them, so a task with one anywhere on that path is refused
   (`m187-guard:ava-config-file`), and the shim runs ava with `--config <static file>`, which makes ava ignore both the
   package.json `"ava"` key and any `ava.config.*`. `detectRunner` returns the vetted options as one JSON string in
   `options` (`m187-guard:ava-options`).
5. Shim. `shimArgs` passes the vetted options JSON before a `--`, then the files (the mocha pattern; the shim requires
   the separator for ava). The shim (`run.mjs`) writes three files beside itself under
   `node_modules/.peaceai-loop/` (read-only and tamper-hashed with the rest of node_modules, like the mocha guard):
   - `ava-config.mjs` (`AVA_CONFIG_PATH`): the static `--config` file. It reads `PEACEAI_AVA_OPTIONS` (the vetted
     options plus the team files), forces `workerThreads: false` (so workers are child processes the guard can pin)
     and `cache: false`, sets the TAP reporter, and prepends the worker guard to `require`.
   - `ava-reporter.cjs` (`AVA_REPORTER_PATH`): preloaded by `launch.cjs` in ava's MAIN process (which runs no code
     under test). It claims the one M173 report writer, captures and suppresses ava's TAP on stdout (so nothing ava
     prints reaches the shim's summary), and on exit parses the finish block anchored to the end of the stream and
     writes `{ numPassedTests, numFailedTests, ..., success: fail === 0 && pass > 0 }`. No usable finish block is
     NO_REPORT (the shim credits nothing).
   - `ava-guard.cjs` (`AVA_GUARD_PATH`): loaded in each worker before the test file (through the config's `require`).
     It pins `process.send` to callers inside the ava package (`m187-forge-guard:ava-send-pin`): a frame check via
     `Error.prepareStackTrace` lets ava's own worker code report results, and drops a `process.send` from code under
     test. `process.send` is redefined non-writable / non-configurable, so code under test cannot restore the raw one.
     It finds ava's real package dir through `PEACEAI_AVA_PKG` (set by the shim).

## Soundness

No check is removed or weakened. ava runs inside the same stage-2 isolation as the candidate uid, from the copy's
read-only, tamper-hashed node_modules. The only repo-controlled inputs passed to it are the allowlisted options, no
more powerful than the test files themselves (a `require` / loader hook is code the test files could already import);
paths are confined to regular files inside the package. Config files are refused rather than read, and ava is told to
read none. The pass / fail counts come only from the finish block the reporter parses in the main process, over the
M173 fd-3 / nonce / one-claim channel, and a nonzero exit with no usable report still scores fail-closed (NO_REPORT 95,
SUITE_LOAD 94, EXIT_ONLY 93).

Forging model. The main process runs no code under test, so its aggregate is sound except that a worker can forge IPC
through `process.send`; the worker guard closes exactly that. The inherited M173 channel closes the other routes: a
worker cannot write the main process's fd 3 (its own fd 3 is not that channel), does not know the per-run nonce, and
has no `peaceai.loop.claim` symbol (that lives only in the main process). A worker `process.exit(0)` mid-run leaves no
finish block, so the run fails closed. Residual exposures, out of scope here and shared with the other runners
(covered by isolation and tamper hashes, not the count): a low-level `process.channel` write that bypasses the pinned
`process.send`; writing another process's memory where `/proc` is not restricted by yama; and in-process reach to
ava's own assertion objects inside a worker (ava uses its own `lib/assert.js`, not `node:assert`, and patching its
assertion prototype did not forge a pass in testing). These are the same class of in-process adversary the mocha spec
documents; the guard closes the documented IPC-forge path, not an adversary that rewrites ava in-process.

## Tests

`m187-cases.ts` (detection, replayed against mutants by `m187-mutation.test.ts`): admitted on three unrelated shapes -
a plain `ava` script with no config; an `npx ava --serial` script plus a package.json `"ava"` object with
`extensions` (object form), an in-package `require`, `nodeArguments` (`--import`), `timeout`, `concurrency`,
`failWithoutAssertions` (the `files` / `cache` / `workerThreads` / `verbose` keys read and dropped); and a short
`extensions` array with an in-package `require` file and `nodeArguments` naming loader / import packages. A refused
near-miss per condition: `ava.config.{js,cjs,mjs,json}` in the package and one dir above it; an unknown `"ava"` key and
a non-object `ava` value; a non-boolean boolean key; a bad timeout (0, negative, huge, odd unit) and concurrency (0,
>64, non-number); a long / non-word extension and an unknown module type; a `require` outside the package (absolute,
`..`) and a missing file; a `nodeArguments` entry that is not a safe flag or a validated hook; zero and two ava
commands; an unknown flag (including one carrying a numeric value); a bad `--timeout` / `--concurrency` value; no ava
dependency. The vetted options the shim hands ava and the `shimArgs` shape are asserted. `m187-mutation.test.ts`
deletes each `m187-guard` line and needs a detection case to fail (the control is clean).

`m187-forge.test.ts` runs real ava 6.4.1 from a pinned lockfile (`peaceai/test/fixtures/m187-forge-ava6`,
`npm ci --ignore-scripts`; CI=true fails on an install error, an offline box skips). Controls: a real pass is credited,
a real failure stays one. Every forging attack is refused: a worker forging an IPC `test-passed` for a file with no
passing test (todo only); a worker writing the pre-M173 report file then exit 0; a worker writing a report line on fd 3
without the nonce then exit 0; a worker trying to claim the writer (the symbol is only in the main process); a worker
`process.exit(0)` mid-run. The one new forge guard is mutation-checked against real ava: deleting
`m187-forge-guard:ava-send-pin` makes the worker's IPC forge a credited pass (the inherited M173 channel guards are
mutation-checked against mocha / vitest / jest in `m173-forge.test.ts`). A hygiene check asserts no process outlives a
run (ava forks workers).

The lockfile fixture is exempt from THIRD_PARTY_NOTICES (m75) on the same basis as the batch 11 fixtures: a
package.json written here plus npm's lockfile, no third-party code or license text.

## Reconciliation with earlier near-miss fixtures

Because ava is now admitted, the earlier runner near-misses that used ava as an example of an UNSUPPORTED runner move
to `tape` (still in `OTHER_RUNNERS`): `m151-cases.ts`, `m151-loop-v2.test.ts`, `m170-cases.ts` and `m172-cases.ts`
(including the `m172-order:service-first` compose-file cases). This is maintenance of those fixtures, not shaping to any
task.
