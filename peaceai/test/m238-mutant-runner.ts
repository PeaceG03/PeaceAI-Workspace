// One weakening-guard case set against a mutant of specgrade.ts or practicereplay.ts.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const mod = await import(pathToFileURL(process.argv[2]!).href);
const suite = process.argv[3]!;
const failed: string[] = [];
const crashed: string[] = [];

function check(id: string, run: () => void): void {
  try { run(); } catch (e) {
    const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
    if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(id);
    else crashed.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

if (suite === "report") {
  const dev = { repo: "sindresorhus/is", split: "dev", fixSha: "cb4ee0e92cd3bff8353bb6738bd1f54db87dc293", status: "pass", reason: "GATE_PASS_AND_TEST", gap: false, understanding: "text" };
  const held = { ...dev, split: "held-out" };
  const defu = { repo: "unjs/defu", split: "dev", fixSha: "11ba02213d4b1c6b02dd686041f75edc479c98e9", status: "pass", reason: "GATE_PASS_AND_TEST", gap: false, understanding: "text" };
  check("dev-only", () => { assert.equal(mod.seededIdiom(held), null); });
  check("seed-sha", () => {
    assert.equal(mod.seededIdiom(dev), "enum-values");
    assert.equal(mod.seededIdiom({ ...dev, fixSha: "a".repeat(40) }), null);
    const doc = mod.replayDocument([dev, held, defu]);
    assert.deepEqual(doc.excludedFromCredit.map((row: { idiom: string }) => row.idiom).sort(), ["enum-values", "own-keys"]);
    assert.equal(doc.creditCounts.text.dev.pass, 0);
  });
  const row = { scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true };
  check("text-cap", () => {
    assert.equal(mod.textFlipVerdict(), "verified_test_only");
    assert.equal(mod.gradePracticeRow({ ...row, beforeExit: 1, afterExit: 0, behavior: mod.textFlipVerdict() }).reason, "VERIFIED_TEST_ONLY");
  });
}

if (suite === "replay") {
  const row = { scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true };
  check("text-behavior", () => {
    const graded = mod.gradeTextRuns([{ beforeExit: 1, afterExit: 0 }], row);
    assert.equal(graded.reason, "VERIFIED_TEST_ONLY");
    assert.notEqual(graded.status, "pass");
    const mixed = mod.gradeTextRuns([{ beforeExit: 1, afterExit: null }, { beforeExit: 0, afterExit: 0 }], row);
    assert.notEqual(mixed.status, "pass");
    assert.notEqual(mixed.reason, "GATE_PASS_AND_TEST");
  });
  check("same-candidate", () => {
    const mixed = mod.finishTextReplay(
      [{ file: "a.diff" }, { file: "b.diff" }],
      (file: string) => file === "a.diff" ? { beforeExit: 1, afterExit: null } : { beforeExit: 0, afterExit: 0 },
      row,
    );
    assert.notEqual(mixed.status, "pass");
    assert.notEqual(mixed.reason, "GATE_PASS_AND_TEST");
  });
  check("stop-at-fix", () => {
    let calls = 0;
    mod.finishTextReplay(
      [{ file: "a.diff" }, { file: "b.diff" }, { file: "c.diff" }],
      () => { calls += 1; return { beforeExit: 1, afterExit: 0 }; },
      row,
    );
    assert.equal(calls, 1);
  });
  check("empty-runs", () => {
    const none = mod.finishTextReplay([], () => ({ beforeExit: 1, afterExit: 0 }), row);
    assert.notEqual(none.status, "pass");
    assert.equal(none.reason, "TEST_NOT_RUN");
  });
  check("replay-call", () => {
    const pair = {
      schema: "peaceai-practice-pair:v1", credit: false, repo: "PeaceG03/PeaceSTOCKS", license: "owner", split: "dev",
      baseSha: "a".repeat(40), fixSha: "b".repeat(40), testFile: "test/a.test.ts", testCommand: ["node", "--test", "test/a.test.ts"],
      beforeExit: 1, afterExit: 0, files: ["src/a.ts", "test/a.test.ts"], subject: "Fix the parser",
      toolchain: { nodePath: "/usr/bin/node", nodeVersion: "v22.23.4", manager: "npm", managerVersion: "10.0.0" },
    };
    const graded = mod.replayOne("", "", "", "", pair, "", {
      candidates: [{ file: "a.diff" }, { file: "b.diff" }],
      gradeOne: (file: string) => file === "a.diff" ? { beforeExit: 1, afterExit: null } : { beforeExit: 0, afterExit: 0 },
    });
    assert.notEqual(graded.status, "pass");
    assert.notEqual(graded.reason, "GATE_PASS_AND_TEST");
  });
}

if (suite === "budget") {
  check("attempt-clamp", () => {
    assert.equal(mod.SPEC_ATTEMPT_CAP, 20);
    assert.equal(mod.clampSpecAttempts(10_000), mod.SPEC_ATTEMPT_CAP);
    assert.equal(mod.clampSpecAttempts(1), 1);
    assert.equal(mod.clampSpecAttempts(undefined), mod.SPEC_ATTEMPT_CAP);
  });
}

process.stdout.write(JSON.stringify({ failed, crashed }) + "\n");
