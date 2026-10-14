// M42: the pre-push hook skips only commits already reachable from origin/main and scans every new commit in
// full, including a merge commit's own diff against its first parent. Runs the real installer and hook in a
// throwaway clone with a throwaway core checkout; nothing touches this repo's .git.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const mail = ["peace", "users.noreply.github.com"].join("@"); // built at runtime (no address in this file)
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_COMMITTER_NAME: "t", GIT_AUTHOR_EMAIL: mail, GIT_COMMITTER_EMAIL: mail, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env, encoding: "utf8" }).trim();
const put = (dir: string, path: string, text: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
const commit = (dir: string, path: string, text: string, msg: string) => { put(dir, path, text); g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", msg); };

function setup() {
  const t = mkdtempSync(join(tmpdir(), "m42-"));
  const core = join(t, "core");
  mkdirSync(core); g(core, "init", "-q"); commit(core, "engine/core.ts", "export const coreOnlyLine = 'm42 fixture';\n", "core");
  const ws = join(t, "ws");
  mkdirSync(ws); g(ws, "init", "-q", "-b", "main");
  for (const f of ["peaceai/bin/install-pre-push.sh", "peaceai/bin/prepush-scan.ts", "peaceai/lib/coreindex.ts", "peaceai/lib/coretext.ts", "peaceai/lib/leak.ts"]) cpSync(join(root, f), join(ws, f), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(ws, "node_modules"));
  put(ws, ".gitignore", "node_modules\n");
  commit(ws, "src/a.ts", "export const a = 1;\n", "base");
  const bare = join(t, "origin.git");
  g(t, "init", "-q", "--bare", "-b", "main", bare); g(ws, "remote", "add", "origin", bare); g(ws, "push", "-q", "origin", "main");
  // Already-public history: a core-path file lands on origin/main (pushed from another clone, hook-free).
  const other = join(t, "other");
  g(t, "clone", "-q", bare, other); commit(other, "engine/core.ts", "export const publicVersion = 2;\n", "public core-path file"); g(other, "push", "-q", "origin", "main");
  const r = spawnSync(join(ws, "peaceai/bin/install-pre-push.sh"), [core], { cwd: ws, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  g(ws, "fetch", "-q", "origin");
  return ws;
}
const push = (ws: string, branch: string) => spawnSync("git", ["push", "origin", branch], { cwd: ws, env, encoding: "utf8" });

test("a main merge carrying already-public core-path files passes", () => {
  const ws = setup();
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "src/b.ts", "export const b = 2;\n", "feature");
  g(ws, "merge", "-q", "--no-edit", "origin/main");
  const r = push(ws, "feat");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /PRE-PUSH PASS commits=2/);
});

test("a new commit touching a core-path file still blocks", () => {
  const ws = setup();
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "engine/core.ts", "export const mine = 3;\n", "new core-path edit");
  const r = push(ws, "feat");
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /PRE-PUSH FAIL [0-9a-f]{10} engine\/core\.ts: same path as a core file/);
});

test("a new core-path commit hidden behind a main merge still blocks", () => {
  const ws = setup();
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "lib/x/core-copy.ts", "x\n", "safe");
  commit(ws, "engine/core.ts", "export const hidden = 4;\n", "hidden core-path edit");
  const hidden = g(ws, "rev-parse", "HEAD");
  // Merge main; resolve the conflict with our (new, non-public) content.
  spawnSync("git", ["merge", "--no-edit", "origin/main"], { cwd: ws, env });
  put(ws, "engine/core.ts", "export const hidden = 4;\n"); g(ws, "add", "-A"); g(ws, "commit", "-q", "--no-edit");
  const r = push(ws, "feat");
  assert.notEqual(r.status, 0);
  const fails = r.stdout.split("\n").filter((l) => /engine\/core\.ts: same path as a core file/.test(l));
  // The hidden commit is caught; the merge kept its content (no change against the first parent).
  assert.equal(fails.length, 1, r.stdout);
  assert.ok(fails[0].includes(hidden.slice(0, 10)), r.stdout);
});

test("a merge that edits a public file during the merge is scanned (content differs from the public parent)", () => {
  const ws = setup();
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "src/b.ts", "b\n", "feature");
  g(ws, "merge", "-q", "--no-commit", "origin/main");
  put(ws, "engine/core.ts", "export const changedInMerge = 5;\n"); g(ws, "add", "-A"); g(ws, "commit", "-q", "--no-edit");
  const r = push(ws, "feat");
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /engine\/core\.ts: same path as a core file/);
});

test("fails closed when origin/main cannot be resolved", () => {
  const ws = setup();
  g(ws, "update-ref", "-d", "refs/remotes/origin/main");
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "src/b.ts", "b\n", "feature");
  const r = push(ws, "feat");
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /origin\/main cannot be resolved/);
});
