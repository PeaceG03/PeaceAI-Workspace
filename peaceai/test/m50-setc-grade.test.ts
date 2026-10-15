// M50: set C v2 grader. Every task counted; static only.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { gradeAll, gradeOne, type CTask } from "../lib/setc-grade.ts";
const repo = join(import.meta.dirname, "../..");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const SRC = "export function add(a: number, b: number): number {\n  const s = a + b;\n  return s;\n}\nconst re = /x/g;\n";
const bs = SRC.indexOf("{"), be = SRC.indexOf("}\n") + 1;
const T: CTask = { id: "t1", repo: "o/r", path: "src/a.ts", fileSha256: sha(SRC), function: "add", bodyStart: bs, bodyEnd: be, bodySha256: sha(SRC.slice(bs, be)) };
const g = (b: string | undefined) => gradeOne(T, SRC, b).verdict;

test("pass is token-equal (whitespace and comments ignored); a changed token fails", () => {
  assert.equal(g(SRC.slice(bs, be)), "pass");
  assert.equal(g("{ const s = a + b; /* c */ return s; }"), "pass");
  assert.equal(g("{ const t = a + b; return t; }"), "fail");
  assert.equal(g("{ return a - b; }"), "fail");
});

test("no output fails; unparsable or span-escaping output is ungradable", () => {
  assert.equal(g(undefined), "fail"); assert.equal(g("  "), "fail");
  assert.equal(g("{ return a +; }"), "ungradable");
  assert.equal(g("{ return a; } } function x() {"), "ungradable");
  assert.equal(g("{ return a; }\nfunction extra() {}"), "ungradable", "must close at the original boundary");
});

test("a wrong pinned file or span is refused, never graded", () => {
  assert.throws(() => gradeOne(T, SRC + " ", "{}"), /pinned file mismatch/);
  assert.throws(() => gradeOne({ ...T, bodySha256: "0".repeat(64) }, SRC, "{}"), /body span mismatch/);
});

test("denominator: every task counted; unknown ids ignored; duplicates refused", () => {
  const ts2 = [T, { ...T, id: "t2" }, { ...T, id: "t3" }];
  const { summary } = gradeAll(ts2, () => SRC, [{ id: "t1", body: SRC.slice(bs, be) }, { id: "t2", body: "{ x" }, { id: "zz", body: "{}" }]);
  assert.deepEqual([summary.tasks, summary.pass, summary.fail, summary.ungradable, summary.unknownPredictions], [3, 1, 1, 1, 1]);
  assert.throws(() => gradeAll(ts2, () => SRC, [{ id: "t1", body: "{}" }, { id: "t1", body: "{}" }]), /duplicate/);
});

test("the grader never executes code: no process, vm, eval, Function or dynamic import", () => {
  for (const f of ["peaceai/lib/setc-grade.ts", "peaceai/bin/setc-grade.ts"]) {
    const s = readFileSync(join(repo, f), "utf8");
    assert.doesNotMatch(s, /child_process|node:vm|\beval\(|new Function|import\(|require\(|spawn|exec/, f);
  }
});

const EXT = process.env.EXT_DIR ?? "/workspace/ext";
test("all 138 #176 tasks: perfect = 138 pass, empty = 138 fail, broken = 138 ungradable", { skip: !existsSync(EXT) }, () => {
  const tasks = JSON.parse(readFileSync(join(repo, "peaceai/model/heldout-c-tasks.json"), "utf8")).tasks as CTask[];
  assert.equal(tasks.length, 138);
  const src = (t: CTask) => readFileSync(`${EXT}/${t.repo.replace("/", "__")}/${t.path}`, "utf8");
  const run = (f: (t: CTask) => string | undefined) => gradeAll(tasks, src, tasks.flatMap((t) => { const b = f(t); return b === undefined ? [] : [{ id: t.id, body: b }]; })).summary;
  const s1 = run((t) => src(t).slice(t.bodyStart, t.bodyEnd));
  assert.deepEqual([s1.tasks, s1.pass, s1.fail, s1.ungradable], [138, 138, 0, 0]);
  const s2 = run(() => undefined);
  assert.deepEqual([s2.tasks, s2.pass, s2.fail, s2.ungradable], [138, 0, 138, 0]);
  const s3 = run(() => "{ (((");
  assert.deepEqual([s3.tasks, s3.pass, s3.fail, s3.ungradable], [138, 0, 0, 138]);
});
