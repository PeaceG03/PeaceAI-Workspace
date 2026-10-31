// M164 (part A): a proposer whose next() throws, or returns no proposal (undefined; Auditor's #658 note), or (after #659)
// a proposal with no refuse and no valid edits array ([], {}), ends the task
// PROPOSER_FAILED (a fixed code, the error text dropped), at the first attempt or a later one, instead of landing on the loop's catch-all FETCH_FAILED. Behavior cases live in
// m164-loop-cases.ts (they need the stage-2 candidate uid; without it they assert the CAND_UID_* refusal); this file
// adds static checks and a mutation check: the guard line in peaceai/lib/loop.ts is tagged "// m164-guard:<id>" (a
// separate tag, so the m146 and m152 guard lists are unchanged); each mutant is written to a temp dir and the cases
// run against it in a child process group (capped, group killed); at least one case must fail with an assertion.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as prop from "../lib/editpropose.ts";
import * as loop from "../lib/loop.ts";
import { LOOP_CODES } from "../lib/looprow.ts";
import { stage2CandUid } from "../lib/selfpropose.ts";
import { CASES } from "./m164-loop-cases.ts";
import { setup, teardown, type M152Ctx } from "./m152-fixtures.ts";

const libDir = resolve(import.meta.dirname, "../lib");
const loopSource = readFileSync(join(libDir, "loop.ts"), "utf8");
const loopLines = loopSource.split("\n");
const TAG = /\/\/ m164-guard:([a-z0-9-]+)\s*$/;
const guards = loopLines.flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i }] : []; });
const cand = stage2CandUid({ PEACEAI_STAGE2_CAND: process.env.M152_CAND ?? process.env.M146_CAND ?? "peaceai-cand" }).ok;

let ctx: M152Ctx;
let dir: string;
before(() => { ctx = setup(); dir = mkdtempSync(join(tmpdir(), "peaceai-m164-mut-")); });
after(() => { teardown(ctx); rmSync(dir, { recursive: true, force: true }); });

for (const c of CASES) test(`M164: ${c.id}`, () => c.run({ prop, loop }, ctx));

test("M164: every next() goes through one helper whose catch keeps no error (no binding); a null, a non-object or a proposal without a valid edits array is PROPOSER_FAILED", () => {
  const calls = [...loopSource.matchAll(/o\.proposer\.next\(/g)];
  assert.equal(calls.length, 1, "one next() call site");
  const helper = /const ask = \(attempt: number\)[^\n]*\n\s*try \{ return o\.proposer\.next\(\{[^\n]*\}\); \} catch \{ return null; \}\n/;
  assert.match(loopSource, helper, "the next() call is wrapped in a catch with no binding");
  assert.match(loopSource, /const p = ask\(attempt\);\n\s*if \(p === null\) return done\("PROPOSER_FAILED"\); \/\/ m164-guard:next-failed\n\s*if \(typeof p !== "object"\) return done\("PROPOSER_FAILED"\); \/\/ m164-guard:next-empty\n\s*if \(!\("refuse" in p\) && !validEdits\(\(p as \{ edits\?: unknown \}\)\.edits\)\) return done\("PROPOSER_FAILED"\); \/\/ m164-guard:next-malformed\n\s*if \("refuse" in p\)/);
  assert.ok(LOOP_CODES.includes("PROPOSER_FAILED" as never));
});

test("M164 mutation: the guard tags are unique and cover the guard", () => {
  assert.deepEqual(guards.map((g) => g.id), ["next-failed", "next-empty", "next-malformed"]);
});

function rewrite(text: string): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
}
const MUTANT_MS = 300_000;
function runMutant(name: string, loopText: string): Promise<{ failed: string[]; crashed: string[]; cand: boolean } | null> {
  const loopFile = join(dir, `mutant-${name}-loop.ts`);
  writeFileSync(loopFile, rewrite(loopText));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m164-mutant-runner.ts"), loopFile], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } }, MUTANT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL") return done(null);
      if (code !== 0) return fail(new Error(`mutant runner exited ${code}`));
      done(JSON.parse(out.trim().split("\n").pop()!));
    });
  });
}

test("M164 mutation: the unmutated copy passes every case (the harness itself is sound)", async () => {
  const r = await runMutant("control", loopSource);
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

/** Replaces `find` (which must occur exactly once in loop.ts) by `replace`. */
const swap = (find: string, replace: string): string => {
  assert.equal(loopSource.split(find).length - 1, 1, `mutant anchor must occur once: ${find}`);
  return loopSource.replace(find, () => replace);
};
const MUTANTS: [string, string][] = [
  ...guards.map((g) => [`drop-${g.id}`, loopLines.filter((_, i) => i !== g.line).join("\n")] as [string, string]),
  ["code-fetch-failed", swap('if (p === null) return done("PROPOSER_FAILED");', 'if (p === null) return done("FETCH_FAILED");')],
  ["empty-code-fetch-failed", swap('if (typeof p !== "object") return done("PROPOSER_FAILED");', 'if (typeof p !== "object") return done("FETCH_FAILED");')],
  ["malformed-code-fetch-failed", swap('!validEdits((p as { edits?: unknown }).edits)) return done("PROPOSER_FAILED");', '!validEdits((p as { edits?: unknown }).edits)) return done("FETCH_FAILED");')],
  ["edit-elements-unchecked", swap("Array.isArray(x) && Array.from(x as unknown[]).every((e) =>", "Array.isArray(x) || Array.from(x as unknown[]).every((e) =>")],
  ["empty-edits-refused", swap("Array.isArray(x) && Array.from(x as unknown[]).every((e) =>", "Array.isArray(x) && x.length > 0 && Array.from(x as unknown[]).every((e) =>")],
  ["edit-path-unchecked", swap('e !== null && typeof (e as Edit).path === "string" && typeof', 'e !== null && typeof')],
  ["sparse-holes-skipped", swap("Array.isArray(x) && Array.from(x as unknown[]).every((e) =>", "Array.isArray(x) && x.every((e) =>")],
  ["catch-rethrows", swap("attempt, feedback, baseline }); } catch { return null; }", "attempt, feedback, baseline }); } catch (e) { throw e; }")],
];
for (const [id, text] of MUTANTS) {
  test(`M164 mutation: ${id} makes a case fail`, async (t) => {
    if (!cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    assert.notEqual(text, loopSource, `${id}: the mutant changed nothing`);
    const r = await runMutant(id, text);
    assert.ok(r, `${id} mutant hung`);
    assert.deepEqual(r.crashed, [], `${id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices ${id}`);
  });
}
