// M152 fixtures: a scratch dir (os.tmpdir(), never inside this repository) for the pure proposer cases, plus one tiny
// synthetic node:test task repo (not modeled on any scorecard task or training repo) for the loop case:
//   window: src/window.ts lastN() drops one item (an off-by-one); the team's test (the "merge" commit) wants n items.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PlanTask } from "../lib/plan.ts";
import { gitCopyFetcher, type CopyFetcher } from "../lib/loop.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";

const MIT = `MIT License\n\nCopyright (c) 2026 M152 fixture\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software, to deal in the\nSoftware without restriction. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", [...G, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

export interface M152Ctx { base: string; root: string; task: PlanTask; fetcher: CopyFetcher; env: Record<string, string | undefined>; cand: boolean }

export function setup(): M152Ctx {
  const base = mkdtempSync(join(tmpdir(), "peaceai-m152-"));
  chmodSync(base, 0o755);
  const dir = join(base, "repos/window");
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  const put = (files: Record<string, string>) => { for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); } };
  put({
    "package.json": JSON.stringify({ name: "fixture", private: true, type: "module", scripts: { test: "node --test" } }, null, 1) + "\n", LICENSE: MIT,
    "src/window.ts": "export function lastN<T>(xs: readonly T[], n: number): T[] {\n  if (n <= 0) return [];\n  return xs.slice(xs.length - n + 1);\n}\n",
  });
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "base");
  const commit = git(dir, "rev-parse", "HEAD");
  put({
    "src/window.ts": "export function lastN<T>(xs: readonly T[], n: number): T[] {\n  if (n <= 0) return [];\n  return xs.slice(xs.length - n);\n}\n",
    "test/window.test.ts": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { lastN } from "../src/window.ts";\n\ntest("lastN returns n items", () => assert.deepEqual(lastN([1, 2, 3], 2), [2, 3]));\ntest("lastN of zero is empty", () => assert.deepEqual(lastN([1, 2, 3], 0), []));\ntest("lastN of one", () => assert.deepEqual(lastN([1, 2, 3], 1), [3]));\n`,
  });
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "reference");
  const merge = git(dir, "rev-parse", "HEAD");
  const task: PlanTask = {
    id: "m152-window", repo: "m152-fixture/window", license: "MIT", licensePath: "LICENSE", licenseSha256: sha(MIT), commit,
    request: "`lastN([1, 2, 3], 2)` returns one item instead of two: it must return the last n items.",
    tests: { command: "node --test", files: ["test/window.test.ts"] },
    reference: { from: { pr: 1, merge }, files: [{ path: "src/window.ts", change: "modify" }, { path: "test/window.test.ts", change: "add" }],
      steps: [{ action: "edit-source", file: "src/window.ts" }, { action: "add-test", file: "test/window.test.ts" }, { action: "run-tests", file: null }], docs: [] },
    trainingCheck: { workspaceCommit: "0".repeat(40), sources: 0, inTraining: false },
  };
  const root = join(base, "root");
  mkdirSync(join(root, "peaceai/plan"), { recursive: true });
  git(root, "init", "-q", "-b", "main");
  const env = { ...process.env, [STAGE2_CAND_ENV]: process.env.M152_CAND ?? process.env.M146_CAND ?? "peaceai-cand" };
  return { base, root, task, fetcher: gitCopyFetcher((r) => join(base, "repos", r.split("/")[1]!)), env, cand: stage2CandUid(env).ok };
}

export function teardown(ctx: M152Ctx): void { rmSync(ctx.base, { recursive: true, force: true }); }
