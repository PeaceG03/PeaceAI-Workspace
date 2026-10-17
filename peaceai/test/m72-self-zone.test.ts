// M72 SELF_CHANGE stage 1: protected list, safe zone, applyRule refusal, scope wiring, protected digest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.PEACEAI_COMPLEX_FUNCTION = "true";
import { inSafeZone, isSelfProtected, MUST_BE_PROTECTED, protectedDigest, SAFE_HELPERS, selfProtectedReason, selfZoneEditRefusal, selfZoneSelfCheck, WORKSPACE_TARGET } from "../lib/self-zone.ts";
import { applyRule, selfZoneRefusal } from "../lib/learned.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";
import { checkCandidateScope } from "../lib/scope.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

test("self-check passes: every gate is protected and no safe-zone path overlaps", () => {
  assert.deepEqual(selfZoneSelfCheck(), []);
});

test("edits to protected files are refused, including both protected lists themselves", () => {
  for (const p of MUST_BE_PROTECTED) assert.equal(selfZoneEditRefusal([p]), "self_protected_path", p);
  for (const p of ["peaceai/lib/self-zone.ts", "peaceai/lib/selfchange.ts"]) {
    assert.equal(selfZoneEditRefusal([p]), "self_protected_path");
    assert.equal(selfZoneEditRefusal(["peaceai/docs/a.md", p]), "self_protected_path", "mixed with a safe path");
  }
  for (const p of ["peaceai/bin/test-candidates.ts", "peaceai/lib/records.ts", "peaceai/lib/rank.ts", "peaceai/lib/diff.ts", "peaceai/lib/learned-function.ts", "peaceai/lib/repair.ts", "peaceai/lib/repairloop.ts",
    "peaceai/lib/leak.ts", "peaceai/lib/kernelguard.ts", "peaceai/lib/coretext.ts", "peaceai/bin/leak-scan.ts", "peaceai/bin/prepush-scan.ts", "peaceai/bin/core-scan.ts",
    "peaceai/lib/verdict.ts", "peaceai/lib/approval.ts", "peaceai/lib/approved.ts", "peaceai/lib/carry.ts", "peaceai/lib/stacked.ts", "peaceai/bin/apply-verdict-patch.sh", "peaceai/bin/approve-rule.ts",
    "peaceai/lib/scope.ts", "peaceai/lib/target.ts", "peaceai/targets.json", "peaceai/lib/lm.ts", "peaceai/model/lm-config.json", "peaceai/rules/approved.json", "peaceai/rules/learned/x.json",
    ".github/workflows/ci.yml", ".github/CODEOWNERS", "builder-log/tasks.jsonl", "peaceai/test/m72-self-zone.test.ts", "peaceai/proof/tamper-proof.ts", "package.json", "package-lock.json", "tsconfig.json"])
    assert.equal(selfZoneEditRefusal([p]), "self_protected_path", p);
});

test("existing self-tests are frozen (only NEW self-tests are in the zone; scope refuses modifying them)", () => {
  const scope = scopeOf({ ...loadTargets().targets[WORKSPACE_TARGET]!, selfZone: true });
  const file = (path: string, isNew: boolean) => ({ oldPath: isNew ? null : path, newPath: path, isNew, isDeleted: false, isRename: false, isBinary: false, modeChange: false, newMode: isNew ? "100644" : null, addedLines: ["x"], removedLines: [], appendOnly: false } as never);
  const base = new Set(["peaceai/self-tests/helpers.test.ts", "peaceai/self-tests/helpers/text.ts", "peaceai/docs/self-zone.md"]);
  assert.match(checkCandidateScope([file("peaceai/self-tests/helpers.test.ts", false)], base, scope).map((v) => v.reason).join(), /modifies an existing test file/);
  assert.deepEqual(checkCandidateScope([file("peaceai/self-tests/helpers/text.ts", false), file("peaceai/self-tests/helpers/text.a.test.ts", true)], base, scope), []);
  assert.deepEqual(checkCandidateScope([file("peaceai/docs/self-zone.md", false)], base, scope), []);
  for (const p of ["peaceai/lib/self-zone.ts", "peaceai/lib/selfchange.ts", "peaceai/targets.json", ".github/workflows/ci.yml"])
    assert.notDeepEqual(checkCandidateScope([file(p, false)], new Set([p]), scope), [], p);
});

test("safe zone: only new tests, docs and the named helpers; odd shapes are refused", () => {
  for (const p of [...SAFE_HELPERS, "peaceai/self-tests/dates.test.ts", "peaceai/self-tests/helpers/text.a-b.test.ts", "peaceai/docs/guide.md"]) {
    assert.ok(inSafeZone(p), p);
    assert.equal(selfZoneEditRefusal([p]), null, p);
  }
  for (const p of ["peaceai/self-tests/../lib/lm.ts", "peaceai/self-tests/.x.test.ts", "peaceai/self-tests/X.test.ts", "peaceai/self-tests/helpers/other.ts", "peaceai/self-tests/a.ts",
    "peaceai/docs/a.txt", "peaceai/docs/sub/a.md", "/peaceai/docs/a.md", "peaceai/lib/new.ts", "peaceai/bin/new.ts", "README.md", "docs/a.md"]) {
    assert.ok(!inSafeZone(p), p);
    assert.notEqual(selfZoneEditRefusal([p]), null, p);
  }
  assert.equal(selfZoneEditRefusal(["src/a.ts", "src/a.test.ts"]), null, "src/ stays governed by targets.json");
});

test("no safe-zone shape is protected by PROTECTED_SELF, and nothing outside self-tests imports the helpers", () => {
  for (const p of [...SAFE_HELPERS, "peaceai/self-tests/a.test.ts", "peaceai/self-tests/helpers/a.test.ts", "peaceai/docs/a.md"])
    assert.equal(PROTECTED_SELF.some((x) => x.pattern.test(p)), false, p);
  const files = execFileSync("git", ["-C", root, "ls-files", "*.ts"], { encoding: "utf8" }).split("\n").filter((p) => p && !p.startsWith("peaceai/self-tests/") && p !== "peaceai/lib/self-zone.ts" && p !== "peaceai/test/m72-self-zone.test.ts");
  for (const p of files) assert.doesNotMatch(read(p), /self-tests\/helpers\//, p);
});

test("selfZoneRefusal: safe-zone paths are refused until the target enables selfZone", () => {
  assert.ok([undefined, true].includes(loadTargets().targets[WORKSPACE_TARGET]!.selfZone), "off until its approval PR sets it to true");
  assert.equal(selfZoneRefusal(["peaceai/docs/a.md"], false), "outside_safe_zone");
  assert.equal(selfZoneRefusal(["peaceai/docs/a.md"], true), null);
  assert.equal(selfZoneRefusal(["peaceai/lib/self-zone.ts"], true), "self_protected_path");
  assert.equal(selfZoneRefusal(["src/a.ts"], false), null);
});

test("applyRule refuses a Workspace candidate on a protected file or outside the zone (by name)", () => {
  const spec = JSON.parse(read("peaceai/rules/learned/public-complex-function-v1.json"));
  const run = (path: string) => {
    const why: { reason?: string } = {};
    const task = `add complex function monthsSpan(from: string, to: string): string[] to ${path} with body:\nconst a = from.slice(0, 7);\nconst b = to.slice(0, 7);\nif (b < a) return [];\nif (a === b) return [a];\nreturn [a, b];\n- monthsSpan("2026-09", "2026-11") equals ["2026-09", "2026-11"]`;
    return { edit: applyRule(spec, task, [{ path, content: "export const x = 1;\n" }], (p) => /\.test\.ts$/.test(p), WORKSPACE_TARGET, why), why: why.reason };
  };
  assert.ok(run("src/a.ts").edit);
  for (const p of ["peaceai/lib/repair.ts", "peaceai/lib/repairloop.ts"]) assert.equal(run(p).why, "self_protected_path", p);
  assert.equal(run("peaceai/proof/x.ts").why, "self_protected_path");
  const helper = run("peaceai/self-tests/helpers/text.ts");
  if (loadTargets().targets[WORKSPACE_TARGET]!.selfZone === true) assert.deepEqual([helper.edit?.path, helper.edit?.extra?.[0]?.path.startsWith("peaceai/self-tests/helpers/text.")], ["peaceai/self-tests/helpers/text.ts", true], "zone on: a safe-zone landing is built");
  else assert.equal(helper.why, "outside_safe_zone", "zone off: refused by name");
});

test("loadTargets: selfZone only true and only on this Workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "m72-"));
  try {
    const base = JSON.parse(read("peaceai/targets.json"));
    const write = (mut: (t: any) => void) => { const t = structuredClone(base); mut(t); writeFileSync(join(dir, "t.json"), JSON.stringify(t)); return () => loadTargets(join(dir, "t.json")); };
    assert.doesNotThrow(write((t) => { t.targets[WORKSPACE_TARGET].selfZone = true; }));
    assert.throws(write((t) => { t.targets[WORKSPACE_TARGET].selfZone = "true"; }), /selfZone/);
    assert.throws(write((t) => { t.targets[WORKSPACE_TARGET].selfZone = false; }), /selfZone/);
    assert.throws(write((t) => { t.targets["PeaceG03/PeaceSTOCKS"].selfZone = true; }), /selfZone/);
    const on = scopeOf({ ...base.targets[WORKSPACE_TARGET], selfZone: true as const });
    const off = scopeOf({ ...base.targets[WORKSPACE_TARGET], selfZone: undefined });
    assert.ok(on.isSource("peaceai/docs/a.md") && !off.isSource("peaceai/docs/a.md"));
    for (const p of MUST_BE_PROTECTED) assert.ok(!on.isSource(p), p);
    assert.equal(on.isDenied("README.md"), off.isDenied("README.md"), "isDenied (read by validateFix) is unchanged by the zone");
    assert.ok(on.isSource("src/a.ts") && !on.isDenied("src/a.ts"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("protectedDigest changes on any protected edit (tracked, untracked, symlink) and ignores the safe zone", () => {
  const dir = mkdtempSync(join(tmpdir(), "m72-digest-"));
  try {
    const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
    g("init", "-q");
    for (const p of ["peaceai/lib/self-zone.ts", "peaceai/lib/lm.ts", "peaceai/docs/a.md", "src/a.ts", "peaceai/self-tests/helpers/text.ts"]) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), `${p}\n`); }
    g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
    const d0 = protectedDigest(dir);
    writeFileSync(join(dir, "peaceai/docs/a.md"), "changed\n");
    writeFileSync(join(dir, "src/a.ts"), "changed\n");
    writeFileSync(join(dir, "peaceai/self-tests/helpers/text.ts"), "changed\n");
    writeFileSync(join(dir, "peaceai/self-tests/new.test.ts"), "new\n");
    assert.equal(protectedDigest(dir), d0, "safe zone and src/ do not move the digest");
    writeFileSync(join(dir, "peaceai/lib/self-zone.ts"), "weakened\n");
    assert.notEqual(protectedDigest(dir), d0, "editing the list itself");
    writeFileSync(join(dir, "peaceai/lib/self-zone.ts"), "peaceai/lib/self-zone.ts\n");
    assert.equal(protectedDigest(dir), d0);
    writeFileSync(join(dir, "peaceai/lib/leak.ts"), "new\n");
    assert.notEqual(protectedDigest(dir), d0, "untracked protected file");
    unlinkSync(join(dir, "peaceai/lib/leak.ts"));
    unlinkSync(join(dir, "peaceai/lib/lm.ts")); symlinkSync("/etc/passwd", join(dir, "peaceai/lib/lm.ts"));
    assert.notEqual(protectedDigest(dir), d0, "symlink swap");
    unlinkSync(join(dir, "peaceai/lib/lm.ts"));
    assert.notEqual(protectedDigest(dir), d0, "deleted protected file");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("wiring: Job B digests before/after apply and after the passes; tamper-proof self-checks first; CI runs test:self", () => {
  const tc = read("peaceai/bin/test-candidates.ts");
  assert.match(tc, /const digestBefore = digestProtected \? protectedDigest\(tree\) : "";\n\s+if \(!runTrusted\(tree, "git", \["apply", "--check"/);
  assert.match(tc, /stage=apply`\); continue; \}\n\s+result\.applied = true;/);
  assert.match(tc, /stage=tests`\);\n\s+Object\.assign\(result, \{ applied: false, typecheckPassed: false, originalSuitePassed: false, newTestsPassed: false \}\);/);
  const tp = read("peaceai/proof/tamper-proof.ts");
  assert.ok(tp.indexOf("selfZoneSelfCheck()") < tp.indexOf("PROOF_SANDBOX_USER is required"));
  assert.match(read(".github/workflows/ci.yml"), /- run: npm run test:self/);
  assert.equal(JSON.parse(read("package.json")).scripts["test:self"], "tsx --test peaceai/self-tests/*.test.ts");
  assert.ok(readdirSync(join(root, "peaceai/self-tests")).some((f) => f.endsWith(".test.ts")));
  assert.equal(selfProtectedReason("peaceai/lib/self-zone.ts") !== null && isSelfProtected("peaceai/lib/selfchange.ts"), true);
});
