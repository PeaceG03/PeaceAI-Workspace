// M174 mutation check: every M174 guard is a single line tagged "// m174-guard:<id>" in peaceai/lib/editpropose.ts,
// loop.ts (the load diagnostics live there) or looprow.ts. For each one this test deletes that line and runs the M174 cases
// (m174-cases.ts) against the mutant in a child process group (capped at MUTANT_MS, group killed); at least one case
// must fail an assertion (not crash). Guards that only act in a real loop run need the stage-2 candidate uid.
// Batch 16 (Auditor's #675 note: the control's loop e2e cases flaked under concurrent same-uid stage-2 load from other
// sessions): the runner cap and the cases' run timeout scale with the load average (E2E_LOAD, bounded), the control may
// re-run ONLY when every failed case is a loop e2e case (at most CONTROL_TRIES runs; a pure case failing, a crash, a
// hang or a leftover process is final), and every runner exit is checked for leftovers: no process may remain in the
// runner's process group or name this test's mutant dir (they are killed, and the control fails). Nothing is skipped.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stage2CandUid } from "../lib/selfpropose.ts";
import { CASES, E2E_LOAD } from "./m174-cases.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const libDir = join(ROOT, "peaceai/lib");
const LIB_FILES = ["editpropose.ts", "looprow.ts", "loop.ts"] as const;
const TAG = /\/\/ m174-guard:([a-z0-9-]+)(?:[\s",].*)?$/;
const sources: Record<string, string> = Object.fromEntries(LIB_FILES.map((f) => [f, readFileSync(join(libDir, f), "utf8")]));
const guards = Object.entries(sources).flatMap(([file, text]) => text.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, file, line: i }] : []; }));
const NEEDS_CAND = new Set(["loop-row-load", "scope-gate"]);
const cand = stage2CandUid({ PEACEAI_STAGE2_CAND: process.env.M151_CAND ?? process.env.M146_CAND ?? "peaceai-cand" }).ok;

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m174-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string, local: Record<string, string>, from: string): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "(?:\.\/|\.\.\/lib\/)([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(local[f] ?? join(libDir, f)).href)}`)
    .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(from));
}

/** The runner cap: 10 minutes, times the load factor (1..3) the cases' loop runs also scale by. */
export const MUTANT_MS = Math.round(600_000 * E2E_LOAD);
/** How often the control may run when only loop e2e cases failed in it. */
export const CONTROL_TRIES = 3;
const E2E_IDS: ReadonlySet<string> = new Set(CASES.filter((c) => c.needsCand).map((c) => c.id));

/** Processes left after a runner exited: members of its process group, or any process whose command line names this
 *  test's mutant dir. Throws when the process table cannot be read (fail closed). */
export function leftovers(pgid: number, mark: string): number[] {
  const g = spawnSync("pgrep", ["-g", String(pgid)], { encoding: "utf8" });
  if (g.status !== 0 && g.status !== 1) throw new Error(`pgrep -g failed (${g.status ?? g.signal})`);
  const out = new Set(g.status === 0 ? g.stdout.trim().split("\n").map(Number) : []);
  for (const e of readdirSync("/proc")) {
    if (!/^\d+$/.test(e) || Number(e) === process.pid) continue;
    let cmd = "";
    try { cmd = readFileSync(`/proc/${e}/cmdline`, "utf8"); } catch { continue; } // exited meanwhile
    if (cmd.includes(mark)) out.add(Number(e));
  }
  return [...out].sort((a, b) => a - b);
}

function runMutant(name: string, file: string, text: string): Promise<{ failed: string[]; crashed: string[]; skipped: string[]; cand: boolean; leftovers: number[] } | null> {
  const local = Object.fromEntries(LIB_FILES.map((f) => [f, join(dir, `mutant-${name}-${f}`)]));
  for (const f of LIB_FILES) writeFileSync(local[f]!, rewrite(f === file ? text : sources[f]!, local, libDir));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m174-mutant-runner.ts"), local["editpropose.ts"]!, local["looprow.ts"]!, local["loop.ts"]!], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } }, MUTANT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      let left: number[];
      try { left = leftovers(child.pid!, join(dir, `mutant-${name}-`)); } catch (e) { return fail(e); }
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* none left in the group */ }
      for (const p of left) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
      if (signal === "SIGKILL") return done(null);
      if (code !== 0) return fail(new Error(`mutant runner exited ${code}`));
      done({ ...JSON.parse(out.trim().split("\n").pop()!), leftovers: left });
    });
  });
}

test("M174 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), [
    "cap", "host-inside", "host-no-modules", "host-no-modules-lex", "lc-all-fixed", "lc-export-only", "le-body", "le-kind", "le-not-listed", "le-one-decl",
    "le-plain", "le-single", "lm-needs-export", "lm-proposer", "lm-suite-load-only", "loop-row-load", "lr-v2-only", "module-lex-inside", "module-not-team",
    "module-not-test", "module-source", "name-ident", "relative", "row-load-baseline", "row-load-code", "row-load-value",
    "row-reached-load", "scope-exists", "scope-gate", "scope-nonempty", "scope-not-infra", "scope-not-test",
    "scope-shape", "scope-source", "star-opaque", "star-unknown", "type-only", "type-only-name",
].sort());
});

test("M174 mutation: the unmutated copies pass every case (the harness itself is sound)", async (t) => {
  let last: string[] = [];
  for (let i = 1; i <= CONTROL_TRIES; i++) {
    const r = await runMutant(`control${i}`, "none", "");
    assert.ok(r, "control hung");
    assert.deepEqual(r.crashed, []);
    assert.deepEqual(r.leftovers, [], "control: a process outlived the runner");
    if (r.failed.length === 0) return;
    // only a real loop run (as the shared candidate uid, which another session's run may disturb) is retried; a pure
    // case failing is never a load effect
    assert.deepEqual(r.failed.filter((id) => !E2E_IDS.has(id)), [], "control: a pure case failed");
    last = r.failed;
    t.diagnostic(`control run ${i}: loop e2e case(s) failed (${r.failed.length}); retrying (load factor ${E2E_LOAD})`);
  }
  assert.fail(`control: loop e2e case(s) failed in all ${CONTROL_TRIES} runs: ${JSON.stringify(last)}`);
});

test("M174 mutation (batch 16): the leftover check sees a process left in the group and one naming the mutant dir; the retry set is the loop e2e cases", async () => {
  assert.ok(E2E_IDS.size >= 5 && [...E2E_IDS].every((id) => id.startsWith("loop e2e")), "the retried cases are exactly the loop e2e cases");
  assert.ok(CASES.some((c) => !c.needsCand && !E2E_IDS.has(c.id)), "pure cases exist and are never retried");
  assert.ok(E2E_LOAD >= 1 && E2E_LOAD <= 3 && MUTANT_MS >= 600_000 && MUTANT_MS <= 1_800_000);
  const mark = join(dir, "mutant-leftcheck-");
  const p = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", mark], { detached: true, stdio: "ignore" });
  try {
    for (let i = 0; i < 50 && !leftovers(p.pid!, mark).includes(p.pid!); i++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(leftovers(p.pid!, mark), [p.pid!], "a live process in the group is a leftover");
    assert.ok(leftovers(p.pid!, join(dir, "mutant-other-")).includes(p.pid!), "a group member is a leftover whatever it names");
    assert.deepEqual(leftovers(999_999_999, mark), [p.pid!], "a process naming the mutant dir is a leftover outside the group too");
  } finally { try { process.kill(-p.pid!, "SIGKILL"); } catch { /* gone */ } }
  for (let i = 0; i < 50 && leftovers(p.pid!, mark).length; i++) await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(leftovers(p.pid!, mark), [], "none once it is killed");
});

for (const g of guards) {
  test(`M174 mutation: deleting m174-guard:${g.id} makes a case fail`, async (t) => {
    if (NEEDS_CAND.has(g.id) && !cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    const text = sources[g.file]!.split("\n").filter((_, i) => i !== g.line).join("\n");
    const r = await runMutant(g.id, g.file, text);
    assert.ok(r, `m174-guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `m174-guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices m174-guard:${g.id} removed`);
  });
}
