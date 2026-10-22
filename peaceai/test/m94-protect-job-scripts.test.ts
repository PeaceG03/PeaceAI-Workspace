// M94 (Auditor #459 follow-up): every peaceai/bin shell script is protected (they run on the trusted runner in workflow
// jobs, many holding secrets or write tokens), a self-change may not name TARGET_PR_TOKEN, clone-target.sh drops
// TARGET_PR_TOKEN from the anonymous clone's environment, and install-target.sh refuses an empty target dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkSelfChangeDiff, PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const isProt = (p: string) => PROTECTED_SELF.some((x) => x.pattern.test(p));

test("every peaceai/bin/*.sh is protected, including the Job B and verdict scripts", () => {
  const sh = readdirSync(resolve(root, "peaceai/bin")).filter((f) => f.endsWith(".sh"));
  for (const f of ["clone-target.sh", "install-target.sh", "with-deploy-key.sh", "results-write.sh", "stage-chosen.sh", "build-kernel.sh", "key-proof-core.sh", "key-proof-results.sh", "apply-verdict-patch.sh"]) assert.ok(sh.includes(f), f);
  for (const f of [...sh, "new-helper.sh"]) assert.ok(isProt(`peaceai/bin/${f}`), f);
  // Only shell scripts directly under peaceai/bin: a TypeScript tool there keeps its own (un)protected status.
  assert.ok(!isProt("peaceai/bin/m94-not-a-script.ts"));
  // Every workflow that runs a peaceai/bin script runs a protected one.
  for (const wf of readdirSync(resolve(root, ".github/workflows")).filter((f) => f.endsWith(".yml")))
    for (const m of read(`.github/workflows/${wf}`).matchAll(/peaceai\/bin\/([\w-]+\.sh)/g)) assert.ok(isProt(`peaceai/bin/${m[1]}`), `${wf}: ${m[1]}`);
});

test("a self-change may not add TARGET_PR_TOKEN (or the other credential names)", () => {
  const add = (line: string) => `diff --git a/peaceai/lib/x.ts b/peaceai/lib/x.ts\nnew file mode 100644\n--- /dev/null\n+++ b/peaceai/lib/x.ts\n@@ -0,0 +1 @@\n+${line}\n`;
  for (const line of ["const t = process.env.TARGET_PR_TOKEN;", "env.TARGET_PR_TOKEN", "const n = 'GH_TOKEN';"]) {
    const r = checkSelfChangeDiff(add(line));
    assert.equal(r.ok, false, line);
    assert.ok(r.refusals.some((x) => /names a credential/.test(x.reason)), line);
  }
  assert.equal(checkSelfChangeDiff(add("export const one = 1;")).ok, true);
});

test("clone-target.sh drops TARGET_PR_TOKEN (and the other credentials) from the anonymous clone's environment", () => {
  const s = read("peaceai/bin/clone-target.sh");
  const anon = /anon=\(env ([^\n]*)/.exec(s)![1]!;
  for (const v of ["GH_TOKEN", "GITHUB_TOKEN", "DEPLOY_KEY", "TARGET_PR_TOKEN", "GIT_SSH_COMMAND"]) assert.ok(anon.includes(`-u ${v} `), v);
});

test("install-target.sh refuses an empty or missing target dir before cd or any install", () => {
  for (const args of [["", "pnpm"], []]) {
    const r = spawnSync("/bin/bash", [resolve(root, "peaceai/bin/install-target.sh"), ...args], { encoding: "utf8", cwd: root, env: { PATH: "/usr/bin:/bin", PEACEAI_INSTALL_NO_BACKOFF: "1" } });
    assert.equal(r.status, 1, JSON.stringify(args));
    assert.match(r.stderr, /missing target dir/);
  }
});
