// M196 fixtures: small repositories written for reproduce-v1 (peaceai/spec/reproduce-v1.md). They share nothing with
// any training, task or Peace project repo (no Peace project code, fixture, request wording or reference diff).
//   LEDGER: a flat package run by node:test (TypeScript, node's own type stripping, no dependencies).
//           src/quota.ts returns `{ ok: false, code: "QUOTA_STORE_DOWN" }` when its store fails (admit, returned);
//           the near misses: src/profile.ts throws PROFILE_MISSING only for an ENOENT failure (passes on the current
//           code), src/theme.ts pushes THEME_DEFAULTED on the normal path too (vacuous), src/region.ts needs an env
//           var its test setup (the script's --import) sets (fails for the wrong reason: the module does not load),
//           src/limits.ts throws on data (no trigger), src/cache.ts is not exported and src/watch.ts reports inside
//           a callback (no entry), src/upload.ts logs through an imported logger and src/track.ts pushes into module
//           state (not observable), src/archive.ts / src/rotate.ts / src/stamp.ts have no usable existing test, and
//           test/fake-store.ts is a test helper (a test-file target). src/fetchall.ts, src/publish.ts and src/save.ts
//           check which dependency call is the trigger.
//   SHELF:  a flat npm + vitest 4 package (lockfile: fixtures/m173-forge-vitest4). src/settings.ts throws
//           SETTINGS_UNREADABLE from a catch (admit, thrown); its test is inside a describe.
//   AGENT:  a pnpm workspace with jest 29 in packages/agent (CommonJS). src/sync.js logs SYNC_PUSH_FAILED through an
//           injected `logger.error` in a catch (admit, logged). packages/web is an unrelated package.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const json = (o: unknown) => JSON.stringify(o, null, 2) + "\n";
const lines = (...l: string[]) => [...l, ""].join("\n");
const nodeTest = 'import assert from "node:assert/strict";\nimport test from "node:test";\n';
const io = 'const io = { read: async (p: string) => (p.endsWith(".json") ? "{\\"name\\":\\"ana\\"}" : "") };\n';

export type Files = Record<string, string>;
export function writeRepo(dir: string, files: Files): string {
  for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); }
  return dir;
}

export const LEDGER: Files = {
  "package.json": json({ name: "ledger", private: true, type: "module", scripts: { test: "node --import ./test/setup.ts --test test/" } }),
  "test/setup.ts": 'process.env.LEDGER_ZONE ??= "eu";\n',
  "src/quota.ts": lines(
    "export interface QuotaStore { used(user: string): Promise<number>; limit: number }",
    "export async function reserve(store: QuotaStore, user: string): Promise<{ ok: true; left: number } | { ok: false; code: string }> {",
    "  try {",
    "    const used = await store.used(user);",
    "    return { ok: true, left: store.limit - used };",
    "  } catch {",
    '    return { ok: false, code: "QUOTA_STORE_DOWN" };',
    "  }",
    "}",
  ),
  "test/quota.test.ts": nodeTest + lines(
    'import { reserve } from "../src/quota.ts";',
    "const store = { limit: 5, used: async (_u: string) => 2 };",
    'test("reserve reports what is left", async () => {',
    '  const r = await reserve(store, "ana");',
    "  assert.deepEqual(r, { ok: true, left: 3 });",
    "});",
  ),
  "src/profile.ts": lines(
    "export async function loadProfile(io: { read(p: string): Promise<string> }, user: string): Promise<{ name: string }> {",
    "  try {",
    "    return JSON.parse(await io.read(`profiles/${user}.json`)) as { name: string };",
    "  } catch (e) {",
    '    if ((e as { code?: string }).code === "ENOENT") throw new Error(`PROFILE_MISSING: ${user}`);',
    "    return { name: user };",
    "  }",
    "}",
  ),
  "test/profile.test.ts": nodeTest + 'import { loadProfile } from "../src/profile.ts";\n' + io + lines(
    'test("loadProfile reads the profile", async () => {',
    '  assert.equal((await loadProfile(io, "ana")).name, "ana");',
    "});",
  ),
  "src/theme.ts": lines(
    "export async function loadTheme(io: { read(p: string): Promise<string> }): Promise<{ theme: Record<string, string>; warnings: string[] }> {",
    "  const warnings: string[] = [];",
    '  let text = "";',
    "  try {",
    '    text = await io.read("theme.txt");',
    "  } catch {",
    '    warnings.push("THEME_DEFAULTED");',
    "  }",
    '  if (!text.trim()) { warnings.push("THEME_DEFAULTED"); return { theme: {}, warnings }; }',
    "  return { theme: JSON.parse(text) as Record<string, string>, warnings };",
    "}",
  ),
  "test/theme.test.ts": nodeTest + 'import { loadTheme } from "../src/theme.ts";\n' + io + lines(
    'test("an empty theme file gives the default theme", async () => {',
    "  const r = await loadTheme(io);",
    "  assert.deepEqual(r.theme, {});",
    "});",
  ),
  "src/region.ts": lines(
    "const ZONE = process.env.LEDGER_ZONE;",
    'if (!ZONE) throw new Error("LEDGER_ZONE must be set");',
    "export async function zoneRates(api: { rates(zone: string): Promise<number[]> }): Promise<number[]> {",
    "  try {",
    "    return await api.rates(ZONE!);",
    "  } catch {",
    '    throw new Error("RATES_UNAVAILABLE");',
    "  }",
    "}",
  ),
  "test/region.test.ts": nodeTest + 'import { zoneRates } from "../src/region.ts";\n' + lines(
    'test("zoneRates asks for the configured zone", async () => {',
    "  const asked: string[] = [];",
    "  await zoneRates({ rates: async (z: string) => { asked.push(z); return [1]; } });",
    '  assert.deepEqual(asked, ["eu"]);',
    "});",
  ),
  "src/limits.ts": lines(
    "export function checkQuota(store: { limit(): number; name(): string }, n: number): number {",
    "  if (n > store.limit()) throw new Error(`QUOTA_EXCEEDED: ${store.name()}`);",
    "  return n;",
    "}",
  ),
  "test/limits.test.ts": nodeTest + 'import { checkQuota } from "../src/limits.ts";\n' + lines(
    'test("checkQuota passes a small request", () => {',
    '  assert.equal(checkQuota({ limit: () => 3, name: () => "a" }, 1), 1);',
    "});",
  ),
  "src/cache.ts": lines(
    "async function warm(io: { read(p: string): Promise<string> }): Promise<string> {",
    "  try {",
    '    return await io.read("cache.bin");',
    "  } catch {",
    '    throw new Error("CACHE_WARM_FAILED");',
    "  }",
    "}",
    "export const start = (io: { read(p: string): Promise<string> }) => warm(io);",
  ),
  "src/watch.ts": lines(
    "export function watchAll(io: { read(p: string): Promise<string> }, names: string[]): Promise<string>[] {",
    "  return names.map(async (n) => {",
    "    try {",
    "      return await io.read(n);",
    "    } catch {",
    "      throw new Error(`WATCH_READ_FAILED: ${n}`);",
    "    }",
    "  });",
    "}",
  ),
  "test/watch.test.ts": nodeTest + 'import { watchAll } from "../src/watch.ts";\n' + io + lines(
    'test("watchAll reads every name", async () => {',
    '  assert.equal((await Promise.all(watchAll(io, ["a.json"]))).length, 1);',
    "});",
  ),
  "src/log.ts": lines("export const sink: string[] = [];", "export const log = { error: (m: string) => { sink.push(m); } };"),
  "src/upload.ts": lines(
    'import { log } from "./log.ts";',
    "export async function upload(io: { put(k: string): Promise<void> }, key: string): Promise<boolean> {",
    "  try {",
    "    await io.put(key);",
    "    return true;",
    "  } catch {",
    "    log.error(`UPLOAD_FAILED ${key}`);",
    "    return false;",
    "  }",
    "}",
  ),
  "test/upload.test.ts": nodeTest + 'import { upload } from "../src/upload.ts";\n' + lines(
    'test("upload puts the key", async () => {',
    '  assert.equal(await upload({ put: async () => {} }, "k"), true);',
    "});",
  ),
  "src/track.ts": lines(
    "export const problems: string[] = [];",
    "export function track(io: { send(e: string): void }, event: string): void {",
    "  try {",
    "    io.send(event);",
    "  } catch {",
    "    problems.push(`TRACK_SEND_FAILED ${event}`);",
    "  }",
    "}",
  ),
  "test/track.test.ts": nodeTest + 'import { track } from "../src/track.ts";\n' + lines(
    'test("track sends the event", () => {',
    "  const sent: string[] = [];",
    '  track({ send: (e: string) => { sent.push(e); } }, "open");',
    '  assert.deepEqual(sent, ["open"]);',
    "});",
  ),
  "src/archive.ts": lines(
    "export async function archive(io: { write(n: string): Promise<void> }, name: string): Promise<void> {",
    "  try {",
    "    await io.write(name);",
    "  } catch {",
    "    throw new Error(`ARCHIVE_WRITE_FAILED: ${name}`);",
    "  }",
    "}",
  ),
  "src/legacy/archive.ts": lines("export async function archive(io: { write(n: string): Promise<void> }, name: string): Promise<void> {", "  await io.write(`old/${name}`);", "}"),
  "test/archive.test.ts": nodeTest + 'import { archive } from "../src/legacy/archive.ts";\n' + lines(
    'test("the legacy archive writes under old/", async () => {',
    "  const w: string[] = [];",
    '  await archive({ write: async (n: string) => { w.push(n); } }, "x");',
    '  assert.deepEqual(w, ["old/x"]);',
    "});",
  ),
  "src/rotate.ts": lines(
    "export async function rotate(io: { swap(k: string): Promise<void> }, key: string): Promise<void> {",
    "  try {",
    "    await io.swap(key);",
    "  } catch {",
    "    throw new Error(`ROTATE_FAILED: ${key}`);",
    "  }",
    "}",
  ),
  "test/rotate.test.ts": nodeTest + 'import { beforeEach } from "node:test";\nimport { rotate } from "../src/rotate.ts";\n' + lines(
    "let swapped = 0;",
    "beforeEach(() => { rotate({ swap: async () => { swapped++; } }, \"k\"); });",
    'test("rotate swaps once per test", () => {',
    "  assert.equal(swapped, 1);",
    "});",
  ),
  "src/stamp.ts": lines(
    "export async function stamp(io: { sign(d: string): Promise<string> }, doc: string): Promise<string> {",
    "  try {",
    "    return await io.sign(doc);",
    "  } catch {",
    "    throw new Error(`STAMP_SIGN_FAILED: ${doc}`);",
    "  }",
    "}",
  ),
  "test/stamp.test.ts": nodeTest + 'import { stamp } from "../src/stamp.ts";\n' + lines(
    'const args = [{ sign: async (d: string) => `signed:${d}` }, "d"] as const;',
    'test("stamp signs the doc", async () => {',
    '  assert.equal(await stamp(...args), "signed:d");',
    "});",
  ),
  "test/fake-store.ts": lines(
    "export async function flakyStore(inner: { used(): Promise<number> }): Promise<number> {",
    "  try {",
    "    return await inner.used();",
    "  } catch {",
    '    throw new Error("FAKE_STORE_DOWN");',
    "  }",
    "}",
  ),
  "src/fetchall.ts": lines(
    "export async function fetchAll(api: { get(id: string): Promise<string>; all(xs: Promise<string>[]): Promise<string[]> }, ids: string[]): Promise<string[]> {",
    "  try {",
    "    const xs = ids.map((id) => api.get(id));",
    "    return await api.all(xs);",
    "  } catch {",
    '    throw new Error("FETCH_ALL_FAILED");',
    "  }",
    "}",
  ),
  "test/fetchall.test.ts": nodeTest + 'import { fetchAll } from "../src/fetchall.ts";\n' + lines(
    'test("fetchAll gets every id", async () => {',
    '  const api = { get: async (id: string) => id, all: (xs: Promise<string>[]) => Promise.all(xs) };',
    '  assert.deepEqual(await fetchAll(api, ["a"]), ["a"]);',
    "});",
  ),
  "src/publish.ts": lines(
    "export async function publish(io: { lock(d: string): Promise<void>; write(d: string): Promise<void> }, doc: string): Promise<void> {",
    "  try {",
    "    try {",
    "      await io.lock(doc);",
    "    } catch {",
    "      // best effort",
    "    }",
    "    await io.write(doc);",
    "  } catch {",
    '    throw new Error("PUBLISH_FAILED");',
    "  }",
    "}",
  ),
  "test/publish.test.ts": nodeTest + 'import { publish } from "../src/publish.ts";\n' + lines(
    'test("publish writes the doc", async () => {',
    "  const w: string[] = [];",
    '  await publish({ lock: async () => {}, write: async (d: string) => { w.push(d); } }, "d");',
    '  assert.deepEqual(w, ["d"]);',
    "});",
  ),
  "src/save.ts": lines(
    "export async function save({ ping, put }: { ping(): Promise<void>; put(k: string): Promise<void> }, key: string): Promise<void> {",
    "  try {",
    "    await ping().catch(() => undefined);",
    "    await put(key);",
    "  } catch {",
    '    throw new Error("SAVE_PUT_FAILED");',
    "  }",
    "}",
  ),
  "test/save.test.ts": nodeTest + 'import { save } from "../src/save.ts";\n' + lines(
    'test("save puts the key", async () => {',
    "  const p: string[] = [];",
    '  await save({ ping: async () => {}, put: async (k: string) => { p.push(k); } }, "k");',
    '  assert.deepEqual(p, ["k"]);',
    "});",
  ),
};

const vitestFixture = resolve(import.meta.dirname, "fixtures/m173-forge-vitest4");
export const SHELF = (): Files => ({
  "package.json": json({ ...JSON.parse(readFileSync(join(vitestFixture, "package.json"), "utf8")), scripts: { test: "vitest run" } }),
  "package-lock.json": readFileSync(join(vitestFixture, "package-lock.json"), "utf8"),
  "src/settings.ts": lines(
    "export interface Reader { read(path: string): Promise<string> }",
    "const parseSettings = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;",
    "export async function loadSettings(io: Reader, path: string): Promise<Record<string, unknown>> {",
    "  try {",
    "    return parseSettings(await io.read(path));",
    "  } catch (e) {",
    "    throw new Error(`SETTINGS_UNREADABLE: ${path}`, { cause: e });",
    "  }",
    "}",
  ),
  "test/settings.test.ts": lines(
    'import { describe, expect, it } from "vitest";',
    'import { loadSettings } from "../src/settings";',
    "const reader = (files: Record<string, string>) => ({ read: async (p: string) => { if (!(p in files)) throw new Error(\"no such file\"); return files[p]!; } });",
    'describe("loadSettings", () => {',
    '  const io = reader({ "a.json": "{\\"x\\":1}" });',
    '  it("parses the file", async () => {',
    '    const s = await loadSettings(io, "a.json");',
    "    expect(s).toEqual({ x: 1 });",
    "  });",
    "});",
  ),
});

export const AGENT: Files = {
  "package.json": json({ name: "agent-ws", private: true, scripts: { test: "pnpm -r test" } }),
  "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
  "packages/agent/package.json": json({ name: "@ws/agent", private: true, scripts: { test: "jest" }, devDependencies: { jest: "29.7.0" } }),
  "packages/agent/src/sync.js": lines(
    '"use strict";',
    "async function syncAll(api, logger, items) {",
    "  let pushed = 0;",
    "  try {",
    "    for (const it of items) {",
    "      await api.push(it);",
    "      pushed++;",
    "    }",
    "  } catch (e) {",
    "    logger.error(`SYNC_PUSH_FAILED after ${pushed}`, e);",
    "  }",
    "  return pushed;",
    "}",
    "module.exports = { syncAll };",
  ),
  "packages/agent/test/sync.test.js": lines(
    'const { syncAll } = require("../src/sync");',
    "const quiet = { error() {}, info() {} };",
    'describe("syncAll", () => {',
    '  test("pushes every item", async () => {',
    "    const seen = [];",
    "    const api = { push: async (x) => { seen.push(x); } };",
    '    const n = await syncAll(api, quiet, ["a", "b"]);',
    "    expect(n).toBe(2);",
    '    expect(seen).toEqual(["a", "b"]);',
    "  });",
    "});",
  ),
  "packages/web/package.json": json({ name: "@ws/web", private: true, scripts: { test: "jest" } }),
  "packages/web/src/page.js": 'module.exports = { title: () => "home" };\n',
};

/** Static-only near misses for the trigger rules (no test needed: each is refused before the test search). */
export const LEDGER_TRIGGERS: Files = {
  "src/defer.ts": lines(
    "export function defer(io: { flush(k: string): void }, key: string): void {",
    "  try {",
    "    setTimeout(() => io.flush(key), 0);",
    "  } catch {",
    '    throw new Error("DEFER_FAILED");',
    "  }",
    "}",
  ),
  "src/probe.ts": lines(
    "export async function probe(io: { ping(): Promise<void> }): Promise<void> {",
    "  try {",
    "    try {",
    "      await io.ping();",
    "    } catch {",
    "      // offline is fine",
    "    }",
    "  } catch {",
    '    throw new Error("PROBE_FAILED");',
    "  }",
    "}",
  ),
  "src/warmup.ts": lines(
    "export async function warmup(io: { warm(): Promise<void> }): Promise<void> {",
    "  try {",
    "    await io.warm().catch(() => undefined);",
    "  } catch {",
    '    throw new Error("WARMUP_FAILED");',
    "  }",
    "}",
  ),
  "src/names.ts": lines(
    "export function upper(names: string[]): string[] {",
    "  try {",
    "    return names.map((n) => n.toUpperCase());",
    "  } catch {",
    '    throw new Error("NAMES_UPPER_FAILED");',
    "  }",
    "}",
  ),
  "src/clock.ts": lines(
    "export function stampNow(): number {",
    "  try {",
    "    return Date.now();",
    "  } catch {",
    '    throw new Error("CLOCK_READ_FAILED");',
    "  }",
    "}",
  ),
};
