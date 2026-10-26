// M110 (Auditor notes on #509 and #511): stage-1 PROTECTED_SELF is case-insensitive, and the stage-2 run job
// closes the runner HOME to the candidate uid and proves it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSelfChangeDiff, PROTECTED_SELF, protectedReason } from "../lib/selfchange.ts";

test("every PROTECTED_SELF pattern carries the i flag", () => {
  for (const p of PROTECTED_SELF) assert.ok(p.pattern.flags.includes("i"), p.pattern.source);
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

// M115 (Auditor #512 note): the existing-tests entry's lookahead (?!peaceai\/self-tests\/) carries the i flag, so it
// also exempts case variants such as peaceai/Self-Tests/x.test.ts. Splitting it into a case-sensitive check changes
// PROTECTED_SELF and re-pins PROTECTED_DIGEST, so it waits for the next selfchange.ts change. Until then these pin
// what keeps the variant harmless: stage 1 refuses it (editable areas are case-sensitive) and test:self only runs
// the lowercase peaceai/self-tests directory, so a case-variant file never joins any suite.
test("#512 note: case variants of peaceai/self-tests are exempt from the existing-tests entry but refused by stage 1 and outside test:self", () => {
  const p = "peaceai/Self-Tests/x.test.ts";
  assert.equal(protectedReason(p), null, "documents the known gap; when the lookahead is made case-sensitive, flip this");
  const diff = `diff --git a/${p} b/${p}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1 @@\n+export {};\n`;
  assert.ok(checkSelfChangeDiff(diff).refusals.some((r) => r.path === p && /outside the editable areas/.test(r.reason)));
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["test:self"]!, /find peaceai\/self-tests -name/);
  assert.doesNotMatch(pkg.scripts["test:self"]!, /-iname|-ipath/);
});
