// M171 (Auditor ruling, condition c): the isolation proof cases (lib/loopdeps.ts runIsolationProofs, run by `bin/loop.ts proofs`), shared by m171-proof.test.ts and
// its mutation check. Each proof has a refused near miss: a probe started without the wrapper's namespaces (net,
// write), a wrong expected uid, a RUNNER_TEMP the candidate can list, a credential file it can read; plus the wrapper
// exits 97 / 98, a probe that never ran, no RUNNER_TEMP, an unreachable work dir and a stray candidate process.
// They run as the stage-2 candidate uid (sudo); without it they are skipped.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type * as IsoProof from "../lib/loopdeps.ts";
import type { CandUid } from "../lib/selfpropose.ts";

const ROOT = resolve(import.meta.dirname, "../..");
export interface ProofCase { id: string; run: (p: typeof IsoProof, cand: CandUid, runnerWrapper: (u: number, g: number) => string) => Promise<void> }
const PASSTHROUGH = () => '#!/bin/sh\nexec node "$@"\n';
const exits = (n: number) => () => `#!/bin/sh\nexit ${n}\n`;

/** A runner-like layout: <base 0700|0755>/runner (home, 0711) with work/_temp (RUNNER_TEMP) and a credentials file in it. */
function runnerDirs(o: { base?: number; temp?: number; cred?: number } = {}) {
  const base = mkdtempSync(join(tmpdir(), "peaceai-m171-proof-"));
  const home = join(base, "runner");
  const temp = join(home, "work/_temp");
  mkdirSync(temp, { recursive: true });
  writeFileSync(join(temp, "git-credentials-0000.config"), "[http]\n\textraheader = AUTHORIZATION: basic bTE3MQ==\n", { mode: o.cred ?? 0o600 });
  chmodSync(join(temp, "git-credentials-0000.config"), o.cred ?? 0o600);
  chmodSync(temp, o.temp ?? 0o700);
  chmodSync(join(home, "work"), 0o755);
  chmodSync(home, 0o711);
  chmodSync(base, o.base ?? 0o700);
  return { base, home, temp, done: () => { chmodSync(base, 0o755); chmodSync(home, 0o755); chmodSync(temp, 0o755); rmSync(base, { recursive: true, force: true }); } };
}
type Wrap = (u: number, g: number) => string;
async function proofs(p: typeof IsoProof, cand: CandUid, rw: Wrap, d: ReturnType<typeof runnerDirs>, extra: Partial<IsoProof.ProofOptions> = {}) {
  try { return await p.runIsolationProofs(cand, { env: { RUNNER_TEMP: d.temp }, root: ROOT, home: d.home, wrapper: rw, ...extra }); } finally { d.done(); }
}
const failedOnly = (r: IsoProof.ProofResult, which: IsoProof.Proof) => {
  assert.equal(r.ok, false);
  assert.equal(r.refusal, "PROOF_FAILED");
  assert.equal(r.proofs[which], "fail", `${which} must fail`);
};

export const PROOF_CASES: ProofCase[] = [
  {
    id: "inside the real wrapper on a runner-like layout: every proof passes (the credentials file was checked)",
    run: async (p, cand, rw) => {
      const r = await proofs(p, cand, rw, runnerDirs());
      assert.equal(r.refusal, null);
      assert.equal(r.ok, true);
      assert.deepEqual(r.proofs, { net: "pass", uid: "pass", write: "pass", "runner-temp": "pass", "git-credentials": "pass" });
      assert.ok(r.credFiles >= 1);
    },
  },
  { id: "near miss net: the probe started without the wrapper's network namespace reaches the 127.0.0.1 listener -> PROOF_FAILED net", run: async (p, cand, rw) => failedOnly(await proofs(p, cand, rw, runnerDirs(), { wrapper: PASSTHROUGH }), "net") },
  { id: "near miss write: without the wrapper's read-only mounts the probe can write /var/tmp, /dev/shm or the work dir's parent -> PROOF_FAILED write", run: async (p, cand, rw) => failedOnly(await proofs(p, cand, rw, runnerDirs(), { wrapper: PASSTHROUGH }), "write") },
  { id: "near miss uid: the probe does not run as the expected uid -> PROOF_FAILED uid", run: async (p, cand, rw) => failedOnly(await proofs(p, cand, rw, runnerDirs(), { expectUid: cand.uid + 1 }), "uid") },
  {
    id: "near miss runner-temp: a RUNNER_TEMP the candidate can list -> PROOF_FAILED runner-temp (credentials still unreadable)",
    run: async (p, cand, rw) => { const r = await proofs(p, cand, rw, runnerDirs({ base: 0o755, temp: 0o755 })); failedOnly(r, "runner-temp"); assert.equal(r.proofs["git-credentials"], "pass"); },
  },
  {
    id: "near miss git-credentials: a credentials file the candidate can read (RUNNER_TEMP traversable, not listable) -> PROOF_FAILED git-credentials",
    run: async (p, cand, rw) => { const r = await proofs(p, cand, rw, runnerDirs({ base: 0o755, temp: 0o711, cred: 0o644 })); failedOnly(r, "git-credentials"); assert.equal(r.proofs["runner-temp"], "pass"); },
  },
  { id: "the wrapper cannot make its namespaces (exit 97) -> CAND_NO_NAMESPACES, no proof reported", run: async (p, cand, rw) => { const r = await proofs(p, cand, rw, runnerDirs(), { wrapper: exits(97) }); assert.equal(r.refusal, "CAND_NO_NAMESPACES"); assert.equal(r.ok, false); assert.deepEqual(r.proofs, {}); } },
  { id: "the wrapper cannot mount (exit 98) -> CAND_NO_MOUNT", run: async (p, cand, rw) => { const r = await proofs(p, cand, rw, runnerDirs(), { wrapper: exits(98) }); assert.equal(r.refusal, "CAND_NO_MOUNT"); assert.equal(r.ok, false); } },
  {
    id: "a probe that never ran (wrapper exits 0, or 1) -> PROOF_ERROR, never ok",
    run: async (p, cand, rw) => {
      for (const n of [0, 1, 124]) { const r = await proofs(p, cand, rw, runnerDirs(), { wrapper: exits(n) }); assert.equal(r.refusal, "PROOF_ERROR", `exit ${n}`); assert.equal(r.ok, false); }
    },
  },
  {
    id: "a stray candidate process left behind by the wrapper -> PROOF_LEFTOVERS",
    run: async (p, cand, rw) => {
      const leaky = (u: number, g: number) => rw(u, g).replace("#!/bin/sh\n", "#!/bin/sh\n(setsid sleep 30 > /dev/null 2>&1 &)\n");
      const r = await proofs(p, cand, rw, runnerDirs(), { wrapper: leaky });
      assert.equal(r.refusal, "PROOF_LEFTOVERS");
      assert.equal(r.ok, false);
    },
  },
  {
    id: "no RUNNER_TEMP (unset or missing) -> NO_RUNNER_TEMP before anything runs",
    run: async (p, cand, rw) => {
      assert.equal((await p.runIsolationProofs(cand, { env: {}, root: ROOT, wrapper: rw })).refusal, "NO_RUNNER_TEMP");
      assert.equal((await p.runIsolationProofs(cand, { env: { RUNNER_TEMP: join(tmpdir(), "peaceai-m171-absent-x") }, root: ROOT, wrapper: rw })).refusal, "NO_RUNNER_TEMP");
    },
  },
  {
    id: "a work dir base the candidate cannot reach -> WORK_DIR",
    run: async (p, cand, rw) => {
      const shut = mkdtempSync(join(tmpdir(), "peaceai-m171-shut-"));
      chmodSync(shut, 0o700);
      try { const r = await proofs(p, cand, rw, runnerDirs(), { workBase: shut }); assert.equal(r.refusal, "WORK_DIR"); assert.equal(r.ok, false); } finally { rmSync(shut, { recursive: true, force: true }); }
    },
  },
];
