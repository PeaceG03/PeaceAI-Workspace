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

const later = [
  "export function counted(bins: Record<string, number>): number {",
  "  let total = 0;",
  "  for (const label in bins) { if (!has(bins, label)) continue; total += bins[label] ?? 0; }",
  "  const has = Object.hasOwn;",
  "  return total;",
  "}",
].join("\n");
const optional = [
  "export function counted(bins: Record<string, number>): number {",
  "  const has = Object?.hasOwn;",
  "  let total = 0;",
  "  for (const label in bins) { if (!has(bins, label)) continue; total += bins[label] ?? 0; }",
  "  return total;",
  "}",
].join("\n");
const sibling = [
  "export function counted(bins: Record<string, number>): number {",
  "  if (bins) { const has = Object.hasOwn; void has; }",
  "  let total = 0;",
  "  for (const label in bins) { if (!has(bins, label)) continue; total += bins[label] ?? 0; }",
  "  return total;",
  "}",
].join("\n");
const shadow = [
  "export function counted(bins: Record<string, number>): number {",
  "  const has = Object.hasOwn;",
  "  let total = 0;",
  "  { const has = Object.keys; for (const label in bins) { if (!has(bins, label)) continue; total += bins[label] ?? 0; } }",
  "  return total;",
  "}",
].join("\n");
const rebound = [
  "export function counted(bins: Record<string, number>): number {",
  "  let has = Object.hasOwn;",
  "  has = Object.keys;",
  "  let total = 0;",
  "  for (const label in bins) { if (!has(bins, label)) continue; total += bins[label] ?? 0; }",
  "  return total;",
  "}",
].join("\n");
const optionalProto = [
  "export function counted(bins: Record<string, number>): number {",
  "  const has = Object?.prototype.hasOwnProperty;",
  "  let total = 0;",
  "  for (const label in bins) { if (!has.call(bins, label)) continue; total += bins[label] ?? 0; }",
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
  check("own-alias-order", () => { assert.equal(ownHits(later).length, 1); });
  check("own-alias-scope", () => { assert.equal(ownHits(direct).length, 0); });
  check("own-alias-optional", () => { assert.equal(ownHits(optional).length, 1); });
  check("own-alias-optional-proto", () => { assert.equal(ownHits(optionalProto).length, 1); });
  check("own-alias-block", () => { assert.equal(ownHits(sibling).length, 1); });
  check("own-alias-shadow", () => { assert.equal(ownHits(shadow).length, 1); });
  check("own-alias-reassign", () => { assert.equal(ownHits(rebound).length, 1); });
  check("bundle-max", () => {
    const five = loops(5);
    const queued = mod.repairCandidates([{ path: "src/tally.ts", name: "tally", start: 0, end: five.length, tier: 0 }], new Map([["src/tally.ts", five]]), new Set(), true);
    assert.equal(queued.filter((c: { muts: { template: string }[] }) => c.muts.length >= 5 && c.muts.every((m) => m.template === "own-keys")).length, 0);
  });
}

if (suite === "spec") {
  const titles = ["  ✖ rejects an empty crate", "  ✖ ships a crate twice", "  ✘ [fail]: pads a label"].join("\n");
  check("ava-cross", () => { assert.deepEqual(mod.failingTestNames(titles), ["pads a label", "rejects an empty crate", "ships a crate twice"]); });
  check("ava-fail", () => { assert.deepEqual(mod.failingTestNames("  ✘ [fail]: rejects an empty crate"), ["rejects an empty crate"]); });
  check("ava-summary-count", () => { assert.deepEqual(mod.failingTestNames("  ✘ [fail]: 2 tests failed"), []); });
  check("ava-summary-one", () => { assert.deepEqual(mod.failingTestNames("  ✘ [fail]: 1 test failed"), []); });
  check("ava-banner", () => { assert.deepEqual(mod.failingTestNames("  ✘ [fail]: test/pad.ts exited with a non-zero exit code: 1"), []); });
  check("ava-banner-error", () => { assert.deepEqual(mod.failingTestNames("  ✘ [fail]: test/pad.ts exited due to an error:"), []); });
}

process.stdout.write(JSON.stringify({ failed, crashed }) + "\n");
