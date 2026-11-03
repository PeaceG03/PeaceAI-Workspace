// M168: repair-v2, the opt-in second edit proposer (peaceai/lib/editpropose.ts, repairProposer({ v2: true }); spec
// peaceai/spec/edit-proposer-v2.md). Behavior cases live in m168-cases.ts (replayed against mutants by
// m168-mutation.test.ts); this file adds the static checks, the bin/loop.ts wiring and one real-loop case on a tiny
// synthetic node:test repo in the stage-2 isolation (candidate uid required; without it the case asserts the
// CAND_UID_* refusal).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as prop from "../lib/editpropose.ts";
import * as loop from "../lib/loop.ts";
import type { PlanTask } from "../lib/plan.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";
import { CASES, setup, teardown, type Ctx } from "./m168-cases.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

for (const c of CASES) test(`M168: ${c.id}`, () => c.run({ prop }, ctx));

test("M168: repair-v1 is unchanged: its template list, its imports and its default name; repair-v2 only adds idioms in front", () => {
  assert.deepEqual([...prop.TEMPLATES], ["missing-export", "nullish-check", "comparison", "arithmetic", "off-by-one", "logical", "default-value", "null-guard", "negate-condition", "boolean-return"]);
  assert.deepEqual([...prop.IDIOM_TEMPLATES], ["discarded-result", "case-predicate", "typeof-null", "proto-safe-copy", "undefined-keeps-key"]); // M172: + undefined-keeps-key
  assert.deepEqual([...prop.TEMPLATES_V2], [...prop.IDIOM_TEMPLATES, ...prop.TEMPLATES, ...prop.CONST_TEMPLATES, ...prop.SSTUB_TEMPLATES]); // M173: + const-value; M176: + SStuB classes last
  assert.deepEqual(prop.CALLEE_DEPTH, { v1: 1, v2: 2 });
  assert.equal(prop.REPAIR_PROPOSER, "repair-v1");
  assert.equal(prop.REPAIR_PROPOSER_V2, "repair-v2");
  const src = readFileSync(join(ROOT, "peaceai/lib/editpropose.ts"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(code, /PeaceSTOCKS|peacestocks|scanner|defu|destr|scule|ohash|yup|valibot|remeda|neverthrow|kysely|github\.com|https?:\/\//i);
});

test("M168: bin/loop.ts accepts --proposer repair-v2 and builds repairProposer({ v2: true }); the default stays rules-v1", () => {
  const src = readFileSync(join(ROOT, "peaceai/bin/loop.ts"), "utf8");
  assert.match(src, /prop !== "repair-v2"/);
  assert.match(src, /prop === "repair-v2" \? \(\): Proposer => repairProposer\(\{ v2: true \}\)/);
  assert.match(src, /prop === "repair-v1" \? \(\): Proposer => repairProposer\(\) :/);
});

// ---- the real loop on a synthetic node:test repo: a dropped filter result in a class method
const MIT = `MIT License\n\nCopyright (c) 2026 M168 fixture\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software, to deal in the\nSoftware without restriction. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n`;
const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", [...G, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const QUEUE = (fixed: boolean) => `export class Queue {\n  items: number[] = [];\n  push(x: number): this { this.items.push(x); return this; }\n  drop(x: number): this {\n    ${fixed ? "this.items = " : ""}this.items.filter((y) => y !== x);\n    return this;\n  }\n  get size(): number { return this.items.length; }\n}\n`;

test("M168: the real loop with repair-v2 passes a dropped-filter-result task (row proposer repair-v2); near miss: repair-v1 on the same task does not", () => {
  const base = mkdtempSync(join(tmpdir(), "peaceai-m168-loop-"));
  try {
    chmodSync(base, 0o755);
    const dir = join(base, "repos/queue");
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    const put = (files: Record<string, string>) => { for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); } };
    put({ "package.json": JSON.stringify({ name: "fixture", private: true, type: "module", scripts: { test: "node --test" } }, null, 1) + "\n", LICENSE: MIT, "src/queue.ts": QUEUE(false) });
    git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "base");
    const commit = git(dir, "rev-parse", "HEAD");
    put({ "src/queue.ts": QUEUE(true), "test/queue.test.ts": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { Queue } from "../src/queue.ts";\n\ntest("drop removes the item", () => assert.equal(new Queue().push(1).push(2).drop(1).size, 1));\ntest("drop of a missing item keeps the rest", () => assert.equal(new Queue().push(3).drop(9).size, 1));\n` });
    git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "reference");
    const merge = git(dir, "rev-parse", "HEAD");
    const task: PlanTask = {
      id: "m168-queue", repo: "m168-fixture/queue", license: "MIT", licensePath: "LICENSE", licenseSha256: createHash("sha256").update(MIT).digest("hex"), commit,
      request: "`new Queue().push(1).drop(1).size` is still 1: `drop` must remove the item.",
      tests: { command: "node --test", files: ["test/queue.test.ts"] },
      reference: { from: { pr: 1, merge }, files: [{ path: "src/queue.ts", change: "modify" }, { path: "test/queue.test.ts", change: "add" }],
        steps: [{ action: "edit-source", file: "src/queue.ts" }, { action: "add-test", file: "test/queue.test.ts" }, { action: "run-tests", file: null }], docs: [] },
      trainingCheck: { workspaceCommit: "0".repeat(40), sources: 0, inTraining: false },
    };
    const root = join(base, "root");
    mkdirSync(join(root, "peaceai/plan"), { recursive: true });
    git(root, "init", "-q", "-b", "main");
    const env = { ...process.env, [STAGE2_CAND_ENV]: process.env.M168_CAND ?? process.env.M152_CAND ?? process.env.M146_CAND ?? "peaceai-cand" };
    const fetcher = loop.gitCopyFetcher((r) => join(base, "repos", r.split("/")[1]!));
    const run = (proposer: loop.Proposer) => loop.runLoopTask(task, "public", "a".repeat(64), { root, fetcher, proposer, maxAttempts: 20, runMs: 120_000, env, rules: [], training: new Set<string>() });
    if (!stage2CandUid(env).ok) { assert.match(run(prop.repairProposer({ v2: true })).row.code, /^CAND_UID_/); return; }
    const v2 = run(prop.repairProposer({ v2: true }));
    assert.equal(v2.row.code, "PASS");
    assert.equal(v2.row.proposer, "repair-v2");
    assert.ok(v2.row.baseline && v2.row.baseline.failing > 0);
    const v1 = run(prop.repairProposer());
    assert.notEqual(v1.row.code, "PASS", "near miss: repair-v1 has no idiom template, so it cannot write this fix");
    assert.equal(v1.row.proposer, "repair-v1");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
