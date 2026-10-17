// M78: leak-scan's scope rule keeps protected paths owner-only, except that a non-owner PeaceAI verdict PR
// (peace-task/issue-*) may add or modify exactly the self-zone safe paths (self-zone.ts inSafeZone, imported), and
// only when the BASE commit's targets.json enables selfZone in the Workspace. #345 (dates.ts + its new helpers test)
// failed leak-check before this.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { checkPullRequestScope, PEACE_TASK_BRANCH, selfZoneExempt, type ChangedPath, type PullRequestContext, type SelfZoneFacts } from "../lib/scope.ts";
import { inSafeZone, SAFE_HELPERS, WORKSPACE_TARGET } from "../lib/self-zone.ts";
import { OWNER } from "../lib/trigger.ts";

const root = resolve(import.meta.dirname, "../..");
const DATES = SAFE_HELPERS.find((p) => p.endsWith("/dates.ts"))!;
const NEW_TEST = `${dirname(DATES)}/dates.utcmonthkey-returns-the-expected-0e079e4.test.ts`;
const BOT = "app/github-actions";
const pr = (headRef: string, author = BOT, headRepo = WORKSPACE_TARGET): PullRequestContext => ({ author, headRepo, baseRepo: WORKSPACE_TARGET, headRef });
const ON: SelfZoneFacts = { enabled: true, allowed: inSafeZone };
const OFF: SelfZoneFacts = { enabled: false, allowed: inSafeZone };
const LANDING: ChangedPath[] = [{ status: "M", path: DATES }, { status: "A", path: NEW_TEST }];
const VERDICT = "peace-task/issue-341-candidate-1-92fc7276";

test("unit: the #345 landing passes on a verdict branch with the zone on", () => {
  assert.ok(PEACE_TASK_BRANCH.test(VERDICT));
  assert.deepEqual(checkPullRequestScope(LANDING, pr(VERDICT), OWNER, null, ON), []);
  assert.equal(checkPullRequestScope(LANDING, pr(VERDICT), OWNER, null, null).length, 2, "before M78 (no zone facts): both refused");
});

test("unit: protected paths stay refused even with the zone on", () => {
  for (const path of ["peaceai/lib/self-zone.ts", "peaceai/bin/leak-scan.ts", "peaceai/targets.json", "package.json", "peaceai/lib/scope.ts", "peaceai/rules/approved.json"]) {
    assert.ok(!inSafeZone(path), path);
    const v = checkPullRequestScope([{ status: "M", path }], pr(VERDICT), OWNER, null, ON);
    assert.equal(v.length, 1, path); assert.match(v[0]!.reason, /protected path changed \(M\) by a non-owner PR/);
  }
  const mixed = checkPullRequestScope([...LANDING, { status: "M", path: "peaceai/lib/self-zone.ts" }], pr(VERDICT), OWNER, null, ON);
  assert.deepEqual(mixed.map((x) => x.path), ["peaceai/lib/self-zone.ts"], "a safe change cannot carry a protected one");
});

test("unit: zone off, non-verdict branches, forks and deletes are refused", () => {
  assert.equal(checkPullRequestScope(LANDING, pr(VERDICT), OWNER, null, OFF).length, 2, "zone off");
  for (const ref of ["feature/x", "peace-task/other", "peaceai-approve-rule/abc", "x/peace-task/issue-1-a"]) assert.equal(checkPullRequestScope(LANDING, pr(ref), OWNER, null, ON).length, 2, ref);
  assert.equal(checkPullRequestScope(LANDING, pr(VERDICT, BOT, "someone/fork"), OWNER, null, ON).length, 2, "fork");
  assert.equal(checkPullRequestScope([{ status: "D", path: DATES }], pr(VERDICT), OWNER, null, ON).length, 1, "delete");
  assert.equal(selfZoneExempt({ status: "R100", path: DATES }, pr(VERDICT), ON), false, "rename");
  assert.equal(selfZoneExempt({ status: "M", path: DATES }, null, ON), false, "no PR context");
});

test("unit: owner PRs are unchanged (privileged)", () => {
  assert.deepEqual(checkPullRequestScope([{ status: "M", path: "peaceai/lib/self-zone.ts" }], pr("m78/x", OWNER), OWNER, null, OFF), []);
});

// ---- integration: the real leak-scan.ts in a scratch repo ----
const tsx = resolve(root, "node_modules/.bin/tsx");
const scan = resolve(root, "peaceai/bin/leak-scan.ts");
const targets = (on: boolean) => JSON.stringify({ schema: "x", targets: { [WORKSPACE_TARGET]: { sourcePattern: "^src/.+\\.ts$", ...(on ? { selfZone: true } : {}) } } }, null, 2);
function leak(opts: { baseOn: boolean; headOn?: boolean; ref?: string; edits: Record<string, string | null> }) {
  const dir = mkdtempSync(join(tmpdir(), "m78-"));
  const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  try {
    g("init", "-q", "-b", "main"); g("config", "user.name", "PeaceG03"); g("config", "user.email", "301894882+PeaceG03@users.noreply.github.com");
    const put = (p: string, c: string) => { mkdirSync(join(dir, dirname(p)), { recursive: true }); writeFileSync(join(dir, p), c); };
    put("peaceai/targets.json", targets(opts.baseOn)); put(DATES, "export const a = 1;\n"); put("peaceai/lib/self-zone.ts", "export const z = 1;\n");
    g("add", "-A"); g("commit", "-qm", "base"); const base = g("rev-parse", "HEAD").trim();
    if (opts.headOn !== undefined) put("peaceai/targets.json", targets(opts.headOn));
    for (const [p, c] of Object.entries(opts.edits)) { if (c === null) rmSync(join(dir, p)); else put(p, c); }
    g("add", "-A"); g("commit", "-qm", "head");
    const env: Record<string, string | undefined> = { ...process.env, LEAK_BASE_SHA: base, PR_AUTHOR: BOT, PR_HEAD_REPO: WORKSPACE_TARGET, PR_BASE_REPO: WORKSPACE_TARGET, PR_HEAD_REF: opts.ref ?? VERDICT, GITHUB_REPOSITORY: WORKSPACE_TARGET, PEACEAI_PRIVATE_TERMS: "" };
    delete env.LEAK_SKIP_SCOPE;
    const r = spawnSync(tsx, [scan], { cwd: dir, env, encoding: "utf8" });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const helperEdit = { [DATES]: "export const a = 1;\nexport const b = 2;\n", [NEW_TEST]: "import test from \"node:test\";\ntest(\"x\", () => {});\n" };

test("leak-scan: safe-zone helper landing on a verdict branch passes when the base enables the zone", () => {
  const r = leak({ baseOn: true, edits: helperEdit });
  assert.equal(r.code, 0, r.out); assert.match(r.out, /self-zone exemption: on/); assert.match(r.out, /LEAK PASS/);
});

test("leak-scan: a protected path is still refused with the zone on", () => {
  const r = leak({ baseOn: true, edits: { ...helperEdit, "peaceai/lib/self-zone.ts": "export const z = 2;\n" } });
  assert.notEqual(r.code, 0); assert.match(r.out, /LEAK FAIL scope peaceai\/lib\/self-zone\.ts: protected path changed \(M\) by a non-owner PR/);
  assert.doesNotMatch(r.out, /LEAK FAIL scope [^\n]*dates\.ts/);
});

test("leak-scan: zone off at the base is refused, even if the PR itself turns selfZone on", () => {
  for (const headOn of [undefined, true]) {
    const r = leak({ baseOn: false, headOn, edits: helperEdit });
    assert.notEqual(r.code, 0, String(headOn)); assert.match(r.out, /self-zone exemption: off/); assert.match(r.out, /LEAK FAIL scope [^\n]*dates\.ts: protected path changed \(M\)/);
  }
});

test("leak-scan: a non-peace-task branch is refused", () => {
  const r = leak({ baseOn: true, ref: "feature/helpers", edits: helperEdit });
  assert.notEqual(r.code, 0); assert.doesNotMatch(r.out, /self-zone exemption/); assert.match(r.out, /LEAK FAIL scope [^\n]*dates\.ts/);
});

test("wiring: leak-scan imports inSafeZone (no duplicated list) and reads targets.json from the base commit", () => {
  const src = readFileSync(scan, "utf8");
  assert.match(src, /import \{ inSafeZone, WORKSPACE_TARGET \} from "\.\.\/lib\/self-zone\.ts";/);
  assert.match(src, /git\("show", `\$\{base\}:peaceai\/targets\.json`\)/);
  assert.doesNotMatch(src, /self-tests\/helpers/);
});
