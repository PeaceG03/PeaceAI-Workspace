// Deleting a trim guard must fail an assertion. The fixtures are written here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const libDir = resolve(import.meta.dirname, "../lib");

function load(drop: string) {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-gap-mut-"));
  const lines = readFileSync(join(libDir, "editpropose.ts"), "utf8").split("\n");
  const body = lines.filter((line) => !line.includes(drop)).join("\n");
  const out = join(dir, "editpropose.ts");
  const tsPath = createRequire(join(libDir, "editpropose.ts")).resolve("typescript");
  writeFileSync(out, body
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`));
  return import(pathToFileURL(out).href).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function trimHits(mod: { idiomMutationsIn: Function; parseSource: Function }, text: string) {
  const site = { path: "src/desk.ts", name: "ticketCode", start: 0, end: text.length, tier: 0 };
  return mod.idiomMutationsIn(mod.parseSource("src/desk.ts", text), site, 0).filter((m: { template: string }) => m.template === "trim-equal");
}

test("deleting trim-guard:or trims an or-conjunction", async () => {
  const mod = await load("trim-guard:or");
  const either = "export function ticketCode(code: unknown): boolean {\n  return typeof code === \"string\" || !Number.isNaN(Number(code));\n}\n";
  assert.ok(trimHits(mod, either).length > 0);
});

test("deleting trim-guard:already ignores a trim outside the conjunction", async () => {
  const mod = await load("trim-guard:already");
  const elsewhere = "export function ticketCode(code: unknown): boolean {\n  const folded = typeof code === \"string\" ? code.trim() : \"\";\n  return folded.length > 0 && typeof code === \"string\" && !Number.isNaN(Number(code));\n}\n";
  assert.ok(trimHits(mod, elsewhere).length > 0);
});

test("deleting trim-guard:ident no longer trims an identifier", async () => {
  const mod = await load("trim-guard:ident");
  const open = "export function ticketCode(code: unknown): boolean {\n  return typeof code === \"string\" && !Number.isNaN(Number(code));\n}\n";
  assert.equal(trimHits(mod, open).length, 0);
});
