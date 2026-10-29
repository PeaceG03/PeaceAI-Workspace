// M99 replay on Node 20 (package.json engines: node >= 20). The ledger replay runs on worker threads; a worker whose
// entry is a .ts file depends on the tsx loader it inherits through execArgv, which Node 20 does not apply inside a
// worker thread (ERR_UNKNOWN_FILE_EXTENSION). peaceai/test/ts-worker.mjs registers tsx in the worker itself.
// These tests run the real replay through it with no usable inherited loader and no native type stripping, and show
// that the plain .ts entry fails under exactly those conditions (so the pass is not vacuous).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { LEDGER } from "./m99-derive-mistakes-replay.ts";

const REPLAY = new URL("./m99-derive-mistakes-replay.ts", import.meta.url).href;
const BOOT = new URL("./ts-worker.mjs", import.meta.url);
const major = Number(process.versions.node.split(".")[0]);
const tsFeature = (process.features as { typescript?: unknown }).typescript;
// Node 20: the inherited tsx --import is not applied in a worker (the original failure). Node >= 22.10: turn native
// type stripping off for the worker, and the overridden execArgv drops the inherited tsx --import as well.
const hostile: string[] | undefined = tsFeature !== undefined ? ["--no-experimental-strip-types"] : undefined;
const conditionKnown = major === 20 || tsFeature !== undefined;

type Msg = { i: number; id: string; err: string | null };
function run(entry: URL, workerData: Record<string, unknown>): Promise<{ msgs: Msg[]; error: Error | null; code: number }> {
  return new Promise((res) => {
    const msgs: Msg[] = [];
    let error: Error | null = null;
    const w = new Worker(entry, { workerData, ...(hostile ? { execArgv: hostile } : {}) });
    w.on("message", (m: Msg) => msgs.push(m));
    w.on("error", (e) => { error = e; });
    w.on("exit", (code) => res({ msgs, error, code }));
  });
}

test("ts-worker: the real ledger replay runs without an inherited loader or native type stripping", async () => {
  const ids = [0, LEDGER.entries.length - 1];
  const r = await run(BOOT, { tsEntry: REPLAY, m99Replay: ids });
  assert.equal(r.error, null, String(r.error));
  assert.equal(r.code, 0);
  assert.deepEqual(r.msgs.map((m) => [m.i, m.id, m.err]), ids.map((i) => [i, LEDGER.entries[i]!.id, null]));
});

test("ts-worker: under the same conditions the plain .ts worker entry fails (the Node 20 failure)", { skip: conditionKnown ? false : `node ${process.versions.node}: cannot reproduce the no-loader worker condition` }, async () => {
  const r = await run(new URL(REPLAY), { m99Replay: [0] });
  assert.ok(r.error, "a .ts entry needs the in-worker registration");
  assert.equal((r.error as NodeJS.ErrnoException).code, "ERR_UNKNOWN_FILE_EXTENSION", String(r.error));
  assert.deepEqual(r.msgs, []);
});

test("ts-worker: refuses anything but a file: URL of a .ts module", async () => {
  for (const tsEntry of [undefined, "", "node:fs", "file:///tmp/x.mjs", "https://example.com/x.ts", "/abs/path.ts"]) {
    const r = await run(BOOT, { tsEntry });
    assert.match(String(r.error), /ts-worker: workerData\.tsEntry must be a file: URL of a \.ts module/, String(tsEntry));
    assert.notEqual(r.code, 0);
  }
});

test("ts-worker: every worker thread in the tool tests starts from ts-worker.mjs, never a .ts entry", () => {
  const dir = new URL("./", import.meta.url);
  const uses = readdirSync(dir).filter((f) => f.endsWith(".ts")).flatMap((f) => [...readFileSync(new URL(f, dir), "utf8").matchAll(/new Worker\((new URL\([^)]*\)|[^,)]*)/g)].map((m) => [f, m[1]!.trim()]));
  const m99 = uses.filter(([f]) => f === "m99-derive-mistakes.test.ts");
  assert.equal(m99.length, 1, JSON.stringify(uses));
  for (const [f, arg] of uses.filter(([f]) => f !== "m135-ts-worker.test.ts")) assert.equal(arg, 'new URL("./ts-worker.mjs", import.meta.url)', f);
});
