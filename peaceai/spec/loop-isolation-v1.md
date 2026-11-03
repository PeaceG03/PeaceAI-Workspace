# Loop isolation access (M171, run 41521457458)

## What happened

Run 41521457458 (peace-model-v1-dev at c8bf9c6, image ubuntu-24.04 20261025.353): the installs now succeed (M169), but
for every proposer the 7 tasks that get past the runner/deps checks (defu, destr, scule, ohash, yup, remeda,
neverthrow) end `ISOLATION_UNAVAILABLE` with `attempts=0`, so reachedTests is 0 (21 of 36 rows).

## Diagnosis: not a path

`ISOLATION_UNAVAILABLE` has exactly one source in the loop (c8bf9c6 line numbers):

- peaceai/lib/loop.ts:184 `const isolation = whole.exitCode !== 97 && whole.exitCode !== 98; // guard:isolation-exit`
- peaceai/lib/loop.ts:398 `if (!base.isolation) return done("ISOLATION_UNAVAILABLE");` (the baseline run; :431 per attempt)

Exit 97 and 98 come only from the runner wrapper the loop writes to `<copy>/node_modules/.bin/tsx`:

- peaceai/lib/loop.ts:142 `unshare -r -n -m true 2>/dev/null || exit 97` (its first line)
- peaceai/lib/loop.ts:143 `... mount --bind "$TMPDIR" ... || exit 98 ...`

For the wrapper to exit 97/98 it must already be running as the candidate uid, with the copy as its working dir: sudo
found and executed `<copy>/node_modules/.bin/tsx` as peaceai-cand. A path the candidate cannot reach gives a sudo or
exec error instead (status 1 or 126: a test failure, never ISOLATION_UNAVAILABLE). The copy and the deps cache are
under /tmp (gitCopyFetcher mkdtemp(os.tmpdir()), PEACEAI_DEPS_DIR=/tmp/peaceai-deps.*); the pre-flight lines
`mode home-runner=750` and `runner-temp candidate-traversable=no` are true but name dirs the candidate never needed.

The failing call is `unshare -r` (an unprivileged user namespace) as the candidate uid. Ubuntu 23.10 and later, and
the GitHub ubuntu-24.04 hosted images, ship `kernel.apparmor_restrict_unprivileged_userns=1`, which denies that to
unconfined processes without CAP_SYS_ADMIN (actions/runner-images#10443; the image change to turn it off, #11489, was
closed unmerged). The box the loop tests ran on has no such restriction, and the CI test job has no candidate uid
(those cases are skipped there), so the wrapper had never run on a hosted runner before this run. The userns step prints
`userns-restrict=<0|1>` after setting it, so every run shows the value it ran with.

## Auditor ruling (2026-11-02, on run 41521457458)

Setting `kernel.apparmor_restrict_unprivileged_userns=0` (the ubuntu-24.04 default of 1: actions/runner-images#10443)
is ALLOWED, under these conditions, and ONLY in the credential-free model-v1 attempt job. No AppArmor profile (option 2).

- (a) Only `model-v1-attempt` in peace-model-v1-dev.yml sets it. That job holds no secret, deploy key, environment or
  R2 access; `permissions: contents: read`; actions/checkout with `persist-credentials: false`; no push, artifact,
  cache or token. The score job, and every job holding a secret, never sets it. Enforced for every workflow by
  workflows.test.ts `usernsProblems` ("M171: only the credential-free model-v1 attempt job sets the userns sysctl",
  with a refused near miss per condition).
- (b) The step runs immediately before the candidate (loop) step: `sudo -n sysctl -q -w ...=0`, reads it back with
  `sysctl -n`, prints only `userns-restrict=<0|1>` and exits 1 (`refused CAND_NO_NAMESPACES`) unless the value is 0
  (m171-proof.test.ts "M171 userns step", executed against a fake sudo/sysctl, plus its mutation test).
- (c) The isolation proofs run ON CI, as the loop step's first command (`peaceai/bin/loop.ts proofs`, lib/loopdeps.ts runIsolationProofs),
  inside the loop's own runner wrapper (loop.ts runnerWrapper), as the candidate uid, started by selfpropose.ts
  isolatedRun exactly as candidate tests are, before any attempt: no TCP connect succeeds (a 127.0.0.1 listener the
  runner opens, and two public addresses); getuid() is the candidate uid; no file can be made outside the work dir
  (its parent, /var/tmp, /dev/shm, the workspace, RUNNER_TEMP, home); RUNNER_TEMP and the home cannot be listed; no
  git credential file the runner finds can be read. Fixed codes only (`proof <name>=pass|fail`, `refused <CODE>`,
  `isolation proofs ok`); any failure, exit 97/98, a probe that never ran (success is exit 64, so a no-op cannot pass),
  a stray candidate process, no RUNNER_TEMP or no work dir refuses the whole job. m171-proof.test.ts covers each with
  a refused near miss, and deleting any `// m171-proof-guard:proof-*` line makes a case fail. The private TMPDIR that
  isolatedRun binds writable is the one sanctioned place outside the work dir; it is fresh per run and removed after.
- (d) The attempt job's output is untrusted. It cannot write the repo (contents: read, no push); its rows reach main
  only as a PR appending to peaceai/plan/loop-runs.jsonl, and that PR's tests job runs m146-loop.test.ts "the
  committed loop log is valid and add-only against its git history" (peaceai/test/m146-loop.test.ts:118), which
  parses every row with parseLoopLog (peaceai/lib/looprow.ts:197) -> loopRowProblem (peaceai/lib/looprow.ts:119):
  schema, fixed code lists (code, attemptCodes, isolationFail), types and set rules, before anything is merged.
- (e) Recorded here. Box runs never count for model-v1 results: only a peace-model-v1-dev run on a hosted runner
  counts, and only if reachedTests > 0 (unchanged).

## Fix

1. Workflow (attempt job):
   - a fail-closed pre-flight after the M169 deps step, before the tools go read-only: proves the candidate can
     traverse and write a fresh 0750 work dir under /tmp (group cand), as the loop makes, and CANNOT read or traverse
     $RUNNER_TEMP, cannot read $HOME, and cannot read any file named `git-credentials*`, `.git-credentials` or
     `.gitconfig` under either (nor ~/.config/git/credentials); else `refused CAND_READS_*`. Fixed words and a count
     only. No chmod anywhere under /home/runner.
   - the userns step (ruling b) right before the loop step, and the in-wrapper proofs (ruling c) as the loop step's
     first command. m9 pin updated.
2. Loop (peaceai/lib/loop.ts, loopdeps.ts, looprow.ts):
   - per task, `openWorkDir` (loopdeps.ts) makes a fresh `mkdtemp(os.tmpdir()/peaceai-work-*)`, mode 0750, group the
     candidate's gid (owner plus candidate only), and probes that the candidate can traverse it and write a dir it
     owns there; else ISOLATION_UNAVAILABLE / WORK_DIR before anything is fetched. Removed after the task.
   - the fetcher makes the copy inside it (`CopyFetcher` gets the work dir as `base`). The copy is a fresh
     `git init` plus fetch by URL: no remote, no auth header, no credential helper.
   - `isolationProblem` (loop.ts) runs right after the fetch and again just before the baseline (after the install):
     the work dir has no "other" bits and holds the copy (WORK_DIR); the copy's .git/config names no extraheader,
     credential, askpass, sshCommand, insteadOf, include or `user@` URL (PRIVATE_CONFIG); no symlink in the copy, or
     in the installed trees its node_modules links point to, resolves lexically or by realpath into the runner's
     home, RUNNER_TEMP or the workspace checkout (PRIVATE_LINK); the candidate can enter and read the copy and (before
     the baseline) execute the wrapper (CAND_NO_ACCESS).
   - every failure is ISOLATION_UNAVAILABLE with attempts 0; the wrapper's exits keep their meaning (97 ->
     NO_NAMESPACES, 98 -> MOUNT_FAILED). There is no path that runs the tests without the wrapper or as the runner.
   - rows: optional `isolationFail` (v4, public ISOLATION_UNAVAILABLE rows only, a fixed code from
     LOOP_ISOLATION_FAILS), so the next run says which check failed. Hidden rows carry none.

## Tests

- m171-isolation.test.ts: the M171 cases (m171-cases.ts) with the real libs, plus the workflow step pinned, then
  executed on the box with a runner-like layout (passes) and with RUNNER_TEMP readable, RUNNER_TEMP traversable, the
  home readable, a found git-credentials file readable and git's credential store readable (each refuses); a
  mutation check deletes each `refused CAND_READS_*` line and requires a scenario to fail.
- m171-cases.ts: workspace, RUNNER_TEMP (with a credentials file) and the fetch sources under a 0750 dir the candidate
  cannot enter; two unrelated code shapes (a function, a class method) reach the baseline and PASS (reachedTests 2);
  near misses: a work dir under the 0750 dir (WORK_DIR, nothing fetched), a 0700 copy (CAND_NO_ACCESS), private links
  (workspace, RUNNER_TEMP, home, relative), credential configs, a 0755 work dir and a copy outside it (WORK_DIR), a
  private link that appears during the install (second check), no namespaces and a failing mount; every refusal has
  0 attempts, no baseline, no proposal and nothing written by a team test outside the isolation.
- m171-mutation.test.ts: deleting each `// m171-guard:` line of loop.ts, loopdeps.ts or looprow.ts makes a case fail.
- m171-proof.test.ts (m171-proof-cases.ts): the in-wrapper proofs pass on a runner-like layout and refuse each near
  miss (no network namespace, no read-only mounts, wrong uid, listable RUNNER_TEMP, readable credential file, exit
  97/98, a probe that never ran, a stray process, no RUNNER_TEMP, an unreachable work dir); the userns step executed;
  mutation of every proof guard and of the userns step's write, read-back and refusal.
- workflows.test.ts: the userns guard over every workflow (ruling a/b), with 12 refused near misses.

## Soundness note

- The change only adds refusals before candidate code runs and moves where the copy lives (a 0750 dir under /tmp
  instead of a 0700 one); the isolation itself (env -i, private HOME/TMPDIR, user + network + mount namespaces,
  read-only /tmp, /var/tmp, /dev/shm) is unchanged, and so is every pass/fail rule.
- The sysctl applies only on the attempt job's ephemeral VM, which holds no secret (no Results key, no weights,
  checkout with persist-credentials false, contents: read), right before the candidate step (Auditor ruling). The
  candidate already runs inside a user namespace by design; the restriction only stopped it from getting one. Any
  process on that VM could now make a user namespace, but nothing on it holds a credential to reach, and the
  in-wrapper proofs show the candidate still has no network, no write outside its work dir and no read of the
  runner's files before any attempt. If the value does not read back 0, the job refuses (CAND_NO_NAMESPACES).
- Nothing under /home/runner is chmod'ed; the pre-flight proves the candidate still cannot read RUNNER_TEMP, the home
  or any git-credentials file, and the loop refuses links into them. If the candidate uid cannot get namespaces, a
  mount, a reachable work dir or access to the copy, the task is ISOLATION_UNAVAILABLE with 0 attempts: never run
  with network, never run as the runner.
- Limits: the link walk follows directory links once and stops (refusing, PRIVATE_LINK) past 1,000,000 entries; the
  config check is a pattern list, which is defence in depth since the fetcher never writes credentials into the copy.
