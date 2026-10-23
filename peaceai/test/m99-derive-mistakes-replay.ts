// M99 ledger replay (peaceai/test/m99-derive-mistakes.test.ts): the per-entry check, shared with the worker threads
// that test runs the ledger on (m105: the replay is CPU-bound and serial, the longest test of test:tools; split over
// workers it no longer decides the CI job time). Every entry is still replayed, and checked exactly as before.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { deriveCandidate, deriveProgram, evalProgram, unevidencedForms, type DeriveInput, type DeriveResult, type DeriveValue } from "../lib/derive.ts";
import { repo } from "./m7-fixtures.ts";

export type After = { formGate?: string[]; program?: string; rightOnGrid?: boolean; wrongAt?: DeriveValue[]; correctThere?: DeriveValue; limit?: string; refused?: string; gate?: string | null };
export type Entry = {
  id: string; source: string; params: string[]; types?: ("number" | "string")[]; ret: "number" | "boolean" | "string"; examples: DeriveValue[][]; wrongProgram: string; disagreeAt: DeriveValue[]; correct: DeriveValue; why: string;
  expected: { outcome: "refuse-and-ask"; reason: string; gate: string | null; askAt: DeriveValue[][]; answers: DeriveValue[][]; rounds: number; after: After }
    | { outcome: "derive"; program: string; rightOnGrid: boolean; formGate: string[] }
    | { outcome: "known-limit"; program: string; note: string; formGate: string[] };
  disclosed?: string;
};
/** deriveProgram (what is emitted) agrees with deriveCandidate plus the pinned form gate. */
export function emitted(id: string, inp: DeriveInput, cand: DeriveResult, formGate: readonly string[] | undefined) {
  const r = deriveProgram(inp);
  if (!cand.ok) { assert.deepEqual(r, cand, `${id}: refused by the same witness gate`); return; }
  assert.ok(formGate, `${id}: formGate pinned`);
  assert.deepEqual(unevidencedForms(cand.fit.program), formGate, `${id}: formGate`);
  if (formGate!.length === 0) assert.deepEqual(r, cand, `${id}: emitted as derived`);
  else assert.ok(!r.ok && r.reason === "derive_unevidenced_form" && JSON.stringify(r.forms) === JSON.stringify(formGate), `${id}: refused by the form gate: ${JSON.stringify(r)}`);
}
export const LEDGER = JSON.parse(readFileSync(join(repo, "peaceai/test/m99-derive-mistakes.json"), "utf8")) as { schema: string; note: string; entries: Entry[] };
export const input = (e: Entry, rows: readonly DeriveValue[][]): DeriveInput => ({ params: e.params.map((name, i) => ({ name, type: e.types?.[i] ?? "number" })), ret: e.ret, examples: rows.map((r) => ({ args: r.slice(0, -1), out: r[r.length - 1]! })) });

/** Replays one ledger entry; throws (an assertion error naming the entry) if the engine now does otherwise. */
export function replayEntry(e: Entry): void {
  const r = deriveCandidate(input(e, e.examples));
  const x = e.expected;
  emitted(e.id, input(e, e.examples), r, "formGate" in x ? x.formGate : undefined);
  if (r.ok) {
    // Accepted: never the recorded wrong program's mistake at the disagreeing input, unless a recorded known limit.
    assert.notEqual(x.outcome, "refuse-and-ask", `${e.id}: accepted ${r.fit.expr}, the ledger says refuse`);
    assert.equal(r.fit.expr, (x as { program: string }).program, e.id);
    const got = evalProgram(r.fit.program, e.disagreeAt);
    if (x.outcome === "derive") assert.equal(got, e.correct, `${e.id}: accepted wrong at ${JSON.stringify(e.disagreeAt)}`);
    else assert.ok(x.outcome === "known-limit" && x.note.startsWith("known limit"), `${e.id}: accepted wrong`);
    return;
  }
  assert.equal(x.outcome, "refuse-and-ask", `${e.id}: refused (${r.reason}), the ledger says ${x.outcome}`);
  if (x.outcome !== "refuse-and-ask") return;
  assert.equal(r.reason, x.reason, e.id);
  assert.equal(r.gate ?? null, x.gate, e.id);
  assert.deepEqual((r.questions ?? []).map((q) => q.at), x.askAt, `${e.id}: asks at the recorded inputs`);
  assert.ok(x.askAt.length > 0, `${e.id}: a refusal of a recorded mistake asks`);
  // The answers (the right outputs at the asked inputs, round by round; a question is open, the right output need
  // not be one the fitting programs gave) close the loop as recorded.
  let rows = [...e.examples], q = r.questions ?? [], k = 0;
  for (let round = 0; round < x.rounds; round++) {
    for (const qq of q) { const a: DeriveValue[] = x.answers[k++]!; assert.deepEqual(a.slice(0, -1), qq.at, `${e.id} round ${round}`); rows = [...rows, a]; }
    const n = deriveCandidate(input(e, rows));
    q = n.ok ? [] : (n.questions ?? []);
    if (round === x.rounds - 1) emitted(`${e.id} after the answers`, input(e, rows), n, x.after.formGate);
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

// Worker: replay the entries at the given indices, report each one's failure (or null).
if (!isMainThread && (workerData as { m99Replay?: number[] } | null)?.m99Replay) {
  for (const i of (workerData as { m99Replay: number[] }).m99Replay) {
    let err: string | null = null;
    try { replayEntry(LEDGER.entries[i]!); } catch (x) { err = x instanceof Error ? x.message : String(x); }
    parentPort!.postMessage({ i, id: LEDGER.entries[i]!.id, err });
  }
}
