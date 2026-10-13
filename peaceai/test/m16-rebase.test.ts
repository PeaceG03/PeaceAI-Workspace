// M16: a chosen candidate whose task base is stale is re-applied onto the current head (cleanly, or refused)
// and graded FRESH there: original suite passes, its new test passes with it and fails without its edit.
// The task-time grade is never carried forward; on refusal the worktree is reset to where it started.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { freshVerdict, patchFiles, rebaseAndRegrade, type RegradeRunners } from "../lib/rebase.ts";
import { protectedReason } from "../lib/selfchange.ts";

const ID = { name: "PeaceG03", email: "301894882+PeaceG03@users.noreply.github.com" };
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
const run: RegradeRunners = {
  suite: (d) => spawnSync("node", ["--test", "suite.test.mjs"], { cwd: d, env, stdio: "ignore" }).status === 0,
  tests: (d, f) => spawnSync("node", ["--test", ...f], { cwd: d, env, stdio: "ignore" }).status === 0,
};
const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", `user.name=${ID.name}`, "-c", `user.email=${ID.email}`, ...a], { cwd, encoding: "utf8" }).trim();
const LIB = "export function scale(a, b) {\n  return a * b;\n}\n";
const SUITE = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { scale } from "./lib.mjs";\ntest("s", () => assert.equal(scale(2, 3), 6));\n';

/** A repo at base B, the candidate patch built on B (append pad2 + its new test), and B checked out again. */
function setup() {
  const d = mkdtempSync(join(tmpdir(), "m16-"));
  g(d, "init", "-q", "-b", "main");
  writeFileSync(join(d, "lib.mjs"), LIB); writeFileSync(join(d, "suite.test.mjs"), SUITE); writeFileSync(join(d, "other.txt"), "x\n");
  g(d, "add", "-A"); g(d, "commit", "-qm", "base");
  const base = g(d, "rev-parse", "HEAD");
  writeFileSync(join(d, "lib.mjs"), LIB + "\nexport function pad2(n) {\n  return String(n).padStart(2, \"0\");\n}\n");
  writeFileSync(join(d, "lib.pad2.test.mjs"), 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { pad2 } from "./lib.mjs";\ntest("p", () => assert.equal(pad2(7), "07"));\n');
  g(d, "add", "-A"); g(d, "commit", "-qm", "candidate");
  const patchFile = join(d, "..", `${d.split("/").pop()}.patch`);
  writeFileSync(patchFile, g(d, "format-patch", "-1", "--stdout") + "\n");
  g(d, "reset", "-q", "--hard", base);
  return { d, base, patchFile };
}
const move = (d: string, file: string, content: string) => { writeFileSync(join(d, file), content); g(d, "add", "-A"); g(d, "commit", "-qm", "main moved"); return g(d, "rev-parse", "HEAD"); };

test("stale base, clean re-apply: graded fresh on the new head (suite, pass-after, fail-before) -> COUNTS", () => {
  const { d, base, patchFile } = setup();
  const head = move(d, "other.txt", "y\n");
  const r = rebaseAndRegrade({ worktree: d, patchFile, baseSha: base, identity: ID, run });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.stale, true);
  assert.equal(r.head, head);
  assert.deepEqual(r.grade, { suite: true, newTests: ["lib.pad2.test.mjs"], afterPass: true, beforeFail: true, verdict: "COUNTS" });
  assert.equal(g(d, "rev-parse", "HEAD~1"), head, "applied on top of the current head");
  assert.equal(g(d, "status", "--porcelain"), "", "before-run leaves no residue");
});

test("stale base, does not apply cleanly (same end-of-module context moved): refused, worktree unchanged", () => {
  const { d, base, patchFile } = setup();
  const head = move(d, "lib.mjs", LIB + "\nexport function other(n) {\n  return n;\n}\n");
  const r = rebaseAndRegrade({ worktree: d, patchFile, baseSha: base, identity: ID, run });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /does not apply cleanly/);
  assert.equal(g(d, "rev-parse", "HEAD"), head);
  assert.equal(g(d, "status", "--porcelain"), "");
});

test("stale base: new head breaks the original suite with the candidate -> refused and reset (no old grade reused)", () => {
  const { d, base, patchFile } = setup();
  const head = move(d, "suite.test.mjs", SUITE.replace("6));", "7));"));
  const r = rebaseAndRegrade({ worktree: d, patchFile, baseSha: base, identity: ID, run });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /suite fails/);
  assert.equal(g(d, "rev-parse", "HEAD"), head);
});

test("not stale: applied as before, no regrade needed", () => {
  const { d, base, patchFile } = setup();
  const r = rebaseAndRegrade({ worktree: d, patchFile, baseSha: base, identity: ID, run });
  assert.ok(r.ok && !r.stale);
});

test("pure pieces: patchFiles split; freshVerdict never COUNTS without suite + pass-after + fail-before (a test that passes without the edit is refused)", () => {
  const { patchFile } = setup();
  assert.deepEqual(patchFiles(readFileSync(patchFile, "utf8")), { newTests: ["lib.pad2.test.mjs"], others: ["lib.mjs"] });
  assert.ok("reason" in freshVerdict({ suite: true, newTests: ["t"], afterPass: true, beforeFail: false }));
  assert.ok("reason" in freshVerdict({ suite: true, newTests: ["t"], afterPass: false, beforeFail: true }));
  assert.ok("reason" in freshVerdict({ suite: false, newTests: ["t"], afterPass: true, beforeFail: true }));
  assert.equal((freshVerdict({ suite: true, newTests: ["t"], afterPass: true, beforeFail: true }) as { verdict: string }).verdict, "COUNTS");
});

test("protected: the re-apply/regrade code is in the protected set", () => {
  assert.ok(protectedReason("peaceai/lib/rebase.ts") !== null);
  assert.ok(protectedReason("peaceai/bin/apply-verdict-patch.ts") !== null);
});
