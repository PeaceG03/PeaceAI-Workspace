# M200 (batch 36): node:test probed; terminal, refused by name under a wider edit scope

## What was open

M199 (`loop-runners-inproc-m199.md`) made vitest and jest `INPROC_VERDICT_TERMINAL` under any edit scope wider than
the M175 bound and left node:test `INPROC_VERDICT_UNPROBED` (not probed). M200 probes node:test the way M193 / M199
probed mocha, vitest and jest, on the real node:test of the node running the test (CI: node 22; also checked on the
box with node 22.23.4 and 24.22.1, same results). The question: can node:test be made sound under a wider scope with
M193-analogous guards (a verdict derived from what actually ran, against the planned tests), or is it terminal?
`EDIT_SCOPE_POLICY` is not widened.

## How the loop runs node:test today

`loop.ts` runTests: `node --test --test-reporter=tap <files>` in the stage-2 isolation (no shim), then one rerun per
top-level literal `test` / `it` name with `--test-name-pattern=^name$`. Counts are the last `# pass` / `# fail` lines
(selfpropose.ts), plus the exit code, leftovers and tamper hashes. `node --test` runs each file in a CHILD process
with the v8-serializer reporter on the child's stdout; the parent (`FileTest` in node's test_runner/runner.js)
deserializes every framed item on that pipe as an event, with no authentication, and takes the child's exit code.

## Probes (every attack is in a SOURCE function an honest test calls, never in the test file)

Path A is the loop's own path above. Path B is the guarded route an M193 analogue would need: node:test run
in-process (`run({ isolation: "none" })`) by a driver preloaded through the real M173 `launch.cjs` (installShim's
LAUNCH_SOURCE: per-run nonce on stdin, one `PEACEAI-REPORT <nonce> <json>` line on fd 3, the shim's one-line rule),
that freezes node:assert / node:test's assert and mock before any repo code loads, locks the EventEmitter / Stream /
Readable / TestsStream prototypes (the M193 accessor lock), reads event fields as own properties only, and counts a
skip or todo as a failure. Path B is a probe driver inside the test, not shipped.

| attack | kind | A: before (loop's TAP path) | B: guarded in-process route | after |
|---|---|---|---|---|
| `node:assert/strict` equal replaced | assertion (module) | CREDITED (test and describe style) | refused (CREDITED with the locks removed) | killed |
| node:test `mock.method` on assert.equal | assertion (node:test mock) | CREDITED | refused (CREDITED unlocked) | killed |
| node:test `assert.register("equal")` (t.assert) | test context | CREDITED | - | killed |
| `after((t) => t.todo())` from the source | after hook | CREDITED (describe style); refused top-level (the per-name rerun needs a pass) | refused (todo is a failure) | killed |
| v8 frames (`test:pass`, `test:plan`) written to fd 1, then `reallyExit(0)` | serialized channel forge | CREDITED | refused (no report) | killed |
| `process.exit(0)` in the failing test | process.exit | CREDITED (both styles; also per name) | refused (no report) | killed |
| `exitCode = 0; reallyExit(0)` | reallyExit | CREDITED | - | killed |
| `Object.is` patched | primordial | refused (node:assert uses primordials) | refused | killed |
| `after` skip, top-level | after hook | refused | - | killed |
| `afterEach((t) => t.todo())` | afterEach hook | refused | - | killed |
| `v8.Serializer.prototype.writeValue` rewrites test:fail | reporter serializer | refused | - | killed |
| exitCode forced to 0 on exit | exitCode | refused | - | killed |
| fake counts on stdout / fd 1 / the parent's fd 1 | fd writes | refused (the real counts come last) | - | killed |
| `internal/test_runner/test` through require | require of internals | refused (ERR_UNKNOWN_BUILTIN) | - | killed |
| diagnostics_channel subscribers rewrite a fail | diagnostics_channel | refused | - | killed |
| `EventEmitter.prototype.emit` rewrites test:fail | event patch | refused | refused (CREDITED unlocked) | killed |
| `Readable.prototype.push` rewrites the stream | stream patch | refused | refused | killed |
| TestsStream prototype (via `run({ files: [] })`) fail -> ok | reporter stream | refused | refused | killed |
| fs binding `writeString` (via `process.binding("fs")`) rewrites the fd 3 report line | report channel | refused (no such line on path A) | CREDITED | killed |
| inspector `Session` reads the nonce from launch.cjs's closure, writes the line, `reallyExit(0)` | report channel | refused | CREDITED | killed |

"killed" = the attack's edit is outside `INPROC_BOUNDED_SCOPE` (M175 refuses it as `EDIT_SCOPE` today) and the
detected runner of a `node --test` package (`node-test`) gives `INPROC_VERDICT_TERMINAL` for its class.
Not pinned in the test: `Error.prototype.failureType` (exit 1 on node 22, 7 or a hang on node 24: refused, but
version-dependent) and `process.kill(process.ppid)` (kills the harness; refused).

## Decision: node:test is NOT closable; TERMINAL

- Path A cannot be made sound by guards: the verdict channel is the child's own stdout and exit code, and the child
  is the process that runs the code under test. It forges a parent-side pass with public APIs (`v8.DefaultSerializer`
  frames on fd 1), and `process.exit(0)` mid-test is a pass. No guard in the parent can tell a forged frame from
  node's own (same bytes, same pipe), and node offers no authenticated reporter channel from the child.
- Path B (the M193 analogue) closes node:test's own surface: with the locks every node:test-internal attack probed
  is refused, and without them three are credited, so the locks are what refuse them. But the report has to leave
  the process, and in-process code under a wider scope reaches that channel through node APIs that are not
  node:test: `process.binding("fs").writeString` is the live binding object (assignable; fs.writeSync, captured or
  not, calls through it), so the one report line, nonce included, can be rewritten; and `node:inspector` reads any
  closure (the nonce) and can call anything. Closing those means removing parts of node (process.binding, the
  inspector, and whatever else reaches V8 state) with no closure argument; node's permission model is documented as
  not a defence against malicious code. So the route is not "a closure over known channels" and is not shipped.
- Hence `inprocScopeProblem("node-test", classes)` = `INPROC_VERDICT_TERMINAL` for any class outside the bound
  (`m200-guard:node-test`), like vitest and jest. Inside the bound (today's policy) node:test is admitted as before.
- vitest / jest stay TERMINAL; mocha stays as M193 / M199 left it (M193 guards unchanged; UNPROBED under a wider
  scope). Note for a future mocha widening: the two Path B channel attacks are against launch.cjs, not node:test, so
  they apply to mocha's in-process verdict too.
  Batch 37 (M201, `loop-runners-inproc-m201.md`) did that probe: they do apply (plus a worker, a child over SIGUSR1,
  and an in-heap Object.prototype attack no channel guard reaches), so mocha is TERMINAL under a wider scope too.

## Mechanism (`peaceai/lib/loop.ts`)

- One line in `inprocScopeProblem`, after `m199-guard:jest`, before the unprobed default:
  `if (runner === "node-test") return "INPROC_VERDICT_TERMINAL"; // m200-guard:node-test`.
- No new code, no new wiring: `m199-guard:loop-wide` already applies the gate to the detected runner right after
  the M175 scope gate. The looprow.ts comment on the codes is updated (comment only). `EDIT_SCOPE_POLICY`,
  `INPROC_BOUNDED_SCOPE`, selfpropose.ts, plandefault.ts and the v4 default digest are unchanged; the M193 mocha
  guards, the shim and the M199 lines for mocha / vitest / jest are unchanged.

## Soundness note

Today the gate is inert for node:test exactly as for vitest / jest: the policy sits inside the bound, so every probed
attack is already `EDIT_SCOPE` (each adds `process`, an import-ish word or a global write). What M200 adds is that
node:test's in-process residual is now named terminal rather than unprobed, with the probe evidence: a wider scope
on a node:test task is refused `INPROC_VERDICT_TERMINAL` before any run. The e2e mutant shows the stake on the real
loop (stage-2 candidate uid): with the policy widened to `dangerous:process`, a source edit that calls
`process.exit(0)` inside the failing test is refused before any run; with `m200-guard:node-test` deleted it falls to
the M199 default (`INPROC_VERDICT_UNPROBED`, still refused); with `m199-guard:loop-wide` deleted the real loop credits
it `PASS`. This is a refusal, not a close: in-body edits on node:test still rest on the M175 syntactic bound, as on
every runner.

## Tests (`peaceai/test/m200-node-test-verdict.test.ts`)

- before (path A): 25 attacks pinned to their probed result on real `node --test`, counted as runTests counts
  (credited ones above are the hazard); honest baselines in test, describe and t.assert styles.
- guarded route (path B): the driver credits honest fixes and refuses the honest bug; 11 attacks pinned (9 refused,
  2 channel attacks credited); 3 attacks credited by the same driver with its lock lines removed.
- after: every attack's edit is outside the bound, refused by M175 today, and `INPROC_VERDICT_TERMINAL` on the
  detected `node-test` runner.
- honest: leap years (test and describe styles), a temperature conversion, roman numerals (describe, strictEqual):
  the bug fails, the in-body fix is credited on real node:test, classed in-body and admitted on node-test.
- gate: the node-test guard with near misses (bounded classes admitted; mocha and an inexact runner name stay
  UNPROBED); the tag is one line in its place; deleting it in a mutant copy fails a case of its own guard.
- loop wiring (candidate uid, M200_CAND / M146_CAND = peaceai-cand3): as in the soundness note, plus the in-body fix
  passes today and widened, and the forging edit is `EDIT_SCOPE` today.
- m199's node:test expectations are moved to the new code (its jest near miss now uses an unknown runner).
- Shapes: leap years, a temperature conversion, roman numerals; none from PeaceSTOCKS, a dev task or a reference
  diff. No registry needed.

## Residuals (honest)

- node:test under today's scope: the M193 note stands (a syntactic bound, not unreachability).
- The Path B channel attacks (fs binding, inspector) are a property of any in-process verdict on the M173 channel;
  they are not reachable inside the bound (both need `process` or an import), and are recorded here for the mocha
  widening question, which M200 does not change.
  Followed up in M201 (`loop-runners-inproc-m201.md`): mocha is TERMINAL under a wider scope.
- Probed on node 22.23.4 and 24.22.1 only; a later node that adds an authenticated child channel would reopen path A.
