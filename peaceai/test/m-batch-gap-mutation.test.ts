// Deleting a new guard must fail an assertion. The fixtures are written here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const libDir = resolve(import.meta.dirname, "../lib");
const trimSource = "export function numeric(value: unknown): boolean {\n  return typeof value === \"string\" && !Number.isNaN(Number(value));\n}\n";
const memberSource = "export function member(list: readonly string[], value: string): boolean {\n  return list.includes(value);\n}\n";

function rewrite(text: string): string {
  const tsPath = createRequire(join(libDir, "editpropose.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
}

async function load(name: string, file: string, drop: string) {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-gap-mut-"));
  const lines = readFileSync(join(libDir, file), "utf8").split("\n");
  const body = lines.filter((line) => !line.includes(drop)).join("\n");
  const out = join(dir, file);
  writeFileSync(out, rewrite(body));
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("deleting trim-guard:and trims a call that is not a conjunction", async () => {
  const mod = await load("and", "editpropose.ts", "trim-guard:and");
  const plain = "export function numeric(value: unknown): boolean {\n  return Number(value);\n}\n";
  const site = { path: "src/desk.ts", name: "numeric", start: 0, end: plain.length, tier: 0 };
  const got = mod.idiomMutationsIn(mod.parseSource("src/desk.ts", plain), site, 0).filter((m: { template: string }) => m.template === "trim-equal");
  assert.ok(got.length > 0);
});

test("deleting trim-guard:already trims a value that is already trimmed", async () => {
  const mod = await load("already", "editpropose.ts", "trim-guard:already");
  const text = "export function numeric(value: unknown): boolean {\n  return typeof value === \"string\" && value === value.trim() && !Number.isNaN(Number(value));\n}\n";
  const site = { path: "src/desk.ts", name: "numeric", start: 0, end: text.length, tier: 0 };
  const got = mod.idiomMutationsIn(mod.parseSource("src/desk.ts", text), site, 0).filter((m: { template: string }) => m.template === "trim-equal");
  assert.ok(got.length > 0);
});

test("deleting trim-guard:ident no longer trims an identifier", async () => {
  const mod = await load("ident", "editpropose.ts", "trim-guard:ident");
  const site = { path: "src/desk.ts", name: "numeric", start: 0, end: trimSource.length, tier: 0 };
  const got = mod.idiomMutationsIn(mod.parseSource("src/desk.ts", trimSource), site, 0).filter((m: { template: string }) => m.template === "trim-equal");
  assert.equal(got.length, 0);
});

test("deleting includes-param marks a parameter as unprobed", async () => {
  const mod = await load("includes", "specgrade.ts", "grade-guard:includes-param");
  assert.equal(mod.comparisonBounds(memberSource).unprobed, true);
});
