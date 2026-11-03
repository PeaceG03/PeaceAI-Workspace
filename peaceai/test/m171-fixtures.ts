// M171 fixtures (run 41521457458: every task ISOLATION_UNAVAILABLE, 0 attempts). Two synthetic task repos of unrelated
// code shapes, not modeled on any public task repo or training repo, built in one os.tmpdir() scratch dir:
//   clamp: a plain function (src/clamp.ts clamp() forgets the upper bound);
//   stack: a class method (src/stack.ts Stack.pop() takes from the bottom).
// Like the hosted runner, the "workspace" (loop root), a fake RUNNER_TEMP holding a git-credentials file and the
// fetch sources all live under a 0750 dir the candidate uid cannot enter (`home`), so only the per-task work dir under
// os.tmpdir() can make the loop reach the tests. Each team test also tries to drop a file in `marker` (owned by the
// test runner): nothing may ever appear there (a run outside the isolation, or as this uid, would leave one).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PlanTask } from "../lib/plan.ts";
import { gitCopyFetcher, type CopyFetcher } from "../lib/loop.ts";
import { STAGE2_CAND_ENV, stage2CandUid, type CandUid } from "../lib/selfpropose.ts";
import { MIT } from "./m146-fixtures.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", [...G, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function buildRepo(dir: string, base: Record<string, string>, merge: Record<string, string>): { commit: string; merge: string } {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  const put = (files: Record<string, string>) => { for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); } };
  put(base); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "base");
  const commit = git(dir, "rev-parse", "HEAD");
  put(merge); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "reference");
  return { commit, merge: git(dir, "rev-parse", "HEAD") };
}

function task(id: string, repo: string, pins: { commit: string; merge: string }, request: string, src: string, test: string): PlanTask {
  return {
    id, repo, license: "MIT", licensePath: "LICENSE", licenseSha256: sha(MIT), commit: pins.commit, request,
    tests: { command: "node --test", files: [test] },
    reference: { from: { pr: 1, merge: pins.merge }, files: [{ path: src, change: "modify" }, { path: test, change: "add" }],
      steps: [{ action: "edit-source", file: src }, { action: "add-test", file: test }, { action: "run-tests", file: null }], docs: [] },
    trainingCheck: { workspaceCommit: "0".repeat(40), sources: 0, inTraining: false },
  };
}

export const CLAMP_FIXED = "export function clamp(x: number, lo: number, hi: number): number {\n  return Math.min(hi, Math.max(lo, x));\n}\n";
export const STACK_FIXED = "export class Stack<T> {\n  private items: T[] = [];\n  push(x: T): void {\n    this.items.push(x);\n  }\n  pop(): T | undefined {\n    return this.items.pop();\n  }\n  get size(): number {\n    return this.items.length;\n  }\n}\n";

export interface Ctx {
  base: string;
  /** 0750, owned by the test runner: the candidate uid cannot enter it (like /home/runner on the hosted runner). */
  home: string;
  /** the fake RUNNER_TEMP (0700) under `home`, holding a git-credentials file. */
  runnerTemp: string;
  /** owned by the test runner (0755): no file may ever appear in it. */
  marker: string;
  root: string;
  clamp: PlanTask;
  stack: PlanTask;
  fetcher: CopyFetcher;
  env: Record<string, string | undefined>;
  cand: CandUid | null;
  /** a dir holding a stub `unshare` that always fails, and one holding a stub `mount` that always fails. */
  noNs: string;
  noMount: string;
}

export function setup(): Ctx {
  const base = mkdtempSync(join(tmpdir(), "peaceai-m171-"));
  chmodSync(base, 0o755);
  const home = join(base, "home");
  mkdirSync(home);
  const marker = join(base, "marker");
  mkdirSync(marker);
  chmodSync(marker, 0o755);
  const runnerTemp = join(home, "work/_temp");
  mkdirSync(runnerTemp, { recursive: true });
  writeFileSync(join(runnerTemp, "git-credentials-m171.config"), "[http \"https://github.com/\"]\n\textraheader = AUTHORIZATION: basic bTE3MC1maXh0dXJlLW5vdC1hLXRva2Vu\n");
  chmodSync(runnerTemp, 0o700);
  const drop = (name: string) => `try { (await import("node:fs")).writeFileSync(${JSON.stringify(join(marker, name))}, String(process.getuid?.())); } catch { /* expected: never writable from the isolation */ }\n`;
  const pkg = JSON.stringify({ name: "m171-fixture", private: true, type: "module", scripts: { test: "node --test" } }, null, 1) + "\n";
  const clampPins = buildRepo(join(home, "repos/clamp"), {
    "package.json": pkg, LICENSE: MIT,
    // M175: the bug is one wrong operand (x for hi), so the fix stays inside the edit-scope gate's vocabulary axis
    "src/clamp.ts": "export function clamp(x: number, lo: number, hi: number): number {\n  return Math.min(x, Math.max(lo, x));\n}\n",
  }, {
    "src/clamp.ts": CLAMP_FIXED,
    "test/clamp.test.ts": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { clamp } from "../src/clamp.ts";\n${drop("clamp")}\ntest("clamp keeps values inside the range", () => assert.equal(clamp(5, 0, 10), 5));\ntest("clamp caps values above the range", () => assert.equal(clamp(15, 0, 10), 10));\n`,
  });
  const stackPins = buildRepo(join(home, "repos/stack"), {
    "package.json": pkg, LICENSE: MIT,
    "src/stack.ts": STACK_FIXED.replace("this.items.pop()", "this.items.shift()"),
  }, {
    "src/stack.ts": STACK_FIXED,
    "test/stack.test.ts": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { Stack } from "../src/stack.ts";\n${drop("stack")}\ntest("pop returns the last pushed item", () => { const s = new Stack<number>(); s.push(1); s.push(2); s.push(3); assert.equal(s.pop(), 3); assert.equal(s.size, 2); });\ntest("pop on an empty stack is undefined", () => assert.equal(new Stack<string>().pop(), undefined));\n`,
  });
  const clamp = task("m171-clamp", "m171-fixture/clamp", clampPins, "Make clamp in src/clamp.ts also cap values above the upper bound.", "src/clamp.ts", "test/clamp.test.ts");
  const stack = task("m171-stack", "m171-fixture/stack", stackPins, "Make Stack.pop in src/stack.ts return the most recently pushed item.", "src/stack.ts", "test/stack.test.ts");
  const root = join(home, "work/ws/root");
  mkdirSync(join(root, "peaceai/plan"), { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "secret.txt"), "m171 fixture workspace file\n");
  chmodSync(home, 0o750); // the simulated runner home: neither "other" nor the candidate's group may enter
  const stub = (name: string, tool: string) => {
    const d = join(base, name);
    mkdirSync(d);
    writeFileSync(join(d, tool), "#!/bin/sh\nexit 1\n");
    chmodSync(d, 0o755);
    chmodSync(join(d, tool), 0o755);
    return d;
  };
  const env = { ...process.env, [STAGE2_CAND_ENV]: process.env.M171_CAND ?? process.env.M146_CAND ?? "", RUNNER_TEMP: runnerTemp };
  const c = stage2CandUid(env);
  return {
    base, home, runnerTemp, marker, root, clamp, stack, env, cand: c.ok ? c.cand : null,
    noNs: stub("nons", "unshare"), noMount: stub("nomount", "mount"),
    fetcher: gitCopyFetcher((r) => join(home, "repos", r.split("/")[1]!)),
  };
}

export function teardown(ctx: Ctx): void {
  execFileSync("sudo", ["-n", "rm", "-rf", "--", ctx.base], { stdio: "ignore" });
  rmSync(ctx.base, { recursive: true, force: true });
}
