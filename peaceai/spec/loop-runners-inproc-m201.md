# M201 (batch 37): mocha probed against report-channel attacks; terminal, refused by name under a wider edit scope

## What was open

M193 made real mocha 10.x sound against mocha-internal result rewriting (the m193 guards in loopdeps.ts
`MOCHA_GUARD_SOURCE`: tests / hooks pinned to their functions, a pass only for a test run through the guard, the run's
plan taken at start and checked at end, mocha's prototypes and node:assert locked). M199 left mocha
`INPROC_VERDICT_UNPROBED` under any edit scope wider than the M175 bound, and M200 noted that its two channel attacks
were against launch.cjs, not node:test, so they bear on mocha. This batch probes real mocha 10.8.2 under the M193
guarded route (the real shim: run.mjs -> launch.cjs with the per-run nonce on stdin -> mocha with mocha-guard.cjs as
preload and reporter -> one `PEACEAI-REPORT <nonce> <json>` line on fd 3) against those attacks and their relatives,
on node 24.22.1 and node 22.23.3 (CI's major).

## Probes (every attack is in a SOURCE function an honest test calls, never in the test file)

Fixture: the m172 pinned lockfile (mocha 10.8.2), `npm ci --ignore-scripts`, as an ESM package so the source can be
`.ts` (node type stripping). Honest test: `it("2024 is a leap year")`, `it("1900 is not a leap year")` against
`isLeap` in `src/leap.ts`; the attack is the function's added body. "M193 route" is the real shim exactly as the loop
runs it. "Hardened" is a probe-only copy of the same shim whose runner is started with node's permission model
(`--permission --allow-fs-read=<package> --allow-fs-write=<package>/.tmp --disable-sigusr1`): no inspector, no
workers, no child processes, no reads outside the package. Credited = exit 0 and `# pass N>0 / # fail 0`.

| id | attack (in `isLeap`) | kind | M193 route | hardened |
|---|---|---|---|---|
| A1 | `process.binding("fs").writeString` rewrites the fd 3 report line (passes 2, failures 0), then `process.reallyExit(0)` | report channel (fs binding) | CREDITED | refused |
| A2 | `node:inspector` Session reads `nonce` from the `[[Scopes]]` of launch.cjs's claim function, `fs.writeSync(3, forged line)`, `reallyExit(0)` | report channel (inspector) | CREDITED | refused |
| A3 | the inspector takes the guard's own claimed `write` out of mocha-guard.cjs's closure (via `require.cache`) and calls it with forged stats (no nonce needed), `reallyExit(0)` | report channel (inspector, guard writer) | CREDITED | refused |
| A4 | the inspector's `Runtime.queryObjects` on Runner.prototype finds the run's Runner; its `fail` listeners are rerouted to the `pass` listeners and `failures` pinned to 0 (no channel, no exit trick) | guard state (inspector, Runner instance) | CREDITED | refused |
| A5 | a worker thread `connectToMainThread()`s, reads the nonce, writes fd 3; the main thread spins on a SharedArrayBuffer flag, then `reallyExit(0)` | report channel (worker + inspector) | CREDITED | refused |
| A6 | a child (fd 3 inherited) sends SIGUSR1 to the runner, reads the nonce over 127.0.0.1:9229, writes fd 3, evaluates `process.reallyExit(0)` in the runner | report channel (child + SIGUSR1) | CREDITED | refused |
| A7 | `/proc/self/mem` scanned for 64-hex runs (launch.cjs run directly with a known nonce) | nonce reachability | nonce among the candidates (not a one-shot forge) | read denied |
| H1 | the passing call arms an `Object.prototype` setter for `callback`; mocha's `Runnable#run` does `this.callback = done` before calling the failing test's fn, the setter calls `done()` at once, the later assertion error is swallowed (`done` already finished) | in-heap (Object.prototype, no channel) | CREDITED | CREDITED |
| H1' | the same, describe / it style | in-heap | CREDITED | CREDITED |
| R1 | forged line with a guessed nonce, `reallyExit(0)` | near miss (no nonce) | refused | refused |
| R2 | `fs.writeSync` (the module function) patched to rewrite the line | near miss (launch.cjs captured it) | refused | refused |
| R3 | a second claim of the channel, then a forged write | near miss (poison line) | refused | refused |
| R4 | `process.exit(0)` inside the failing test | near miss (no report) | refused | refused |
| R5 | the H1 setter armed inside the failing call itself (too late: `callback` is already set) | near miss (in-heap, too late) | refused | refused |

Same results on node 24.22.1 and 22.23.3. Honest baselines (the bug is `# pass 1 / # fail 1`, exit 1; the fix is
credited) hold on both routes, in it and describe / it styles.

## Decision: mocha is NOT sound in-process; TERMINAL under a wider scope

- The M193 route is not a closure over the report channel: A1-A6 are credited on the real shim. The nonce, the
  guard's claimed writer and the Runner's listeners are all in the heap of the process that runs the code under
  test, and node gives that code the fs binding, the inspector (in-thread, from a worker, or from a child over
  SIGUSR1) and `reallyExit`.
- Closing the channels in-process is possible only with node's permission model (the hardened route refuses A1-A7),
  and node documents that model as not a defence against malicious code. Even granting it, H1 is credited on the
  hardened route: it uses no channel, no binding, no inspector, only an `Object.prototype` accessor that mocha's own
  `Runnable` falls into. M193 locks mocha's prototypes and node:assert; it does not and cannot lock
  `Object.prototype`, every primordial and every instance mocha makes without breaking honest code, and each new lock
  is one more case of a list with no end (whack-a-mole over the whole shared heap).
- So no general in-process mechanism makes mocha's verdict sound under a wider scope. `inprocScopeProblem("mocha",
  classes)` = `INPROC_VERDICT_TERMINAL` for any class outside the bound (`m201-guard:mocha`). Inside the bound
  (today's policy) mocha is admitted as before, and every attack above is already `EDIT_SCOPE` today (each needs
  `process`, `prototype`, an import-ish word or a new word).
- vitest / jest / node:test stay TERMINAL; any other runner name stays UNPROBED. `EDIT_SCOPE_POLICY` is not widened.

## Mechanism (`peaceai/lib/loop.ts`)

- One line in `inprocScopeProblem`, after `m200-guard:node-test`, before the unprobed default:
  `if (runner === "mocha") return "INPROC_VERDICT_TERMINAL"; // m201-guard:mocha`.
- No new wiring: `m199-guard:loop-wide` already applies the gate to the detected runner right after the M175 scope
  gate. `EDIT_SCOPE_POLICY`, `INPROC_BOUNDED_SCOPE`, looprow.ts, selfpropose.ts, plandefault.ts and the v4 default
  digest are unchanged; the M193 mocha guards, the shim and the M199 / M200 lines are unchanged. The hardened route
  is a probe only and is not shipped.

## Soundness note

This is a refusal, not a close. Under today's policy the gate is inert for mocha as for every runner: the policy sits
inside the bound, so every probed attack is `EDIT_SCOPE`, and in-body edits on mocha rest on the M175 syntactic
bound (the M193 note stands: vocabulary, not unreachability). What M201 adds is that mocha's in-process residual is
named terminal, with evidence on the real runner: six channel attacks and one in-heap attack credited before, and
each killed after (outside the bound, refused by M175 today, `INPROC_VERDICT_TERMINAL` on the detected mocha runner
under a wider scope). The e2e mutant shows the stake on the real loop (stage-2 candidate uid peaceai-cand3, real mocha
copied in by a stub package manager run as the candidate): with the policy widened to `dangerous:prototype`, the H1
source edit is refused before any run; with `m201-guard:mocha` deleted it falls to the M199 default
(`INPROC_VERDICT_UNPROBED`, still refused); with `m199-guard:loop-wide` deleted the real loop credits it `PASS`.

### What a sound design would need (recorded next step, not built)

A verdict the code under test cannot reach. In-process guards cannot give that (H1), so the boundary has to be the
kernel's:

1. Two processes under two uids. The candidate process (candidate uid) loads and runs the code under test and
   returns DATA only: the values the test's calls produced, serialized (structured clone or JSON) over one pipe. The
   verifier process (a separate verifier uid, never the candidate's) holds the test file, the assertion library, the
   runner and the reporter; it compares the returned values and alone writes the verdict. No test code, assertion or
   reporter object lives in the candidate's heap, so there is nothing there to patch.
2. No reach from candidate to verifier: different uids (no ptrace, no `/proc/<pid>/mem`, no signals across, so no
   SIGUSR1 inspector), `ptrace_scope` >= 1 (the box has no yama today), the inspector disabled in both
   (`--disable-sigusr1`, no `--inspect`), no shared fds except the data pipe (no fd 3, no inherited stdout the
   verifier reads as a verdict), no shared writable dirs, no network between them.
3. The data channel carries values, never code or verdicts: the verifier parses it with a strict schema and bounds,
   treats anything malformed, missing or late as a failure, and never evaluates it. A value can still be wrong on
   purpose only by being the right answer, which is an honest pass.
4. What this costs: a test must be split into calls (run in the candidate) and checks (run in the verifier). That is
   a runner of PeaceAI's own, not mocha, so a sound wider scope means "PeaceAI's split runner", and mocha / vitest /
   jest / node:test stay TERMINAL under a wider scope until a task's tests can be run that way.

## Tests (`peaceai/test/m201-mocha-verdict.test.ts`)

- baselines on both routes (the bug fails, the fix is credited; it and describe / it styles).
- before: the 13 attacks of the table pinned on both routes (26 cases), A7 pinned as reachable on the M193 route and
  denied on the hardened route.
- after: every attack's edit (A1-A7, H1, R1-R5) is outside the bound, refused by M175 today, and
  `INPROC_VERDICT_TERMINAL` on the runner `detectRunner` picks for the package (`mocha`).
- honest: leap years (it with node:assert/strict; describe / it with node:assert strictEqual), a temperature
  conversion, roman numerals (describe / it, a done callback): the bug fails and the in-body fix is credited on both
  routes, classed in-body and admitted on mocha.
- gate: the mocha guard with near misses (bounded classes and an empty list admitted; `mochas`, `Mocha`, `mocha10`
  and "" stay UNPROBED; vitest / jest / node-test unchanged); pins (bound and policy unchanged); the tag is one line
  in its place; deleting it in a mutant copy fails a case of its own guard.
- loop wiring (candidate uid, M201_CAND / M146_CAND = peaceai-cand3): as in the soundness note, plus the in-body fix
  passes today and widened, and the forge is `EDIT_SCOPE` today.
- m199 and m200 near misses that expected mocha UNPROBED now use unknown runner names (`tap`, `ava`).
- Shapes: leap years, a temperature conversion, roman numerals; none from PeaceSTOCKS, a dev task or a reference
  diff. Reuses the m172-real-mocha10 fixture; needs the npm registry like m193 (CI=true: an install failure fails).
- A6 uses the inspector's default port 9229 on 127.0.0.1 (tests in the file run one at a time).

## Residuals (honest)

- mocha under today's scope: the M193 guards and the M175 syntactic bound stand; this batch shows the guards are not
  a closure over the process, so their value is against mocha-internal rewrites only.
- Third-party assertion libraries (M199's reason for UNPROBED) are moot under a wider scope now (TERMINAL) and remain
  inside the bound as before.
- Probed on mocha 10.8.2, node 22.23.3 and 24.22.1 only; H1 depends on `Runnable#run` assigning `this.callback`, but
  the decision does not: A1-A6 apply to any in-process verdict on the M173 channel.
- The out-of-process design above is built as experimental verifier-v1 (M202, `peaceai/spec/verifier-v1.md`); not default.
  The box also lacks yama ptrace hardening (unchanged from M173); M202 re-checks that cand3 cannot ptrace the verifier uid.
