# M192: ava stays refused (terminality proof and soundness note)

Batch 25. Status: ava is refused with `TEST_RUNNER_UNSUPPORTED`, as it was before M187. M187 (batch 22) admitted
it and was reverted on gen/batch22 (853cb2d) after Auditor forged three credited passes on real ava 6.4.1. This
note explains why PeaceAI does not ship a second ava guard, what keeps ava out, and what remains open.

## The bar

A credited pass must come from something the code under test cannot influence. For the supported runners
(M173, `repair-v2-m173.md` "Report forging") that means two things. First, the report reaches the shim on fd 3 as
one line carrying a per-run nonce. The nonce comes in on stdin before any repo code runs and is held in a closure.
Second, the runner objects that produce the verdict are locked before repo code loads. On mocha (#671) those are
the Runnable / Runner / Suite / Test / Hook / Context / Mocha prototypes, the pinned `Runner.prototype.emit` and the
frozen `node:assert`. Both defences rely on JavaScript language guarantees that same-process code cannot undo
(non-configurable accessors, closures). The one exception is reading process memory, which is a documented residual.

## Why ava cannot meet it (terminality)

1. ava decides every test's verdict in the worker. That is the child process (`workerThreads: false`) or the
   worker thread (the default) that loads the test file, and through it the code under test. The assertions run
   there, and `lib/worker/base.js` turns the runner's `stateChange` events into `test-passed` / `test-failed`
   messages.
2. The main process (`lib/run-status.js`) only counts those messages, and its exit code and TAP / JSON summaries
   are derived from them. Nothing in the main process observes a test running.
3. The messages travel over a channel the worker must keep open for ava to work: the IPC fd with `advanced`
   (v8) serialization, or the worker's `parentPort`. Code in the worker can put bytes on that channel that cannot
   be told apart from ava's own. Six ways are shown in `m187-forge.test.ts` (each one credited by ava's own verdict
   on real ava 6.4.1):
   - (a) call ava's own `lib/worker/channel.cjs` `send` by absolute path. A guard that checks the caller's stack
     sees ava's file, which is how the M187 send-pin was bypassed.
   - (b) `process._send`, and (d) `process.send`.
   - (c) wrap `channel.send` and rewrite a really failing test's `test-failed` into `test-passed`.
   - (e) `fs.writeSync(process.channel.fd, frame)` with a hand-built v8 frame. This uses no JavaScript object of
     ava's or node's IPC layer, so no pin, freeze or lock applies to it.
   - (f) worker threads: `parentPort.postMessage`.
4. A nonce or MAC on these messages does not help. ava's legitimate sender is in the same process as the code
   under test, so (a) and (c) go through the signing path itself, and (e) can sign with a key that sits in the
   same address space. The mocha approach works because PeaceAI owns both ends: its reporter computes the verdict
   from mocha's locked runner and holds the nonce. For ava the equivalent would mean replacing ava's main-process
   aggregation and its worker internals. That would be a version-specific rewrite of a framework PeaceAI does not
   control, and it would still leave (c)-class result rewriting (see Residuals).
5. Taking the verdict from a different process gives nothing new. The only process that sees a test run is the one
   running it. Exit codes, files, fds and timing that it produces are all under its control. Kernel-level
   separation (seccomp, ptrace) cannot tell ava's write(2) from the attacker's, because they are the same syscall
   from the same process.

So no sound place exists to count ava results. This is not a missing guard. It follows from where ava runs
assertions. The decision is to refuse, not to ship a weak guard.

## What keeps ava out (each a single tagged line, each with a mutant)

- `guard:runner-other` (existing): a test script word (or one level of script indirection) naming ava, or any
  other refused runner, is refused. This holds even when vitest / jest is installed beside it.
- `m192-guard:runner-path` (new): a refused runner named by path is refused, for example `./node_modules/.bin/ava`
  or `node node_modules/ava/entrypoints/cli.mjs`. Before M192 such a script fell through to dependency inference
  and could be run under vitest / jest. It was never credited, but it was misattributed. It covers the case where ava is
  not a declared dependency. When it is declared, `runner-dep-other` refuses the repo as well.
- `m192-guard:runner-dep-other` (new): when no runner is named and a refused runner is in the dependencies, the repo
  is refused rather than run under the vitest / jest installed beside it.
- Shim, defence in depth: `run.mjs` given any runner other than vitest / jest / mocha exits `NO_REPORT` with
  `# pass 0` / `# fail 1`. A credit also needs PeaceAI's reporter to claim the fd 3 writer, and ava has no reporter
  hook that PeaceAI runs.

## Tests (`peaceai/test/m187-forge.test.ts`)

- Detection: five refusal conditions, each with a refused near-miss and an admitted neighbour (`avalanche-fixtures`,
  `vitest run test/ava.test.js`, `node node_modules/jest/bin/jest.js`, `ava-like-helper`, a `jest` indirection).
  Mutation: deleting each tag admits its near-miss.
- Real ava 6.4.1 (pinned lockfile fixture `fixtures/m187-forge-ava6`, `npm ci --ignore-scripts`):
  - Controls: ava's verdict credits a real pass and not a real failure, in both process and thread mode.
  - Mutation: with the refusal removed, the credit source would be ava's own verdict (as M187 used it). On that
    source every attack (a)-(f) is a credited pass, so the refusal is the defence.
  - Through PeaceAI: every attack repo is refused at detection, and the shim credits nothing for runner `ava`
    (`NO_REPORT`).
- Shapes: leap years, roman numerals, a temperature conversion. None come from PeaceSTOCKS or a task repo.

## Residuals (honest)

- The same in-process class exists on the supported runners. M173 documents "in-process framework reach on vitest
  / jest" as not closed. Batch 25 found and pinned the strongest form on vitest 4.1.10: a really failing test whose
  `ctx.onTestFailed` sets `ctx.task.result.state = "pass"` is credited through the shim today. This is pinned in
  `m187-forge.test.ts` layer 3 so the note stays true. vitest's main process trusts its workers' task state the way
  ava's trusts its IPC, and the M173 report channel protects only the reporter-to-shim hop. jest (workers or in-band)
  and mocha instance-level rewrites of `currentTest.state` were not probed in this batch and are presumed to be in
  the same class.
  Batch 26 (M193, `peaceai/spec/loop-runners-inproc-m193.md`) probed all three: mocha is made sound against the
  class (PeaceAI's reporter pins and plans the run); vitest and jest are terminal at the runner and the attacks,
  including source code reaching `__vitest_worker__` (Auditor, #687), are killed by the M175 edit gate.
- In the loop's own threat model, the code that runs is team test files (edits refused, `TEAM_TEST_EDIT`) plus
  candidate source edits bounded by M175 (in-body template edits, no new imports or words, no global writes).
  That model does not give the candidate an obvious way to reach `ctx.task` or a runner channel. But M175 is a
  syntactic bound, not a proof of unreachability. Auditor's bar treats code under test as adversarial, and against
  that bar these residuals are open.
- Unchanged from M173: reading the nonce through `/proc/self/mem` or the inspector, and no yama / ptrace hardening.
