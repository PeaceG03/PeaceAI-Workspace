// M220 (batch 56): self-loop practice shapes - pins, seed, missingSkillFor, mutant. EXPERIMENTAL, not for credit.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import * as P from "../lib/self-loop-practice.ts";
import { buildSelfLoopTask } from "../lib/self-loop-task.ts";

const libDir = join(import.meta.dirname, "../lib");
const specPath = join(import.meta.dirname, "../spec/self-loop-practice-v1.md");
const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", [...G, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const base = mkdtempSync(join(tmpdir(), "peaceai-m220-"));
after(() => rmSync(base, { recursive: true, force: true }));

function miniClean(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "f", private: true, type: "module", scripts: { test: "node --test" } }) + "\n");
  mkdirSync(join(dir, "peaceai/self-tests/helpers"), { recursive: true });
  writeFileSync(join(dir, "peaceai/self-tests/helpers/dates.ts"), "export function utcDayKey(d: Date): string { return d.toISOString().slice(0, 10); }\n");
  writeFileSync(join(dir, "peaceai/self-tests/helpers/text.ts"), "export function plural(c: number, w: string): string { return c === 1 ? c + ' ' + w : c + ' ' + w + 's'; }\n");
  writeFileSync(join(dir, ".gitignore"), "node_modules\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "clean");
  return git(dir, "rev-parse", "HEAD");
}

test("M220 pins: eight shapes, distinct kinds, one unfixable", () => {
  const pins = P.practiceShapePins();
  assert.deepEqual(pins.ids, [...P.PRACTICE_SHAPE_IDS]);
  assert.equal(pins.ids.length, 8);
  assert.equal(new Set(pins.kinds).size, 8);
  assert.equal(pins.unfixable, "oracle-absent");
  assert.ok(P.PRACTICE_SHAPES.every((s) => s.editPath.startsWith("peaceai/self-tests/helpers/")));
  assert.ok(P.PRACTICE_SHAPES.every((s) => s.broken.includes(P.SELF_LOOP_PRACTICE_MARKER)));
  assert.equal(P.PRACTICE_SHAPES.filter((s) => s.expectUnfixable).length, 1);
});

test("M220 spec names shapes, repair grading, credit false", () => {
  const spec = readFileSync(specPath, "utf8");
  assert.match(spec, /wrong-literal|off-by-one|oracle-absent/);
  assert.match(spec, /repair-v2|repair/);
  assert.match(spec, /not for credit|credit: false/i);
  assert.match(spec, /m220-guard/);
  assert.match(spec, /generic|not modeled/i);
});

test("M220 seedPracticeShape: builds a PlanTask and marks the break", () => {
  const clean = join(base, "clean");
  const head = miniClean(clean);
  const scratch = join(base, "scratch-wrong-literal");
  execFileSync("git", ["clone", "--quiet", "--no-local", clean, scratch], { stdio: "ignore" });
  git(scratch, "checkout", "--quiet", "--detach", head);
  const shape = P.practiceShapeById("wrong-literal")!;
  const seeded = P.seedPracticeShape(scratch, shape);
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  if (!seeded.ok) return;
  const broken = execFileSync("git", ["show", `${seeded.commit}:${shape.editPath}`], { cwd: scratch, encoding: "utf8" });
  assert.ok(broken.includes("wrong-literal"));
  const gap = {
    id: "m220-wrong-literal",
    request: shape.request,
    repo: "PeaceG03/PeaceAI-Workspace",
    editPath: shape.editPath,
    testPath: shape.testPath,
    commit: seeded.commit,
    merge: seeded.merge,
    licenseSha256: P.PRACTICE_SET_LICENSE_SHA256,
  };
  const built = buildSelfLoopTask(gap);
  assert.equal(built.ok, true, JSON.stringify(built));
});

test("M220 missingSkillFor names locate vs attempt exhaustion", () => {
  const shape = P.practiceShapeById("off-by-one")!;
  assert.match(P.missingSkillFor(shape, { loopCode: "NO_EDIT", attempts: 0, result: "refused" }), /locate|templates|fault localization|mutation catalog/);
  assert.match(P.missingSkillFor(shape, { loopCode: "ATTEMPT_LIMIT", attempts: 5, result: "fail" }), /exhausted/);
});

// ---- mutation
const SRC = readFileSync(join(libDir, "self-loop-practice.ts"), "utf8");
const tsPath = createRequire(join(libDir, "self-loop-practice.ts")).resolve("typescript");
function rewrite(t: string): string {
  return t
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
}
const tagsOf = (t: string) => t.split("\n").flatMap((l) => {
  const m = /\/\/ m220-guard:([a-z0-9-]+)/.exec(l);
  return m ? [m[1]!] : [];
});
const drop = (text: string, tag: string) => {
  const ls = text.split("\n");
  const hit = (l: string) => new RegExp(`// m220-guard:${tag}(?![a-z0-9-])`).test(l);
  assert.equal(ls.filter(hit).length, 1, `one line holds ${tag}`);
  return ls.filter((l) => !hit(l)).join("\n");
};

test("M220 mutation: every m220-guard has a case; deleting it is caught", async () => {
  // Embed guards into practiceShapePins for mutant coverage
  assert.ok(SRC.includes("m220-guard:ids") || true);
  // If guards are missing from source, inject via testing the pin function behavior after rewrite of a tagged copy.
  // The library tags live on practiceShapePins body - add them if absent by failing here so we add them.
  if (!SRC.includes("m220-guard:ids")) {
    assert.fail("self-loop-practice.ts must tag practiceShapePins with m220-guard:ids|kinds|unfixable");
  }
  const tags = tagsOf(SRC);
  assert.deepEqual(tags.sort(), ["ids", "kinds", "unfixable"]);
  const dir = join(base, "mut");
  mkdirSync(dir, { recursive: true });
  const load = async (text: string) => {
    const f = join(dir, `m-${Math.random().toString(16).slice(2)}.ts`);
    writeFileSync(f, rewrite(text));
    return (await import(pathToFileURL(f).href)) as typeof P;
  };
  const control = await load(SRC);
  assert.equal(control.practiceShapePins().ids.length, 8);
  {
    const m = await load(drop(SRC, "ids"));
    assert.notEqual(m.practiceShapePins().ids.length, 8);
  }
  {
    const m = await load(drop(SRC, "kinds"));
    assert.notEqual(new Set(m.practiceShapePins().kinds).size, 8);
  }
  {
    const m = await load(drop(SRC, "unfixable"));
    assert.notEqual(m.practiceShapePins().unfixable, "oracle-absent");
  }
  void dirname;
});
