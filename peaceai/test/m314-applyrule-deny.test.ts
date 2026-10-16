// #314: applyRule enforces the target's denyPatterns itself (regression: the box dry-run of batch2 C02
// built a src/host.ts candidate for PeaceSTOCKS because it passed an unfiltered file list).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyRule, deniedEditPath } from "../lib/learned.ts";

const spec = JSON.parse(readFileSync(join(import.meta.dirname, "..", "rules", "learned", "public-env-fix-v1.json"), "utf8"));
const TASK = "make env `PEACEAI_MARKETS_SCHEDULER_PROBE` strict in `src/host.ts` as a flag";
const host = { path: "src/host.ts", content: 'export function probe(): boolean {\n  if (process.env.PEACEAI_MARKETS_SCHEDULER_PROBE === "1") return true;\n  return false;\n}\n' };
const isTest = (p: string) => /\.test\.ts$/.test(p);

test("C02 case: denied src/host.ts on PeaceSTOCKS is refused even from an unfiltered file list", () => {
  const why: { reason?: string } = {};
  assert.equal(applyRule(spec, TASK, [host], isTest, "PeaceG03/PeaceSTOCKS", why), null);
  assert.equal(why.reason, "denied_path");
});

test("same task builds on a target without that deny (control: the rule itself still works)", () => {
  const why: { reason?: string } = {};
  const edit = applyRule(spec, TASK, [host], isTest, "PeaceG03/PeaceAI-Workspace", why);
  assert.ok(edit, why.reason);
  assert.equal(edit!.path, "src/host.ts");
});

test("deniedEditPath: deny patterns, extra paths, opted-in workflow, unknown target", () => {
  const S = "PeaceG03/PeaceSTOCKS";
  assert.equal(deniedEditPath(S, ["src/identity.ts"]), false);
  assert.equal(deniedEditPath(S, ["src/identity.ts", "src/fixtures/x.ts"]), true);
  assert.equal(deniedEditPath(S, ["src/backfill.ts"]), true);
  assert.equal(deniedEditPath(S, [".github/workflows/tenmin-mode-sim.yml"]), false);
  assert.equal(deniedEditPath(S, [".github/workflows/scanner.yml"]), true);
  assert.equal(deniedEditPath("PeaceG03/Unknown", ["src/host.ts"]), false);
});
