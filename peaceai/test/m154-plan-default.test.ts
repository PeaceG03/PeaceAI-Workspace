// M154 PLAN-ONLY default planner (peaceai/spec/plan-default.md): the default is decided only in lib/plandefault.ts and
// is plan-only-v3; v1/v2/v3 stay selectable; near-miss flags are refused; v1/v2/v3 plannerSha256 are unchanged; the
// entry point bin/plan.ts routes through selectPlanner; and a mutation check (each mutant of plandefault.ts, loaded
// from a temp copy, must fail at least one check). Offline.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as real from "../lib/plandefault.ts";
import { plannerSha256 } from "../lib/planrun.ts";
import { plannerSha256V2 } from "../lib/plan2run.ts";
import { plannerSha256V3 } from "../lib/plan3run.ts";

const repo = join(import.meta.dirname, "../..");
const SRC = readFileSync(join(repo, "peaceai/lib/plandefault.ts"), "utf8");

/** Main's fingerprints (add-only). */
const V1 = "275e559b93822a74c461970d122b9c27233d034c0839b04d599d7c112e7aedeb";
const V2 = "fae6c0c489dcd18acf968706dcaa7bc0643a01f9375ee85b09747745cc697227";
const V3 = "f49997972d7aaea495257366ac4b1f8587619099b695869753531f6c72198f35";

type M = typeof real;
/** Every check on a plandefault module; returns the failures (empty = pass). */
function problems(m: M): string[] {
  const out: string[] = [];
  const ck = (ok: boolean, why: string) => { if (!ok) out.push(why); };
  ck(m.DEFAULT_PLANNER === "plan-only-v3", "default is v3");
  const d = m.selectPlanner(undefined);
  ck(d?.name === "plan-only-v3" && d.module === "../lib/plan3run.ts" && d.run === "runFileV3" && d.status === "DEFAULT", "no flag -> v3 runner");
  for (const [f, n, mod, run] of [["v1", "plan-only-v1", "../lib/planrun.ts", "runFile"], ["v2", "plan-only-v2", "../lib/plan2run.ts", "runFileV2"], ["v3", "plan-only-v3", "../lib/plan3run.ts", "runFileV3"]] as const) {
    for (const flag of [f, n]) { const e = m.selectPlanner(flag); ck(e?.name === n && e.module === mod && e.run === run, `--planner=${flag} -> ${n}`); }
  }
  // Near misses: close to a valid name but not one.
  for (const bad of ["", "V3", "v3 ", " v3", "v4", "v0", "plan-only", "plan-only-v4", "plan-only-V3", "3", "toString", "__proto__", "constructor"]) ck(m.selectPlanner(bad) === null, `refuses ${JSON.stringify(bad)}`);
  ck(Object.values(m.PLANNERS).filter((e) => e.status === "DEFAULT").length === 1 && m.PLANNERS["plan-only-v3"].status === "DEFAULT", "exactly one DEFAULT, v3");
  ck(m.PLANNERS["plan-only-v1"].status === "RUNNABLE" && m.PLANNERS["plan-only-v2"].status === "EXPERIMENTAL", "v1 RUNNABLE, v2 EXPERIMENTAL");
  return out;
}

test("M154: the default planner is plan-only-v3; v1/v2/v3 selectable; near-miss flags refused", () => {
  assert.deepEqual(problems(real), []);
});

test("M154: v1, v2 and v3 keep their plannerSha256 (a default change touches no planner file)", () => {
  assert.equal(plannerSha256(), V1);
  assert.equal(plannerSha256V2(), V2);
  assert.equal(plannerSha256V3(), V3);
  const v1cli = readFileSync(join(repo, "peaceai/bin/plan-only.ts"), "utf8");
  assert.ok(!/plandefault|plan3|plan-only-v3/.test(v1cli), "bin/plan-only.ts is still v1 only");
});

test("M154: bin/plan.ts routes through selectPlanner and refuses an unknown planner before loading anything", () => {
  const cli = readFileSync(join(repo, "peaceai/bin/plan.ts"), "utf8");
  assert.match(cli, /import \{ selectPlanner \} from "\.\.\/lib\/plandefault\.ts"/);
  assert.ok(!/plan2run|plan3run|runFileV[23]/.test(cli), "no hard-coded planner in the entry point");
  const run = (...a: string[]) => spawnSync(join(repo, "node_modules/.bin/tsx"), [join(repo, "peaceai/bin/plan.ts"), ...a], { encoding: "utf8", cwd: tmpdir() });
  const bad = run("run", "--planner=v4", "t.json");
  assert.equal(bad.status, 2); assert.equal(bad.stdout.trim(), "refused PLANNER_UNKNOWN");
  const near = run("run", "--planner=V3", "t.json");
  assert.equal(near.status, 2); assert.equal(near.stdout.trim(), "refused PLANNER_UNKNOWN");
  const usage = run("run");
  assert.equal(usage.status, 2); assert.match(usage.stdout, /^usage: plan\.ts/);
  const missing = run("run", "--planner=v1", "no-such-file.json");
  assert.equal(missing.status, 1); assert.match(missing.stdout, /^refused [A-Z_]+$/m);
});

const MUTANTS: [string, string, string][] = [
  ["default -> v1", 'DEFAULT_PLANNER: PlannerName = "plan-only-v3"', 'DEFAULT_PLANNER: PlannerName = "plan-only-v1"'],
  ["default -> v2", 'DEFAULT_PLANNER: PlannerName = "plan-only-v3"', 'DEFAULT_PLANNER: PlannerName = "plan-only-v2"'],
  ["no-flag ignores default", "if (flag === undefined) return PLANNERS[DEFAULT_PLANNER];", 'if (flag === undefined) return PLANNERS["plan-only-v1"];'],
  ["v3 runner swapped", 'module: "../lib/plan3run.ts", run: "runFileV3"', 'module: "../lib/planrun.ts", run: "runFile"'],
  ["v1 runner swapped", 'module: "../lib/planrun.ts", run: "runFile",', 'module: "../lib/plan3run.ts", run: "runFileV3",'],
  ["v3 status", 'run: "runFileV3", status: "DEFAULT"', 'run: "runFileV3", status: "RUNNABLE"'],
  ["v1 status DEFAULT", 'run: "runFile", status: "RUNNABLE"', 'run: "runFile", status: "DEFAULT"'],
  ["v1 alias dropped", 'v1: "plan-only-v1", ', ""],
  ["v2 alias -> v3", 'v2: "plan-only-v2"', 'v2: "plan-only-v3"'],
  ["loose match", "Object.prototype.hasOwnProperty.call(ALIASES, flag) ? ALIASES[flag] : undefined", "ALIASES[flag.trim().toLowerCase()]"],
  ["inherited keys", "Object.prototype.hasOwnProperty.call(ALIASES, flag) ? ALIASES[flag] : undefined", "(ALIASES as any)[flag]"],
  ["unknown -> default", "return n ? PLANNERS[n] : null;", "return n ? PLANNERS[n] : PLANNERS[DEFAULT_PLANNER];"],
];

test("M154 mutation: every mutant of lib/plandefault.ts fails at least one check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m154-"));
  try {
    for (const [i, [name, from, to]] of MUTANTS.entries()) {
      assert.ok(SRC.includes(from), `mutant "${name}" applies`);
      const f = join(dir, `m${i}.ts`);
      writeFileSync(f, SRC.replace(from, to));
      const m = (await import(pathToFileURL(f).href)) as M;
      assert.ok(problems(m).length > 0, `mutant "${name}" survived`);
    }
    // Control: the unmutated copy passes the same way.
    const c = join(dir, "control.ts"); writeFileSync(c, SRC);
    assert.deepEqual(problems((await import(pathToFileURL(c).href)) as M), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
