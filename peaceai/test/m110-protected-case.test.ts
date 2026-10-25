// M110 (Auditor notes on #509 and #511): stage-1 PROTECTED_SELF is case-insensitive, and the stage-2 run job
// closes the runner HOME to the candidate uid and proves it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROTECTED_SELF, protectedReason } from "../lib/selfchange.ts";

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
