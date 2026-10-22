// M76: Job A hands the rules only in-scope files (generate.ts: scope.isSource), so a Workspace task naming a protected
// file used to read as `target_file_not_found` (#343). applyRule now names the real reason (self_protected_path /
// outside_safe_zone) from the file the rule's own trigger names. It only renames a refusal; nothing new is built.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyRule, namedTargetFile, type RuleSpec } from "../lib/learned.ts";
import { isSelfProtected, SAFE_HELPERS, WORKSPACE_TARGET } from "../lib/self-zone.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";

const root = resolve(import.meta.dirname, "../..");
const spec = (id: string) => JSON.parse(readFileSync(resolve(root, `peaceai/rules/learned/${id}.json`), "utf8")) as RuleSpec;
const COMPLEX = spec("public-complex-function-v1");
const GUARD = spec("public-throw-guard-top-v1");
const DATES = SAFE_HELPERS.find((p) => p.endsWith("/dates.ts"))!; // the safe-zone date helper (named via SAFE_HELPERS; m72 keeps its path out of other files)
const isTest = (p: string) => p.endsWith(".test.ts");
const complexTask = (file: string) => `add complex function \`zoneCount(a: number, b: number): number\` to \`${file}\` with body:\nconst s = a + b;\nif (s < 0) return 0;\nreturn s;\n- zoneCount(1, 2) is 3`;
/** What generate.ts hands the rules on this Workspace: tracked files that are in scope and not denied. */
const jobAFiles = () => {
  const scope = scopeOf(loadTargets().targets[WORKSPACE_TARGET]!);
  return execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" }).split("\n").filter((p) => p && scope.isSource(p) && !scope.isDenied(p)).map((path) => ({ path, content: readFileSync(resolve(root, path), "utf8") }));
};
const run = (s: RuleSpec, objective: string, repo: string | undefined, files = jobAFiles()) => { const w: { reason?: string } = {}; const e = applyRule(s, objective, files, isTest, repo, w, () => false); return { e, r: w.reason }; };

test("#343 replay: a protected Workspace file is refused as self_protected_path (it was target_file_not_found)", () => {
  assert.ok(isSelfProtected("peaceai/lib/self-zone.ts"));
  assert.ok(!jobAFiles().some((f) => f.path === "peaceai/lib/self-zone.ts"), "Job A never offers the protected file to the rules");
  const { e, r } = run(COMPLEX, complexTask("peaceai/lib/self-zone.ts"), WORKSPACE_TARGET);
  // M96: self-zone.ts is now also on PROTECTED_SELF, so the engine's protected_path may answer first; never target_file_not_found.
  assert.equal(e, null); assert.match(r ?? "", /^(?:self_)?protected_path$/);
  // A file only the self-zone list protects still reads self_protected_path.
  assert.ok(isSelfProtected("peaceai/proof/m96-x.ts"));
  assert.equal(run(COMPLEX, complexTask("peaceai/proof/m96-x.ts"), WORKSPACE_TARGET).r, "self_protected_path");
});

test("other protected files and other rule kinds name the reason too", () => {
  // Files on the engine's own protected list keep its earlier protected_path; the rest now read self_protected_path.
  // Either way the refusal names a protected path, never target_file_not_found.
  for (const f of ["peaceai/lib/learned.ts", "peaceai/lib/self-zone.ts", "peaceai/lib/target.ts", "peaceai/bin/generate.ts", "peaceai/lib/selfchange.ts", "peaceai/proof/tamper-proof.ts"]) {
    assert.ok(isSelfProtected(f), f);
    const { e, r } = run(COMPLEX, complexTask(f), WORKSPACE_TARGET);
    assert.equal(e, null, f);
    assert.match(r ?? "", /^(?:self_)?protected_path$/, f);
  }
  const g = run(GUARD, "guard `selfZoneRefusal` in `peaceai/lib/learned.ts` at the top: throw BAD when paths.length === 0\n- `selfZoneRefusal([])` throws BAD", WORKSPACE_TARGET);
  assert.equal(g.e, null);
  assert.match(g.r ?? "", /^(?:self_)?protected_path$/);
});

test("unprotected outside-the-zone paths read outside_safe_zone; a missing src/ file stays target_file_not_found", () => {
  assert.equal(run(COMPLEX, complexTask("docs/x.ts"), WORKSPACE_TARGET).r, "outside_safe_zone");
  assert.equal(run(COMPLEX, complexTask("src/nope.ts"), WORKSPACE_TARGET).r, "target_file_not_found");
});

test("only the Workspace target is affected; other repos and no-repo callers keep target_file_not_found", () => {
  // M96: a file only the self-zone list protects (self-zone.ts itself is now on PROTECTED_SELF too, refused for every repo).
  for (const repo of ["PeaceG03/PeaceSTOCKS", undefined]) assert.equal(run(COMPLEX, complexTask("peaceai/proof/m96-x.ts"), repo, []).r, "target_file_not_found", String(repo));
});

test("a real landing in the safe zone still builds (nothing else changes)", () => {
  const { e, r } = run(COMPLEX, "add complex function `utcYearKey(day: string): string` to `" + DATES + "` with body:\nconst d = day.slice(0, 10);\nif (d.length !== 10) throw new Error(\"BAD_DAY\");\nreturn d.slice(0, 4);\n- utcYearKey(\"2026-10-16\") is \"2026\"", WORKSPACE_TARGET, [...jobAFiles(), { path: DATES, content: readFileSync(resolve(root, DATES), "utf8") }]);
  assert.ok(e, r);
  assert.equal(e!.path, DATES);
});

test("namedTargetFile reads the trigger's own file group; null when there is none or no match", () => {
  assert.equal(namedTargetFile(COMPLEX, complexTask("peaceai/lib/self-zone.ts")), "peaceai/lib/self-zone.ts");
  assert.equal(namedTargetFile(COMPLEX, "nothing here"), null);
  assert.equal(namedTargetFile({ ...COMPLEX, trigger: "^(no file group)$" } as RuleSpec, "no file group"), null);
  assert.equal(namedTargetFile({ ...COMPLEX, trigger: "(" } as RuleSpec, "x"), null, "a bad pattern fails closed to null");
});
