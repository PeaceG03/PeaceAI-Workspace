// M146 fixtures: tiny synthetic task repos (built in one os.tmpdir() scratch dir, never inside this repository), in
// the plan-only task format, with a local fetcher. Not modeled on any public task repo or any training repo.
//   calc:  src/calc.ts add() subtracts; the team's test (the "merge" commit) wants a sum. A known-correct edit passes,
//          a wrong edit fails every attempt.
//   jail:  the team's tests assert the isolation itself: writes outside the copy fail, no network (not even a
//          loopback server the test host opens), no secrets in the environment.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PlanTask, PlanTaskFile } from "../lib/plan.ts";
import { gitCopyFetcher, type CopyFetcher } from "../lib/loop.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";

export const MIT = `MIT License\n\nCopyright (c) 2026 M146 fixture\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software, to deal in the\nSoftware without restriction. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", [...G, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** A two-commit repo: `base` files at the pinned commit, then `merge` files on top (the reference change). */
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

export const CALC_FIXED = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
export const CALC_WRONG = "export function add(a: number, b: number): number {\n  return a * b;\n}\n";
export const FLAG_FIXED = "export function ready(): boolean {\n  return true;\n}\n";
export const SECRET_NAME = "PEACEAI_M146_FAKE_SECRET";

export interface Ctx {
  base: string;
  /** Owned by the test runner; the candidate must not be able to create anything here. */
  marker: string;
  port: number;
  /** Connections the host's loopback server has seen (the candidate must never reach it). */
  hits: () => number;
  calc: PlanTask;
  jail: PlanTask;
  file: PlanTaskFile;
  fetcher: CopyFetcher;
  root: string;
  /** A plain dir for the edit-path guards: src/calc.ts, .git/config, link-in -> src/calc.ts, out -> the marker dir. */
  edits: string;
  /** The stage-2 candidate uid is usable here (box and the private job; not the CI test job). */
  cand: boolean;
  env: Record<string, string | undefined>;
  /** A dir holding a stub `unshare` that always fails (to prove the loop fails closed without namespaces). */
  noNs: string;
}

export function setup(port: number, hits: () => number): Ctx {
  const base = mkdtempSync(join(tmpdir(), "peaceai-m146-"));
  chmodSync(base, 0o755);
  const marker = join(base, "marker");
  mkdirSync(marker);
  chmodSync(marker, 0o755);
  const pkg = JSON.stringify({ name: "fixture", private: true, type: "module", scripts: { test: "node --test" } }, null, 1) + "\n";
  const calcPins = buildRepo(join(base, "repos/calc"), {
    "package.json": pkg, LICENSE: MIT,
    "src/calc.ts": "export function add(a: number, b: number): number {\n  return a - b;\n}\n",
  }, {
    "src/calc.ts": CALC_FIXED,
    "test/calc.test.ts": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/calc.ts";\n\ntest("add sums two numbers", () => assert.equal(add(2, 3), 5));\ntest("add keeps the other number for zero", () => assert.equal(add(0, 4), 4));\n`,
  });
  const targets = [join(marker, "from-candidate"), "../peaceai-m146-escape", "/tmp/peaceai-m146-escape", "/var/tmp/peaceai-m146-escape", "/dev/shm/peaceai-m146-escape", "src/written-in-copy.ts"];
  const jailPins = buildRepo(join(base, "repos/jail"), {
    "package.json": pkg, LICENSE: MIT,
    "src/flag.ts": "export function ready(): boolean {\n  return false;\n}\n",
  }, {
    "src/flag.ts": FLAG_FIXED,
    "test/jail.test.ts": [
      `import test from "node:test";`, `import assert from "node:assert/strict";`, `import fs from "node:fs";`, `import net from "node:net";`, `import { ready } from "../src/flag.ts";`,
      `const connect = (port: number, host: string) => new Promise((ok, fail) => { const s = net.connect({ port, host, timeout: 3000 }); s.on("connect", () => { s.destroy(); ok(true); }); s.on("timeout", () => { s.destroy(); fail(new Error("timeout")); }); s.on("error", fail); });`,
      `test("ready", () => assert.equal(ready(), true));`,
      `test("writes outside the copy fail", () => { for (const p of ${JSON.stringify(targets)}) assert.throws(() => fs.writeFileSync(p, "x"), p); });`,
      `test("the private temp dir is writable", () => { fs.writeFileSync(process.env.TMPDIR + "/ok", "x"); });`,
      `test("no network: the host's loopback server is unreachable", async () => { await assert.rejects(connect(${port}, "127.0.0.1")); });`,
      `test("no network: an outside address is unreachable", async () => { await assert.rejects(connect(443, "1.1.1.1")); });`,
      `test("no secrets in the environment", () => { assert.equal(process.env.${SECRET_NAME}, undefined); assert.equal(process.env.GITHUB_TOKEN, undefined); const extra = Object.keys(process.env).filter((k) => !["PATH", "HOME", "LANG", "TZ", "TMPDIR", "PEACEAI_SELF_SANDBOX", "CI", "PWD", "SHLVL", "_", "OLDPWD", "NODE_USE_SYSTEM_CA"].includes(k) && !/^NODE_TEST_/.test(k)); assert.deepEqual(extra, []); });`,
      "",
    ].join("\n"),
  });
  const calc = task("m146-calc", "m146-fixture/calc", calcPins, "Fix add in src/calc.ts so that it returns the sum of its two arguments.", "src/calc.ts", "test/calc.test.ts");
  const jail = task("m146-jail", "m146-fixture/jail", jailPins, "Make ready in src/flag.ts return true once the module is loaded.", "src/flag.ts", "test/jail.test.ts");
  const file: PlanTaskFile = { schema: "peaceai-plan-tasks:v1" as PlanTaskFile["schema"], set: "public", tasks: [calc] };
  // a scratch root with an empty committed log (lock tests)
  const root = join(base, "root");
  mkdirSync(join(root, "peaceai/plan"), { recursive: true });
  git(root, "init", "-q", "-b", "main");
  const edits = join(base, "edits");
  for (const d of ["src", ".git"]) mkdirSync(join(edits, d), { recursive: true });
  writeFileSync(join(edits, "src/calc.ts"), "x\n");
  writeFileSync(join(edits, ".git/config"), "x\n");
  symlinkSync("src/calc.ts", join(edits, "link-in"));
  symlinkSync(marker, join(edits, "out"));
  const noNs = join(base, "nons");
  mkdirSync(noNs);
  writeFileSync(join(noNs, "unshare"), "#!/bin/sh\nexit 1\n");
  chmodSync(noNs, 0o755);
  chmodSync(join(noNs, "unshare"), 0o755);
  const env = { ...process.env, [STAGE2_CAND_ENV]: process.env.M146_CAND ?? "peaceai-cand" };
  const cand = stage2CandUid(env).ok;
  return { base, marker, port, hits, calc, jail, file, edits, cand, env, noNs, fetcher: gitCopyFetcher((r) => join(base, "repos", r.split("/")[1]!)), root };
}

export function teardown(ctx: Ctx): void {
  for (const p of ["/tmp/peaceai-m146-escape", "/var/tmp/peaceai-m146-escape", "/dev/shm/peaceai-m146-escape"]) rmSync(p, { force: true });
  rmSync(ctx.base, { recursive: true, force: true });
}
