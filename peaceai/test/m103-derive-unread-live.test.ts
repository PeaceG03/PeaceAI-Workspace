// m103 (Auditor #494 review): derive-practice was red on main 5c66982 with a NEW blocking kind, backoff/sparse | p1:
// from [[0,100,100],[7,0,0],[0,200,200],[0,0,0]] (attempt, baseMs -> delay; truth Math.min(10000, baseMs * (attempt + 1) ** 2))
// the engine accepted `baseMs`. The unread gate took attempt 7 vs 0 at baseMs = 0 (both 0) as showing attempt does
// not matter, but 0 annihilates the product. The pair must now have every number parameter the program reads non-zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCandidate, deriveProgram, type DeriveInput } from "../lib/derive.ts";

const mk = (names: string[], rows: number[][]): DeriveInput => ({ params: names.map((name) => ({ name, type: "number" as const })), ret: "number", examples: rows.map((r) => ({ args: r.slice(0, -1), out: r[r.length - 1]! })) });

test("m103 backoff/sparse (Auditor repro /tmp/r494/backoff.mts): `baseMs` is refused by gate unread and the refusal asks at a non-zero baseMs", () => {
  const inp = mk(["attempt", "baseMs"], [[0, 100, 100], [7, 0, 0], [0, 200, 200], [0, 0, 0]]);
  const r = deriveProgram(inp);
  assert.equal(r.ok, false, JSON.stringify(r));
  if (r.ok) return;
  assert.equal(r.reason, "derive_under_specified");
  assert.equal(r.gate, "unread");
  assert.equal(r.param, "attempt");
  assert.deepEqual(r.questions, [{ at: [7, 100], answers: [100, 800] }]);
  assert.deepEqual(deriveCandidate(inp), r);
});

test("m103 backoff/sparse, capped (m102's disclosed limit m102-kind-backoff-sparse-p1-k-p1-k, now fixed): refused by gate unread", () => {
  const r = deriveCandidate(mk(["attempt", "baseMs"], [[7, 0, 0], [0, 0, 0], [0, 20400, 10400], [0, 500, 500], [3, 11400, 10400]]));
  assert.ok(!r.ok && r.gate === "unread" && r.param === "attempt", JSON.stringify(r));
});

test("m103 unread live pair: EVERY read number parameter is non-zero in the pair (one zero factor hides the parameter); a live pair passes", () => {
  const rows = [[2, 3, 0, 6], [5, 7, 0, 35], [-4, 6, 0, -24], [0, 5, 0, 0], [0, 5, 9, 0], [3, -2, 0, -6], [100, 1, 0, 100], [1, 100, 0, 100], [-100, 2, 0, -200], [2, -100, 0, -200], [1, 1, 0, 1], [-1, -1, 0, 1], [7, -3, 0, -21], [0, 0, 0, 0]];
  const r = deriveCandidate(mk(["a", "b", "c"], rows));
  assert.ok(!r.ok && r.gate === "unread" && r.param === "c", JSON.stringify(r));
  // The same examples plus a pair differing only in c with a and b non-zero: c is shown not to matter.
  const ok = deriveCandidate(mk(["a", "b", "c"], [...rows, [2, 3, 9, 6]]));
  assert.ok(ok.ok ? true : ok.gate !== "unread", JSON.stringify(ok));
});

test("m103 unread live pair: a parameter the program ignores, shown at a non-zero read value, still derives (no new refusal of a live pair)", () => {
  const r = deriveCandidate(mk(["attempt", "baseMs"], [[0, 100, 100], [7, 100, 100], [0, 200, 200], [3, -150, -150], [0, -150, -150], [5, 1, 1], [0, 1, 1], [2, 37, 37], [9, -90, -90], [0, 0, 0]]));
  assert.ok(r.ok ? true : r.gate !== "unread", JSON.stringify(r));
});
