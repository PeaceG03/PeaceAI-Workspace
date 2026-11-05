# VERIFIER-V1 (M202, batch 38): experimental out-of-process verification

Status: EXPERIMENTAL, NOT DEFAULT, NOT FOR CREDIT. Code: `peaceai/lib/verifier.ts`, harness
`peaceai/lib/verifier-harness.cjs`, CLI `peaceai/bin/verifier-v1.ts`, test `peaceai/test/m202-verifier.test.ts`.
Loop opt-in: `LoopOptions.verdictMode = "oop-v1"` (or `selectVerdictMode("oop-v1")`). Default remains `inproc`.
`EDIT_SCOPE_POLICY`, `selfpropose.ts`, `plandefault.ts` and the v4 digest are unchanged.

## Why

M199–M201 found every in-process runner (vitest, jest, node:test, mocha) unsound under an edit scope wider than the
M175 bound: the verdict shares a heap / process with the code under test. `peaceai/spec/loop-runners-inproc-m201.md`
recorded the sound design. This batch builds that design as a reusable library and proves it on the attack families.

## Design

1. **Two processes, two uids.** The candidate process (`PEACEAI_STAGE2_CAND`, never the verifier) loads the candidate
   module through a fixed harness and answers call requests (function name + JSON args) with JSON results / errors over
   stdin / stdout only. The verifier process (the box / runner uid) holds the test cases as data and compares with its
   own primordials (`Object.is` and friends captured at load). It never imports candidate code.
2. **Harness.** `verifier-harness.cjs`, started as `node --disable-sigusr1 harness.cjs <module>` under
   `sudo -n -u <cand> -- env -i PATH=... HOME=<priv> TMPDIR=<priv> NODE_OPTIONS= setsid --wait`. No `--inspect`, no
   extra fds, env scrubbed. One JSON object per line, version 1.
3. **Defensive deserialize.** Size limit (`MAX_LINE_BYTES`), depth limit (`MAX_DEPTH`), per-call and session timeouts.
   Any protocol deviation, oversize payload, unexpected id, or non-protocol stdout is a fixed refusal
   (`OOP_PROTOCOL`, `OOP_OVERSIZE`, `OOP_DEPTH`, `OOP_TIMEOUT`, `OOP_STDOUT_NOISE`).
4. **Case source (conservative).** A JSON case file (`version: "verifier-v1"`), or extraction from only
   `assert.strictEqual(fn(lit...), lit)` / `assert.equal` / `assert.deepStrictEqual` / `expect(fn(lit...)).toBe(lit)` /
   `.toEqual(lit)` with literal args. Anything else that looks like an assertion is `OOP_CASES_NONLITERAL`. Empty is
   `OOP_CASES_EMPTY`. Does not claim coverage of arbitrary tests.
5. **Loop wiring.** `inprocScopeProblem(runner, classes, verdictMode)` returns null when `verdictMode === "oop-v1"`
   (`m202-guard:oop-skip`), so TERMINAL does not apply to verdicts produced by verifier-v1. Under `oop-v1` the loop
   judges team tests through `runTestsOop` (extract + verify). If cases cannot be derived: `VERDICT_OOP_CASES`. Other
   verifier refusals: `VERDICT_OOP_REFUSED`. Default mode is unchanged: the M199 gate and every in-process runner path
   behave as before.

## Attack table (candidate source; honest cases expect the right leap / value)

| id | attack (in candidate `isLeap` / `toCelsius`) | in-process (M199–M201 / re-check) | verifier-v1 |
|---|---|---|---|
| H-Object.is | `Object.is = () => true` | CREDITED (naive / vitest / jest) | FAIL (value) |
| H-proto | `Object.prototype` setter for a matcher field | CREDITED (mocha H1; vitest/jest variants) | FAIL / no effect on verifier |
| H-expect | `expect.extend({ toBe: () => ({ pass: true }) })` | CREDITED (vitest / jest) | FAIL (verifier never calls expect) |
| H-assert | patch `assert.strictEqual` | CREDITED when assert is in-process | FAIL |
| X-exit | `process.exit(0)` / `reallyExit(0)` | refused or EXIT_ONLY (shim); mocha channel variants CREDITED | REFUSED (`OOP_PROTOCOL`) or case fail |
| X-stdout | forge `# pass` / a protocol line on stdout | often refused by shim; channel forge on fd 3 CREDITED on mocha | REFUSED (`OOP_STDOUT_NOISE`) |
| X-fs | `process.binding("fs").writeString` on a report fd | CREDITED on mocha M193 route (M201 A1) | no shared report fd; FAIL / PROTOCOL |
| X-inspector | `node:inspector` Session reads a nonce / closures | CREDITED on mocha (M201 A2–A4) | inspector off (`--disable-sigusr1`); FAIL / PROTOCOL |
| X-worker | worker + SharedArrayBuffer / connectToMainThread | CREDITED on mocha (M201 A5) | FAIL / PROTOCOL (no channel to verifier) |
| X-child | child + SIGUSR1 + forge | CREDITED on mocha (M201 A6) | SIGUSR1 disabled; FAIL / PROTOCOL |
| X-procmem | scan `/proc/self/mem` for a nonce | nonce reachable on mocha launch (M201 A7) | no verifier nonce in candidate; N/A / FAIL |
| R-proto-dev | non-JSON stdout, wrong id, oversize, deep JSON | — | REFUSED (per guard) |
| R-nonlit | `assert.strictEqual(fn(x), y)` with non-literal `x` | — | `OOP_CASES_NONLITERAL` |

Honest shapes (credited under verifier-v1 when the module is correct; fail when buggy): leap years, temperature
conversion (F to C). Neither is from PeaceSTOCKS, a dev task, or a reference diff.

## Guards (each tag is one line; m202-verifier deletes each in a mutant and requires its own case to fail)

- `m202-guard:oop-skip` — `inprocScopeProblem` returns null under `oop-v1`.
- `m202-guard:default-inproc` — `selectVerdictMode(undefined)` is `inproc`.
- `m202-guard:oversize` / `depth` / `proto-*` / `noise` / `nonliteral` / `empty` / `cand` / `module` / `ok` — see
  `verifier.ts`.
- `m202-guard:loop-oop` / `loop-cases` / `loop-refused` / `mode-select` — loop wiring.

## Residuals (honest)

- **Same kernel.** Candidate and verifier share a kernel. A kernel bug is out of scope.
- **No seccomp.** The candidate is not under a syscall filter; it can still open files it can reach, spawn processes as
  its own uid, and burn CPU until the deadline. It cannot write the verifier's verdict.
- **Yama ptrace.** The box has no `/proc/sys/kernel/yama/ptrace_scope` (Yama off / absent). Classic uid checks still
  apply: as of this batch, `peaceai-cand3` **cannot** `PTRACE_ATTACH` the verifier (box) uid (`EPERM`), cannot
  `process_vm_readv` it, cannot send it `SIGUSR1`, and cannot read `/proc/<box-pid>/mem`. Residual: if the verifier
  were ever run as the same uid as the candidate, or if a future kernel / capability change granted the candidate
  `CAP_SYS_PTRACE`, this would need re-proof. Prefer `ptrace_scope >= 1` on hosts that run verifier-v1 for real.
- **JSON values only.** A candidate that returns the right answer on purpose is an honest pass (the design's point).
- **Not a general test runner.** Only data-only cases. Mocha / vitest / jest / node:test stay `INPROC_VERDICT_TERMINAL`
  under a wider in-process scope; oop-v1 is a separate opt-in path.
- **Per-case process.** v1 starts one candidate process per case (simpler sync control). A future revision may keep a
  session process; the protocol and uid split stay.
