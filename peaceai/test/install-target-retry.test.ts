// install-target.sh retries the locked, script-free install (3 attempts) when the package-manager download times out.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const SCRIPT = resolve("peaceai/bin/install-target.sh");

function fake(failTimes: number) {
  const root = mkdtempSync(join(tmpdir(), "inst-"));
  const bin = join(root, "bin"); const dir = join(root, "target");
  mkdirSync(bin); mkdirSync(dir);
  for (const tool of ["corepack", "npm"]) {
    const p = join(bin, tool);
    writeFileSync(p, [
      "#!/usr/bin/env bash",
      `c=$(cat "${root}/count" 2>/dev/null || echo 0); c=$((c+1)); echo "$c" > "${root}/count"`,
      `echo "${tool} $* prompt=\${COREPACK_ENABLE_DOWNLOAD_PROMPT:-unset} nm=$([ -e node_modules/partial ] && echo yes || echo no)" >> "${root}/argv"`,
      `if [ "$c" -le ${failTimes} ]; then mkdir -p node_modules && touch node_modules/partial; echo "Could not download the pnpm binary: timed out after 30s" >&2; exit 1; fi`,
      "exit 0", ""].join("\n"));
    chmodSync(p, 0o755);
  }
  return { root, dir, run: (kind: string) => spawnSync("bash", [SCRIPT, dir, kind], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PEACEAI_INSTALL_NO_BACKOFF: "1" } }) };
}
const lines = (root: string) => existsSync(join(root, "argv")) ? readFileSync(join(root, "argv"), "utf8").trim().split("\n") : [];

test("pnpm: a timed-out download is retried and the same frozen, script-free command runs each time", () => {
  const f = fake(2);
  const r = f.run("pnpm");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /target dependencies installed/);
  const a = lines(f.root);
  assert.equal(a.length, 3);
  for (const l of a) assert.match(l, /^corepack pnpm install --frozen-lockfile --ignore-scripts --reporter=silent prompt=0 /);
  // A partial node_modules from a failed attempt is removed before the next one.
  assert.deepEqual(a.map((l) => l.endsWith("nm=no")), [true, true, true]);
  assert.match(r.stderr, /attempt 1 failed; retrying in 15s/);
  assert.match(r.stderr, /attempt 2 failed; retrying in 45s/);
});

test("pnpm: gives up after 3 attempts with a non-zero exit", () => {
  const f = fake(99);
  const r = f.run("pnpm");
  assert.notEqual(r.status, 0);
  assert.equal(lines(f.root).length, 3);
  assert.match(r.stderr, /failed after 3 attempts/);
  assert.doesNotMatch(r.stdout, /installed/);
});

test("npm: same retry around npm ci with its existing flags; success on the first try runs once", () => {
  const f = fake(1);
  assert.equal(f.run("npm").status, 0);
  const a = lines(f.root);
  assert.equal(a.length, 2);
  for (const l of a) assert.match(l, /^npm ci --ignore-scripts --no-audit --no-fund --loglevel=error /);
  const g = fake(0);
  assert.equal(g.run("pnpm").status, 0);
  assert.equal(lines(g.root).length, 1);
});

test("an unknown installer is refused before any attempt", () => {
  const f = fake(0);
  const r = f.run("yarn");
  assert.notEqual(r.status, 0);
  assert.equal(lines(f.root).length, 0);
});
