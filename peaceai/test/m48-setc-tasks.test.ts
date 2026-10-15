// M48: set C v2 function-body task list. Structure always; full rebuild-equality when the pinned snapshots are present.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const repo = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const T = JSON.parse(read("peaceai/model/heldout-c-tasks.json"));
const C = JSON.parse(read("peaceai/model/heldout-c.json")).sets.C as { repo: string; sha: string; contentSha256: string[] }[];

test("every task comes from a set C v2 repo at its pin, from a held-out file", () => {
  const byRepo = new Map(C.map((c) => [c.repo, c]));
  assert.equal(T.schema, "peaceai-heldout-c-tasks:v1");
  assert.ok(T.tasks.length >= 100);
  for (const t of T.tasks) {
    const c = byRepo.get(t.repo); assert.ok(c, t.repo);
    assert.equal(t.sha, c!.sha); assert.ok(c!.contentSha256.includes(t.fileSha256), t.path);
    assert.ok(t.bodyLines >= 2 && t.bodyLines <= 15 && t.bodyEnd > t.bodyStart);
    assert.doesNotMatch(t.path, /\.d\.ts$|(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\./);
  }
});

test("ids are unique and each repo's tasks are its lowest ids, capped at 20; counts match", () => {
  assert.equal(new Set(T.tasks.map((t: { id: string }) => t.id)).size, T.tasks.length);
  for (const c of C) {
    const ts = T.tasks.filter((t: { repo: string }) => t.repo === c.repo).map((t: { id: string }) => t.id);
    assert.deepEqual(ts, [...ts].sort()); assert.ok(ts.length <= 20);
    assert.equal(T.counts[c.repo].chosen, ts.length);
    assert.ok(T.counts[c.repo].eligible >= ts.length);
  }
});

test("rebuilding from the pinned snapshots reproduces the list byte for byte", { skip: !existsSync(process.env.EXT_DIR ?? "/workspace/ext") }, () => {
  const before = read("peaceai/model/heldout-c-tasks.json");
  execFileSync(join(repo, "node_modules/.bin/tsx"), [join(repo, "peaceai/bin/heldout-c-tasks.ts")], { cwd: repo });
  assert.equal(read("peaceai/model/heldout-c-tasks.json"), before);
});
