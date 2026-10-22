// M95: every peaceai TypeScript file a workflow step runs (named in .github/workflows, also via the tools/ checkout,
// or in a package.json script) is protected; pr-guard.ts first, since its output drives the step holding TARGET_PR_TOKEN.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const isProt = (p: string) => PROTECTED_SELF.some((x) => x.pattern.test(p));
const NAMED = /(?:^|[^\w./-])(?:tools\/)?(peaceai\/[\w./-]+\.ts)\b/g;

test("the verdict and Job tools are protected (pr-guard.ts first)", () => {
  for (const p of ["peaceai/bin/pr-guard.ts", "peaceai/bin/verdict-patch.ts", "peaceai/bin/parse-verdict.ts", "peaceai/bin/target-check.ts", "peaceai/bin/issue-fetch.ts", "peaceai/bin/lm-fill.ts", "peaceai/bin/lm-provenance.ts", "peaceai/bin/no-candidate-comment.ts", "peaceai/bin/review-comment.ts", "peaceai/bin/select.ts", "peaceai/bin/train.ts", "peaceai/proof/tamper-proof.ts"]) {
    assert.ok(existsSync(resolve(root, p)), p);
    assert.ok(isProt(p), p);
  }
  // pr-guard.ts output gates the target-pr step, which holds TARGET_PR_TOKEN.
  const v = read(".github/workflows/peace-verdict.yml");
  assert.match(v, /pr-guard\.ts/);
  assert.match(v, /TARGET_PR_TOKEN/);
  // Neighbours stay as they were (the entry is an exact list, not a directory).
  assert.ok(!isProt("peaceai/bin/m95-not-a-tool.ts"));
});

test("every peaceai .ts named in a workflow or a package.json script is protected", () => {
  const named = new Map<string, string>();
  for (const wf of readdirSync(resolve(root, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f)))
    for (const m of read(`.github/workflows/${wf}`).matchAll(NAMED)) named.set(m[1]!, wf);
  for (const [k, v] of Object.entries((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts))
    for (const m of v.matchAll(/(peaceai\/[\w./-]+\.ts)/g)) named.set(m[1]!, `package.json ${k}`);
  assert.ok(named.size >= 20, String(named.size));
  for (const [p, where] of named) assert.ok(isProt(p), `${where}: ${p}`);
});
