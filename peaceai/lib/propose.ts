// M8: turn mined shape statistics into learned-rule specs and proposal issue bodies. Deterministic.
import { MINER_VERSION, majority, type ShapeStats } from "./mine.ts";
import { nullishTrigger, RULE_SCHEMA, specHash, TRIGGERS, type RuleKind, type RuleSpec } from "./learned.ts";
import { TEST_CHECKS } from "./learned-test.ts";
import { GUARD_VOCAB } from "./learned-guard.ts";
import { FUNCTION_VOCAB } from "./learned-function.ts";
import { WORKFLOW_VOCAB } from "./learned-workflow.ts";

export const MIN_COMMITS = 3;
export const MIN_FILES = 2;
/** A default kind is learned only with at least this many observed examples. */
export const MIN_KIND_SUPPORT = 2;
/** Rule versions. ADD_NULLISH_DEFAULT v2: single-read only, kinds with support, trigger limited to those kinds. */
const RULE_VERSION: Record<RuleKind, number> = { SET_LITERAL: 1, ADD_SWITCH_CASE: 1, ADD_NULLISH_DEFAULT: 2, ADD_TEST_CASE: 1, ADD_THROW_GUARD: 1, ADD_FUNCTION: 2, ADD_WORKFLOW_STEP: 1 };
const NAMED_CONTEXTS = ["object-property", "top-level-const", "local-const"];
const KIND_OF: Partial<Record<string, RuleKind>> = { LITERAL_CHANGE: "SET_LITERAL", SWITCH_CASE: "ADD_SWITCH_CASE", NULLISH_DEFAULT: "ADD_NULLISH_DEFAULT", TEST_CASE: "ADD_TEST_CASE", TEST_CASE_APPEND: "ADD_TEST_CASE", THROW_GUARD: "ADD_THROW_GUARD", PURE_FUNCTION: "ADD_FUNCTION", WORKFLOW_STEP: "ADD_WORKFLOW_STEP" };
const SLUG: Record<RuleKind, string> = { SET_LITERAL: "set-literal", ADD_SWITCH_CASE: "add-switch-case", ADD_NULLISH_DEFAULT: "add-nullish-default", ADD_TEST_CASE: "test-case", ADD_THROW_GUARD: "throw-guard", ADD_FUNCTION: "add-function", ADD_WORKFLOW_STEP: "workflow-step" };
/** M12: upper line bound of the majority size bucket of mined test cases (">40" is capped at 40). */
const MAX_LINES: Record<string, string> = { "<=12": "12", "13-40": "40", ">40": "40" };

export type Skip = "covered" | "below-threshold" | "no-executable-kind" | "no-learnable-params";
export interface Proposal { spec: RuleSpec; sha256: string; stats: ShapeStats }

/** Specs for uncovered, frequent shapes the engine can execute. */
export function proposeRules(stats: readonly ShapeStats[], minedFrom: "public" | "core", repos: readonly string[]): { proposals: Proposal[]; skipped: { shape: string; why: Skip }[] } {
  const proposals: Proposal[] = [];
  const skipped: { shape: string; why: Skip }[] = [];
  for (const s of stats) {
    if (s.covered) { skipped.push({ shape: s.shape, why: "covered" }); continue; }
    if (s.commits < MIN_COMMITS || s.files < MIN_FILES) { skipped.push({ shape: s.shape, why: "below-threshold" }); continue; }
    const kind = KIND_OF[s.shape];
    if (!kind) { skipped.push({ shape: s.shape, why: "no-executable-kind" }); continue; }
    let params: Record<string, string | string[]>;
    if (kind === "SET_LITERAL") {
      const contexts = NAMED_CONTEXTS.filter((c) => (s.styles.context?.[c] ?? 0) > 0).sort();
      const kinds = Object.keys(s.styles.kind ?? {}).sort();
      if (contexts.length === 0 || kinds.length === 0) { skipped.push({ shape: s.shape, why: "no-learnable-params" }); continue; }
      params = { contexts, kinds };
    } else if (kind === "ADD_SWITCH_CASE") {
      const body = majority(s, "body");
      if (!body?.startsWith("return-") || body === "return-expression" || majority(s, "label") !== "string") { skipped.push({ shape: s.shape, why: "no-learnable-params" }); continue; }
      params = { body: "return-literal", label: "string" };
    } else if (kind === "ADD_TEST_CASE") {
      // Learned only from public tests; the template needs the majority runner/assert imports it renders.
      if (minedFrom !== "public") { skipped.push({ shape: s.shape, why: "no-executable-kind" }); continue; }
      const regex = majority({ ...s, styles: { m: Object.fromEntries(Object.entries(s.styles.matcher ?? {}).filter(([k]) => k !== "n/a")) } }, "m") === "regex";
      const checks = TEST_CHECKS.filter((c) => (s.styles[`check:${c}`]?.yes ?? 0) >= MIN_KIND_SUPPORT && (regex || (c !== "throws" && c !== "rejects")));
      const lines = MAX_LINES[majority(s, "lines") ?? ""];
      if (majority(s, "framework") !== "node:test-default" || majority(s, "assert") !== "node:assert/strict-default" || checks.length === 0 || !lines) { skipped.push({ shape: s.shape, why: "no-learnable-params" }); continue; }
      params = { assert: "node:assert/strict-default", checks: [...checks], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: lines, placement: s.shape === "TEST_CASE_APPEND" ? "append" : "new-file" };
    } else if (kind === "ADD_THROW_GUARD") {
      // M13: public-mined only. The fixed edit needs the majority form (bare `throw new Error("CODE")`) and
      // enough evidence of each value it renders (one line, at the function entry).
      const support = (k: string, v: string) => (s.styles[k]?.[v] ?? 0) >= MIN_KIND_SUPPORT;
      if (minedFrom !== "public" || majority(s, "braces") !== "none" || majority(s, "error") !== "Error" || majority({ ...s, styles: { m: Object.fromEntries(Object.entries(s.styles.message ?? {}).filter(([k]) => k !== "other" && k !== "none")) } }, "m") !== "code-only" || !support("lines", "one") || !support("placement", "function-entry")) { skipped.push({ shape: s.shape, why: "no-learnable-params" }); continue; }
      params = { braces: "none", error: "Error", grading: GUARD_VOCAB.grading[0]!, lines: "one", message: "code-only", placement: "function-entry", test: "new-file" };
    } else if (kind === "ADD_FUNCTION") {
      // M15: public-mined only. The fixed edit needs the majority form (typed parameters, annotated return type,
      // a single return statement) and enough evidence of new functions added at the end of a module.
      const support = (k: string, v: string) => (s.styles[k]?.[v] ?? 0) >= MIN_KIND_SUPPORT;
      if (minedFrom !== "public" || majority(s, "body") !== "single-return" || majority(s, "params") !== "typed" || majority(s, "returns") !== "annotated" || !support("placement", "end-of-module")) { skipped.push({ shape: s.shape, why: "no-learnable-params" }); continue; }
      // M17 (v2): with enough evidence of pure functions in newly created modules, the rule may also create one.
      params = { body: "single-return", grading: FUNCTION_VOCAB.grading[0]!, params: "typed", placement: support("placement", "new-module") ? "end-of-module-or-new-module" : "end-of-module", returns: "annotated", test: "new-file" };
    } else if (kind === "ADD_WORKFLOW_STEP") {
      // M19: public-mined only. The evidence must show the `- name:` + `run:` form as the majority, steps with
      // no secrets as the majority, and enough two-key steps and steps appended at a job's end. The `run`
      // vocabulary (one package script, one safe tool) is a fixed safety limit, not learned.
      const support = (k: string, v: string) => (s.styles[k]?.[v] ?? 0) >= MIN_KIND_SUPPORT;
      if (minedFrom !== "public" || majority(s, "step") !== "name-run" || majority(s, "secrets") !== "none" || !support("extraKeys", "none") || !support("placement", "end-of-job")) { skipped.push({ shape: s.shape, why: "no-learnable-params" }); continue; }
      params = { grading: WORKFLOW_VOCAB.grading[0]!, placement: "end-of-job", run: "package-script", step: "name-run", test: "new-file" };
    } else {
      const kinds = Object.entries(s.styles.default ?? {}).filter(([k, n]) => k !== "expression" && n >= MIN_KIND_SUPPORT).map(([k]) => k).sort();
      if (kinds.length === 0 || majority(s, "target") !== "member") { skipped.push({ shape: s.shape, why: "no-learnable-params" }); continue; }
      params = { kinds, reads: "single", target: "member" };
    }
    const spec: RuleSpec = {
      schema: RULE_SCHEMA, id: s.shape === "TEST_CASE_APPEND" ? `${minedFrom}-test-case-append-v1` : `${minedFrom}-${SLUG[kind]}-v${RULE_VERSION[kind]}`, kind, minedFrom, minerVersion: MINER_VERSION, shape: s.shape,
      trigger: kind === "ADD_NULLISH_DEFAULT" ? nullishTrigger(params.kinds as string[]) : TRIGGERS[kind], params, evidence: { hunks: s.hunks, commits: s.commits, files: s.files, repos: [...repos].sort() },
    };
    proposals.push({ spec, sha256: specHash(spec), stats: s });
    // M20: with enough public test cases whose calls take object-literal arguments, a second, separate spec
    // (same template, plus `args: object-literal`) accepts longer checks built from bounded object literals.
    if (kind === "ADD_TEST_CASE" && (s.styles.objectArgs?.yes ?? 0) >= MIN_KIND_SUPPORT) {
      const o: RuleSpec = { ...spec, id: spec.id.replace(/-v1$/, "-objargs-v1"), params: { ...params, args: "object-literal" } };
      proposals.push({ spec: o, sha256: specHash(o), stats: s });
    }
  }
  return { proposals, skipped };
}

export const PHRASING: Record<RuleKind, string> = {
  SET_LITERAL: "set `NAME` to VALUE  (optionally: set `NAME` in `path/file.ts` to VALUE)",
  ADD_SWITCH_CASE: 'add case "label" returning VALUE to the switch in `functionName`',
  ADD_NULLISH_DEFAULT: "default `obj.field` to VALUE in `functionName`",
  ADD_THROW_GUARD: "guard `functionName` in `src/file.ts`: throw CODE when CONDITION, then one bullet per test call (`- CALL throws CODE`, at least one; optional `- EXPR is VALUE` / `- EXPR equals [..]`). CONDITION uses only the function's parameters, literals, property reads, comparisons, `!`, `&&`/`||`, `typeof` and Number.isFinite/isInteger/isNaN/isSafeInteger, Array.isArray; calls take literal arguments only. Write comparisons with `<`/`<=` (issue cleaning strips `>`; a stripped operator makes the task unreadable, so it is refused, never misread)",
  ADD_FUNCTION: "add function `name(a: T, b: U): R` to `src/file.ts` returning EXPR, then one bullet per test check (`- CALL is VALUE` / `- CALL equals [..]` / `- CALL throws CODE`, at least one). Types: string, number, boolean, string[], number[], readonly string[], readonly number[] (1-4 parameters). EXPR uses only the parameters, literals, `.length`, arithmetic, comparisons, `!`, `&&`/`||`/`??`, `?:`, template literals, array literals, Math.min/max/floor/ceil/round/abs/trunc/sign, String/Number/Boolean, Number.isFinite/isInteger/isNaN/isSafeInteger, Array.isArray, and the string/array methods slice, padStart, padEnd, includes, startsWith, endsWith, trim, toUpperCase, toLowerCase, indexOf, lastIndexOf, at, join, concat, split, toFixed (padStart/padEnd take an integer literal length up to 64; no repeat). Write comparisons with `<`/`<=` (issue cleaning strips `>`)",
  ADD_WORKFLOW_STEP: "add workflow step NAME to job JOB in `.github/workflows/FILE.yml` running `pnpm run SCRIPT` (or `npm run SCRIPT`). NAME: letters, digits, spaces and ()_.,/- (up to 60). SCRIPT must be an existing package.json script whose command is `tsc` with `--noEmit` and plain arguments (no --build/--watch/--outDir/--outFile). The workflow must be opted in by the target (`workflowPattern`), declare top-level `permissions:` with read/none values only, and mention no secrets, write permission, id-token, pull_request_target or workflow_run",
  ADD_TEST_CASE: "add a test for `NAME` in `src/file.ts`: TITLE, then one bullet per check (`- EXPR is VALUE`, `- EXPR equals [..]`, `- EXPR throws CODE`, `- EXPR rejects with CODE`, as the spec's checks allow) and a line `Fix: <40-hex commit>` naming the fix the test must pin",
};
const KIND_VALUE: Record<string, string> = { array: "`[]`", null: "`null`", string: 'a string literal (`"..."`)', number: "a number", boolean: "`true`/`false`" };
/** Task phrasing for one spec; for ADD_NULLISH_DEFAULT it names the only VALUE kinds the trigger accepts. */
export function phrasingFor(spec: RuleSpec): string {
  if (spec.kind !== "ADD_NULLISH_DEFAULT") return PHRASING[spec.kind];
  const kinds = Array.isArray(spec.params.kinds) ? spec.params.kinds : [];
  return `${PHRASING.ADD_NULLISH_DEFAULT}, where VALUE is ${kinds.map((k) => KIND_VALUE[k] ?? k).join(" or ")}. Refused when \`obj.field\` is read more than once in that function (one default would cover only the first read).`;
}
export const APPROVAL_NOTE = "Architect posts `/approve-rule` under Peace's delegation, with a note on what was checked.";

export const proposalMarker = (p: Pick<Proposal, "spec" | "sha256">) =>
  `<!-- peaceai-rule-proposal:v1 id=${p.spec.id} sha256=${p.sha256} source=${p.spec.minedFrom} -->`;
export function parseMarker(body: string): { id: string; sha256: string; source: "public" | "core" } | null {
  const all = [...body.matchAll(/<!-- peaceai-rule-proposal:v1 id=([a-z0-9-]+) sha256=([0-9a-f]{64}) source=(public|core) -->/g)];
  if (all.length !== 1) return null;
  return { id: all[0]![1]!, sha256: all[0]![2]!, source: all[0]![3] as "public" | "core" };
}
/** The spec JSON carried in a proposal body, between the spec markers. */
export function parseSpecBlock(body: string): unknown {
  const m = /<!-- spec -->\n```json\n([\s\S]*?)\n```\n<!-- \/spec -->/.exec(body);
  if (!m) return null;
  try { return JSON.parse(m[1]!); } catch { return null; }
}

export interface ExampleLink { label: string; url: string }
/** Proposal issue body. `examples` may only quote code for a private (core) proposal. */
export function proposalBody(p: Proposal, links: readonly ExampleLink[], examples: readonly string[] = []): string {
  const s = p.stats;
  const styleRows = Object.entries(s.styles).flatMap(([k, v]) => Object.entries(v).map(([val, n]) => `| ${k} | ${val} | ${n} |`));
  return [
    proposalMarker(p),
    `## Learned edit rule proposal: \`${p.spec.id}\` (${p.spec.kind})`,
    "",
    `Mined deterministically (${MINER_VERSION}, TypeScript AST shapes, no model of any kind) from ${p.spec.minedFrom === "core" ? "core (private) commits" : "public commits"} in: ${p.spec.evidence.repos.join(", ")}.`,
    "",
    "### Frequency evidence",
    "",
    `| shape | hunks | distinct commits | distinct files |`,
    `|---|---:|---:|---:|`,
    `| ${s.shape} | ${s.hunks} | ${s.commits} | ${s.files} |`,
    "",
    "| style | value | count |",
    "|---|---|---:|",
    ...styleRows,
    "",
    ...(links.length ? ["Example commits:", "", ...links.map((l) => `- [${l.label}](${l.url})`), ""] : []),
    ...(examples.length ? ["Example hunks (private):", "", ...examples.map((e) => "```diff\n" + e + "\n```"), ""] : []),
    "### What the rule does",
    "",
    `Task phrasing: ${phrasingFor(p.spec)}`,
    "",
    p.spec.kind === "ADD_TEST_CASE" && p.spec.params.placement === "append"
      ? "It appends one test case at the END of the target's own existing test file (`<stem>.test.ts`); no existing line changes (the scope gate allows an existing test file only for a graded learned test whose diff is a pure append). The file must already import assert, test and every name the checks use. Job B grades only the appended case (the file's imports + the new lines): it must PASS on the fixed code and FAIL before the fix; otherwise it is rejected. No M7 repair. Same gates as every other candidate."
      : p.spec.kind === "ADD_TEST_CASE"
      ? "It writes one NEW test file (never an existing test) from the learned template; every placeholder comes only from names in the task text and the target code (the named file must export every name a check starts from; values must be literals). Job B grades the test in the tamper-proof harness: it must PASS on the fixed code and FAIL on the code before the fix (the fix commit's non-test source change reversed); a test that passes on both or fails on both is rejected and the grading is recorded in Results. No M7 repair is applied to it. It also goes through the same scope, leak and core-text gates as every other candidate."
      : p.spec.kind === "ADD_FUNCTION"
      ? (p.spec.params.placement === "end-of-module-or-new-module" ? "When the named module does not exist yet (path `src/<dirs>/<name>.ts`, lower-case, next to at least one existing non-test `.ts` file in that directory, never a new directory or a test/declaration file), the function becomes a NEW module holding only it; Job B then grades it by removing that module (the new test must fail without it). " : "") + "It appends ONE new `export function NAME(typed params): Type { return EXPR; }` at the end of an existing source module and writes one NEW test file from the task's bullets (never an existing test). Refused when NAME already appears anywhere in that module, a type is outside the vocabulary, or EXPR uses anything but the function's own parameters, literals and the fixed pure operators/built-ins/methods (no other names, so no calls into the module, no `new`, assignment, closures or element access). Job B grades the candidate against itself: its new test must PASS with the function and FAIL with the module put back to the task base; otherwise it is rejected and the grading is recorded in Results. No M7 repair. Same scope, leak and core-text gates as every other candidate."
      : p.spec.kind === "ADD_WORKFLOW_STEP"
      ? "It appends ONE two-line step (`- name: NAME` / `run: <pm> run SCRIPT`) after the last step of the named job in an existing opted-in workflow, and writes one NEW test file: it checks the step is the job's last, and runs the script's tsc --noEmit command from node_modules/.bin (exit 0). No `uses:`, `env:`, `with:`, `if:` or `${{ }}` in the step; triggers, permissions and every existing line stay byte-identical (the scope gate re-checks that the workflow diff is exactly those two added lines, nothing removed). Refused when the workflow or job has secrets, write permissions, id-token, privileged triggers, job-level permissions/env/uses/container/services, YAML anchors or tags, no install with the same package manager, or already has this step name or command. Job B grades the candidate against itself: the new test must PASS with the step and FAIL with the workflow put back to the task base; otherwise it is rejected and recorded in Results. No M7 repair. Same scope, leak and core-text gates as every other candidate."
      : p.spec.kind === "ADD_THROW_GUARD"
      ? "It inserts one line `if (CONDITION) throw new Error(\"CODE\");` at the entry of the uniquely named exported function (after any guards already there) and writes one NEW test file from the task's bullets (never an existing test). Refused when the code already appears in that file, the function is not unique/exported, or the condition uses anything outside the allowed vocabulary. Job B grades the candidate against itself: its new test must PASS with the guard and FAIL with the guard's source edit taken back out (the task base); otherwise it is rejected and the grading is recorded in Results. No M7 repair. Same scope, leak and core-text gates as every other candidate."
      : "It produces one candidate when the edit site is unique; otherwise none. The candidate goes through the same scope, leak and core-text gates, the sandboxed tests and the M7 repair loop as every other candidate.",
    "",
    "### Spec (the hash covers exactly this JSON, canonicalized with sorted keys)",
    "",
    "<!-- spec -->",
    "```json",
    JSON.stringify(p.spec, null, 2),
    "```",
    "<!-- /spec -->",
    "",
    `SHA-256: \`${p.sha256}\``,
    "",
    "### Approval",
    "",
    `To approve, post exactly \`/approve-rule ${p.sha256}\` on this issue from the PeaceG03 account. Only that comment makes the approval workflow add the rule to the hash-pinned list. ${APPROVAL_NOTE} Until then Job A refuses this rule.`,
  ].join("\n");
}
