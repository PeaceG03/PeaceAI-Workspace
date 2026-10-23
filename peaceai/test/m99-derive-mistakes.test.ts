// M99 (#491 round 3, Peace): the derive engine's mistakes ledger, peaceai/test/m99-derive-mistakes.json. Every
// wrong program a NOT PASS found (and the scan's), with the examples it was accepted from, an input where it is wrong
// and the right output there, is replayed here on every change: the engine must never accept a wrong program from
// those examples again. Each entry also pins what happens now (refuse and ask at the recorded inputs; then, with the
// answers added, the program derived) or a known limit (the examples alone fit, and the review note shows it).
// A future NOT PASS counterexample is added to the ledger in the same PR that fixes it (spec: "Mistakes ledger").
// Regenerate: tsx peaceai/proof/m99-derive-mistakes-gen.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveProgram, evalProgram, type DeriveInput, type DeriveValue } from "../lib/derive.ts";
import { buildDeriveEdit, DERIVE_TRIGGER, DERIVE_VOCAB, deriveReviewNote, parseDeriveTask } from "../lib/learned-derive.ts";
import { cleanIssueText } from "../lib/taskmap.ts";
import { repo } from "./m7-fixtures.ts";

type After = { program?: string; rightOnGrid?: boolean; wrongAt?: DeriveValue[]; correctThere?: DeriveValue; limit?: string; refused?: string; gate?: string | null };
type Entry = {
  id: string; source: string; params: string[]; types?: ("number" | "string")[]; ret: "number" | "boolean" | "string"; examples: DeriveValue[][]; wrongProgram: string; disagreeAt: DeriveValue[]; correct: DeriveValue; why: string;
  expected: { outcome: "refuse-and-ask"; reason: string; gate: string | null; askAt: DeriveValue[][]; answers: DeriveValue[][]; rounds: number; after: After }
    | { outcome: "derive"; program: string; rightOnGrid: boolean }
    | { outcome: "known-limit"; program: string; note: string };
};
const LEDGER = JSON.parse(readFileSync(join(repo, "peaceai/test/m99-derive-mistakes.json"), "utf8")) as { schema: string; entries: Entry[] };
const input = (e: Entry, rows: readonly DeriveValue[][]): DeriveInput => ({ params: e.params.map((name, i) => ({ name, type: e.types?.[i] ?? "number" })), ret: e.ret, examples: rows.map((r) => ({ args: r.slice(0, -1), out: r[r.length - 1]! })) });

test("mistakes ledger: shape, and every Auditor counterexample so far is in it", () => {
  assert.equal(LEDGER.schema, "peaceai-derive-mistakes:v1");
  const ids = LEDGER.entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["r1-s1-without-600", "r1-s1-drop-429", "r2-hidden-island", "r2-unwitnessed-cap", "r2-amb3-backoff-k7-1"]) assert.ok(ids.includes(id), id);
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

test("mistakes ledger: replayed, no entry is accepted wrong; each refuses and asks, derives, or is a recorded known limit", () => {
  for (const e of LEDGER.entries) {
    const r = deriveProgram(input(e, e.examples));
    const x = e.expected;
    if (r.ok) {
      // Accepted: never the recorded wrong program's mistake at the disagreeing input, unless a recorded known limit.
      assert.notEqual(x.outcome, "refuse-and-ask", `${e.id}: accepted ${r.fit.expr}, the ledger says refuse`);
      assert.equal(r.fit.expr, (x as { program: string }).program, e.id);
      const got = evalProgram(r.fit.program, e.disagreeAt);
      if (x.outcome === "derive") assert.equal(got, e.correct, `${e.id}: accepted wrong at ${JSON.stringify(e.disagreeAt)}`);
      else assert.ok(x.outcome === "known-limit" && x.note.startsWith("known limit"), `${e.id}: accepted wrong`);
      continue;
    }
    assert.equal(x.outcome, "refuse-and-ask", `${e.id}: refused (${r.reason}), the ledger says ${x.outcome}`);
    if (x.outcome !== "refuse-and-ask") continue;
    assert.equal(r.reason, x.reason, e.id);
    assert.equal(r.gate ?? null, x.gate, e.id);
    assert.deepEqual((r.questions ?? []).map((q) => q.at), x.askAt, `${e.id}: asks at the recorded inputs`);
    assert.ok(x.askAt.length > 0, `${e.id}: a refusal of a recorded mistake asks`);
    // The answers (the right outputs at the asked inputs, round by round; a question is open, the right output need
    // not be one the fitting programs gave) close the loop as recorded.
    let rows = [...e.examples], q = r.questions ?? [], k = 0;
    for (let round = 0; round < x.rounds; round++) {
      for (const qq of q) { const a: DeriveValue[] = x.answers[k++]!; assert.deepEqual(a.slice(0, -1), qq.at, `${e.id} round ${round}`); rows = [...rows, a]; }
      const n = deriveProgram(input(e, rows));
      q = n.ok ? [] : (n.questions ?? []);
      if (round === x.rounds - 1) {
        if (x.after.program !== undefined) {
          assert.ok(n.ok, `${e.id}: derives after the answers`);
          if (!n.ok) continue;
          assert.equal(n.fit.expr, x.after.program, e.id);
          if (x.after.rightOnGrid) assert.equal(evalProgram(n.fit.program, e.disagreeAt), e.correct, `${e.id}: right at the disagreeing input`);
          else { assert.ok(x.after.limit?.startsWith("known limit"), e.id); assert.notEqual(evalProgram(n.fit.program, x.after.wrongAt!), x.after.correctThere, e.id); }
        } else { assert.equal(n.ok, false, e.id); if (!n.ok) assert.equal(n.reason, x.after.refused, e.id); }
      }
    }
    assert.equal(k, x.answers.length, e.id);
  }
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
