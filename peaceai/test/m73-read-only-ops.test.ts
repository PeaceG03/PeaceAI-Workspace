// M73 READ_ONLY_OPS: bounded allowlist, GET only, no writes or dispatches, every action logged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_ITEMS, opsEnabled, OPS_REPOS, planOp, READ_ONLY_OPS, runOp, type OpLogEntry } from "../lib/read-only-ops.ts";

const root = join(import.meta.dirname, "..", "..");
const WS = "PeaceG03/PeaceAI-Workspace";
const SHA = "a".repeat(40);
const now = () => new Date("2026-10-17T03:00:00Z");

test("allowlist is exactly the four read ops on the two public targets", () => {
  assert.deepEqual(Object.keys(READ_ONLY_OPS).sort(), ["check_runs", "failed_jobs", "recent_runs", "run_status"]);
  assert.deepEqual([...OPS_REPOS], ["PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"]);
});

test("planOp builds fixed GET paths", () => {
  assert.deepEqual(planOp("run_status", WS, { run: "123" }), { ok: true, path: `repos/${WS}/actions/runs/123` });
  assert.deepEqual(planOp("failed_jobs", WS, { run: "123" }), { ok: true, path: `repos/${WS}/actions/runs/123/jobs?filter=latest&per_page=${MAX_ITEMS}` });
  assert.deepEqual(planOp("recent_runs", WS, {}), { ok: true, path: `repos/${WS}/actions/runs?per_page=20` });
  assert.deepEqual(planOp("recent_runs", "PeaceG03/PeaceSTOCKS", { workflow: "ci.yml", branch: "main", status: "failure" }), { ok: true, path: "repos/PeaceG03/PeaceSTOCKS/actions/workflows/ci.yml/runs?per_page=20&branch=main&status=failure" });
  assert.deepEqual(planOp("check_runs", WS, { sha: SHA }), { ok: true, path: `repos/${WS}/commits/${SHA}/check-runs?per_page=${MAX_ITEMS}` });
});

test("refusals: write/dispatch ops, other repos, bad or extra args (by name)", () => {
  for (const op of ["rerun", "rerun_failed_jobs", "cancel", "dispatch", "workflow_dispatch", "delete_run", "download_logs", "comment", "merge", "approve", "__proto__", "constructor", "toString", ""])
    assert.deepEqual(planOp(op, WS, { run: "1" }), { ok: false, reason: "op_not_allowlisted" }, op);
  for (const repo of ["PeaceG03/PeaceAI-Results", "PeaceG03/PeaceAI", "someone/PeaceAI-Workspace", "PeaceG03/PeaceAI-Workspace/../x", ""])
    assert.deepEqual(planOp("run_status", repo, { run: "1" }), { ok: false, reason: "repo_not_allowlisted" }, repo);
  const bad: [string, Record<string, string>, string][] = [
    ["run_status", {}, "missing_arg:run"], ["run_status", { run: "0" }, "bad_arg:run"], ["run_status", { run: "1/rerun" }, "bad_arg:run"], ["run_status", { run: "1?x=1" }, "bad_arg:run"],
    ["run_status", { run: "1", method: "POST" }, "unknown_arg:method"], ["check_runs", { sha: "abc" }, "bad_arg:sha"], ["check_runs", { sha: SHA.toUpperCase() }, "bad_arg:sha"],
    ["recent_runs", { branch: "a/../b" }, "bad_arg:branch"], ["recent_runs", { branch: "x y" }, "bad_arg:branch"], ["recent_runs", { workflow: "../ci.yml" }, "bad_arg:workflow"],
    ["recent_runs", { workflow: "ci.yml/dispatches" }, "bad_arg:workflow"], ["recent_runs", { status: "requested" }, "bad_arg:status"],
  ];
  for (const [op, args, reason] of bad) assert.deepEqual(planOp(op, WS, args), { ok: false, reason }, `${op} ${JSON.stringify(args)}`);
});

test("runOp: one log entry per call; GET only with the planned path; refused/disabled never reach the getter", async () => {
  const logs: OpLogEntry[] = []; const gets: string[] = [];
  const push = (e: OpLogEntry) => { logs.push(e); };
  const get = async (p: string) => { gets.push(p); return { id: 9, status: "completed", conclusion: "failure", logs_url: "x", token: "secret", head_sha: SHA }; };
  const ok = await runOp("run_status", WS, { run: "9" }, get, push, { enabled: true, now });
  assert.deepEqual(ok, { ok: true, op: "run_status", data: { id: 9, name: null, status: "completed", conclusion: "failure", event: null, head_branch: null, head_sha: SHA, run_attempt: null, created_at: null, updated_at: null, html_url: null } });
  assert.deepEqual(gets, [`repos/${WS}/actions/runs/9`]);
  assert.deepEqual(logs, [{ at: "2026-10-17T03:00:00.000Z", op: "run_status", repo: WS, args: { run: "9" }, ok: true, reason: null, path: `repos/${WS}/actions/runs/9`, items: 1 }]);
  assert.deepEqual(await runOp("rerun", WS, { run: "9" }, get, push, { enabled: true, now }), { ok: false, op: "rerun", reason: "op_not_allowlisted" });
  assert.deepEqual(await runOp("run_status", WS, { run: "9" }, get, push, { enabled: false, now }), { ok: false, op: "run_status", reason: "ops_disabled" });
  assert.deepEqual(await runOp("run_status", WS, { run: "9" }, async () => { throw new Error("boom"); }, push, { enabled: true, now }), { ok: false, op: "run_status", reason: "get_failed" });
  assert.equal(gets.length, 1);
  assert.deepEqual(logs.map((l) => [l.ok, l.reason]), [[true, null], [false, "op_not_allowlisted"], [false, "ops_disabled"], [false, "get_failed"]]);
});

test("projections: failed jobs keep only failed jobs and step names; lists are capped", async () => {
  const jobs = { jobs: [{ id: 1, name: "test", conclusion: "failure", steps: [{ name: "npm test", conclusion: "failure", log: "x" }, { name: "setup", conclusion: "success" }] }, { id: 2, name: "lint", conclusion: "success" }] };
  const r = await runOp("failed_jobs", WS, { run: "5" }, async () => jobs, () => {}, { enabled: true, now });
  assert.deepEqual(r, { ok: true, op: "failed_jobs", data: [{ id: 1, name: "test", status: null, conclusion: "failure", started_at: null, completed_at: null, html_url: null, failed_steps: ["npm test"] }] });
  const many = { workflow_runs: Array.from({ length: 80 }, (_, i) => ({ id: i })) };
  const runs = await runOp("recent_runs", WS, {}, async () => many, () => {}, { enabled: true, now });
  assert.ok(runs.ok && (runs.data as unknown[]).length === MAX_ITEMS);
  const odd = await runOp("check_runs", WS, { sha: SHA }, async () => "not json object", () => {}, { enabled: true, now });
  assert.deepEqual(odd, { ok: true, op: "check_runs", data: [] });
});

test("enable file: off on main until its approval PR; strict schema", () => {
  const c = JSON.parse(readFileSync(join(root, "peaceai/read-only-ops.json"), "utf8"));
  assert.ok([false, true].includes(c.enabled) && c.schema === "peaceai-read-only-ops:v1");
  const dir = mkdtempSync(join(tmpdir(), "m73-"));
  try {
    const f = join(dir, "c.json");
    const w = (x: unknown) => { writeFileSync(f, JSON.stringify(x)); return opsEnabled(f); };
    assert.equal(w({ schema: "peaceai-read-only-ops:v1", enabled: true }), true);
    assert.equal(w({ schema: "peaceai-read-only-ops:v1", enabled: "true" }), false);
    assert.equal(w({ schema: "peaceai-read-only-ops:v1", enabled: true, ops: ["rerun"] }), false);
    assert.equal(w({ schema: "x", enabled: true }), false);
    assert.equal(opsEnabled(join(dir, "missing.json")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("source pins: no write verbs or dispatch endpoints; the CLI's only call is gh api --method GET", () => {
  const lib = readFileSync(join(root, "peaceai/lib/read-only-ops.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(lib, /\b(POST|PUT|PATCH|DELETE)\b|dispatches|\/rerun|\/cancel|\/logs|execFile|spawn|fetch\(/);
  const bin = readFileSync(join(root, "peaceai/bin/read-only-ops.ts"), "utf8");
  assert.equal(bin.match(/execFileSync\(/g)?.length, 1);
  assert.match(bin, /execFileSync\("gh", \["api", "--method", "GET", path\]/);
  assert.doesNotMatch(bin.replace(/^\s*\/\/.*$/gm, ""), /spawn|--field|-f |--input|-X /);
});

test("CLI: refused and logged when disabled, without calling gh", { skip: opsEnabled() }, () => {
  const dir = mkdtempSync(join(tmpdir(), "m73-cli-"));
  try {
    const log = join(dir, "ops.jsonl");
    const marker = join(dir, "gh-called");
    writeFileSync(join(dir, "gh"), `#!/bin/sh\ntouch "${marker}"\necho '{}'\n`); chmodSync(join(dir, "gh"), 0o755);
    const r = spawnSync(join(root, "node_modules/.bin/tsx"), [join(root, "peaceai/bin/read-only-ops.ts"), "run_status", WS, "run=1"], { encoding: "utf8", env: { ...process.env, PEACEAI_OPS_LOG: log, PATH: `${dir}:${process.env.PATH}` } });
    assert.equal(r.status, 2);
    assert.equal(existsSync(marker), false, "gh never called");
    const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => [l.op, l.ok, l.reason]), [["run_status", false, "ops_disabled"]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI (enabled): exactly one gh call, `api --method GET <planned path>`, logged", { skip: !opsEnabled() }, () => {
  const dir = mkdtempSync(join(tmpdir(), "m73-cli-on-"));
  try {
    const log = join(dir, "ops.jsonl"), argsFile = join(dir, "gh-args");
    writeFileSync(join(dir, "gh"), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${argsFile}"\necho '{"id": 7, "status": "completed"}'\n`); chmodSync(join(dir, "gh"), 0o755);
    const r = spawnSync(join(root, "node_modules/.bin/tsx"), [join(root, "peaceai/bin/read-only-ops.ts"), "run_status", WS, "run=7"], { encoding: "utf8", env: { ...process.env, PEACEAI_OPS_LOG: log, PATH: `${dir}:${process.env.PATH}` } });
    assert.equal(r.status, 0);
    assert.deepEqual(readFileSync(argsFile, "utf8").trim().split("\n"), ["api", "--method", "GET", `repos/${WS}/actions/runs/7`]);
    assert.equal(JSON.parse(r.stdout).id, 7);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l).ok), [true]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
