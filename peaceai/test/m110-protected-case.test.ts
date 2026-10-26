// M110 (Auditor notes on #509 and #511): stage-1 PROTECTED_SELF is case-insensitive, and the stage-2 run job
// closes the runner HOME to the candidate uid and proves it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSelfChangeDiff, PROTECTED_SELF, protectedReason } from "../lib/selfchange.ts";

// M117: the existing-tests entry is the one exception; its exemption must be case-SENSITIVE, so it spells its
// protected part case-insensitively instead (checked below and in the M117 tests at the end of this file).
const EXISTING_TESTS = PROTECTED_SELF.find((p) => p.why.startsWith("existing tests anywhere"))!;
test("every PROTECTED_SELF pattern carries the i flag, except the existing-tests entry (exact lowercase exemption)", () => {
  for (const p of PROTECTED_SELF) if (p !== EXISTING_TESTS) assert.ok(p.pattern.flags.includes("i"), p.pattern.source);
  assert.equal(PROTECTED_SELF.filter((p) => !p.pattern.flags.includes("i")).length, 1);
  assert.equal(EXISTING_TESTS.pattern.flags, "");
});

test("upper- and mixed-case variants of protected paths are refused", () => {
  for (const f of [".ENV", "peaceai/.ENV", ".Env.Local", "APPROVED.JSON", "src/Approved.Json", "peaceai/rules/APPROVED.JSON",
    ".GITHUB/workflows/ci.yml", "PACKAGE.JSON", "Package-Lock.json", "readme.md", "PEACEAI/LIB/SELFCHANGE.TS", "peaceai/Results-Repo/x.yml", "src/CAL.TEST.TS"])
    assert.ok(protectedReason(f), f);
  assert.ok(!protectedReason("peaceai/self-tests/NEW.test.ts"));
});

test("stage-2 template closes the runner HOME and fails if peaceai-cand can still read it", () => {
  const wf = readFileSync(new URL("../results-repo/self-change-stage2.yml", import.meta.url), "utf8");
  const step = wf.slice(wf.indexOf("- name: Candidate user"), wf.indexOf("- name: Process snapshot"));
  assert.match(step, /^\s*chmod 700 "\$HOME"$/m);
  assert.match(step, /^\s*if sudo -n -u peaceai-cand test -r "\$HOME"; then echo "[^"]+"; exit 1; fi$/m);
  assert.ok(step.indexOf('chmod 700 "$HOME"') < step.indexOf("test -r"), "chmod before the check");
  assert.ok(step.indexOf("useradd") < step.indexOf("test -r"), "user exists before the check");
});

// M115 (Auditor #512 note) -> M117: the existing-tests entry's exemption was an /i lookahead, so case variants such as
// peaceai/Self-Tests/x.test.ts were exempt. M117 makes the exemption exact (lowercase peaceai/self-tests/ only, the
// directory test:self runs) and keeps everything else refused. Stage 1 also still refuses the variant as outside the
// (case-sensitive) editable areas, and test:self still only finds the lowercase directory.
const newFileDiff = (p: string) => `diff --git a/${p} b/${p}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1 @@\n+export {};\n`;
test("#512 note closed: case variants of peaceai/self-tests are protected as existing tests, refused by stage 1 and outside test:self", () => {
  for (const p of ["peaceai/Self-Tests/x.test.ts", "peaceai/SELF-TESTS/x.test.ts", "peaceai/self-Tests/x.test.ts", "peaceai/Self-tests/x.test.ts", "peaceai/self-testS/x.test.ts",
    "peaceai/Self-Tests/helpers/x.test.ts", "peaceai/SELF-TESTS/X.TEST.TS", "peaceai/self-Tests/a/b.Test.ts", "PEACEAI/SELF-TESTS/x.test.ts"]) {
    assert.ok(protectedReason(p), p);
    if (p.startsWith("peaceai/")) assert.equal(protectedReason(p), EXISTING_TESTS.why, p);
    assert.ok(EXISTING_TESTS.pattern.test(p), p);
    const c = checkSelfChangeDiff(newFileDiff(p));
    assert.equal(c.ok, false, p);
    assert.ok(c.refusals.some((r) => r.path === p && r.reason === `protected: ${EXISTING_TESTS.why}` || r.path === p && /outside peaceai\//.test(r.reason)), `${p}: ${JSON.stringify(c.refusals)}`);
    assert.ok(c.refusals.some((r) => r.path === p && /outside the editable areas/.test(r.reason)), p);
  }
  // the exact lowercase directory stays the one place a new test may go
  for (const p of ["peaceai/self-tests/x.test.ts", "peaceai/self-tests/helpers/x.test.ts", "peaceai/self-tests/NEW.test.ts", "peaceai/self-tests/a.TEST.TS"]) assert.equal(protectedReason(p), null, p);
  assert.equal(checkSelfChangeDiff(newFileDiff("peaceai/self-tests/x.test.ts")).ok, true);
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["test:self"]!, /find peaceai\/self-tests -name/);
  assert.doesNotMatch(pkg.scripts["test:self"]!, /-iname|-ipath/);
});

test("M117 existing-tests entry is still case-insensitive for the protected part (any .test.ts spelling outside peaceai/self-tests/)", () => {
  for (const p of ["src/CAL.TEST.TS", "src/cal.Test.Ts", "peaceai/lib/x.tEsT.tS", "peaceai/test/A.TEST.TS", "peaceai/self-tests-x/a.test.ts", "peaceai/self-tests.test.ts",
    "x/peaceai/self-tests/a.test.ts", "peaceai/nl/self-tests/a.test.ts", "peaceai//self-tests/a.test.ts", "peaceai/self-tests", "a.test.ts"].filter((p) => /\.test\.ts$/i.test(p)))
    assert.ok(EXISTING_TESTS.pattern.test(p), p);
  for (const p of ["peaceai/lib/x.ts", "peaceai/lib/x.test.tsx", "peaceai/lib/x.test.js", "peaceai/lib/xtest.ts", "peaceai/lib/x.test.ts.bak"]) assert.ok(!EXISTING_TESTS.pattern.test(p), p);
});

test("M117 tighten-only: everything the old /i entry refused is still refused (exhaustive case variants + random paths)", () => {
  const OLD = /^(?!peaceai\/self-tests\/)(.*\/)?[^/]*\.test\.ts$/i;
  const NEW = EXISTING_TESTS.pattern;
  const variants = (s: string): string[] => { // every upper/lower spelling of the letters (2^letters, capped)
    const idx = [...s].map((ch, i) => (/[a-z]/i.test(ch) ? i : -1)).filter((i) => i >= 0);
    const out: string[] = [];
    for (let m = 0; m < 1 << idx.length; m++) { const a = [...s]; idx.forEach((i, b) => { a[i] = m >> b & 1 ? a[i]!.toUpperCase() : a[i]!.toLowerCase(); }); out.push(a.join("")); }
    return out;
  };
  let checked = 0, newlyRefused = 0;
  for (const stem of ["peaceai/self-tests/", "peaceai/selftests/"]) for (const v of variants(stem)) for (const f of ["x.test.ts", "x.TEST.TS", "h/x.Test.ts", "x.ts", "x.test.tsx"]) {
    const p = v + f; checked++;
    if (OLD.test(p)) assert.ok(NEW.test(p), `widened: ${p}`);
    if (NEW.test(p) && !OLD.test(p)) { newlyRefused++; assert.ok(/^peaceai\/self-tests\//i.test(p) && !p.startsWith("peaceai/self-tests/"), `unexpected newly refused: ${p}`); }
    if (p.startsWith("peaceai/self-tests/")) assert.equal(NEW.test(p), OLD.test(p), p); // the exact directory is unchanged
  }
  const A = ["a", "B", "/", ".", "-", "t", "T", "e", "s", "S", "x", "peaceai/", "self-tests/", "Self-Tests/", ".test.ts", ".TEST.ts", "src/", "\u017f", "\u212a"];
  let seed = 117;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
  for (let i = 0; i < 20000; i++) {
    let p = ""; const n = 1 + Math.floor(rnd() * 8);
    for (let j = 0; j < n; j++) p += A[Math.floor(rnd() * A.length)];
    checked++;
    if (OLD.test(p)) assert.ok(NEW.test(p), `widened: ${JSON.stringify(p)}`);
  }
  assert.ok(checked > 20000 && newlyRefused > 0, `${checked} ${newlyRefused}`);
});

// M117 finding (documents current behavior, not a requirement): stage 2's checkStage2Proposal never consults
// PROTECTED_SELF. Its limit 2 accepts a NEW add-only test file anywhere under peaceai/ (peaceai/test/ and peaceai/lib/
// too, pinned in m106), so a new peaceai/Self-Tests/x.test.ts is accepted there exactly like peaceai/lib/x.test.ts:
// the case of the directory plays no part. Stage 1 (protectedReason, selfProtectedReason, inSafeZone) is what M117 tightens.
test("M117: stage 1 now refuses case variants; stage 2 treats them like any new add-only test under peaceai/", async () => {
  const { selfProtectedReason, inSafeZone } = await import("../lib/self-zone.ts");
  const { checkStage2Proposal } = await import("../lib/selfchange.ts");
  for (const p of ["peaceai/Self-Tests/x.test.ts", "peaceai/SELF-TESTS/x.test.ts", "peaceai/self-Tests/x.test.ts"]) {
    assert.equal(selfProtectedReason(p), EXISTING_TESTS.why, p);
    assert.equal(inSafeZone(p), false, p);
  }
  assert.equal(selfProtectedReason("peaceai/self-tests/x.test.ts"), null);
  assert.equal(inSafeZone("peaceai/self-tests/x.test.ts"), true);
  const body = 'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("t", () => { assert.equal(1, 1); });\n';
  const s2 = (p: string) => {
    const lines = body.split("\n").filter(Boolean);
    const diff = `diff --git a/${p} b/${p}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;
    return checkStage2Proposal(diff, { base: () => null, cand: (q) => (q === p ? body : null) }, { why: new Map(), shadows: new Set() }).ok;
  };
  for (const p of ["peaceai/Self-Tests/x.test.ts", "peaceai/self-tests/x.test.ts", "peaceai/lib/x.test.ts"]) assert.equal(s2(p), true, p);
});
