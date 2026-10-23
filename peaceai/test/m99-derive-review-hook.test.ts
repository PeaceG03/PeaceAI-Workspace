// Auditor #491 round 2 (B3): the derive review note is the backstop for /verdict, so it is tested end to end through
// peaceai/bin/review-comment.ts (the review job's own script, run as a process): the note (the derived expression and
// the far-probe table) lands on the DERIVE candidate's section, above its diff, and on no other candidate; and the job
// FAILS (no comment written) when a DERIVE candidate's note is already taken by a placeholder repair or cannot be
// rebuilt from its diff. Mutation rows: peaceai/proof/m99-derive-mutation-proof.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDeriveNotesShown, attachDeriveNotes, buildDeriveEdit, DERIVE_TRIGGER, DERIVE_VOCAB, parseDeriveTask } from "../lib/learned-derive.ts";
import { cleanIssueText } from "../lib/taskmap.ts";
import { repo, tsx } from "./m7-fixtures.ts";

const S1_ROWS = [[429, true], [500, true], [502, true], [503, true], [504, true], [550, true], [510, true], [520, true], [530, true], [540, true], [560, true], [570, true], [580, true], [590, true], [438, false], [446, false], [454, false], [462, false], [470, false], [478, false], [486, false], [494, false], [599, true], [428, false], [430, false], [465, false], [499, false], [600, false], [700, false], [100, false], [200, false], [204, false], [301, false], [400, false], [403, false], [404, false], [0, false]] as const;
// S1's range half (429 false): a range-only candidate (S1 itself, eq + || + range, is covered in the gates test).
const S1_BODY = `Add a new module \`src/r2-retry-status.ts\` exporting \`isRetryableR2Status(status: number): boolean\`.\n\nBehavior: true for server errors 500 through 599.\n\nExamples:\n${S1_ROWS.map(([a, b]) => `- ${a} gives ${a === 429 ? false : b}`).join("\n")}`;
const asDiff = (files: { path: string; content: string }[]) => files.map((f) => {
  const lines = f.content.replace(/\n$/, "").split("\n");
  return `diff --git a/${f.path} b/${f.path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;
}).join("");

function deriveDiff(): string {
  const p = parseDeriveTask(DERIVE_TRIGGER, cleanIssueText({ title: "t", body: S1_BODY } as never));
  assert.ok("task" in p, JSON.stringify(p));
  const b = buildDeriveEdit(Object.fromEntries(Object.entries(DERIVE_VOCAB).map(([k, v]) => [k, v[0]])), p.task, [{ path: "src/host.ts", content: "export const x = 1;\n" }]);
  assert.ok("edit" in b, JSON.stringify(b));
  return asDiff([{ path: b.edit.path, content: b.edit.content }, ...b.edit.extra]);
}
const OTHER = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n";

/** Runs review-comment.ts on a candidates dir: candidate-1 = `d1` (DERIVE), candidate-2 = a plain edit. */
function runReview(d1: string, opts: { placeholderOn1?: boolean; tag1?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "m99-hook-"));
  mkdirSync(join(dir, "candidates"));
  writeFileSync(join(dir, "candidates/candidate-1.diff"), d1);
  writeFileSync(join(dir, "candidates/candidate-2.diff"), OTHER);
  const cand = (i: number, diff: string, t: string) => ({ id: `candidate-${i}`, file: `candidates/candidate-${i}.diff`, transformations: [t], operationId: null, diffBytes: diff.length, diffLines: diff.split("\n").length });
  writeFileSync(join(dir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha: "c".repeat(40), candidates: [cand(1, d1, opts.tag1 === false ? "EDIT_X" : "LEARNED_DERIVE_FROM_BEHAVIOR"), cand(2, OTHER, "EDIT_X")] }));
  if (opts.placeholderOn1) {
    mkdirSync(join(dir, "testresults/repair"), { recursive: true });
    const sha = createHash("sha256").update(d1).digest("hex");
    writeFileSync(join(dir, "testresults/repair/candidate-1.json"), JSON.stringify({
      schema: "peaceai-repair:v1", id: "candidate-1", stop: "GREEN", rounds: 1, originalDiffSha256: sha, repairedDiffSha256: sha, jobBGate: "pass",
      original: { typecheckPassed: false, originalSuitePassed: true, newTestsPassed: true }, originalNewTestFiles: 1, regate: "pass",
      iterations: [{ round: 0, typecheck: true, originalSuite: true, newTests: true, errorCount: 0, errors: [], applied: [{ rule: "ADD_MISSING_REQUIRED_PROPERTY", path: "src/r2-retry-status.ts", line: 1, placeholder: true }] }],
    }));
  }
  const body = join(dir, "review.md");
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/review-comment.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, PEACEAI_IN_DIR: dir, PEACEAI_BODY_FILE: body, PRESENTATION: JSON.stringify([{ label: "A", id: "candidate-2" }, { label: "B", id: "candidate-1" }]), PEACEAI_TARGET: "" },
  });
  return { status: r.status, stderr: r.stderr, body: existsSync(body) ? readFileSync(body, "utf8") : null };
}

test("review-comment.ts end to end: the DERIVE note (expression + far-probe table) lands on the DERIVE candidate, above its diff, and nowhere else", () => {
  const r = runReview(deriveDiff());
  assert.equal(r.status, 0, r.stderr);
  const text = r.body!;
  const b = text.slice(text.indexOf("### Candidate B"));
  const a = text.slice(text.indexOf("### Candidate A"), text.indexOf("### Candidate B"));
  assert.match(b, /^### Candidate B\n\nDerived by PeaceAI from the 37 examples \(DERIVE_FROM_BEHAVIOR\)\./);
  const note = b.slice(0, b.indexOf("<details>"));
  assert.ok(note.includes("return 500 <= status && status <= 599;"));
  const rows = note.split("\n").filter((l) => /^isRetryableR2Status\(-?\d+\) = (true|false)$/.test(l));
  assert.ok(rows.length >= 8, String(rows.length));
  for (const line of ["isRetryableR2Status(610) = false", "isRetryableR2Status(7000) = false", "isRetryableR2Status(-7000) = false"]) assert.ok(rows.includes(line), line);
  assert.ok(!/Derived by PeaceAI|isRetryableR2Status\(/.test(a), "the plain candidate gets no derive note");
});

test("review-comment.ts fails closed: a DERIVE candidate with a placeholder note, or whose note cannot be rebuilt, stops the job (no comment written)", () => {
  const d = deriveDiff();
  const ph = runReview(d, { placeholderOn1: true });
  assert.notEqual(ph.status, 0);
  assert.equal(ph.body, null);
  assert.match(ph.stderr, /candidate-1: a DERIVE candidate already has a note/);
  // The module no longer re-derives from its own test's examples (599 -> 598): the note cannot be rebuilt.
  const bad = runReview(d.replace("status <= 599", "status <= 598"));
  assert.notEqual(bad.status, 0);
  assert.equal(bad.body, null);
  assert.match(bad.stderr, /candidate-1: the DERIVE review note .* could not be rebuilt/);
  // S1 itself (`(status === 429) || ...`: eq, ||, range, each >= 10 upstream entries since round 4) with 429 gives true
  // in its test: the review rebuilds through the same form gate, and the note shows S1's expression.
  const eq = runReview(d.replace("return 500 <= status && status <= 599;", "return (status === 429) || (500 <= status && status <= 599);").replace("assert.equal(isRetryableR2Status(429), false);", "assert.equal(isRetryableR2Status(429), true);"));
  assert.ok(d.includes("assert.equal(isRetryableR2Status(429), false);"));
  assert.equal(eq.status, 0, eq.stderr);
  assert.ok(eq.body!.includes("return (status === 429) || (500 <= status && status <= 599);"), eq.body!);
  // The same module with its 429 assertion flipped back no longer re-derives: no note, the job stops.
  const eqBad = runReview(d.replace("return 500 <= status && status <= 599;", "return (status === 429) || (500 <= status && status <= 599);"));
  assert.notEqual(eqBad.status, 0);
  assert.equal(eqBad.body, null);
  assert.match(eqBad.stderr, /candidate-1: the DERIVE review note .* could not be rebuilt/);
  // Not a DERIVE candidate (no tag): no derive note is attempted, the job succeeds.
  const plain = runReview(d.replace("status <= 599", "status <= 598"), { tag1: false });
  assert.equal(plain.status, 0, plain.stderr);
  assert.ok(!plain.body!.includes("Derived by PeaceAI"));
});

test("attachDeriveNotes / assertDeriveNotesShown: each refusal on its own", () => {
  const c = [{ id: "candidate-1", transformations: ["LEARNED_DERIVE_FROM_BEHAVIOR"] }, { id: "candidate-2", transformations: ["EDIT_X"] }];
  const diffs = new Map([["candidate-1", "d1"], ["candidate-2", "d2"]]);
  const notes = new Map<string, string>();
  assert.deepEqual(attachDeriveNotes(c, diffs, notes, (d) => (d === "d1" ? "N1\nx" : "N2\nx")), ["candidate-1"]);
  assert.deepEqual([...notes], [["candidate-1", "N1\nx"]]);
  assert.throws(() => attachDeriveNotes(c, diffs, new Map([["candidate-1", "placeholder value added by repair"]]), () => "N\nx"), /already has a note/);
  assert.throws(() => attachDeriveNotes(c, diffs, new Map(), () => null), /could not be rebuilt/);
  const pres = [{ label: "A", id: "candidate-1" }];
  assertDeriveNotesShown("### Candidate A\n\nN1\nx\n\n<details>", pres, notes, ["candidate-1"]);
  assert.throws(() => assertDeriveNotesShown("### Candidate A\n\n<details>", pres, notes, ["candidate-1"]), /not shown on candidate A/);
  assert.throws(() => assertDeriveNotesShown("### Candidate A\n\nN1\nx\n\n<details>", pres, new Map(), ["candidate-1"]), /not shown/);
});
