// Spec-gated depth cap, page cap, and strict flag.
// Admitting snippets are synthetic. Refusals are copied from permissively licensed sources
// that are not practice-set rows and not held-out repos.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { specDemand, specEdits } from "../lib/editpropose.ts";
import { heldOutRow } from "../lib/requestfamily.ts";

const log = readFileSync(join(import.meta.dirname, "../../builder-log/tasks.jsonl"), "utf8");

function edits(files: Record<string, string>, spec: string): Record<string, string> {
  const next = specEdits(Object.entries(files).map(([path, content]) => ({ path, content })), spec);
  const out: Record<string, string> = {};
  for (const edit of next) out[edit.path] = edit.content;
  return out;
}

test("a spec without one bound does not demand an edit", () => {
  assert.equal(specDemand("please look at this"), null);
  assert.equal(specDemand("depth < 4 and depth < 8, then fail closed"), null);
  assert.equal(specDemand("depth < 4"), null);
  assert.equal(specDemand("3 pages then fail closed"), null);
  assert.equal(specDemand('make MODE_A and MODE_B strict (""/0/1) so true no longer counts'), null);
  assert.equal(specDemand('make the flag strict (""/0/1), true no longer counts'), null);
});

test("dev rows that demand a spec edit are the pre-registered ones", () => {
  const hit: number[] = [];
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { seq: number; asked: string; skill: string };
    if (heldOutRow(row.seq, row.asked)) continue;
    if (row.skill === "PEACEAI_SELF_CHANGE" || row.skill === "OPS_ACTION") continue;
    if (specDemand(row.asked)) hit.push(row.seq);
  }
  assert.deepEqual(hit, [217, 218, 219, 220]);
});

test("a real walk that is not while (true) is left alone", () => {
  // paulmillr/readdirp index.ts @ 4.1.2 (MIT): the loop is bounded by batch, and depth is already capped.
  const readdirp = [
    "export function readDir(batch: number, destroyed: boolean): void {",
    "  let depth = 0;",
    "  while (!destroyed && batch > 0) {",
    "    if (depth <= 8) depth += 1;",
    "    batch -= 1;",
    "  }",
    "}",
    "",
  ].join("\n");
  // isaacs/node-glob src/processor.ts @ v11.0.0 (ISC): the condition is the pattern, not true.
  const glob = [
    "export function processPattern(rest: string | null, errorCode: string): void {",
    "  while (rest) {",
    "    rest = rest.slice(1);",
    "    if (!rest) return;",
    "  }",
    "}",
    "",
  ].join("\n");
  const spec = "bound the climb walk (depth < 4, then fail closed)";
  assert.deepEqual(edits({ "src/readdirp.ts": readdirp, "src/processor.ts": glob }, spec), {});
  const spinner = [
    "export function spin(errorCode: string): void {",
    "  while (true) {",
    "    throw new Error(errorCode);",
    "  }",
    "}",
    "",
  ].join("\n");
  assert.deepEqual(edits({ "src/climb.ts": spinner }, spec), {});
});

test("a synthetic ancestor walk is capped only for its spec", async () => {
  const source = [
    "export function climb(start: string, errorCode: string): string {",
    "  let current = start;",
    "  while (true) {",
    "    if (current.includes(\"..\")) throw new Error(errorCode);",
    "    if (current === \"/\") return current;",
    "    const parent = dirname(current);",
    "    if (parent === current) return current;",
    "    current = parent;",
    "  }",
    "}",
    "function dirname(path: string): string {",
    "  const i = path.lastIndexOf(\"/\");",
    "  return i <= 0 ? \"/\" : path.slice(0, i);",
    "}",
    "",
  ].join("\n");
  const spec = "bound the climb walk (depth < 4, then fail closed)";
  assert.deepEqual(edits({ "src/climb.ts": source }, "depth < 4"), {});
  const got = edits({ "src/climb.ts": source }, spec);
  const next = got["src/climb.ts"];
  assert.ok(next);
  assert.match(next!, /while \(walkDepth < 4\)/);
  assert.match(next!, /throw new Error\(errorCode\)/);
  const testText = [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    'import { climb } from "./climb.ts";',
    'test("climb depth < 4 fails closed", () => {',
    '  assert.equal(climb("/a/b/c", "BAD"), "/");',
    '  assert.throws(() => climb("/a/b/c/d/e", "BAD"), /BAD/);',
    "});",
    "",
  ].join("\n");
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m240-depth-"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("NODE_TEST") || key.startsWith("NODE_CHANNEL")) delete env[key];
  const run = (body: string) => new Promise<number>((done, fail) => {
    writeFileSync(join(dir, "climb.ts"), body);
    writeFileSync(join(dir, "climb.test.ts"), testText);
    const child = spawn(process.execPath, ["--experimental-strip-types", "--test", "climb.test.ts"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", fail);
    child.on("close", (code) => (code === null ? fail(new Error("no exit")) : done(code)));
  });
  try {
    assert.notEqual(await run(source), 0);
    assert.equal(await run(next!), 0);
    const mutant = next!.replace("walkDepth < 4", "walkDepth < 3");
    assert.notEqual(await run(mutant), 0);
    const throwAt = next!.lastIndexOf("throw new Error(errorCode);");
    const noThrow = next!.slice(0, throwAt) + "return current;" + next!.slice(throwAt + "throw new Error(errorCode);".length);
    assert.notEqual(await run(noThrow), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a cursor that is not a counted loop is left alone", () => {
  // honojs/hono src/utils/url.ts @ f6fbaf02 (MIT): the index walks the query string.
  const hono = [
    "export function queryOf(url: string): string {",
    "  let keyIndex = url.indexOf(\"?\");",
    "  while (keyIndex !== -1) {",
    "    keyIndex = url.indexOf(\"&\", keyIndex + 1);",
    "  }",
    "  return url;",
    "}",
    "",
  ].join("\n");
  // @octokit/plugin-paginate-rest src/iterator.ts @ v11.4.2 (MIT): next is an iterator field, not a loop.
  const octokit = [
    "export function iterator(url: string | undefined): { done: boolean } {",
    "  if (!url) return { done: true };",
    "  return { done: false };",
    "}",
    "",
  ].join("\n");
  const capped = [
    "export function listRange(next: string | undefined): number {",
    "  let page = 0;",
    "  while (next) {",
    "    if (page >= 9) throw new Error(\"RANGE_PAGE_CAP\");",
    "    page += 1;",
    "    next = undefined;",
    "  }",
    "  return page;",
    "}",
    "",
  ].join("\n");
  const spec = "bound the drain listing (3 pages, then fail closed with DRAIN_PAGE_CAP)";
  assert.deepEqual(edits({ "src/url.ts": hono, "src/iterator.ts": octokit, "src/range.ts": capped }, spec), {});
});

test("a synthetic page loop throws the named cap", async () => {
  const source = [
    "export function drain(cursor: string | undefined): string[] {",
    "  const keys: string[] = [];",
    "  do {",
    "    keys.push(cursor ?? \"end\");",
    "    if (!cursor) break;",
    "    cursor = cursor.length > 2 ? cursor.slice(1) : undefined;",
    "  } while (cursor);",
    "  return keys;",
    "}",
    "",
  ].join("\n");
  const spec = "bound the drain listing (3 pages, then fail closed with DRAIN_PAGE_CAP)";
  const got = edits({ "src/drain.ts": source }, spec);
  const next = got["src/drain.ts"];
  assert.ok(next);
  assert.match(next!, /pageCount < 3/);
  assert.match(next!, /DRAIN_PAGE_CAP/);
  const testText = [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    'import { drain } from "./drain.ts";',
    'test("drain 3 pages fails closed", () => {',
    '  assert.deepEqual(drain(undefined), ["end"]);',
    '  assert.throws(() => drain("abcdefghi"), /DRAIN_PAGE_CAP/);',
    "});",
    "",
  ].join("\n");
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m240-page-"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("NODE_TEST") || key.startsWith("NODE_CHANNEL")) delete env[key];
  const run = (body: string) => new Promise<number>((done, fail) => {
    writeFileSync(join(dir, "drain.ts"), body);
    writeFileSync(join(dir, "drain.test.ts"), testText);
    const child = spawn(process.execPath, ["--experimental-strip-types", "--test", "drain.test.ts"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", fail);
    child.on("close", (code) => (code === null ? fail(new Error("no exit")) : done(code)));
  });
  try {
    assert.notEqual(await run(source), 0);
    assert.equal(await run(next!), 0);
    const mutant = next!.replace("pageCount < 3", "pageCount < 9");
    assert.notEqual(await run(mutant), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a truthy env read is left alone, and a strict table is edited", async () => {
  // vitejs/vite packages/vite/src/node/logger.ts @ v6.0.0 (MIT): CI is truthy, not === "1".
  const vite = [
    "export function clear(allow: boolean): boolean {",
    "  return allow && !process.env.CI;",
    "}",
    "",
  ].join("\n");
  const spec = 'make MODE_FLAG strict in mode (""/0/1 only; "true" no longer counts)';
  assert.equal(specDemand(spec)?.kind, "strict-flag");
  assert.deepEqual(edits({ "src/logger.ts": vite, "src/mode.ts": vite.replace("CI", "MODE_FLAG") }, spec), {});
  const source = [
    "export function enabled(): boolean {",
    "  if (process.env.MODE_FLAG === \"1\") return true;",
    "  return false;",
    "}",
    "",
  ].join("\n");
  const got = edits({ "src/mode.ts": source }, spec);
  const next = got["src/mode.ts"];
  assert.ok(next);
  assert.match(next!, /strictModeFlag\(process\.env\.MODE_FLAG\)/);
  assert.match(next!, /MODE_FLAG_INVALID/);
  const testText = [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    'import { enabled, strictModeFlag } from "./mode.ts";',
    'test("MODE_FLAG strict", () => {',
    '  assert.equal(strictModeFlag(undefined), false);',
    '  assert.equal(strictModeFlag("1"), true);',
    '  assert.throws(() => strictModeFlag("true"), /MODE_FLAG_INVALID/);',
    "});",
    "",
  ].join("\n");
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m240-flag-"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("NODE_TEST") || key.startsWith("NODE_CHANNEL")) delete env[key];
  const run = (body: string) => new Promise<number>((done, fail) => {
    writeFileSync(join(dir, "mode.ts"), body);
    writeFileSync(join(dir, "mode.test.ts"), testText);
    const child = spawn(process.execPath, ["--experimental-strip-types", "--test", "mode.test.ts"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", fail);
    child.on("close", (code) => (code === null ? fail(new Error(err.slice(-400))) : done(code)));
  });
  try {
    assert.notEqual(await run(source), 0);
    assert.equal(await run(next!), 0);
    const mutant = next!.replace('if (s === "1") return true;', 'if (s === "1" || s === "true") return true;');
    assert.notEqual(await run(mutant), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
