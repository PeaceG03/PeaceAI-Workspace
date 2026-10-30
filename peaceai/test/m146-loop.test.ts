// M146: PeaceAI's sandboxed test-and-fix loop (peaceai/lib/loop.ts) on tiny synthetic task repos, its log rows in the
// plan-only add-only log, and static checks that it reuses the stage-2 isolation and never pushes or self-targets.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join, resolve } from "node:path";
import * as lib from "../lib/loop.ts";
import { LOOP_SCHEMA, loopRowProblem, type LoopRow } from "../lib/looprow.ts";
import { addOnlyProblem, logRowProblem, parseLog, RUN_LOG } from "../lib/plangrade.ts";
import { lockRow } from "../lib/planrun.ts";
import { CASES } from "./m146-loop-cases.ts";
import { CALC_FIXED, setup, teardown, type Ctx } from "./m146-fixtures.ts";

const root = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
let server: net.Server;
let hits = 0;
before(async () => {
  server = net.createServer((s) => { hits++; s.destroy(); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  ctx = setup((server.address() as net.AddressInfo).port, () => hits);
});
after(() => { teardown(ctx); server.close(); });

test("M146: environment", (t) => { t.diagnostic(ctx.cand ? "stage-2 candidate uid available: isolation cases run for real" : "no stage-2 candidate uid here: isolation cases assert the CAND_UID_* refusal"); });
for (const c of CASES) test(`M146: ${c.id}`, () => c.run(lib, ctx));

const sampleRow = (over: Partial<LoopRow> = {}): LoopRow => ({
  schema: LOOP_SCHEMA, at: "2026-10-30T23:00:00Z", set: "public", taskFileSha256: "a".repeat(64), taskKey: "0123456789abcdef", repo: "o/r", commit: "c".repeat(40),
  workspace: "d".repeat(40), loop: "loop-v1", loopSha256: "e".repeat(64), proposer: "rules-v1", lm: "not-loadable", code: "ATTEMPT_LIMIT", maxAttempts: 2, attempts: 2,
  result: "fail", attemptCodes: [["TEST_FAIL"], ["TEST_FAIL", "TIMEOUT"]], tests: { total: 3, passedByPeaceAI: 1, filledByTeam: 2 }, ...over,
});

test("M146: loop rows: fixed keys, codes and numbers only; hidden rows name no repo; plangrade accepts them in the log", () => {
  assert.equal(loopRowProblem(sampleRow()), null);
  assert.equal(logRowProblem(sampleRow()), null);
  const { repo: _r, commit: _c, ...hidden } = sampleRow({ set: "hidden" });
  assert.equal(loopRowProblem(hidden), null);
  const bad: [Partial<LoopRow> | Record<string, unknown>, string][] = [
    [{ set: "hidden" }, "hidden_names_repo"],
    [{ failing: ["add sums"] } as Record<string, unknown>, "loop_keys"],
    [{ message: "x" } as Record<string, unknown>, "loop_keys"],
    [{ code: "SOMETHING" as LoopRow["code"] }, "code"],
    [{ result: "pass" }, "result"],
    [{ attempts: 1, attemptCodes: [["TEST_FAIL"]] }, "limit_attempts"],
    [{ attemptCodes: [["TEST_FAIL"], ["oops" as "TEST_FAIL"]] }, "attempt_codes"],
    [{ tests: { total: 3, passedByPeaceAI: 2, filledByTeam: 2 } }, "tests_values"],
    [{ code: "PASS", result: "pass", attemptCodes: [["TEST_FAIL"], []], tests: { total: 3, passedByPeaceAI: 2, filledByTeam: 1 } }, "pass_tests"],
    [{ attempts: 3 }, "attempts"],
    [{ tests: null }, "tests_presence"],
  ];
  for (const [over, want] of bad) assert.equal(loopRowProblem({ ...sampleRow(), ...over }), want, JSON.stringify(over));
  const log = JSON.stringify(sampleRow()) + "\n" + JSON.stringify(hidden) + "\n";
  assert.ok(!("problem" in parseLog(log)));
  assert.equal(addOnlyProblem("", log), null);
});

test("M146: runLoopFile: the task file must be locked in the COMMITTED log; any path (Auditor's hidden one) works; rows are appended add-only", () => {
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", ...a], { cwd: ctx.root, encoding: "utf8" });
  const hiddenFile = join(ctx.base, "anywhere", "hidden-tasks.json");
  execFileSync("mkdir", ["-p", join(ctx.base, "anywhere")]);
  const text = JSON.stringify({ ...ctx.file, set: "hidden" }, null, 1) + "\n";
  writeFileSync(hiddenFile, text);
  const o = { root: ctx.root, fetcher: ctx.fetcher, proposer: { name: "fixed", next: () => ({ edits: [{ path: "src/calc.ts", content: CALC_FIXED }] }) } as lib.Proposer, env: ctx.env, rules: [], training: new Set<string>(), outDir: join(ctx.base, "out") };
  assert.equal(lib.runLoopFile(hiddenFile, o).code, "TASK_FILE_UNLOCKED");
  writeFileSync(join(ctx.root, RUN_LOG), JSON.stringify(lockRow(text)) + "\n");
  assert.equal(lib.runLoopFile(hiddenFile, o).code, "TASK_FILE_UNLOCKED", "a lock only in the working tree does not count");
  g("add", "-A"); g("commit", "-q", "-m", "lock");
  const before = readFileSync(join(ctx.root, RUN_LOG), "utf8");
  const r = lib.runLoopFile(hiddenFile, o);
  assert.equal(r.code, "OK");
  assert.equal(r.results.length, 1);
  const after = readFileSync(join(ctx.root, RUN_LOG), "utf8");
  assert.equal(addOnlyProblem(before, after), null);
  const row = JSON.parse(after.trim().split("\n").pop()!) as LoopRow;
  assert.equal(row.set, "hidden");
  assert.ok(!("repo" in row) && !after.includes("m146-fixture") && !after.includes("calc"), "the hidden row names nothing");
  if (ctx.cand) assert.equal(row.code, "PASS"); else assert.match(row.code, /^CAND_UID_/);
});

test("M146: static: the loop reuses selfpropose.ts guardedRun + stage2CandUid unchanged, never pushes, never touches the stage-2 flag", () => {
  const src = readFileSync(resolve(root, "peaceai/lib/loop.ts"), "utf8");
  const code = src.replace(/\/\/[^\n]*/g, "");
  assert.match(src, /import \{ guardedRun, stage2CandUid, type CandUid, type RawRun \} from "\.\/selfpropose\.ts";/);
  assert.doesNotMatch(code, /\bpush\b(?!\()|"push"|stage2\.json|selfChange|STAGE2_FLAG|isolatedRun\(/);
  assert.equal([...code.matchAll(/guardedRun\(/g)].length, 1, "one run site");
  assert.doesNotMatch(code, /spawnSync\("(?!id")|execFileSync\("(?!git")/, "only git (fetch/checkout in the copy) and id are spawned directly");
  assert.doesNotMatch(code, /process\.env\s*\[?[^;]*=(?!=)/, "never writes the environment");
  assert.equal(JSON.parse(readFileSync(resolve(root, "peaceai/self/stage2.json"), "utf8")).enabled, false, "the stage-2 self-change flag stays off");
});

test("M146: selfpropose.ts (the stage-2 isolation) is unchanged on this branch", (t) => {
  let base = "";
  try { base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* shallow CI checkout */ }
  if (!base) { t.skip("no origin/main here (shallow checkout)"); return; }
  assert.equal(execFileSync("git", ["diff", base, "HEAD", "--", "peaceai/lib/selfpropose.ts"], { cwd: root, encoding: "utf8" }), "", "selfpropose.ts unchanged");
});
