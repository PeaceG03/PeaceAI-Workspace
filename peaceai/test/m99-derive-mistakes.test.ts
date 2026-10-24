// M99 (#491 round 3, Peace): the derive engine's mistakes ledger, peaceai/test/m99-derive-mistakes.json. Every
// wrong program a NOT PASS found (and the scan's), with the examples it was accepted from, an input where it is wrong
// and the right output there, is replayed here on every change: the engine must never accept a wrong program from
// those examples again. Each entry also pins what happens now (refuse and ask at the recorded inputs; then, with the
// answers added, the program derived) or a known limit (the examples alone fit, and the review note shows it).
// A future NOT PASS counterexample is added to the ledger in the same PR that fixes it (spec: "Mistakes ledger").
// Round 4 (Auditor ruling on 6f1ea5e): replayed through deriveCandidate (the search and the witness gates); for every
// program that path accepts, the ledger pins formGate (the forms the runtime form gate refuses; [] = emitted) and
// deriveProgram is checked to emit it exactly then, or to refuse it by name (derive_unevidenced_form) otherwise.
// Regenerate: tsx peaceai/proof/m99-derive-mistakes-gen.ts. The per-entry replay is in m99-derive-mistakes-replay.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { buildDeriveEdit, DERIVE_TRIGGER, DERIVE_VOCAB, deriveReviewNote, parseDeriveTask } from "../lib/learned-derive.ts";
import { cleanIssueText } from "../lib/taskmap.ts";
import { LEDGER } from "./m99-derive-mistakes-replay.ts";

test("mistakes ledger: shape, and every Auditor counterexample so far is in it", () => {
  assert.equal(LEDGER.schema, "peaceai-derive-mistakes:v1");
  assert.match(LEDGER.note, /11 blocking\) describes seed 100 only/);
  const ids = LEDGER.entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["r1-s1-without-600", "r1-s1-drop-429", "r2-hidden-island", "r2-unwitnessed-cap", "r2-amb3-backoff-k7-1", "seed101-island-hidden-island-t465", "m103-backoff-sparse-basems", "m103-backoff-sparse-capped-basems", "m103-unread-ab-plus-c", "m103-unread-a-plus-bc", "m103-unread-c-plus-ab-squared", "m103-unread-s-plus-t-repeat-n", "m103-unread-empty-s-or-s-plus-t", "m103-unread-b-pow-a", "m103-unread-b-times-a-plus-1-squared-symmetric", "m103-unread-and-short-circuit", "m103-unread-or-short-circuit", "m102-order-hidden-max", "m102-order-hidden-less", "m102-kind-range-sparse-p0-k", "m102-kind-s1-shape-sparse-p0-k", "m102-kind-s1-shape-sparse-p0-eq-k"]) assert.ok(ids.includes(id), id);
  // Auditor round 3: the disclosed limits it accepted are marked; every known limit is disclosed.
  const accepted = LEDGER.entries.filter((e) => /accepted by Auditor/.test(e.disclosed ?? "")).map((e) => e.id);
  assert.deepEqual(accepted, ["r1-s1-drop-429", "m100-floor-clamp-past", "m100-kind-floor-clamp-unwitnessed-cap-k-p0-p0-k", "m100-kind-floor-clamp-sparse-k-p0-p0-k", "m100-kind-eq-or-ge-sparse-k-p0", "m100-kind-s1-shape-sparse-k-p0"]);
  // Auditor analysed these two in the #495 review of 159a632 (not accepted): disclosed known limits.
  for (const id of ["m102-kind-range-sparse-p0-k", "m102-kind-s1-shape-sparse-p0-k"]) assert.match(LEDGER.entries.find((e) => e.id === id)!.disclosed ?? "", /^disclosed known limit \(analysed by Auditor/, id);
  for (const e of LEDGER.entries) if (e.expected.outcome === "known-limit") assert.match(e.disclosed ?? "", /^disclosed (known )?limit/, e.id);
  const t465 = LEDGER.entries.find((e) => e.id === "seed101-island-hidden-island-t465")!;
  assert.deepEqual([t465.wrongProgram, t465.disagreeAt, t465.correct, t465.expected.outcome], ["!(105 <= n && n <= 180)", [140], true, "known-limit"]);
  assert.equal(ids.filter((i) => i.startsWith("r2-amb3-if-eq-")).length, 7); // Auditor: if-eq 40 / 7 accepted / 7 wrong
  assert.equal(ids.filter((i) => i.startsWith("r2-amb3-cap-lin2-")).length, 2); // cap-lin2 40 / 4 / 2
  assert.equal(ids.filter((i) => i.startsWith("r2-amb3-backoff-")).length, 1); // backoff 40 / 11 / 1
  for (const e of LEDGER.entries) {
    assert.ok(e.source && e.why && !/\n/.test(e.why), e.id);
    assert.equal(e.disagreeAt.length, e.params.length, e.id);
    assert.ok(e.examples.every((r) => r.length === e.params.length + 1), e.id);
    assert.ok(!e.examples.some((r) => JSON.stringify(r.slice(0, -1)) === JSON.stringify(e.disagreeAt)), `${e.id}: the disagreeing input is not an example`);
  }
});

test("mistakes ledger: replayed, no entry is accepted wrong; each refuses and asks, derives, or is a recorded known limit", async () => {
  // Every entry, checked by replayEntry (m99-derive-mistakes-replay.ts), on REPLAY_WORKERS worker threads.
  const REPLAY_WORKERS = 3;
  const shards = Array.from({ length: REPLAY_WORKERS }, (_, w) => LEDGER.entries.map((_, i) => i).filter((i) => i % REPLAY_WORKERS === w));
  const done = await Promise.all(shards.map((ids) => new Promise<{ i: number; id: string; err: string | null }[]>((res, rej) => {
    const got: { i: number; id: string; err: string | null }[] = [];
    const w = new Worker(new URL("./m99-derive-mistakes-replay.ts", import.meta.url), { workerData: { m99Replay: ids } });
    w.on("message", (m) => got.push(m)); w.on("error", rej); w.on("exit", (code) => (code === 0 ? res(got) : rej(new Error(`replay worker exited ${code}`))));
  })));
  const all = done.flat().sort((a, b) => a.i - b.i);
  assert.deepEqual(all.map((r) => r.id), LEDGER.entries.map((e) => e.id), "every entry replayed, once");
  for (const r of all) assert.equal(r.err, null, r.err ?? "");
});

test("mistakes ledger: the known limit 'S1 without 429 gives true' is shown in the review note (the derived expression)", () => {
  const e = LEDGER.entries.find((x) => x.id === "r1-s1-drop-429")!;
  assert.equal(e.expected.outcome, "known-limit");
  const body = `Add a new module \`src/r2-retry-status.ts\` exporting \`isRetryableR2Status(status: number): boolean\`.\n\nBehavior: retry on server errors.\n\nExamples:\n${e.examples.map(([a, b]) => `- ${a} gives ${b}`).join("\n")}`;
  const p = parseDeriveTask(DERIVE_TRIGGER, cleanIssueText({ title: "t", body } as never));
  assert.ok("task" in p, JSON.stringify(p));
  const b = buildDeriveEdit(Object.fromEntries(Object.entries(DERIVE_VOCAB).map(([k, v]) => [k, v[0]])), p.task, [{ path: "src/host.ts", content: "export const x = 1;\n" }]);
  assert.ok("edit" in b, JSON.stringify(b));
  const lines = (c: string) => c.replace(/\n$/, "").split("\n");
  const diff = [{ path: b.edit.path, content: b.edit.content }, ...b.edit.extra].map((f) => `diff --git a/${f.path} b/${f.path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${lines(f.content).length} @@\n${lines(f.content).map((l) => `+${l}`).join("\n")}\n`).join("");
  const note = deriveReviewNote(diff);
  assert.ok(note, "a note is built");
  const expected = (e.expected as { program: string }).program;
  assert.ok(note!.includes(`return ${expected};`), note!);
  assert.ok(!/429/.test(expected), "the derived program has no 429 in it: the reviewer sees the limit");
});
