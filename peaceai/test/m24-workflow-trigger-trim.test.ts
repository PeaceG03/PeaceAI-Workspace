// M24: a workflow-step task whose header line ends in backticked text still parses after issue cleaning.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { WORKFLOW_TRIGGER } from "../lib/learned-workflow.ts";
import { applyRule, specHash, type RuleSpec } from "../lib/learned.ts";
import { isCanonical, nlDecision } from "../lib/nlparse.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const SPEC = JSON.parse(readFileSync(join(repo, "peaceai/rules/learned/public-workflow-step-v2.json"), "utf8")) as RuleSpec;
const KINDS = new Set(["ADD_WORKFLOW_STEP"]);
const head = (tick: boolean) => tick
  ? "add workflow step Typecheck to job sim in `.github/workflows/sim.yml` running `pnpm run typecheck`"
  : "add workflow step Typecheck to job sim in .github/workflows/sim.yml running pnpm run typecheck";

test("backtick-ending header parses after cleaning (was NO_FAMILY, #130)", () => {
  for (const tick of [true, false]) {
    const d = nlDecision({ title: "[M19 live] workflow step", body: `Target: PeaceG03/PeaceSTOCKS\n\n${head(tick)}\n\nReal need: x\n` }, undefined, KINDS, null);
    assert.equal(d.status, "canonical", `tick=${tick}: ${JSON.stringify(d)}`);
  }
  for (const tail of [" ", "  ", "\t", ". ", ".\t"]) assert.ok(isCanonical(head(false) + tail), JSON.stringify(tail));
});

test("still strict: trailing words, other text after the script, and unapproved kind are not canonical/run", () => {
  for (const tail of [" now", " && curl x", " x", "\u00a0"]) assert.equal(isCanonical(head(false) + tail), false, JSON.stringify(tail));
  const d = nlDecision({ title: "t", body: head(true) }, undefined, new Set(), null);
  assert.equal(d.status === "unsure" && d.reason, "RULE_NOT_APPROVED");
});

test("the spec trigger (and v2's hash) is unchanged; the engine builds from the cleaned, backtick-ending text", () => {
  assert.equal(SPEC.trigger, WORKFLOW_TRIGGER);
  assert.equal(specHash(SPEC), "7c09a06ded2b478ff7af407682aae3d4d5eb19a25d07e1235ee00a86ff87d48b");
  const wf = "name: S\non:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  sim:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@v4\n      - run: pnpm install --frozen-lockfile\n      - name: T\n        run: pnpm -s exec tsx --test src/a.test.ts\n";
  const files = [{ path: ".github/workflows/sim.yml", content: wf }, { path: "package.json", content: JSON.stringify({ scripts: { typecheck: "tsc -p tsconfig.json --noEmit" } }) }, { path: "pnpm-lock.yaml", content: "" }, { path: "tsconfig.json", content: "" }];
  const cleaned = head(true).replace(/`/g, " ").replace(/[ \t]+/g, " ");
  assert.match(cleaned, / $/, "cleaning leaves a trailing space");
  assert.ok(applyRule(SPEC, cleaned, files, (p) => /\.test\.ts$/.test(p)), "engine builds");
});

test("Auditor #133: nlparse.ts is protected", async () => {
  const { protectedReason } = await import("../lib/selfchange.ts");
  assert.ok(protectedReason("peaceai/lib/nlparse.ts"));
});
