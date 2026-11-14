// Two repair-v2 idioms. The fixtures are written for this test. They are not practice-set rows.
import assert from "node:assert/strict";
import test from "node:test";
import { idiomMutationsIn, MAX_CANDIDATES, namedSymbols, parseSource, repairCandidates, type Site } from "../lib/editpropose.ts";

function hits(text: string, template: string): string[] {
  const site: Site = { path: "src/desk.ts", name: "desk", start: 0, end: text.length, tier: 0 };
  return idiomMutationsIn(parseSource("src/desk.ts", text), site, 0).filter((m) => m.template === template).map((m) => m.text);
}

/** Keep a value unless it is the reverse-mapped name of a numeric property. */
function keepsMember(table: Record<PropertyKey, unknown>, member: unknown): boolean {
  if (typeof member !== "string") return true;
  const back = table[member];
  return typeof back !== "number" || table[back] !== member;
}

test("a code span does not invent a compound name from a dotted keyword", () => {
  assert.deepEqual(namedSymbols("Fix `is.class` for a minified class"), ["is"]);
  assert.deepEqual(namedSymbols("`inRange(5, 1, 5)` is false; `JSON.parse('{\"__a\":1}')` and parseFoo_bar in MAX_SIZE"), ["inRange", "parseFoo_bar", "MAX_SIZE"]);
});

test("own-keys guards a for-in and skips a loop that already checks ownership", () => {
  const text = [
    "export function binTotal(bins: Record<string, number>): number {",
    "  let total = 0;",
    "  for (const label in bins) total += bins[label] ?? 0;",
    "  return total;",
    "}",
  ].join("\n");
  const got = hits(text, "own-keys");
  assert.equal(got.length, 1);
  assert.match(got[0]!, /for \(const label in bins\)/);
  assert.match(got[0]!, /if \(!Object\.hasOwn\(bins, label\)\) continue;/);
  assert.match(got[0]!, /total \+= bins\[label\]/);
  assert.doesNotMatch(got[0]!, /Object\.keys/);
  const guarded = [
    "export function counted(bins: Record<string, number>): number {",
    "  let total = 0;",
    "  for (const label in bins) {",
    "    if (!Object.hasOwn(bins, label)) continue;",
    "    total += bins[label] ?? 0;",
    "  }",
    "  return total;",
    "}",
  ].join("\n");
  const viaMethod = "export function viaMethod(bins: Record<string, number>): number {\n  let total = 0;\n  for (const label in bins) {\n    if (!bins.hasOwnProperty(label)) continue;\n    total += bins[label] ?? 0;\n  }\n  return total;\n}\n";
  const viaCall = "export function viaCall(bins: Record<string, number>): number {\n  let total = 0;\n  for (const label in bins) {\n    if (!Object.prototype.hasOwnProperty.call(bins, label)) continue;\n    total += bins[label] ?? 0;\n  }\n  return total;\n}\n";
  const ofLoop = "export function listed(names: string[]): number {\n  let total = 0;\n  for (const label of names) total += label.length;\n  return total;\n}\n";
  const called = "export function fresh(): number {\n  let total = 0;\n  for (const label in readBins()) total += label.length;\n  return total;\n}\nfunction readBins(): Record<string, number> { return {}; }\n";
  assert.deepEqual(hits(guarded, "own-keys"), []);
  assert.deepEqual(hits(viaMethod, "own-keys"), []);
  assert.deepEqual(hits(viaCall, "own-keys"), []);
  assert.deepEqual(hits(ofLoop, "own-keys"), []);
  assert.deepEqual(hits(called, "own-keys"), []);
  const nested = [
    "export function score(roster: Record<string, number>): number {",
    "  let total = 0;",
    "  for (const id in roster) {",
    "    const peek = () => Object.hasOwn(roster, id);",
    "    total += roster[id] ?? 0;",
    "    void peek;",
    "  }",
    "  return total;",
    "}",
  ].join("\n");
  assert.equal(hits(nested, "own-keys").length, 1);
  const proto = { inherited: 1 };
  const bins = Object.create(proto) as Record<string, number> & { kept: number };
  bins.kept = 2;
  const seen: string[] = [];
  for (const label in bins) {
    if (!Object.hasOwn(bins, label)) continue;
    seen.push(label);
  }
  assert.deepEqual(seen, ["kept"]);
});

test("enum-values drops a numeric reverse name and leaves a string table alone", () => {
  const text = [
    "export function ticketListed(code: unknown, statuses: object): boolean {",
    "  return Object.values(statuses).includes(code);",
    "}",
  ].join("\n");
  const got = hits(text, "enum-values");
  assert.equal(got.length, 1);
  assert.match(got[0]!, /Object\.values\(statuses\)\.filter\(\(member\) => typeof member !== "string" \|\| typeof \(statuses as Record<PropertyKey, unknown>\)\[member\] !== "number"/);
  assert.match(got[0]!, /\.includes\(code\)/);
  assert.doesNotMatch(got[0]!, /Number\.isNaN/);
  const numeric: Record<PropertyKey, unknown> = { Draft: 0, Sent: 1, 0: "Draft", 1: "Sent" };
  const textual: Record<PropertyKey, unknown> = { Draft: "draft", Sent: "sent" };
  assert.deepEqual(Object.values(numeric).filter((member) => keepsMember(numeric, member)).sort(), [0, 1]);
  assert.equal(keepsMember(numeric, "Draft"), false);
  assert.deepEqual(Object.values(textual).filter((member) => keepsMember(textual, member)).sort(), ["draft", "sent"]);
  const keys = "export function named(code: string, statuses: object): boolean {\n  return Object.keys(statuses).includes(code);\n}\n";
  const index = "export function at(code: unknown, statuses: object): boolean {\n  return Object.values(statuses).indexOf(code) >= 0;\n}\n";
  const called = "export function normalized(statuses: object): boolean {\n  return Object.values(statuses).includes(readCode());\n}\nfunction readCode(): string { return \"\"; }\n";
  const filtered = "export function onlyNumbers(code: unknown, statuses: object): boolean {\n  return Object.values(statuses).filter((member) => typeof member === \"number\").includes(code);\n}\n";
  const extraArg = "export function fromZero(code: unknown, statuses: object): boolean {\n  return Object.values(statuses).includes(code, 0);\n}\n";
  assert.deepEqual(hits(keys, "enum-values"), []);
  assert.deepEqual(hits(index, "enum-values"), []);
  assert.deepEqual(hits(called, "enum-values"), []);
  assert.deepEqual(hits(filtered, "enum-values"), []);
  assert.deepEqual(hits(extraArg, "enum-values"), []);
  const site: Site = { path: "src/desk.ts", name: "ticketListed", start: 0, end: text.length, tier: 0 };
  const queued = repairCandidates([site], new Map([["src/desk.ts", text]]), new Set(), true);
  assert.ok(queued.some((c) => c.muts.some((m) => m.template === "enum-values")));
});

test("two own-key guards are one candidate, and a nested loop is not bundled", () => {
  const siblings = [
    "export function deskTotal(open: Record<string, number>, closed: Record<string, number>): number {",
    "  let total = 0;",
    "  for (const label in open) total += open[label] ?? 0;",
    "  for (const label in closed) total += closed[label] ?? 0;",
    "  return total;",
    "}",
  ].join("\n");
  const site: Site = { path: "src/desk.ts", name: "desk", start: 0, end: siblings.length, tier: 0 };
  const queued = repairCandidates([site], new Map([["src/desk.ts", siblings]]), new Set(), true);
  const bundle = queued.find((c) => c.muts.length === 2 && c.muts.every((m) => m.template === "own-keys"));
  assert.ok(bundle);
  assert.equal(queued[0], bundle);
  assert.match(bundle!.edits[0]!.content, /Object\.hasOwn\(open, label\)/);
  assert.match(bundle!.edits[0]!.content, /Object\.hasOwn\(closed, label\)/);
  const nested = [
    "export function walk(outer: Record<string, { tag: string }>, side: Record<string, number>): string[] {",
    "  const out: string[] = [];",
    "  for (const label in outer) {",
    "    const child = outer[label];",
    "    if (child) for (const field in child) out.push(field);",
    "  }",
    "  for (const label in side) out.push(label);",
    "  return out;",
    "}",
  ].join("\n");
  const nestedQueue = repairCandidates([{ path: "src/walk.ts", name: "walk", start: 0, end: nested.length, tier: 0 }], new Map([["src/walk.ts", nested]]), new Set(), true);
  const nestedBundle = nestedQueue.filter((c) => c.muts.length === 2 && c.muts.every((m) => m.template === "own-keys"));
  assert.equal(nestedBundle.length, 1);
  assert.match(nestedBundle[0]!.edits[0]!.content, /Object\.hasOwn\(outer, label\)/);
  assert.match(nestedBundle[0]!.edits[0]!.content, /Object\.hasOwn\(side, label\)/);
  assert.match(nestedBundle[0]!.edits[0]!.content, /for \(const field in child\) out\.push\(field\)/);
  assert.equal(nestedQueue.filter((c) => c.muts.length > 2 && c.muts.every((m) => m.template === "own-keys")).length, 0);
});

test("an own-key bundle does not push the candidate list past the cap", () => {
  const lines = ["export function tally(open: Record<string, number>, closed: Record<string, number>): number {", "  let total = 0;"];
  lines.push("  for (const label in open) total += open[label] ?? 0;");
  lines.push("  for (const label in closed) total += closed[label] ?? 0;");
  for (let i = 0; i < 40; i++) lines.push(`  if (total > ${i}) total = total - 1;`);
  lines.push("  return total;", "}");
  const text = lines.join("\n");
  const queued = repairCandidates([{ path: "src/tally.ts", name: "tally", start: 0, end: text.length, tier: 0 }], new Map([["src/tally.ts", text]]), new Set(), true);
  assert.equal(queued.length, MAX_CANDIDATES);
  assert.equal(queued[0]!.muts.length, 2);
  assert.ok(queued[0]!.muts.every((m) => m.template === "own-keys"));
});

test("an enum string is dropped only when the numeric value maps back to it", () => {
  const text = [
    "export function listed(code: unknown, statuses: object): boolean {",
    "  return Object.values(statuses).includes(code);",
    "}",
  ].join("\n");
  const got = hits(text, "enum-values");
  assert.equal(got.length, 1);
  assert.match(got[0]!, /\[\(statuses as Record<PropertyKey, unknown>\)\[member\] as PropertyKey\] !== member/);
  const reversed: Record<PropertyKey, unknown> = { Draft: 0, Sent: 1, 0: "Draft", 1: "Sent" };
  const labeled: Record<PropertyKey, unknown> = { label: 2, 2: "other" };
  assert.equal(keepsMember(reversed, "Draft"), false);
  assert.equal(keepsMember(reversed, 0), true);
  assert.equal(keepsMember(labeled, "label"), true);
  assert.equal(keepsMember(labeled, 2), true);
});

function loops(count: number): string {
  const names = ["open", "closed", "hold", "spare", "extra"];
  const params = names.slice(0, count).map((name) => `${name}: Record<string, number>`).join(", ");
  const lines = [`export function tally(${params}): number {`, "  let total = 0;"];
  for (const name of names.slice(0, count)) lines.push(`  for (const label in ${name}) total += ${name}[label] ?? 0;`);
  lines.push("  return total;", "}");
  return lines.join("\n");
}

test("own-key bundles stop at four disjoint loops", () => {
  const four = loops(4);
  const fourQueue = repairCandidates([{ path: "src/tally.ts", name: "tally", start: 0, end: four.length, tier: 0 }], new Map([["src/tally.ts", four]]), new Set(), true);
  assert.equal(fourQueue.filter((c) => c.muts.length === 4 && c.muts.every((m) => m.template === "own-keys")).length, 1);
  const five = loops(5);
  const fiveQueue = repairCandidates([{ path: "src/tally.ts", name: "tally", start: 0, end: five.length, tier: 0 }], new Map([["src/tally.ts", five]]), new Set(), true);
  assert.equal(fiveQueue.filter((c) => c.muts.length >= 5 && c.muts.every((m) => m.template === "own-keys")).length, 0);
  assert.ok(fiveQueue.some((c) => c.muts.length === 1 && c.muts[0]!.template === "own-keys"));
});

test("an aliased own-property check is already a guard, and a different alias is not", () => {
  const call = [
    "export function counted(bins: Record<string, number>): number {",
    "  const has = Object.prototype.hasOwnProperty;",
    "  let total = 0;",
    "  for (const label in bins) {",
    "    if (!has.call(bins, label)) continue;",
    "    total += bins[label] ?? 0;",
    "  }",
    "  return total;",
    "}",
  ].join("\n");
  const direct = [
    "export function counted(bins: Record<string, number>): number {",
    "  const has = Object.hasOwn;",
    "  let total = 0;",
    "  for (const label in bins) {",
    "    if (!has(bins, label)) continue;",
    "    total += bins[label] ?? 0;",
    "  }",
    "  return total;",
    "}",
  ].join("\n");
  const other = [
    "export function counted(bins: Record<string, number>): number {",
    "  const has = Object.keys;",
    "  let total = 0;",
    "  for (const label in bins) {",
    "    if (has(bins).includes(label)) total += bins[label] ?? 0;",
    "  }",
    "  return total;",
    "}",
  ].join("\n");
  const elsewhere = [
    "function borrowed(): typeof Object.prototype.hasOwnProperty { return Object.prototype.hasOwnProperty; }",
    "export function counted(bins: Record<string, number>): number {",
    "  const has = borrowed();",
    "  let total = 0;",
    "  for (const label in bins) {",
    "    if (!has.call(bins, label)) continue;",
    "    total += bins[label] ?? 0;",
    "  }",
    "  return total;",
    "}",
  ].join("\n");
  assert.deepEqual(hits(call, "own-keys"), []);
  assert.deepEqual(hits(direct, "own-keys"), []);
  assert.equal(hits(other, "own-keys").length, 1);
  assert.equal(hits(elsewhere, "own-keys").length, 1);
  const later = [
    "export function counted(bins: Record<string, number>): number {",
    "  let total = 0;",
    "  for (const label in bins) {",
    "    if (!has(bins, label)) continue;",
    "    total += bins[label] ?? 0;",
    "  }",
    "  const has = Object.hasOwn;",
    "  return total;",
    "}",
  ].join("\n");
  const optional = [
    "export function counted(bins: Record<string, number>): number {",
    "  const has = Object?.hasOwn;",
    "  let total = 0;",
    "  for (const label in bins) {",
    "    if (!has(bins, label)) continue;",
    "    total += bins[label] ?? 0;",
    "  }",
    "  return total;",
    "}",
  ].join("\n");
  const optionalProto = [
    "export function counted(bins: Record<string, number>): number {",
    "  const has = Object?.prototype.hasOwnProperty;",
    "  let total = 0;",
    "  for (const label in bins) {",
    "    if (!has.call(bins, label)) continue;",
    "    total += bins[label] ?? 0;",
    "  }",
    "  return total;",
    "}",
  ].join("\n");
  assert.equal(hits(later, "own-keys").length, 1);
  assert.equal(hits(optional, "own-keys").length, 1);
  assert.equal(hits(optionalProto, "own-keys").length, 1);
});
