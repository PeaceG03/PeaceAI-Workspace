// M42: the pre-push hook skips only commits already reachable from origin/main and scans every new commit in
// full, including a merge commit's own diff against its first parent. Runs the real installer and hook in a
// throwaway clone with a throwaway core checkout; nothing touches this repo's .git.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const mail = ["peace", "users.noreply.github.com"].join("@"); // built at runtime (no address in this file)
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_COMMITTER_NAME: "t", GIT_AUTHOR_EMAIL: mail, GIT_COMMITTER_EMAIL: mail, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
// Distinctive long lines (>= LONG_LINE) that exist only in the throwaway core checkout.
// Git trims leading/trailing punctuation from names, so the identity fixture line is letters and spaces only.
const IDENTITY_LINE = "m42 private core fixture identity line carried only by the throwaway core checkout";
const CORE_TEXT = [0, 1, 2, 3].map((i) => `export const m42PrivateCoreFixtureLine${i} = "only the throwaway core checkout carries this line ${i}";`).join("\n") + "\n" + IDENTITY_LINE + "\n";
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env, encoding: "utf8" }).trim();
const put = (dir: string, path: string, text: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
const commit = (dir: string, path: string, text: string, msg: string) => { put(dir, path, text); g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", msg); };

function setup() {
  const t = mkdtempSync(join(tmpdir(), "m42-"));
  const core = join(t, "core");
  mkdirSync(core); g(core, "init", "-q"); commit(core, "engine/core.ts", CORE_TEXT, "core");
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

test("fails closed when the remote main is missing or not present locally", () => {
  const ws = setup();
  const other = join(dirname(ws), "other");
  commit(other, "src/c.ts", "c\n", "remote moves on"); g(other, "push", "-q", "origin", "main");
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "src/b.ts", "b\n", "feature");
  const r = push(ws, "feat");
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /remote main [0-9a-f]{10} is not present locally/);
  g(dirname(ws), "--git-dir=origin.git", "update-ref", "-d", "refs/heads/main");
  const r2 = push(ws, "feat");
  assert.notEqual(r2.status, 0);
  assert.match(r2.stdout, /remote main cannot be resolved/);
});

// ---- Auditor #157 attacks: each must block.
const blocks = (r: ReturnType<typeof push>, re: RegExp) => { assert.notEqual(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, re); };

test("F1: a forged refs/remotes/origin/main does not make core text public", () => {
  const ws = setup();
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "src/leak.ts", CORE_TEXT, "core text");
  g(ws, "update-ref", "refs/remotes/origin/main", "HEAD");
  blocks(push(ws, "feat"), /src\/leak\.ts: core text/);
});

test("F2: a local remote-tracking ref does not hide a commit (no --not --remotes)", () => {
  const ws = setup();
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "src/leak.ts", CORE_TEXT, "core text");
  g(ws, "update-ref", "refs/remotes/elsewhere/x", "HEAD");
  blocks(push(ws, "feat"), /src\/leak\.ts: core text/);
});

test("F3: core text in a file containing a NUL byte is still scanned", () => {
  const ws = setup();
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "src/blob.bin", "\0" + CORE_TEXT, "binary with core text");
  blocks(push(ws, "feat"), /src\/blob\.bin: core text/);
});

test("F4: a file over 2 MB blocks instead of being skipped", () => {
  const ws = setup();
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "src/big.ts", CORE_TEXT + "// pad\n".repeat(300_000), "big");
  blocks(push(ws, "feat"), /src\/big\.ts: over 2 MB/);
});

test("F5: a symlink turned into a regular file with core text is scanned", () => {
  const ws = setup();
  g(ws, "checkout", "-q", "-b", "feat");
  symlinkSync("a.ts", join(ws, "src/link.ts")); g(ws, "add", "-A"); g(ws, "commit", "-q", "-m", "link");
  g(ws, "push", "-q", "--no-verify", "origin", "feat"); // test setup only: publish the symlink commit on the branch
  rmSync(join(ws, "src/link.ts")); commit(ws, "src/link.ts", CORE_TEXT, "typechange to file");
  blocks(push(ws, "feat"), /src\/link\.ts: core text/);
});

test("F6: an annotated tag message carrying core text blocks", () => {
  const ws = setup();
  g(ws, "tag", "-a", "v1", "-m", CORE_TEXT, "origin/main");
  blocks(spawnSync("git", ["push", "origin", "v1"], { cwd: ws, env, encoding: "utf8" }), /tag message: core text/);
});

test("F7: pushed objects are typed: a tag is followed and its identity checked; a blob or tree blocks", () => {
  const ws = setup();
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: ws, env, input: CORE_TEXT, encoding: "utf8" }).trim();
  blocks(spawnSync("git", ["push", "origin", `${blob}:refs/tags/b`], { cwd: ws, env, encoding: "utf8" }), /pushed blob/);
  const tree = g(ws, "rev-parse", "HEAD^{tree}");
  blocks(spawnSync("git", ["push", "origin", `${tree}:refs/tags/t`], { cwd: ws, env, encoding: "utf8" }), /pushed tree/);
  // A tag pointing at a new core-text commit: followed to the commit and scanned.
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "src/leak.ts", CORE_TEXT, "core text");
  g(ws, "tag", "-a", "v2", "-m", "release", "HEAD");
  blocks(spawnSync("git", ["push", "origin", "v2"], { cwd: ws, env, encoding: "utf8" }), /src\/leak\.ts: core text/);
  // A tagger that is not a noreply address.
  const bad = ["someone", "example.com"].join("@");
  execFileSync("git", ["tag", "-a", "v3", "-m", "x", "origin/main"], { cwd: ws, env: { ...env, GIT_COMMITTER_EMAIL: bad } });
  blocks(spawnSync("git", ["push", "origin", "v3"], { cwd: ws, env, encoding: "utf8" }), /tagger email is not a noreply/);
});

test("a hook run from a linked worktree indexes the core checkout, not the repo being pushed", () => {
  const ws = setup();
  const wt = join(dirname(ws), "wt");
  g(ws, "worktree", "add", "-q", "-b", "feat", wt, "origin/main");
  commit(wt, "src/new-file.ts", "export const fresh = 6;\n", "new non-core file");
  const r = push(wt, "feat");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /PRE-PUSH PASS commits=1/);
  commit(wt, "engine/core.ts", "export const wtCore = 7;\n", "core-path edit from a worktree");
  const r2 = push(wt, "feat");
  assert.notEqual(r2.status, 0);
  assert.match(r2.stdout, /engine\/core\.ts: same path as a core file/);
});

test("N1: core text in a commit message blocks", () => {
  const ws = setup();
  g(ws, "checkout", "-q", "-b", "feat"); commit(ws, "src/b.ts", "b\n", CORE_TEXT);
  blocks(push(ws, "feat"), /commit message: core text/);
});

test("N2: core text stored as UTF-16LE (with and without BOM) blocks", () => {
  for (const bom of [true, false]) {
    const ws = setup();
    g(ws, "checkout", "-q", "-b", "feat");
    const body = Buffer.from(CORE_TEXT, "utf16le");
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, "src/u16.txt"), bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body);
    g(ws, "add", "-A"); g(ws, "commit", "-q", "-m", "utf16");
    blocks(push(ws, "feat"), /src\/u16\.txt: core text/);
  }
});

test("identity names (author, committer, tagger) carrying core text block", () => {
  const line = IDENTITY_LINE;
  const ws = setup();
  g(ws, "checkout", "-q", "-b", "feat"); put(ws, "src/b.ts", "b\n"); g(ws, "add", "-A");
  execFileSync("git", ["commit", "-q", "-m", "x"], { cwd: ws, env: { ...env, GIT_AUTHOR_NAME: line } });
  blocks(push(ws, "feat"), /commit identity: core text/);
  const ws2 = setup();
  g(ws2, "checkout", "-q", "-b", "feat"); put(ws2, "src/b.ts", "b\n"); g(ws2, "add", "-A");
  execFileSync("git", ["commit", "-q", "-m", "x"], { cwd: ws2, env: { ...env, GIT_COMMITTER_NAME: line } });
  blocks(push(ws2, "feat"), /commit identity: core text/);
  const ws3 = setup();
  execFileSync("git", ["tag", "-a", "v9", "-m", "x", "origin/main"], { cwd: ws3, env: { ...env, GIT_COMMITTER_NAME: line } });
  blocks(spawnSync("git", ["push", "origin", "v9"], { cwd: ws3, env, encoding: "utf8" }), /tagger identity: core text/);
});
