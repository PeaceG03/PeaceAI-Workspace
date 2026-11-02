// M169: the deps dir the candidate uid can reach (run 41488888877: every install DEPS_INSTALL_FAILED with the cache
// under $RUNNER_TEMP), install-failure subcodes on public rows (codes only), the inert pnpm-workspace.yaml build /
// release-age keys, and bin/loop.ts's LOOP_CRASHED catch (spec: peaceai/spec/loop-deps-access-v1.md). Behavior cases
// live in m169-cases.ts (replayed against mutants by m169-mutation.test.ts); this file runs them once and pins the
// attempt job's pre-flight step. Synthetic fixtures only; no network.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as deps from "../lib/loopdeps.ts";
import * as loop from "../lib/loop.ts";
import * as row from "../lib/looprow.ts";
import { binChecks, CASES } from "./m169-cases.ts";
import { setup, teardown, type Ctx } from "./m151-fixtures.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

for (const c of CASES) test(`M169: ${c.id}`, (t) => { if (c.needsCand && !ctx.cand) { t.skip(c.needsCand); return; } c.run({ deps, loop, row }, ctx); });

test("M169: bin/loop.ts prints TASK_FILE_INVALID only for the task file, LOOP_CRASHED <code> for any other throw", () => {
  const scratch = mkdtempSync(join(tmpdir(), "peaceai-m169-bin-"));
  try { binChecks(join(ROOT, "node_modules/.bin/tsx"), join(ROOT, "peaceai/bin/loop.ts"), ROOT, scratch); } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("M169: the attempt job proves the candidate uid can reach and write the deps dir (fail closed) before any loop run", () => {
  const wf = readFileSync(join(ROOT, ".github/workflows/peace-model-v1-dev.yml"), "utf8");
  const job = wf.slice(wf.indexOf("\n  model-v1-attempt:"));
  const next = /\n  [a-z0-9-]+:\n/.exec(job.slice(1));
  const steps = next ? job.slice(0, next.index + 1) : job;
  const user = steps.indexOf("sudo useradd --system --no-create-home --shell /usr/sbin/nologin peaceai-cand");
  const pre = steps.indexOf("Pre-flight (fail closed) - the candidate uid can traverse and write the deps dir");
  const firstRun = steps.indexOf("peaceai/bin/loop.ts run");
  assert.ok(user > 0 && pre > user && firstRun > pre, "user, then pre-flight, then the loop");
  const body = steps.slice(pre, steps.indexOf("\n      - name:", pre + 1));
  assert.match(body, /set -euo pipefail/);
  assert.match(body, /D=\$\(mktemp -d \/tmp\/peaceai-deps\.XXXXXX\); chmod 755 "\$D"/);
  assert.match(body, /sudo -n -u peaceai-cand -- test -x "\$D" \|\| \{ echo "refused DEPS_DIR_CAND_NO_TRAVERSE"; exit 1; \}/);
  assert.match(body, /sudo -n -u peaceai-cand -- sh -c 'touch "\$1\/w" && rm "\$1\/w"' sh "\$P" \|\| \{ echo "refused DEPS_DIR_CAND_NO_WRITE"; exit 1; \}/);
  assert.match(body, /echo "PEACEAI_DEPS_DIR=\$D" >> "\$GITHUB_ENV"/);
  assert.ok(body.indexOf("GITHUB_ENV") > body.indexOf("DEPS_DIR_CAND_NO_WRITE"), "exported only after both checks");
  assert.match(body, /runner-temp candidate-traversable=yes"; else echo "runner-temp candidate-traversable=no"/, "the diagnosis line prints yes/no only");
  assert.equal((steps.match(/--deps-dir "\$PEACEAI_DEPS_DIR"/g) ?? []).length, 3);
  assert.ok(!wf.includes('--deps-dir "$RUNNER_TEMP/deps"'));
});
