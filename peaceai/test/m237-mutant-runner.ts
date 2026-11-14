// Runs one follow-up case set against a mutant of editpropose.ts or testspec.ts.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const mod = await import(pathToFileURL(process.argv[2]!).href);
const suite = process.argv[3]!;
const failed: string[] = [];
const crashed: string[] = [];

function check(id: string, run: () => void): void {
  try { run(); } catch (e) {
    const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
    if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(id);
    else crashed.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const call = [
  "export function counted(bins: Record<string, number>): number {",
  "  const has = Object.prototype.hasOwnProperty;",
  "  let total = 0;",
  "  for (const label in bins) { if (!has.call(bins, label)) continue; total += bins[label] ?? 0; }",
  "  return total;",
  "}",
].join("\n");
const direct = [
  "export function counted(bins: Record<string, number>): number {",
  "  const has = Object.hasOwn;",
  "  let total = 0;",
  "  for (const label in bins) { if (!has(bins, label)) continue; total += bins[label] ?? 0; }",
  "  return total;",
  "}",
].join("\n");

function ownHits(text: string): string[] {
  const site = { path: "src/bin.ts", name: "counted", start: 0, end: text.length, tier: 0 };
  return mod.idiomMutationsIn(mod.parseSource("src/bin.ts", text), site, 0).filter((m: { template: string }) => m.template === "own-keys");
}

function loops(count: number): string {
  const names = ["open", "closed", "hold", "spare", "extra"];
  const params = names.slice(0, count).map((name) => `${name}: Record<string, number>`).join(", ");
  const lines = [`export function tally(${params}): number {`, "  let total = 0;"];
  for (const name of names.slice(0, count)) lines.push(`  for (const label in ${name}) total += ${name}[label] ?? 0;`);
  lines.push("  return total;", "}");
  return lines.join("\n");
}

if (suite === "propose") {
  check("alias-init", () => { assert.equal(ownHits(call).length, 0); });
  check("alias-use", () => { assert.equal(ownHits(direct).length, 0); assert.equal(ownHits(call).length, 0); });
  check("enum-roundtrip", () => {
    const text = "export function listed(code: unknown, statuses: object): boolean {\n  return Object.values(statuses).includes(code);\n}\n";
    const site = { path: "src/desk.ts", name: "listed", start: 0, end: text.length, tier: 0 };
    const got = mod.idiomMutationsIn(mod.parseSource("src/desk.ts", text), site, 0).filter((m: { template: string }) => m.template === "enum-values").map((m: { text: string }) => m.text);
    assert.equal(got.length, 1);
    assert.match(got[0], /\[\(statuses as Record<PropertyKey, unknown>\)\[member\] as PropertyKey\] !== member/);
  });
  check("bundle-max", () => {
    const five = loops(5);
    const queued = mod.repairCandidates([{ path: "src/tally.ts", name: "tally", start: 0, end: five.length, tier: 0 }], new Map([["src/tally.ts", five]]), new Set(), true);
    assert.equal(queued.filter((c: { muts: { template: string }[] }) => c.muts.length >= 5 && c.muts.every((m) => m.template === "own-keys")).length, 0);
  });
  check("enum-keys", () => {
    const text = "export function listed(code: unknown, statuses: object): boolean {\n  return Object.values(statuses).includes(code);\n}\n";
    const site = { path: "src/desk.ts", name: "listed", start: 0, end: text.length, tier: 0 };
    const got = mod.idiomMutationsIn(mod.parseSource("src/desk.ts", text), site, 0).filter((m: { template: string }) => m.template === "enum-keys").map((m: { text: string }) => m.text);
    assert.equal(got.length, 1);
    assert.match(got[0], /typeof member === "number"/);
  });
  check("numeric-trim", () => {
    const text = "export function readPrice(price: unknown): boolean {\n  return typeof price === \"string\" && !Number.isNaN(Number(price));\n}\n";
    const site = { path: "src/till.ts", name: "readPrice", start: 0, end: text.length, tier: 0 };
    const got = mod.idiomMutationsIn(mod.parseSource("src/till.ts", text), site, 0).filter((m: { template: string }) => m.template === "numeric-trim").map((m: { text: string }) => m.text);
    assert.equal(got.length, 1);
    assert.match(got[0], /price\.trim\(\) === price/);
  });
  check("plain-object", () => {
    const text = "export function vacant(bin: object): boolean {\n  return Object.keys(bin).length === 0;\n}\n";
    const site = { path: "src/bin.ts", name: "vacant", start: 0, end: text.length, tier: 0 };
    const got = mod.idiomMutationsIn(mod.parseSource("src/bin.ts", text), site, 0).filter((m: { template: string }) => m.template === "plain-object").map((m: { text: string }) => m.text);
    assert.equal(got.length, 1);
    assert.match(got[0], /!Array\.isArray\(bin\)/);
  });
}

if (suite === "spec") {
  const titles = ["  ✖ rejects an empty crate", "  ✖ ships a crate twice", "  ✖ 2 tests failed"].join("\n");
  check("ava-cross", () => { assert.deepEqual(mod.failingTestNames(titles), ["rejects an empty crate", "ships a crate twice"]); });
  check("ava-summary", () => { assert.equal(mod.failingTestNames("✖ 2 tests failed").includes("2 tests failed"), false); });
  check("ava-banner", () => { assert.deepEqual(mod.failingTestNames("✖ test/crate.ts exited with a non-zero exit code: 1"), []); });
}

process.stdout.write(JSON.stringify({ failed, crashed }) + "\n");
