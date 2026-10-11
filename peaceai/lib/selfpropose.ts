// M11: the proposal run itself (called by peaceai/bin/self-change.ts only after selfChangeAllowedHere passes).
// It makes a FRESH clone of the source at the base commit, applies the change there, runs the LIVE suite (the base
// commit's peaceai/test/*.test.ts, restored from the base) plus new peaceai/self-tests, and writes the record and
// a git bundle of the exact candidate commit (so the promotion PR head can be that tested commit).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetMinutes, checkSelfChangeDiff, listSha, SELF_SCHEMA, sha256, type SelfChangeRecord, type TestRun } from "./selfchange.ts";

const NOREPLY = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 }).trim();

/** The suite runs as a fresh top-level test run with a minimal environment (no inherited credentials). */
function suiteEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "LANG", "TZ", "TMPDIR"];
  const env: NodeJS.ProcessEnv = { PEACEAI_SELF_SANDBOX: "1", CI: "true" };
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return env;
}

function runSuite(cwd: string, suite: "live" | "new", files: string[], deadline: number): TestRun {
  if (files.length === 0) return { suite, files, filesSha256: listSha(files), exitCode: 0, pass: 0, fail: 0 };
  const left = Math.max(1000, deadline - Date.now());
  const r = spawnSync(join(cwd, "node_modules/.bin/tsx"), ["--test", "--test-reporter=tap", ...files], { cwd, encoding: "utf8", timeout: left, maxBuffer: 1 << 28, env: suiteEnv() });
  const num = (k: string) => Number(new RegExp(`^# ${k} (\\d+)$`, "m").exec(r.stdout ?? "")?.[1] ?? 0);
  return { suite, files, filesSha256: listSha(files), exitCode: r.status ?? 124, pass: num("pass"), fail: num("fail") + (r.status === null ? 1 : 0) };
}

export interface ProposeOptions { id: string; diff: string; source: string; base: string; out: string; budget?: string; nodeModules?: string }
export interface ProposeResult { code: 0 | 2 | 3; message: string; record: SelfChangeRecord }

export function proposeInSandbox(o: ProposeOptions): ProposeResult {
  const deadline = Date.now() + budgetMinutes(o.budget) * 60_000;
  const check = checkSelfChangeDiff(o.diff);
  const rec: SelfChangeRecord = {
    schema: SELF_SCHEMA, id: o.id, baseSha: "", candidateSha: "", diffSha256: sha256(o.diff), paths: check.paths, check,
    liveSuite: { baseSha: "", filesSha256: "" }, tests: [], status: "refused",
    rollback: { kind: "revert", of: null, command: `peaceai/bin/self-change.ts rollback --record self-changes/${o.id}.json --repo <clone of main>` },
    createdAt: new Date().toISOString(),
  };
  const write = () => {
    mkdirSync(join(o.out, "self-changes"), { recursive: true });
    writeFileSync(join(o.out, "self-changes", `${o.id}.json`), JSON.stringify(rec, null, 1) + "\n");
  };
  if (!check.ok) {
    write();
    return { code: 2, record: rec, message: `self-change propose id=${o.id} status=refused refusals=${check.refusals.length}\n${check.refusals.map((r) => `  ${r.path}: ${r.reason}`).join("\n")}` };
  }
  const box = mkdtempSync(join(tmpdir(), "peaceai-self-"));
  try {
    execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--no-checkout", o.source, box], { stdio: "ignore" });
    rec.baseSha = git(box, "rev-parse", `${o.base}^{commit}`);
    rec.liveSuite.baseSha = rec.baseSha;
    git(box, "checkout", "--quiet", "--detach", rec.baseSha);
    git(box, "remote", "remove", "origin");
    const liveFiles = git(box, "ls-tree", "-r", "--name-only", rec.baseSha, "peaceai/test/").split("\n").filter((f) => /\.test\.ts$/.test(f));
    rec.liveSuite.filesSha256 = listSha(liveFiles);
    if (o.nodeModules && existsSync(o.nodeModules)) symlinkSync(o.nodeModules, join(box, "node_modules"), "dir");
    else execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: box, stdio: "ignore", env: suiteEnv() });
    writeFileSync(join(box, ".self.patch"), o.diff);
    try { git(box, "apply", "--index", "--whitespace=nowarn", ".self.patch"); } catch {
      rec.check = { ...check, ok: false, refusals: [{ path: "-", reason: "patch does not apply to the base" }] };
      write();
      return { code: 2, record: rec, message: `self-change propose id=${o.id} status=refused reason=PATCH_DOES_NOT_APPLY` };
    }
    rmSync(join(box, ".self.patch"));
    git(box, ...NOREPLY, "commit", "--quiet", "--no-verify", "-m", `self-change ${o.id}`);
    rec.candidateSha = git(box, "rev-parse", "HEAD");
    mkdirSync(join(o.out, "self-changes"), { recursive: true });
    git(box, "bundle", "create", join(o.out, "self-changes", `${o.id}.bundle`), `${rec.baseSha}..HEAD`);
    git(box, "checkout", rec.baseSha, "--", "peaceai/test");
    rec.tests.push(runSuite(box, "live", liveFiles, deadline));
    const newFiles = git(box, "ls-files", "peaceai/self-tests").split("\n").filter((f) => /\.test\.ts$/.test(f));
    rec.tests.push(runSuite(box, "new", newFiles, deadline));
    rec.status = rec.tests.every((t) => t.exitCode === 0 && t.fail === 0) && rec.tests[0]!.pass > 0 ? "awaiting-review" : "tested-failing";
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
  write();
  const t = rec.tests.map((x) => `${x.suite}:pass=${x.pass},fail=${x.fail},exit=${x.exitCode}`).join(" ");
  return { code: rec.status === "awaiting-review" ? 0 : 3, record: rec, message: `self-change propose id=${o.id} status=${rec.status} base=${rec.baseSha.slice(0, 12)} candidate=${rec.candidateSha.slice(0, 12)} ${t}` };
}
