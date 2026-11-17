// Capability batch 1. The sentences are made up. No builder-log row, no practice repo, and no fix sha is named.
// EXPERIMENTAL. credit is false.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { routeReplay } from "../lib/capabilityjob.ts";
import { canonicalRequest, envStrictName, guessFamily, opsRequest, scoreFamilies, trainRequestModel, type FamilyRow } from "../lib/requestfamily.ts";
import { envLine, type SlotRepo } from "../lib/slotfill.ts";
import { ENV_FIX_TRIGGER, parseEnvFixTask } from "../lib/env-fix.ts";

const root = resolve(import.meta.dirname, "../..");
const log = readFileSync(resolve(root, "builder-log/tasks.jsonl"), "utf8");
const rows: FamilyRow[] = log.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as FamilyRow);
const model = trainRequestModel(rows);

const repo = (files: Record<string, string>): SlotRepo => ({ files: Object.entries(files).map(([path, content]) => ({ path, content })) });

test("Make NAME strict is the env-fix family, and a lowercase name is not", () => {
  assert.equal(envStrictName("Make WIDGET_MS strict in the worker"), "WIDGET_MS");
  assert.equal(envStrictName("make the cake strict"), null);
  assert.equal(envStrictName("Make WIDGET_MS and OTHER_MS strict"), null);
  const hit = guessFamily(model, "Make WIDGET_MS strict and fail closed beside src/worker.ts");
  assert.equal(hit.family, "ENV_FIX");
  assert.equal(hit.none, false);
  const line = canonicalRequest("ENV_FIX", "Make WIDGET_MS strict in src/worker.ts as a flag");
  assert.equal(line, "make env WIDGET_MS strict in src/worker.ts as a flag");
  assert.ok(parseEnvFixTask(ENV_FIX_TRIGGER, line!));
  const ranged = canonicalRequest("ENV_FIX", "Make WIDGET_MS strict in src/worker.ts as integer 1..50");
  assert.equal(ranged, "make env WIDGET_MS strict in src/worker.ts as integer 1..50");
});

test("a flag read in one file fills the env line, and a second file or another shape refuses", () => {
  const one = repo({
    "src/worker.ts": 'export function go() {\n  if (process.env.WIDGET_MS === "1") return true;\n  return env.WIDGET_MS !== "1";\n}\n',
    "src/worker.test.ts": 'if (process.env.WIDGET_MS === "1") {}\n',
  });
  const line = envLine("WIDGET_MS", one);
  assert.equal(line, "make env WIDGET_MS strict in src/worker.ts as a flag");
  const filled = canonicalRequest("ENV_FIX", "Make WIDGET_MS strict in the worker", one);
  assert.equal(filled, line);
  const two = repo({
    "src/a.ts": 'export const a = process.env.WIDGET_MS === "1";\n',
    "src/b.ts": 'export const b = process.env.WIDGET_MS !== "1";\n',
  });
  assert.equal(envLine("WIDGET_MS", two), null);
  const other = repo({ "src/a.ts": "export const a = Number(process.env.WIDGET_MS) > 0 ? Number(process.env.WIDGET_MS) : DELAY;\n" });
  assert.equal(envLine("WIDGET_MS", other), null);
  const bracket = repo({ "src/a.ts": 'export const a = process.env["WIDGET_MS"] === "1";\n' });
  assert.equal(envLine("WIDGET_MS", bracket), "make env WIDGET_MS strict in src/a.ts as a flag");
});

test("an operational sentence is not a code family, and a path keeps it unsure", () => {
  assert.equal(opsRequest("Rebase the pull request onto main"), true);
  assert.equal(opsRequest("rebase src/worker.ts onto main"), false);
  const ops = guessFamily(model, "Rebase the pull request onto main after the other one merged");
  assert.equal(ops.family, null);
  assert.equal(ops.none, true);
  const route = routeReplay({ model, asked: "Rebase the pull request onto main", changed: "Example@aaaaaaaa", issueBody: null, seq: 1 });
  assert.deepEqual(route, { fail: "NOT_CODE_FAMILY" });
  const near = guessFamily(model, "rebase the offset in src/worker.ts");
  assert.equal(near.family, null);
  assert.equal(near.none, false);
  const kept = guessFamily(model, "add a characterization test for total in src/cart.ts and rebase the notes");
  assert.equal(kept.family, "TEST_CASE_EXISTING");
});

test("dev rows stay correct, and a dropped logic cue is not brought back onto an env sentence", () => {
  const dev = scoreFamilies(model, rows, false);
  assert.equal(dev.wrong, 0);
  assert.equal(dev.correct >= 84, true);
  const held = scoreFamilies(model, rows, true);
  assert.equal(held.wrong, 0);
});

const base = resolve(root, "peaceai/test/.capability-mutants");
mkdirSync(base, { recursive: true });
let n = 0;
async function mutant(guard: string, source: string) {
  const text = readFileSync(resolve(root, source), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((l, i) => (l.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(resolve(root, "peaceai/lib", f)).href)}`);
  const file = join(base, `mutant-${n++}.ts`);
  writeFileSync(file, next);
  return import(pathToFileURL(file).href);
}

test("deleting the guards admits the near miss", async () => {
  const sentence = "Make WIDGET_MS strict and fail closed beside src/worker.ts";
  assert.equal(guessFamily(model, sentence).family, "ENV_FIX");
  const opened = await mutant("family-guard:env-not-logic", "peaceai/lib/requestfamily.ts") as typeof import("../lib/requestfamily.ts");
  const kept = opened.trainRequestModel(rows);
  const families = kept.families.includes("MODIFY_LOGIC") ? kept.families : [...kept.families, "MODIFY_LOGIC"];
  assert.equal(opened.guessFamily({ ...kept, families }, sentence).family, "MODIFY_LOGIC");

  const two = repo({
    "src/a.ts": 'export const a = process.env.WIDGET_MS === "1";\n',
    "src/b.ts": 'export const b = process.env.WIDGET_MS !== "1";\n',
  });
  assert.equal(envLine("WIDGET_MS", two), null);
  const both = await mutant("slot-guard:one-env", "peaceai/lib/slotfill.ts") as { envLine: typeof envLine };
  assert.equal(both.envLine("WIDGET_MS", two), "make env WIDGET_MS strict in src/a.ts as a flag");

  const other = repo({ "src/a.ts": "export const n = Number(process.env.WIDGET_MS) || 1;\n" });
  assert.equal(envLine("WIDGET_MS", other), null);
  const shape = await mutant("slot-guard:env-shape", "peaceai/lib/slotfill.ts") as { envLine: typeof envLine };
  assert.equal(shape.envLine("WIDGET_MS", other), "make env WIDGET_MS strict in src/a.ts as a flag");

  assert.equal(opsRequest("rebase src/worker.ts"), false);
  const coded = await mutant("family-guard:ops-code", "peaceai/lib/requestfamily.ts") as { opsRequest: typeof opsRequest };
  assert.equal(coded.opsRequest("rebase src/worker.ts"), true);
});
