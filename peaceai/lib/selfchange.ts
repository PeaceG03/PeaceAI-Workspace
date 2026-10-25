// M11: self-improvement sandbox. PeaceAI may PROPOSE a change to its own code (this repo's peaceai/), but the change
// is built and tested in a fresh clone inside an ephemeral GitHub-hosted job of a private repo (no box mode), never
// in the live checkout. Nothing here pushes, merges or edits the live tree; promotion is a normal PR that a human
// lands after the gates below, and every self-change is recorded in private Results with a one-step rollback.
import { createHash } from "node:crypto";
import ts from "typescript";

export const SELF_SCHEMA = "peaceai-self-change:v1";
export const AUDITOR_COMMAND = "/auditor-pass";
export const PROMOTE_COMMAND = "/promote-self-change";
export const MAX_BUDGET_MINUTES = 30;
export const DEFAULT_BUDGET_MINUTES = 15;
/** Repositories whose Actions jobs may run a self-change. Workspace (public) is not one of them. */
export const PRIVATE_RUNNERS = ["PeaceG03/PeaceAI-Results", "PeaceG03/PeaceAI"] as const;

/**
 * The protected set: paths a self-change may never touch (create, modify, delete, rename to or from, copy to,
 * mode-change or symlink). It holds the gates, the approval path, the checks, the hooks, the rules, the live
 * tests and the self-change machinery itself, so PeaceAI can never weaken what judges it.
 */
export const PROTECTED_SELF: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /(^|\/)[^/]*public-origin[^/]*$/i, why: "the public-origin allowlist (leak gate): core's docs/peaceai-public-origin.json and any copy, test or reader of it" },
  { pattern: /^\.github\//i, why: "workflows, required checks and approval workflows" },
  { pattern: /^\.githooks\/|(^|\/)\.git\//i, why: "git hooks" },
  { pattern: /^(package(-lock)?\.json|npm-shrinkwrap\.json|\.npmrc|tsconfig[^/]*\.json|\.gitignore|\.gitattributes)$/i, why: "dependencies and build config" },
  { pattern: /^(README\.md|CONSTITUTION[^/]*|SECURITY[^/]*|CODEOWNERS|LICENSE[^/]*)$/i, why: "governance documents" },
  { pattern: /^peaceai\/rules\//i, why: "approved learned-rule list and rule specs" },
  { pattern: /^peaceai\/test\//i, why: "the live test suite (new tests go under peaceai/self-tests/)" },
  { pattern: /^(?!peaceai\/self-tests\/)(.*\/)?[^/]*\.test\.ts$/i, why: "existing tests anywhere (new tests go under peaceai/self-tests/)" },
  { pattern: /^peaceai\/bin\/(approve-rule[^/]*|check-approved-list\.ts|leak-scan\.ts|prepush-scan\.ts|core-scan\.ts|install-pre-push\.sh|push-proof-main\.sh|await-checks\.sh|await-held-runs\.sh|clone-core\.sh|self-change\.ts|nl-refusal\.ts|regate\.ts|gate\.ts)$/i, why: "approval, leak, scan, hook, gate and self-change tools" },
  { pattern: /^peaceai\/bin\/test-candidates\.ts$/i, why: "the grading harness (M14)" },
  { pattern: /^peaceai\/bin\/(?:pr-guard|verdict-patch|parse-verdict|target-check|issue-fetch|lm-fill|lm-provenance|no-candidate-comment|review-comment|select|train)\.ts$|^peaceai\/proof\/tamper-proof\.ts$/i, why: "the TypeScript tools workflow steps run on the trusted runner: pr-guard.ts (its output drives the target-pr step holding TARGET_PR_TOKEN), verdict-patch.ts, parse-verdict.ts, target-check.ts (also in target-pr), issue-fetch.ts, lm-fill.ts, lm-provenance.ts, no-candidate-comment.ts, review-comment.ts, select.ts, train.ts (holds the Results deploy key) and the tamper-proof check (M95)" },
  { pattern: /^peaceai\/bin\/[^/]+\.sh$/i, why: "every shell script under peaceai/bin: they run on the trusted runner in workflow jobs, many holding secrets or write tokens (clone-target.sh, install-target.sh, with-deploy-key.sh, results-write.sh, stage-chosen.sh, build-kernel.sh, key-proof-*.sh, apply-verdict-patch.sh; M94, Auditor #459)" },
  { pattern: /^peaceai\/bin\/(verdict-stale|regrade-fetch|record-task|record-verdict|carry-check|carry-verdict)\.ts$|^peaceai\/lib\/(regrade|carry)\.ts$/i, why: "the stale-base regrade route through Job B and its Results records (M18), and carry-forward verdicts" },
  { pattern: /^peaceai\/bin\/(generate|regate)\.ts$|^peaceai\/lib\/(records|rank|diff)\.ts$/i, why: "candidate generation and the Job B check files: grading, eligibility and diff parsing (M17)" },
  { pattern: /^peaceai\/bin\/apply-verdict-patch\.ts$|^peaceai\/lib\/(rebase|stacked)\.ts$/i, why: "the stale-base re-apply and fresh regrade (M16), and the stacked-batch landing exception" },
  { pattern: /^peaceai\/lib\/(?:patch|self-zone|queue|fill|dedupe|provenance|sourcehunt|memprompts|refusal-reason|review|repair|repairrecord|repairloop|symbols|sources|nlparse|store|mine|minegit|propose)\.ts$|^peaceai\/lib\/ranker\/(?:features|model|pipeline)\.ts$|^peaceai\/bin\/kernel-guard\.ts$/i, why: "the lib import closure of the protected tools: code in these modules runs in the same trusted workflow steps (patch.ts checks the verdict patch author in apply-verdict-patch, self-zone.ts is the safe-zone list, queue.ts feeds issue-fetch, sources/nlparse/symbols/fill/refusal-reason run in Job A generate, the repair and ranker modules in record-task, mine/propose in approve-rule-catchup), plus kernel-guard.ts run by build-kernel.sh (M96, Auditor #463)" },
  { pattern: /^peaceai\/lib\/(leak|approval|approved|scope|prguard|kernelguard|coretext|coreindex|substr|policy|gate|selfchange|selfpropose|learned|learned-test|learned-guard|learned-function|learned-complex|learned-body|minebody|learned-workflow|objargs|minetest|mineworkflow|results|verdict|trigger|diff)\.ts$/i, why: "gates, approvals, leak/scope scanners and the self-change rules" },
  { pattern: /^peaceai\/lib\/target\.ts$|^peaceai\/targets\.json$/i, why: "per-target scope config, incl. opted-in workflow files (M19)" },
  { pattern: /^peaceai\/proof\/workflow-step-proof\.md$/i, why: "workflow-step grading and live-proof procedure (Auditor #107 changes 4, 6)" },
  { pattern: /^peaceai\/lib\/lm\.ts$|^peaceai\/model\/|^peaceai\/test\/m39-corefree-ext\.test\.ts$|^peaceai\/bin\/lm-memcheck\.ts$|^peaceai\/test\/m40-corefree-followups\.test\.ts$|^peaceai\/test\/m52-corefree-ft\.test\.ts$/i, why: "the model, its memcheck and job guard" },
  { pattern: /^peaceai\/lib\/(lmcorpus|heldout)\.ts$|^peaceai\/bin\/(lm-corpus|heldout-select|ext-corpus|ext-fetch|ext-manifest-check|ext-memcheck)\.ts$|^peaceai\/lib\/extcorpus\.ts$|^peaceai\/model\/(ext-corpus\.json|ext-manifest\.jsonl|ext-train\.json|ext-summary\.json|ext-memcheck\.json|ext-doc-exclusions\.json|heldout-c\.json|heldout-c-excluded\.json|eval_c\.py)$|^peaceai\/model\/ext-manifest\/(index\.json|part-\d{3}\.jsonl)$|^peaceai\/lib\/manifestparts\.ts$|^peaceai\/model\/manifest_parts\.py$|^peaceai\/test\/m51-manifest-parts\.test\.ts$|^peaceai\/test\/m49-ext-doc-exclusions\.test\.ts$|^peaceai\/test\/m3[67]-ext-(corpus|train)\.test\.ts$/i, why: "the training corpus builders and the held-out selection/exclusion (M28, external corpus and set C v2 M36, training M37)" },
  { pattern: /^peaceai\/lib\/lmpublic\.ts$|^peaceai\/bin\/(lm-manifest-check|lm-public-corpus)\.ts$|^peaceai\/model\/lm-public-allow\.json$/i, why: "the public-runner LM corpus allowlist and held-out manifest check (M31)" },
  { pattern: /^peaceai\/lib\/learned-multibody\.ts$|^peaceai\/spec\/multibody-v1\.md$|^peaceai\/test\/m32-multibody\.test\.ts$/i, why: "the multi-line body edit rule, its spec and its proofs (M32)" },
  { pattern: /^peaceai\/spec\/test-dateargs-v1\.md$|^peaceai\/test\/m35-date-args\.test\.ts$/i, why: "the Date-argument test-line grammar spec and its proofs (M35)" },
  { pattern: /^peaceai\/lib\/taskmap\.ts$|^peaceai\/test\/m46-issue-text\.test\.ts$/i, why: "the issue-text cleaning that feeds every rule trigger, and its proofs (M46)" },
  { pattern: /^peaceai\/spec\/throw-guard-top-v1\.md$|^peaceai\/test\/m47-guard-top\.test\.ts$/i, why: "the throw-guard function-top placement proposal, its spec and proofs (M47)" },
  { pattern: /^peaceai\/bin\/heldout-c-tasks\.ts$|^peaceai\/model\/heldout-c-tasks\.json$|^peaceai\/spec\/heldout-c-tasks-v1\.md$|^peaceai\/test\/m48-setc-tasks\.test\.ts$/i, why: "the set C v2 task list PeaceAI is measured on, its builder, spec and proofs (M48)" },
  { pattern: /^peaceai\/lib\/setc-grade\.ts$|^peaceai\/bin\/setc-grade\.ts$|^peaceai\/spec\/setc-grade-v1\.md$|^peaceai\/test\/m50-setc-grade\.test\.ts$/i, why: "the set C v2 grader PeaceAI is scored by, its spec and proofs (M50)" },
  { pattern: /^peaceai\/lib\/learned-config\.ts$|^peaceai\/spec\/(import-edit|package-script)-v1\.md$|^peaceai\/test\/m45-config-kinds\.test\.ts$/i, why: "the IMPORT_EDIT and PACKAGE_SCRIPT proposal kinds, their specs and proofs (M45)" },
  { pattern: /^\.github\/workflows\/peace-lm-train-m49\.yml$|^peaceai\/model\/ext-train-m49\.json$|^peaceai\/lib\/ftpairs\.ts$|^peaceai\/bin\/ft-pairs\.ts$|^peaceai\/lib\/ftgate\.ts$|^peaceai\/bin\/ft-gate\.ts$|^peaceai\/model\/ft-corefree(-proof)?\.json$|^peaceai\/test\/m49-ft-core-gate\.test\.ts$|^peaceai\/model\/(eval_ab|gen_c)\.py$|^peaceai\/model\/spans\.cjs$|^peaceai\/spec\/lm-run-m49\.md$|^peaceai\/test\/m49-lm-workflow\.test\.ts$/i, why: "the M49 training workflow, its fine-tune data selection, evals, spec and proofs" },
  { pattern: /^peaceai\/lib\/import-edit-v2\.ts$|^peaceai\/spec\/import-edit-v2\.md$|^peaceai\/test\/m56-import-edit-v2\.test\.ts$|^peaceai\/rules\/learned\/public-import-edit-v2\.json$|^peaceai\/test\/m66-import-edit-v2-wiring\.test\.ts$/i, why: "the IMPORT_EDIT v2 kind, its learned spec, engine, spec and proofs (M56/M66)" },
  { pattern: /^peaceai\/lib\/(?:workflow-job|tsconfig-script|env-fix)\.ts$|^peaceai\/spec\/undrop-skills-v1\.md$|^peaceai\/rules\/learned\/public-(?:workflow-job|tsconfig-script|env-fix)-v1\.json$|^peaceai\/rules\/learned\/public-loop-function-v2\.json$|^peaceai\/rules\/proposals\/public-(?:workflow-job|tsconfig-script|env-fix)-v1\.json$|^peaceai\/rules\/proposals\/public-loop-function-v2\.json$|^peaceai\/test\/m67-(?:undrop-skills|loop-while)\.test\.ts$|^peaceai\/test\/fixtures\/m67\//i, why: "the M67 un-drop batch kinds (WORKFLOW_JOB, TSCONFIG_SCRIPT, ENV_FIX, LOOP_WHILE), their learned specs, spec, fixtures and proofs" },
  { pattern: /^peaceai\/lib\/package-script-v2\.ts$|^peaceai\/spec\/package-script-v2\.md$|^peaceai\/test\/m57-package-script-v2\.test\.ts$/i, why: "the PACKAGE_SCRIPT v2 proposal kind, its spec and proofs (M57)" },
  { pattern: /^peaceai\/test\/m26-complex-function\.test\.ts$|^peaceai\/rules\/proposals\/m26-complex-function-evidence\.json$|^peaceai\/test\/fixtures\/m26\/|^peaceai\/rules\/learned\/public-complex-function-v1\.json$|^peaceai\/rules\/proposals\/public-complex-function-v1\.json$|^peaceai\/test\/m26-new-test-path\.test\.ts$/i, why: "the COMPLEX_FUNCTION proofs, its mined evidence, blob-pinned fixtures, learned spec and proposal record, and the all-kinds new-test-path proofs (M26)" },
  { pattern: /^peaceai\/test\/m64-loop-function\.test\.ts$|^peaceai\/rules\/proposals\/m64-loop-function-evidence\.json$|^peaceai\/test\/fixtures\/m64\/|^peaceai\/rules\/learned\/public-loop-function-v1\.json$|^peaceai\/rules\/proposals\/public-loop-function-v1\.json$|^peaceai\/test\/m65-loop-wiring\.test\.ts$/i, why: "the LOOP_FUNCTION proofs, its mined evidence, blob-pinned fixtures, learned spec and proposal record (M64), and its wiring proofs (M65)" },
  { pattern: /^peaceai\/lib\/method-guard\.ts$|^peaceai\/spec\/method-guard-v1\.md$|^peaceai\/test\/m58-method-guard\.test\.ts$|^peaceai\/rules\/learned\/public-method-guard-v1\.json$/i, why: "the METHOD_GUARD proposal kind, its learned spec, engine and proofs (M58/M62)" },
  { pattern: /^peaceai\/lib\/learned-test-existing\.ts$|^peaceai\/spec\/test-case-existing-v1\.md$|^peaceai\/test\/m80-test-case-existing\.test\.ts$|^peaceai\/rules\/proposals\/m80-test-case-existing-evidence\.json$|^peaceai\/test\/fixtures\/m80\/|^peaceai\/rules\/learned\/public-test-case-existing-v1\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v1\.json$/i, why: "the TEST_CASE_EXISTING kind (fix-free characterization tests), its engine, spec, mined evidence, blob-pinned fixtures, learned spec, proposal record and proofs (M80)" },
  { pattern: /^peaceai\/spec\/(?:complex-calls-v1|test-case-existing-v2|replace-expression-v2)\.md$|^peaceai\/test\/m85-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m85-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m85-[\w-]+\/|^peaceai\/rules\/learned\/public-(?:complex-calls-v1|test-case-existing-v2|replace-expression-v2)\.json$|^peaceai\/rules\/proposals\/public-(?:complex-calls-v1|test-case-existing-v2|replace-expression-v2)\.json$/i, why: "the M85 skill batch (COMPLEX calls/callbacks, TEST_CASE_EXISTING v2, REPLACE_EXPRESSION v2): specs, proofs, mined evidence, blob-pinned fixtures, learned specs and proposal records" },
  { pattern: /^peaceai\/spec\/test-case-existing-v3\.md$|^peaceai\/test\/m88-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m88-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m88-[\w-]+\/|^peaceai\/rules\/learned\/public-test-case-existing-v3\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v3\.json$/i, why: "M88 TEST_CASE_EXISTING v3 (Date signatures, Date literals, objects nested in arrays): spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/spec\/test-case-existing-v4\.md$|^peaceai\/test\/m90-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m90-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m90-[\w-]+\/|^peaceai\/rules\/learned\/public-test-case-existing-v4\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v4\.json$/i, why: "M90 TEST_CASE_EXISTING v4 (optional / literal-default params, plain-data generic references, wider type bounds): spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/spec\/test-case-existing-v5\.md$|^peaceai\/test\/m91-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m91-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m91-[\w-]+\/|^peaceai\/rules\/learned\/public-test-case-existing-v5\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v5\.json$/i, why: "M91 TEST_CASE_EXISTING v5 (literal-const typeof, string-literal property lookups): spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/spec\/test-case-existing-v6\.md$|^peaceai\/test\/m93-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m93-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m93-[\w-]+\/|^peaceai\/rules\/learned\/public-test-case-existing-v6\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v6\.json$/i, why: "M93 TEST_CASE_EXISTING v6 (top-level unknown params, NodeJS.ProcessEnv params with an overridden process.env default): spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/spec\/test-case-existing-v7\.md$|^peaceai\/test\/m97-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m97-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m97-[\w-]+\/|^peaceai\/rules\/learned\/public-test-case-existing-v7\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v7\.json$/i, why: "M97 TEST_CASE_EXISTING v7 (Map / Set signatures and literals, void returns with throws checks, v7 closure hardening): spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/lib\/learned-edit-existing\.ts$|^peaceai\/spec\/existing-function-edit-v1\.md$|^peaceai\/test\/m98-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m98-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m98-[\w-]+\/|^peaceai\/rules\/learned\/public-existing-function-edit-v1\.json$|^peaceai\/rules\/proposals\/public-existing-function-edit-v1\.json$/i, why: "M98 EXISTING_FUNCTION_EDIT (G1 statement edit inside an existing function / class method + G2 fake-driven test, hermetic walk, Job B zone+locale grading): engine, spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/lib\/derive\.ts$|^peaceai\/lib\/learned-derive\.ts$|^peaceai\/spec\/derive-from-behavior-v1\.md$|^peaceai\/test\/m99-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m99-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m99-[\w-]+\/|^peaceai\/rules\/learned\/public-derive-from-behavior-v1\.json$|^peaceai\/rules\/proposals\/public-derive-from-behavior-v1\.json$/i, why: "M99 DERIVE_FROM_BEHAVIOR (typed-DSL program search from behavior + examples, anti-credit guard, AMBIGUOUS refusal): engine, rule, spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^\.github\/workflows\/corpus-checks\.yml$/i, why: "the dispatch-only whole-corpus memcheck and core-free proof (no training)" },
  { pattern: /^\.github\/workflows\/derive-practice\.yml$|^peaceai\/lib\/derive-practice(-kinds)?\.ts$|^peaceai\/lib\/derive-practice-families\.json$|^peaceai\/bin\/derive-practice(-kinds|-dedup)?\.ts$|^peaceai\/bin\/derive-family-census\.ts$|^peaceai\/lib\/derive-family-census\.ts$/i, why: "M100 derive practice workflow (checks only, no training), its families manifest and the tools it runs (with the census lib the census bin imports: Peace, 2026-10-23, for now)" },
  { pattern: /^peaceai\/test\/m42-prepush-reach\.test\.ts$/i, why: "the pre-push hook reachability and attack proofs (M42, Auditor #157)" },
  { pattern: /(^|\/)\.env(\.[^/]*)?$|(^|\/)approved\.json$|^peaceai\/read-only-ops\.json$|^peaceai\/results-repo\//i, why: "the stage-1 gaps the M106 cross-check found (stage 2 already closes them; Peace approved this re-pin 2026-10-25): .env files anywhere, any approved.json, the read-only-ops enable list and the Results-repo workflow templates (self-change-stage2.yml, rule-approval.yml/.mjs)" },
  { pattern: /^peaceai\/self\//i, why: "self-change records and configuration" },
  { pattern: /^builder-log\//i, why: "the Builder task log and its validator (append-only, PR-reviewed; M21)" },
];

/** Strings a self-change may not ADD anywhere: they reach the protected set or the credentials by content. */
const CONTENT_BANNED: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /public-origin|PUBLIC_ORIGIN|parsePublicOrigin|publicOrigin/i, why: "names the public-origin allowlist (leak gate)" },
  { pattern: /\.github\//, why: "names the workflow directory" },
  { pattern: /approved\.json|peaceai\/rules\//, why: "names the approved-rule list" },
  { pattern: /peaceai\/test\/|self-tests\/.*\.\.\//, why: "reaches into the live tests" },
  { pattern: /hooksPath|pre-push|--no-verify/, why: "touches git hooks" },
  { pattern: /GITHUB_TOKEN|GH_TOKEN|DEPLOY_KEY|PEACEAI_[A-Z_]*KEY|TARGET_PR_TOKEN|secrets\./, why: "names a credential" },
  { pattern: /\/approve-rule|\/promote-self-change|\/auditor-pass/, why: "names an approval command" },
  { pattern: /\b(isProtectedPath|PROTECTED_SELF|checkSelfChangeDiff|promotionDecision|mayChangeProtected|lmJobAllowed|scanText)\b/, why: "names a gate function" },
  { pattern: /\beval\s*\(|new Function\s*\(|require\(\s*[^"'`]/, why: "dynamic code loading" },
  { pattern: /process\.env\.(PEACEAI_|GITHUB_)/, why: "reads a gate/runner variable" },
];

export interface DiffFile { oldPath: string | null; newPath: string | null; status: "A" | "M" | "D" | "R" | "C"; oldMode?: string; newMode?: string; binary: boolean; added: string[] }

/**
 * Parses `git diff --binary` output STRICTLY (M106, Auditor #504 blocker 1): `git apply` also honours ---/+++ names
 * and plain unified sections, so anything this parser does not fully account for makes the diff malformed:
 * CR bytes, quoted or unparseable `diff --git` headers, ---/+++/rename names that differ from the header, text
 * outside a section or after a complete hunk (hunk line counts are checked), unknown header lines, a path in two
 * sections. Callers must still compare the result with what git actually applied (appliedDiffRefusals).
 */
export function parseGitDiff(diff: string): { files: DiffFile[]; malformed: boolean; problems: string[] } {
  const files: DiffFile[] = [];
  const problems: string[] = [];
  if (diff.includes("\r")) problems.push("carriage return in the diff");
  const lines = diff.split("\n");
  if (lines.at(-1) === "") lines.pop();
  type Cur = DiffFile & { hOld: string; hNew: string; minus?: string; plus?: string; renFrom?: string; renTo?: string };
  let cur: Cur | null = null;
  let oldLeft = 0, newLeft = 0, inHunk = false, binBody = false;
  const seen = new Set<string>();
  const finish = () => {
    if (!cur) return;
    const c = cur;
    const where = c.hNew;
    if (inHunk && (oldLeft > 0 || newLeft > 0)) problems.push(`${where}: hunk shorter than its header`);
    if (c.status !== "R" && c.status !== "C" && c.hOld !== c.hNew) problems.push(`${where}: header names two paths without a rename`);
    if (c.renFrom !== undefined && c.renFrom !== c.hOld) problems.push(`${where}: rename/copy source differs from the header`);
    if (c.renTo !== undefined && c.renTo !== c.hNew) problems.push(`${where}: rename/copy target differs from the header`);
    if (c.minus !== undefined && c.minus !== (c.status === "A" ? "/dev/null" : `a/${c.hOld}`)) problems.push(`${where}: --- names another file than the header`);
    if (c.plus !== undefined && c.plus !== (c.status === "D" ? "/dev/null" : `b/${c.hNew}`)) problems.push(`${where}: +++ names another file than the header`);
    for (const p of new Set([c.hOld, c.hNew])) { if (seen.has(p)) problems.push(`${p}: path in two diff sections`); seen.add(p); }
    files.push({ oldPath: c.oldPath, newPath: c.newPath, status: c.status, ...(c.oldMode ? { oldMode: c.oldMode } : {}), ...(c.newMode ? { newMode: c.newMode } : {}), binary: c.binary, added: c.added });
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const at = `line ${i + 1}`;
    if (cur && inHunk && line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (cur && inHunk && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0];
      if (line === "" || c === " ") { oldLeft--; newLeft--; }
      else if (c === "-") oldLeft--;
      else if (c === "+") { newLeft--; cur.added.push(line.slice(1)); }
      else problems.push(`${at}: not a hunk line`);
      if (oldLeft < 0 || newLeft < 0) problems.push(`${at}: hunk longer than its header`);
      continue;
    }
    if (line.startsWith("diff ")) {
      finish();
      inHunk = false; binBody = false;
      const m = /^diff --git a\/([^\s"\\]+) b\/([^\s"\\]+)$/.exec(line);
      if (!m) { problems.push(`${at}: unparseable or quoted diff header`); continue; }
      cur = { oldPath: m[1]!, newPath: m[2]!, hOld: m[1]!, hNew: m[2]!, status: "M", binary: false, added: [] };
      continue;
    }
    if (!cur) { problems.push(`${at}: text outside a git diff section`); continue; }
    if (binBody) continue;
    if (line.startsWith("@@")) {
      const h = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      if (!h) { problems.push(`${at}: bad hunk header`); continue; }
      if (cur.minus === undefined || cur.plus === undefined) problems.push(`${at}: hunk without ---/+++ lines`);
      oldLeft = h[1] === undefined ? 1 : Number(h[1]);
      newLeft = h[2] === undefined ? 1 : Number(h[2]);
      inHunk = true;
      continue;
    }
    if (inHunk) { problems.push(`${at}: text after a complete hunk`); continue; }
    let m: RegExpExecArray | null;
    if ((m = /^new file mode (\d+)$/.exec(line))) { cur.status = "A"; cur.newMode = m[1]; cur.oldPath = null; }
    else if ((m = /^deleted file mode (\d+)$/.exec(line))) { cur.status = "D"; cur.oldMode = m[1]; cur.newPath = null; }
    else if ((m = /^old mode (\d+)$/.exec(line))) cur.oldMode = m[1];
    else if ((m = /^new mode (\d+)$/.exec(line))) cur.newMode = m[1];
    else if ((m = /^rename from (\S+)$/.exec(line))) { cur.status = "R"; cur.renFrom = m[1]!; }
    else if ((m = /^rename to (\S+)$/.exec(line))) cur.renTo = m[1]!;
    else if ((m = /^copy from (\S+)$/.exec(line))) { cur.status = "C"; cur.renFrom = m[1]!; }
    else if ((m = /^copy to (\S+)$/.exec(line))) cur.renTo = m[1]!;
    else if (/^(similarity|dissimilarity) index \d+%$/.test(line) || /^index [0-9a-f]+\.\.[0-9a-f]+( \d{6})?$/.test(line)) { /* informational */ }
    else if (line.startsWith("--- ")) { if (cur.minus !== undefined) problems.push(`${at}: second --- line`); cur.minus = line.slice(4); }
    else if (line.startsWith("+++ ")) { if (cur.plus !== undefined) problems.push(`${at}: second +++ line`); cur.plus = line.slice(4); }
    else if (line === "GIT binary patch") { cur.binary = true; binBody = true; }
    else if (/^Binary files .* differ$/.test(line)) cur.binary = true;
    else problems.push(`${at}: unknown diff header line`);
  }
  finish();
  return { files, malformed: problems.length > 0 || files.length === 0, problems };
}

/** One entry of `git diff --cached --raw -z --no-renames`: what git actually staged. */
export interface StagedEntry { oldMode: string; newMode: string; status: string; path: string }
export function parseRawZ(raw: string): StagedEntry[] {
  const parts = raw.split("\0");
  const out: StagedEntry[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/.exec(parts[i]!.replace(/^\n/, ""));
    if (!m) throw new Error(`unexpected git diff --raw entry: ${parts[i]!.slice(0, 60)}`);
    out.push({ oldMode: m[1]!, newMode: m[2]!, status: m[3]!, path: parts[i + 1]! });
  }
  return out;
}
/** Auditor #504 blocker 1: the change git applied must be exactly the change the parser saw (paths, status, modes). */
export function appliedDiffRefusals(staged: readonly StagedEntry[], files: readonly DiffFile[]): string[] {
  const want = new Map<string, string>();
  for (const f of files) {
    if (f.status === "A" || f.status === "C") want.set(f.newPath!, "A");
    else if (f.status === "D") want.set(f.oldPath!, "D");
    else if (f.status === "R") { want.set(f.oldPath!, "D"); want.set(f.newPath!, "A"); }
    else want.set(f.newPath!, "M");
  }
  const got = new Map(staged.map((e) => [e.path, e.status]));
  const out: string[] = [];
  for (const p of [...new Set([...want.keys(), ...got.keys()])].sort()) if (want.get(p) !== got.get(p)) out.push(`applied change differs from the parsed diff: ${p} (parsed ${want.get(p) ?? "nothing"}, git applied ${got.get(p) ?? "nothing"})`);
  for (const e of staged) for (const mode of [e.oldMode, e.newMode]) if (mode !== "100644" && mode !== "000000") out.push(`applied file mode ${mode}: ${e.path}`);
  return out;
}

export function protectedReason(path: string | null): string | null {
  if (path === null) return null;
  const norm = path.replace(/\\/g, "/");
  if (norm.startsWith("/") || norm.split("/").some((s) => s === ".." || s === "." || s === "")) return "path is not a plain relative path";
  if (PROTECTED_SELF[0]!.pattern.test(norm)) return PROTECTED_SELF[0]!.why; // the public-origin allowlist, wherever it sits
  // M21: the Builder task log is named explicitly (not just "outside peaceai/"), wherever the self-change root moves.
  const log = PROTECTED_SELF.find((p) => p.pattern.source === "^builder-log\\/");
  if (log && log.pattern.test(norm)) return log.why;
  if (!norm.startsWith("peaceai/")) return "outside peaceai/ (self-changes edit PeaceAI's own code only)";
  return PROTECTED_SELF.find((p) => p.pattern.test(norm))?.why ?? null;
}

export interface SelfDiffCheck { ok: boolean; refusals: { path: string; reason: string }[]; paths: string[] }

/** Refuses any self-change that touches the protected set, by path (every side of a rename/copy) and by content. */
export function checkSelfChangeDiff(diff: string): SelfDiffCheck {
  const { files, malformed, problems } = parseGitDiff(diff);
  const refusals: { path: string; reason: string }[] = [];
  if (malformed && files.length === 0) refusals.push({ path: "-", reason: "diff is empty or not a git diff" });
  for (const p of problems) refusals.push({ path: "-", reason: `malformed diff: ${p}` });
  const paths = new Set<string>();
  for (const f of files) {
    for (const p of [f.oldPath, f.newPath]) {
      if (p === null) continue;
      paths.add(p);
      const r = protectedReason(p);
      if (r) refusals.push({ path: p, reason: `protected: ${r}` });
    }
    const where = f.newPath ?? f.oldPath ?? "-";
    if (f.binary) refusals.push({ path: where, reason: "binary change" });
    for (const mode of [f.newMode, f.oldMode]) if (mode && mode !== "100644") refusals.push({ path: where, reason: `file mode ${mode} (symlinks, submodules and executables are refused)` });
    if (f.status === "D") refusals.push({ path: where, reason: "deletes a file" });
    if (f.status === "C") refusals.push({ path: where, reason: "copies a file" });
    if (f.newPath && !/^peaceai\/(lib|bin|self-tests|nl|ranker)\//.test(f.newPath)) refusals.push({ path: f.newPath, reason: "outside the editable areas (peaceai/lib, bin, nl, ranker, self-tests)" });
    f.added.forEach((line) => {
      for (const b of CONTENT_BANNED) if (b.pattern.test(line)) refusals.push({ path: where, reason: `content: ${b.why}` });
    });
  }
  const seen = new Set<string>();
  const uniq = refusals.filter((r) => { const k = `${r.path}\0${r.reason}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { ok: uniq.length === 0, refusals: uniq, paths: [...paths].sort() };
}

// ---- where it may run

/** Variables that carry credentials or a route to them; a proposal's environment must have none. */
const CREDENTIAL_ENV = /^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GIT_ASKPASS|SSH_ASKPASS|SSH_AUTH_SOCK|GIT_SSH|GIT_SSH_COMMAND|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT|NPM_TOKEN|NODE_AUTH_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN|AWS_[A-Z_]+|.*_(TOKEN|SECRET|KEY|PASSWORD))$/;

/**
 * A proposal runs new or changed code, so it runs in exactly one place: an ephemeral GitHub-hosted Actions job
 * in a private repo on the allowlist (Results or core), started manually (workflow_dispatch) or by a proposal
 * (issues), with no credential variables in its environment. There is no box or local mode.
 */
export function selfChangeAllowedHere(env: Record<string, string | undefined>): { ok: boolean; reason?: string } {
  if (env.GITHUB_ACTIONS !== "true") return { ok: false, reason: "PRIVATE_ACTIONS_ONLY" };
  if (!(PRIVATE_RUNNERS as readonly string[]).includes(env.GITHUB_REPOSITORY ?? "")) return { ok: false, reason: "PUBLIC_RUNNER_REFUSED" };
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" && env.GITHUB_EVENT_NAME !== "issues") return { ok: false, reason: "START_MANUALLY_OR_ON_PROPOSAL" };
  if (env.RUNNER_ENVIRONMENT !== "github-hosted") return { ok: false, reason: "RUNNER_NOT_EPHEMERAL" };
  if (Object.keys(env).some((k) => CREDENTIAL_ENV.test(k) && env[k])) return { ok: false, reason: "CREDENTIALS_IN_ENV" };
  return { ok: true };
}

export function budgetMinutes(asked: string | undefined): number {
  const n = Number(asked ?? DEFAULT_BUDGET_MINUTES);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_BUDGET_MINUTES) : DEFAULT_BUDGET_MINUTES;
}

// ---- promotion

export interface TestRun { suite: "live" | "new"; files: string[]; filesSha256: string; exitCode: number; pass: number; fail: number }
/** A command comment, traced: its GitHub comment id and URL (issuecomment-<id>) on the promotion PR/issue. */
export interface CommandComment { id?: number; url?: string; body: string; author: string; association: string; createdAt: string }
export const WORKSPACE_REPO = "PeaceG03/PeaceAI-Workspace";
export function tracedComment(c: CommandComment): boolean {
  return Number.isSafeInteger(c.id) && (c.id ?? 0) > 0 && typeof c.url === "string" && new RegExp(`^https://github\\.com/${WORKSPACE_REPO}/(pull|issues)/\\d+#issuecomment-${c.id}$`).test(c.url);
}

export interface SelfChangeRecord {
  schema: typeof SELF_SCHEMA;
  id: string;
  baseSha: string;
  candidateSha: string;
  diffSha256: string;
  paths: string[];
  check: SelfDiffCheck;
  liveSuite: { baseSha: string; filesSha256: string };
  tests: TestRun[];
  status: "refused" | "tested-failing" | "awaiting-review" | "promoted" | "rolled-back";
  promotion?: { decision: PromotionDecision; prUrl?: string; mergeSha?: string };
  rollback: { kind: "revert"; of: string | null; command: string };
  createdAt: string;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const listSha = (files: readonly string[]) => sha256([...files].sort().join("\n"));

export interface PromotionDecision { ok: boolean; reasons: string[]; auditorComment?: string; architectComment?: string }

/**
 * Promotion needs ALL of: a clean protected-set check; the LIVE version's existing test suite (the file list
 * taken from the base commit, unchanged) run against the candidate and passing; any new tests passing; and two
 * traced comments on the promotion PR (comment id + URL), each naming this change and ONE commit:
 *   Auditor   `/auditor-pass <id> <sha>`
 *   Architect `/promote-self-change <id> <sha>`, posted after that pass.
 * Both SHAs must equal the PR's current head, which must be the tested candidate commit. Any new push moves the
 * head, so it needs a fresh proposal run, a fresh pass and a fresh promote. Labels count for nothing.
 */
export function promotionDecision(rec: SelfChangeRecord, liveFilesAtBase: readonly string[], prHeadSha: string, comments: readonly CommandComment[], approvers: { auditor: readonly string[]; architect: readonly string[] }): PromotionDecision {
  const reasons: string[] = [];
  if (rec.schema !== SELF_SCHEMA) reasons.push("BAD_RECORD");
  if (!rec.check.ok || !checkOkAgain(rec)) reasons.push("PROTECTED_SET");
  const live = rec.tests.find((t) => t.suite === "live");
  if (!live) reasons.push("LIVE_TESTS_NOT_RUN");
  else {
    if (liveFilesAtBase.length === 0 || live.filesSha256 !== listSha(liveFilesAtBase) || rec.liveSuite.filesSha256 !== listSha(liveFilesAtBase)) reasons.push("LIVE_SUITE_MISMATCH");
    if (live.exitCode !== 0 || live.fail !== 0 || live.pass === 0) reasons.push("LIVE_TESTS_FAILED");
  }
  for (const t of rec.tests.filter((x) => x.suite === "new")) if (t.exitCode !== 0 || t.fail !== 0) reasons.push("NEW_TESTS_FAILED");
  const head = /^[0-9a-f]{40}$/.test(prHeadSha) ? prHeadSha : "";
  if (!head || head !== rec.candidateSha) reasons.push("HEAD_NOT_TESTED_CANDIDATE");
  const valid = (c: CommandComment, who: readonly string[]) => tracedComment(c) && who.includes(c.author) && ["OWNER", "MEMBER", "COLLABORATOR"].includes(c.association);
  const pass = comments.filter((c) => valid(c, approvers.auditor) && c.body.trim() === `${AUDITOR_COMMAND} ${rec.id} ${head}`).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  if (!head || !pass) reasons.push(comments.some((c) => valid(c, approvers.auditor) && c.body.trim().startsWith(`${AUDITOR_COMMAND} ${rec.id} `)) ? "AUDITOR_PASS_STALE_OR_SHA_MISMATCH" : "AUDITOR_PASS_MISSING");
  const promote = pass && comments.find((c) => valid(c, approvers.architect) && c.body.trim() === `${PROMOTE_COMMAND} ${rec.id} ${head}` && c.createdAt > pass.createdAt);
  if (!promote) reasons.push(comments.some((c) => valid(c, approvers.architect) && c.body.trim().startsWith(`${PROMOTE_COMMAND} ${rec.id} `)) ? "ARCHITECT_PROMOTE_STALE_OR_SHA_MISMATCH" : "ARCHITECT_APPROVAL_MISSING");
  return { ok: reasons.length === 0, reasons, ...(pass && promote ? { auditorComment: pass.url, architectComment: promote.url } : {}) };
}

/** The record's own check must still hold; a record cannot carry a passing check for refused paths. */
function checkOkAgain(rec: SelfChangeRecord): boolean {
  return rec.paths.every((p) => protectedReason(p) === null);
}

// ======================================================================================================================
// M106 SELF-CHANGE STAGE 2 (Peace, 2026-10-25 00:29 MT: "PeaceAI may propose changes to its own protected code under
// all of Auditor's limits"). It extends the M11 sandbox above, it is not a second framework:
//   1. NEVER_ZONE: paths PeaceAI may not even PROPOSE (stage2PathRefusal). Everything else under peaceai/ and the root
//      docs/*.md pages may be proposed, protected or not.
//   2. Tests are ADD-ONLY against the base (addOnlyTestRefusals): every existing top-level statement stays
//      AST-identical and in order; added statements are imports, consts, functions and plain test()/it() calls only;
//      no skip/only/todo/timeout/hooks/mocks/stubs, no writes to anything not declared in the added code. Growing any
//      allowlist / exemption / KNOWN_* / GRANDFATHERED / accepted-reason list anywhere is a weakening (listGrowth).
//   3. Grading (selfpropose.ts proposeStage2InSandbox, private ephemeral Actions job only): the UNCHANGED base suite
//      passes on the candidate, and every new test fails on the base and passes on the candidate (stage2GradeDecision).
//   4. Landing: PeaceAI only proposes. The recorded diff hash must equal the PR's diff, the PR head must be the graded
//      candidate commit, and it needs Peace `/verdict <id> <sha> right` AND Auditor `/auditor-pass <id> <sha>` on that
//      exact commit (a later push moves the head and voids both). OFF unless peaceai/self/stage2.json enables it, and
//      only Peace flips that file (it is in the never-zone).
//   5. Credit only when the landed change is byte-identical to the recorded proposal (stage2Credit).
// ======================================================================================================================

export const STAGE2_SCHEMA = "peaceai-self-change:v2";
export const STAGE2_FLAG_PATH = "peaceai/self/stage2.json";
export const STAGE2_FLAG_SCHEMA = "peaceai-self-stage2:v1";
export const VERDICT_COMMAND = "/verdict";
/** The proposal hash: sha256 of the canonical diff text (`git diff --binary --full-index --no-color --no-ext-diff --no-renames`). */
export const STAGE2_DIFF_ARGS = ["diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-renames"] as const;
export const stage2DiffSha = (diffText: string): string => sha256(diffText.replace(/\s+$/, "") + "\n");

/** Auditor limit 1: never proposable (checked on every side of every diff entry). */
export const NEVER_ZONE: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /(^|\/)\.[^/]/, why: "dot-paths: .github workflows, git hooks, .npmrc / .env secret and environment config" },
  { pattern: /(^|\/)CODEOWNERS$|^(README\.md|CONSTITUTION[^/]*|SECURITY[^/]*|LICENSE[^/]*)$/, why: "CODEOWNERS and governance documents" },
  { pattern: /(^|\/)[^/]*public-origin[^/]*$/i, why: "the public-origin allowlist (leak gate)" },
  { pattern: /^(package(-lock)?\.json|npm-shrinkwrap\.json|tsconfig[^/]*\.json)$/, why: "dependencies and build config (install scripts, test runner flags)" },
  { pattern: /^peaceai\/lib\/(leak|kernelguard|coretext|coreindex|substr|policy|prguard|scope)\.ts$|^peaceai\/bin\/(leak-scan|prepush-scan|core-scan|kernel-guard|pr-guard)\.ts$|^peaceai\/proof\//, why: "leak-check, scope and tamper-proof gates" },
  { pattern: /^peaceai\/lib\/(self-zone|selfchange|selfpropose)\.ts$|^peaceai\/bin\/self-change\.ts$|^peaceai\/results-repo\/|^peaceai\/self\//, why: "the self-change rules, their grading job, its workflow template, approvers and the stage-2 enable flag" },
  { pattern: /^peaceai\/rules\/|(^|\/)approved\.json$/, why: "approved.json and every rule approval, learned spec and proposal record" },
  { pattern: /^peaceai\/lib\/(approval|approved|verdict|trigger|results|carry|regrade|stacked|rebase|patch)\.ts$|^peaceai\/bin\/(approve-rule[^/]*|check-approved-list|parse-verdict|record-verdict|verdict-patch|verdict-stale|apply-verdict-patch|carry-check|carry-verdict|record-task|regrade-fetch)\.ts$/, why: "the /verdict, /approve-rule and /auditor-pass verification and landing code" },
  { pattern: /^peaceai\/bin\/(test-candidates|gate|regate)\.ts$|^peaceai\/lib\/(gate|records|diff)\.ts$/, why: "the Job B grading harness and its records" },
  { pattern: /^peaceai\/bin\/[^/]+\.sh$/, why: "shell scripts run on the trusted runner with secrets" },
  { pattern: /^peaceai\/targets\.json$|^peaceai\/lib\/target\.ts$|^peaceai\/read-only-ops\.json$/, why: "enable flips and allowed-file config (targets.json selfZone, read-only-ops enabled)" },
  { pattern: /^peaceai\/lib\/lm\.ts$|^peaceai\/model\//, why: "the model and its job guard" },
  { pattern: /^builder-log\//, why: "the Builder task log and the coverage counter (check.ts, trace.ts, coverage.ts and their tests)" },
];

/**
 * Strings a stage-2 proposal may not ADD (credentials, hooks, approval commands, dynamic code, runner variables).
 * ADVISORY LINT ONLY (Auditor #504): a determined proposal can always spell these some other way. The real guards
 * are the never-zone (paths + import closure, computed from the base tree), the add-only test check, and a grading
 * job that holds no secret and no write token. For TS/JS files the check also folds string concatenations and
 * templates and flags indirect eval / Function / computed import / computed global access (stage2ContentFindings).
 */
const STAGE2_CONTENT_BANNED: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /GITHUB_TOKEN|GH_TOKEN|DEPLOY_KEY|PEACEAI_[A-Z_]*KEY|TARGET_PR_TOKEN|secrets\./, why: "names a credential" },
  { pattern: /hooksPath|--no-verify/, why: "touches git hooks" },
  { pattern: /\/approve-rule|\/promote-self-change|\/auditor-pass|\/verdict\b/, why: "names an approval command" },
  { pattern: /\beval\s*\(|\bFunction\s*\(|require\(\s*[^"'`]|\bimport\s*\(\s*[^"'`\s)]/, why: "dynamic code loading" },
  { pattern: /process\.env\.(PEACEAI_SELF|GITHUB_)|process\s*\[|globalThis\s*\[/, why: "reads a self-change / runner variable" },
  { pattern: /child_process/, why: "spawns processes" },
];
const GLOBAL_OBJECTS = new Set(["process", "globalThis", "global", "window", "self", "Reflect"]);
/** AST findings for one TS/JS file (advisory lint, see above); a proposal may not add a finding the base file lacks. */
export function stage2ContentFindings(path: string, text: string): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.(mjs|cjs|js)$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const lit = (e: ts.Node): string | null => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => s.literal.text).join("");
    if (ts.isParenthesizedExpression(e)) return lit(e.expression);
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return (lit(e.left) ?? "") + (lit(e.right) ?? "");
    return null;
  };
  const text1 = (s: string) => { for (const b of STAGE2_CONTENT_BANNED) if (b.pattern.test(s)) out.push(`content: ${b.why}`); };
  const v = (n: ts.Node): void => {
    const plusTop = ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken);
    if (plusTop || ts.isTemplateExpression(n) || ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken))) {
      const s = lit(n);
      if (s !== null && !(ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent))) text1(s);
    }
    if (ts.isIdentifier(n) && n.text === "eval") out.push("content: dynamic code loading (eval)");
    if (ts.isIdentifier(n) && n.text === "Function" && !ts.isTypeReferenceNode(n.parent)) out.push("content: dynamic code loading (Function)");
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      const a = n.arguments[0];
      if (!a || !(ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) out.push("content: dynamic code loading (computed import/require)");
      else if (/child_process/.test(a.text)) out.push("content: spawns processes");
    }
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && /child_process/.test(n.moduleSpecifier.text)) out.push("content: spawns processes");
    if (ts.isElementAccessExpression(n)) {
      let x: ts.Expression = n.expression;
      while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
      const env = ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "process" && x.name.text === "env";
      if ((ts.isIdentifier(x) && GLOBAL_OBJECTS.has(x.text)) || (env && !ts.isStringLiteral(n.argumentExpression))) out.push("content: computed access to a global / runner object");
      if (env && ts.isStringLiteral(n.argumentExpression)) text1(`process.env.${n.argumentExpression.text}`);
    }
    if (ts.isPropertyAccessExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "process" && n.expression.name.text === "env") text1(`process.env.${n.name.text}`);
    ts.forEachChild(n, v);
  };
  v(sf);
  for (const line of text.split("\n")) text1(line);
  return out;
}

const plainPath = (p: string) => !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((s) => s === "" || s === "." || s === "..");
/** Where a stage-2 proposal may write: PeaceAI's own tree (peaceai/**) and the root doc pages (docs/<seg>.md). */
const STAGE2_AREA = /^peaceai\/|^docs\/[a-z0-9][a-z0-9._-]{0,80}\.md$/;

/**
 * Auditor #504 round 2 B2: protected code also READS data (derive-practice-families.json via new URL(...), nl/model.json
 * via nlparse.ts), which an import closure cannot see. So every NON-CODE file under peaceai/ is never-zone unless it
 * matches this short allowlist. The allowlist lives here, in selfchange.ts, which is itself never-zone.
 * Code = .ts/.mts/.cts/.js/.mjs/.cjs (still subject to the closure); test files are code or refused as fixtures.
 */
export const STAGE2_DATA_ALLOWLIST: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /^peaceai\/docs\/[a-z0-9][a-z0-9._-]{0,80}\.md$/, why: "PeaceAI's own doc pages (stage-1 safe zone shape)" },
];
const CODE_PATH = /\.(ts|mts|cts|js|mjs|cjs)$/;
/** Auditor limit 1: why PeaceAI may not propose a change to this path, or null. */
export function stage2PathRefusal(path: string): string | null {
  if (!plainPath(path)) return "never-zone: path is not a plain relative path";
  const n = NEVER_ZONE.find((z) => z.pattern.test(path));
  if (n) return `never-zone: ${n.why}`;
  if (!STAGE2_AREA.test(path)) return "outside the stage-2 areas (peaceai/**, docs/*.md)";
  if (path.startsWith("peaceai/") && !CODE_PATH.test(path) && !STAGE2_DATA_ALLOWLIST.some((a) => a.pattern.test(path))) return "never-zone: data file under peaceai/ (protected code may read it; only allowlisted data files are proposable)";
  return null;
}

/**
 * Auditor #504 blocker 2: the never-zone is the full reach of every never-zone file, computed from the BASE tree:
 * every file NEVER_ZONE names, the scripts that run with a token in peace-task / peace-train (TOKEN_SCRIPTS), and,
 * transitively, every module they import (static, dynamic or require, any literal relative specifier) and every
 * repo script path their text names (workflows, shell scripts, spawned tools). Tests are not followed (a test
 * importing a module does not make it a gate). `shadows` are the other resolution candidates of those imports: a
 * proposal may not ADD a file there (it could take over what a never-zone file loads).
 */
export const TOKEN_SCRIPTS: readonly string[] = ["peaceai/bin/review-comment.ts", "peaceai/bin/no-candidate-comment.ts", "peaceai/bin/issue-fetch.ts", "peaceai/bin/select.ts", "peaceai/bin/generate.ts", "peaceai/bin/train.ts"];
export interface NeverZoneSet { why: ReadonlyMap<string, string>; shadows: ReadonlySet<string> }
const CODE_FILE = /\.(ts|mts|cts|js|mjs|cjs)$/;
const SCRIPT_REF = /(?<![A-Za-z0-9_.\/-])(?:peaceai|builder-log|src)\/[A-Za-z0-9_.\/-]+\.(?:ts|mts|mjs|js|sh)(?![A-Za-z0-9_])/g;
function importSpecifiers(path: string, text: string): string[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.(mjs|cjs|js)$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const out: string[] = [];
  const v = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require")) && n.arguments[0] && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) out.push(n.arguments[0].text);
    if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) out.push(n.argument.literal.text);
    if (ts.isExternalModuleReference(n) && ts.isStringLiteral(n.expression)) out.push(n.expression.text);
    ts.forEachChild(n, v);
  };
  v(sf);
  return out;
}
function resolutionCandidates(from: string, spec: string): string[] {
  const parts: string[] = [];
  for (const s of `${from.split("/").slice(0, -1).join("/")}/${spec}`.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") { if (!parts.length) return []; parts.pop(); } else parts.push(s);
  }
  const p = parts.join("/");
  return [...new Set([p, p.replace(/\.js$/, ".ts"), p.replace(/\.mjs$/, ".mts"), p.replace(/\.cjs$/, ".cts"), `${p}.ts`, `${p}.mts`, `${p}.js`, `${p}.mjs`, `${p}.json`, `${p}/index.ts`, `${p}/index.js`])];
}
export function computeNeverZone(tracked: readonly string[], read: (p: string) => string | null): NeverZoneSet {
  const files = new Set(tracked);
  const why = new Map<string, string>();
  const shadows = new Set<string>();
  const queue: string[] = [];
  const add = (p: string, reason: string) => { if (files.has(p) && !why.has(p)) { why.set(p, reason); queue.push(p); } };
  for (const p of tracked) { const n = NEVER_ZONE.find((z) => z.pattern.test(p)); if (n) add(p, `never-zone: ${n.why}`); }
  for (const p of TOKEN_SCRIPTS) add(p, "never-zone: runs with a token in peace-task / peace-train");
  while (queue.length) {
    const f = queue.shift()!;
    if (isStage2TestPath(f)) continue;
    const text = read(f);
    if (text === null) continue;
    if (CODE_FILE.test(f)) for (const spec of importSpecifiers(f, text)) {
      if (!spec.startsWith(".")) continue;
      const cands = resolutionCandidates(f, spec);
      for (const c of cands) shadows.add(c);
      const hit = cands.find((c) => files.has(c));
      if (hit) add(hit, `never-zone: imported by ${f}`);
    }
    if (CODE_FILE.test(f) || /\.(sh|ya?ml|json)$/.test(f)) for (const m of text.matchAll(SCRIPT_REF)) add(m[0], `never-zone: run or named by ${f}`);
  }
  return { why, shadows };
}
/** Limit 1 with the closure: the pattern refusal, else the closure's reason, else (for an added file) a shadowing refusal. */
export function stage2ZoneRefusal(path: string, zone: NeverZoneSet, added = false): string | null {
  const r = stage2PathRefusal(path);
  if (r) return r;
  const w = zone.why.get(path);
  if (w) return w;
  if (added && zone.shadows.has(path)) return "never-zone: a new file here would replace a module a never-zone file imports";
  return null;
}

/** A test file for limit 2: any *.test.ts, and everything under peaceai/test/ (its fixtures too). */
export const isStage2TestPath = (p: string): boolean => /\.test\.(ts|mts|js|mjs)$/.test(p) || /^peaceai\/test\//.test(p);

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
function parseTs(path: string, text: string): ts.SourceFile | null {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length ? null : sf;
}
/** Canonical, comment- and whitespace-free form of a node: two statements are AST-identical iff these are equal. */
const canon = (n: ts.Node, sf: ts.SourceFile): string => printer.printNode(ts.EmitHint.Unspecified, n, sf);

const BANNED_TEST_NAMES = new Set(["skip", "only", "todo", "timeout", "concurrency", "mock", "mocks", "stub", "stubs", "spy", "spyOn", "fake", "fakes", "sinon", "jest", "vi", "before", "beforeEach", "after", "afterEach", "beforeAll", "afterAll", "defineProperty", "defineProperties", "setPrototypeOf", "Reflect", "__proto__", "prototype", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "constructor"]);
/** Auditor #504 round 2 B3: accessor-definition names in ANY form (identifier, string, folded concatenation). */
const ACCESSOR_HACK = /__(define|lookup)(Getter|Setter)__|__proto__|__define|__lookup/;
const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "set", "add", "delete", "clear", "assign"]);
const TEST_CALLEES = new Set(["test", "it"]);

function rootIdent(e: ts.Expression): ts.Identifier | null {
  let x: ts.Expression = e;
  for (;;) {
    if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x) || ts.isNonNullExpression(x) || ts.isParenthesizedExpression(x) || ts.isAsExpression(x)) x = x.expression;
    else break;
  }
  return ts.isIdentifier(x) ? x : null;
}
/** A value made right here (a literal, `new X()`, or a copy from a copying method), so mutating it touches nothing shared. */
const FRESH_METHODS = new Set(["split", "slice", "map", "filter", "concat", "flat", "flatMap", "toSorted", "toReversed", "keys", "values", "entries", "match", "matchAll"]);
function freshValue(e: ts.Expression): boolean {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  if (ts.isArrayLiteralExpression(x) || ts.isObjectLiteralExpression(x) || ts.isNewExpression(x) || ts.isStringLiteral(x) || ts.isTemplateExpression(x)) return true;
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
    const m = x.expression.name.text;
    if (FRESH_METHODS.has(m)) return true;
    if (ts.isIdentifier(x.expression.expression) && ["Array", "Object"].includes(x.expression.expression.text) && ["from", "of", "keys", "values", "entries"].includes(m)) return true;
  }
  return false;
}
/** Every name a node declares (variables, parameters, binding elements, functions, classes, imports); `each` sees every declaration. */
function declaredNames(n: ts.Node, out: Set<string>, each: (name: string) => void = () => {}): void {
  const put = (s: string) => { out.add(s); each(s); };
  const bind = (b: ts.BindingName) => {
    if (ts.isIdentifier(b)) put(b.text);
    else for (const el of b.elements) if (!ts.isOmittedExpression(el)) bind(el.name);
  };
  const v = (x: ts.Node): void => {
    if (ts.isVariableDeclaration(x) || ts.isParameter(x)) bind(x.name);
    else if ((ts.isFunctionDeclaration(x) || ts.isFunctionExpression(x) || ts.isClassDeclaration(x) || ts.isClassExpression(x)) && x.name) put(x.name.text);
    else if (ts.isImportClause(x) && x.name) put(x.name.text);
    else if (ts.isNamespaceImport(x) || ts.isImportSpecifier(x)) put(x.name.text);
    else if (ts.isCatchClause(x) && x.variableDeclaration) { bind(x.variableDeclaration.name); ts.forEachChild(x.block, v); return; }
    if (ts.isVariableDeclaration(x) || ts.isParameter(x)) { if (x.initializer) v(x.initializer); return; }
    ts.forEachChild(x, v);
  };
  if (ts.isIdentifier(n)) put(n.text); else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) bind(n); else v(n);
}

/** The text of a string literal / template / `+` chain of them (null otherwise); only the top of a `+` chain is folded. */
function foldString(n: ts.Node): string | null {
  const lit = (e: ts.Node): string | null => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => s.literal.text).join("");
    if (ts.isParenthesizedExpression(e)) return lit(e.expression);
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) { const a = lit(e.left), b = lit(e.right); return a === null && b === null ? null : (a ?? "") + (b ?? ""); }
    return null;
  };
  if (n.parent && ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken) return null;
  if (n.parent && ts.isParenthesizedExpression(n.parent)) return null;
  return lit(n);
}

/** Round 3: the WHOLE string a literal expression builds ("a" + `b${"c"}`), or null if any part is not a literal. */
function exactFold(e: ts.Node): string | null {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return e.text;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) return exactFold(e.expression);
  if (ts.isTemplateExpression(e)) { let r = e.head.text; for (const sp of e.templateSpans) { const v = exactFold(sp.expression); if (v === null) return null; r += v + sp.literal.text; } return r; }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) { const a = exactFold(e.left), b = exactFold(e.right); return a === null || b === null ? null : a + b; }
  return null;
}

/**
 * Auditor #504 round 2 B1(3): an ENFORCED (not advisory) static rule for added or changed code. Proposed engine code
 * runs inside the same process as the base tests that import it, so it may not reach the test machinery or the
 * process: no node:assert / node:test (engine code only) / child_process / process-level modules, no `process`
 * beyond a read-only allowlist, no globalThis / global, no writes or definers on imports, globals or built-ins, no
 * prototype / accessor patching, no Reflect, no eval / Function / computed import, no `.constructor`. Findings are
 * compared base vs candidate as a multiset, so only NEW occurrences count. Static checks cannot be complete; they
 * narrow the attack, the counts stay advisory and Auditor's review of the diff is the gate.
 */
const PROCESS_READ_OK = new Set(["argv", "cwd", "platform", "arch", "version", "versions", "hrtime", "nextTick", "stdout", "stderr"]);
const BUILTIN_GLOBALS = new Set(["Object", "Array", "String", "Number", "Boolean", "Function", "Promise", "JSON", "Math", "Date", "RegExp", "Error", "TypeError", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Reflect", "Proxy", "console", "Buffer", "URL", "BigInt", "Intl", "Atomics", "SharedArrayBuffer", "ArrayBuffer", "Uint8Array", "setTimeout", "setInterval", "queueMicrotask"]);
const BANNED_MODULES = /^(node:)?(child_process|process|module|vm|worker_threads|cluster|inspector|v8|repl|async_hooks|diagnostics_channel|trace_events)(\/|$)/;
const TEST_MODULES = /^(node:)?(assert|test)(\/|$)/;
/** R3-2: no file-system access from proposed ENGINE code (it could rewrite base tests or the grader mid-run). */
const FS_MODULES = /^(node:)?fs(\/|$)/;
/** R3 (non-blocking n1): never-zone helpers that spawn or grade (isolatedRun, ...) are not importable by proposed code. */
const SELF_MODULES = /(^|\/)self(propose|change)(\.[cm]?[jt]s)?$/;
/** R3-3: these may be used (X.y, X(...), new X, instanceof X, typeof X) but never bound, passed, stored or returned whole. */
const NO_BARE = new Set(["Object", "Reflect", "Error", "Function", "Proxy", "Symbol", "globalThis", "global", "process", "Array", "JSON", "Math", "Promise", "console", "module", "require", "exports", "Buffer", "String", "Number", "Boolean", "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet", "Intl", "Atomics", "TypeError", "RangeError", "SyntaxError"]);
export function stage2EngineFindings(path: string, text: string, opts: { testFile?: boolean } = {}): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.(mjs|cjs|js)$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const imported = new Set<string>();
  for (const s of sf.statements) if (ts.isImportDeclaration(s) && s.importClause) declaredNames(s.importClause, imported);
  const un = (e: ts.Expression): ts.Expression => { let x = e; while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression; return x; };
  const root = (e: ts.Expression): ts.Identifier | null => { let x = un(e); while (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x) || ts.isCallExpression(x)) x = un(x.expression); return ts.isIdentifier(x) ? x : null; };
  const shared = (id: ts.Identifier | null) => !!id && (imported.has(id.text) || BUILTIN_GLOBALS.has(id.text) || ["globalThis", "global", "window", "self", "process", "module", "exports", "require"].includes(id.text));
  const chainHas = (e: ts.Expression, re: RegExp): boolean => { let x = un(e); for (;;) { if (ts.isPropertyAccessExpression(x)) { if (re.test(x.name.text)) return true; x = un(x.expression); } else if (ts.isElementAccessExpression(x)) { const k = foldString(x.argumentExpression) ?? ""; if (re.test(k)) return true; x = un(x.expression); } else return false; } };
  const at = (n: ts.Node) => n.getText(sf).replace(/\s+/g, " ").slice(0, 60);
  const spec = (m: string, n: ts.Node) => {
    if (BANNED_MODULES.test(m)) out.push(`engine-safety: imports ${m}`);
    if (!opts.testFile && TEST_MODULES.test(m)) out.push(`engine-safety: non-test code imports ${m}`);
    if (!opts.testFile && FS_MODULES.test(m)) out.push(`engine-safety: non-test code imports ${m} (no file-system access from proposed engine code)`);
    if (SELF_MODULES.test(m)) out.push(`engine-safety: imports ${m} (self-change machinery is not importable by proposed code)`);
    void n;
  };
  const v = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) spec(n.moduleSpecifier.text, n);
    if (ts.isImportEqualsDeclaration(n)) out.push(`engine-safety: import = require (${at(n)})`);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      const a = n.arguments[0];
      if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) spec(a.text, n); else out.push(`engine-safety: computed import/require (${at(n)})`);
    }
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || (ts.isMethodDeclaration(p) && p.name === n) || (ts.isPropertyDeclaration(p) && p.name === n) || ts.isTypeReferenceNode(p) || ts.isQualifiedName(p);
      if (!isName) {
        if (["globalThis", "global", "window", "self"].includes(n.text)) out.push(`engine-safety: uses ${n.text}`);
        if (n.text === "eval" || n.text === "Function") out.push(`engine-safety: uses ${n.text}`);
        if (n.text === "Reflect") out.push("engine-safety: uses Reflect");
        if (n.text === "process" && !(ts.isPropertyAccessExpression(p) && p.expression === n && PROCESS_READ_OK.has(p.name.text))) out.push(`engine-safety: uses process${ts.isPropertyAccessExpression(p) && p.expression === n ? `.${p.name.text}` : ""} (only ${[...PROCESS_READ_OK].join("/")} may be read)`);
        // round 3 (eng.mts n13/n14/n18): stdout/stderr only as .write(...); functions only called directly (no _handle, .call, .constructor)
        if (n.text === "process" && ts.isPropertyAccessExpression(p) && p.expression === n && PROCESS_READ_OK.has(p.name.text)) {
          const g = p.parent;
          const called = (e: ts.Node) => ts.isCallExpression(e.parent) && e.parent.expression === e;
          const k = p.name.text;
          const fine = k === "stdout" || k === "stderr" ? ts.isPropertyAccessExpression(g) && g.expression === p && g.name.text === "write" && called(g)
            : k === "cwd" || k === "nextTick" ? called(p)
            : k === "hrtime" ? called(p) || (ts.isPropertyAccessExpression(g) && g.expression === p && g.name.text === "bigint" && called(g))
            : true;
          if (!fine) out.push(`engine-safety: process.${k} used other than ${k === "stdout" || k === "stderr" ? `process.${k}.write(...)` : "as a direct call"} (${at(g)})`);
        }
      }
      if (/^__(define|lookup)(Getter|Setter)__$|^__proto__$/.test(n.text)) out.push(`engine-safety: uses ${n.text}`);
      if (n.text === "constructor" && ts.isPropertyAccessExpression(p) && p.name === n) out.push("engine-safety: reads .constructor");
      // R3-1: `constructor` in ANY binding / property-name position ({ constructor: F } = fn, { constructor }, obj literal keys)
      if (n.text === "constructor" && (ts.isBindingElement(p) || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p))) out.push("engine-safety: uses constructor as a key");
      // R3-3: built-ins / globals only as X.y, X(...), new X(...), instanceof X, typeof X; never bound or passed whole
      if (NO_BARE.has(n.text) && !(opts.testFile && /Error$/.test(n.text))) {
        const ok = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAccessExpression(p) && p.expression === n) || (ts.isElementAccessExpression(p) && p.expression === n)
          || ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === n) || (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && p.right === n)
          || ts.isTypeOfExpression(p) || ts.isTypeReferenceNode(p) || ts.isExpressionWithTypeArguments(p) || ts.isQualifiedName(p) || ts.isTypeQueryNode(p)
          || ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)
          || ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isBindingElement(p) || ts.isEnumMember(p)) && p.name === n)
          || (ts.isBindingElement(p) && p.propertyName === n) || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p);
        if (!ok) out.push(`engine-safety: binds or passes ${n.text} whole (${at(p)})`);
      }
    }
    // R3-1: computed keys in destructuring / object literals must fold to a plain string (and never to constructor & co)
    if ((ts.isBindingElement(n) && n.propertyName && ts.isComputedPropertyName(n.propertyName)) || ((ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n)) && ts.isComputedPropertyName(n.name))) {
      const cp = (ts.isBindingElement(n) ? n.propertyName : (n as ts.PropertyAssignment).name) as ts.ComputedPropertyName;
      const k = exactFold(cp.expression);
      const symbolKey = ts.isPropertyAccessExpression(cp.expression) && ts.isIdentifier(cp.expression.expression) && cp.expression.expression.text === "Symbol";
      if (k === null && !symbolKey && !ts.isNumericLiteral(cp.expression)) out.push(`engine-safety: computed key ${at(cp)} (keys must be plain names)`);
      else if (k !== null && /^(constructor|prototype|__proto__)$/.test(k)) out.push(`engine-safety: uses ${k} as a key`);
    }
    if (ts.isBindingElement(n) && n.propertyName && (ts.isStringLiteral(n.propertyName) || ts.isNoSubstitutionTemplateLiteral(n.propertyName)) && /^(constructor|prototype|__proto__)$/.test(n.propertyName.text)) out.push(`engine-safety: uses ${n.propertyName.text} as a key`);
    if ((ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n)) && ts.isStringLiteral(n.name) && /^(constructor|__proto__)$/.test(n.name.text)) out.push(`engine-safety: uses ${n.name.text} as a key`);
    // R3-1: a computed member CALL x[expr](...) in proposed engine code (the key may be built at runtime)
    if (ts.isCallExpression(n)) { const c = un(n.expression); if (ts.isElementAccessExpression(c) && !ts.isNumericLiteral(un(c.argumentExpression))) out.push(`engine-safety: computed member call ${at(c)}`); }
    const folded = foldString(n);
    if (folded !== null && ACCESSOR_HACK.test(folded)) out.push(`engine-safety: accessor-definition name in a string`);
    if (ts.isElementAccessExpression(n) && /^(constructor|prototype|__proto__)$/.test(foldString(n.argumentExpression) ?? "")) out.push(`engine-safety: reads [${foldString(n.argumentExpression)}]`);
    if (ts.isElementAccessExpression(n)) {
      const ex = exactFold(n.argumentExpression);
      const key = un(n.argumentExpression);
      if (ex !== null && /^(constructor|prototype|__proto__)$/.test(ex)) out.push(`engine-safety: reads [${ex}]`);
      // a key BUILT inline (template with substitutions, + concatenation) that does not fold completely
      else if (ex === null && (ts.isTemplateExpression(key) || (ts.isBinaryExpression(key) && key.operatorToken.kind === ts.SyntaxKind.PlusToken))) out.push(`engine-safety: computed key built inline ${at(n)}`);
    }
    if (ts.isTemplateExpression(n) || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken))) {
      const ex = exactFold(n);
      if (ex !== null && /^(constructor|prototype)$/.test(ex) && !(ts.isElementAccessExpression(n.parent) && n.parent.argumentExpression === n)) out.push(`engine-safety: "${ex}" as a string`);
    }
    if (folded !== null && /^(constructor|prototype)$/.test(folded) && !(ts.isElementAccessExpression(n.parent) && n.parent.argumentExpression === n)) out.push(`engine-safety: "${folded}" as a string`);
    const write = (target: ts.Expression) => {
      const t = un(target);
      if (ts.isPropertyAccessExpression(t) || ts.isElementAccessExpression(t)) {
        if (shared(root(t))) out.push(`engine-safety: writes into an import / global / built-in (${at(t)})`);
        if (chainHas(t, /^prototype$|^__proto__$/)) out.push(`engine-safety: patches a prototype (${at(t)})`);
      } else if (ts.isIdentifier(t) && imported.has(t.text)) out.push(`engine-safety: reassigns import ${t.text}`);
    };
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) write(n.left);
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) write(n.operand);
    if (ts.isDeleteExpression(n)) write(n.expression);
    if (ts.isCallExpression(n)) {
      const c = un(n.expression);
      const name = ts.isPropertyAccessExpression(c) ? c.name.text : ts.isElementAccessExpression(c) ? foldString(c.argumentExpression) ?? "" : "";
      const owner = ts.isPropertyAccessExpression(c) || ts.isElementAccessExpression(c) ? root(c.expression) : null;
      if (owner?.text === "Object" && /^(setPrototypeOf|defineProperty|defineProperties|assign|freeze|seal|preventExtensions)$/.test(name)) {
        const a0 = n.arguments[0];
        if (name === "setPrototypeOf" || (a0 && (shared(root(a0)) || chainHas(a0, /^prototype$/)))) out.push(`engine-safety: Object.${name} on an import / global / built-in / prototype (${at(n)})`);
      }
      if (ts.isPropertyAccessExpression(c) && /^(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|add|delete|clear)$/.test(name) && shared(root(c.expression)) && !ts.isCallExpression(un(c.expression))) {
        const r = root(c.expression);
        if (r && imported.has(r.text)) out.push(`engine-safety: mutates an imported value (${at(n)})`);
      }
    }
    ts.forEachChild(n, v);
  };
  v(sf);
  return out;
}

/**
 * Auditor limit 2: a proposed test file must be add-only against the base. Returns the refusals (empty = ok) and the
 * names of the added test() / it() cases (each must then fail on the base and pass on the candidate).
 */
export function addOnlyTestCheck(path: string, base: string | null, cand: string): { refusals: string[]; added: string[] } {
  const refusals: string[] = [];
  const added: string[] = [];
  const csf = parseTs(path, cand);
  if (!csf) return { refusals: ["test file does not parse"], added };
  const bsf = base === null ? null : parseTs(path, base);
  if (base !== null && !bsf) return { refusals: ["base test file does not parse"], added };
  const B = bsf ? bsf.statements.map((s) => canon(s, bsf)) : [];
  const C = csf.statements.map((s) => canon(s, csf));
  // every base statement, AST-identical and in the same order (a subsequence of the candidate)
  const matched = new Set<number>();
  let j = 0;
  for (let i = 0; i < B.length; i++) {
    while (j < C.length && C[j] !== B[i]) j++;
    if (j >= C.length) { refusals.push(`existing statement ${i + 1} changed, moved or removed`); break; }
    matched.add(j++);
  }
  const addedNodes = csf.statements.filter((_, k) => !matched.has(k));
  // Auditor #504 blocker 3: new code may only mutate values it made itself. `rebind` = names the added code declares
  // as variables (may be reassigned); `fresh` = such a variable initialised with a fresh value (literal, new X(),
  // a copying method) and declared exactly ONCE in the whole file (no shadowing by a parameter, import, function or
  // base name). Parameters, imports, globals and aliases are never written through, at any depth, and a module
  // object (default / namespace import) or global object is never handed to a call as a whole.
  const declCount = new Map<string, number>();
  const bump = (n: string) => declCount.set(n, (declCount.get(n) ?? 0) + 1);
  for (const s of csf.statements) { const all = new Set<string>(); declaredNames(s, all, bump); }
  const rebind = new Set<string>();
  const fresh = new Set<string>();
  const moduleObjects = new Set<string>(["globalThis", "global", "process", "console", "Object", "Array", "Math", "JSON", "Promise", "Symbol", "Reflect", "module", "require", "exports"]);
  const imported = new Set<string>();
  for (const s of csf.statements) if (ts.isImportDeclaration(s) && s.importClause) { const names = new Set<string>(); declaredNames(s.importClause, names); for (const x of names) imported.add(x); }
  for (const s of csf.statements) if (ts.isImportDeclaration(s) && s.importClause) {
    if (s.importClause.name) moduleObjects.add(s.importClause.name.text);
    if (s.importClause.namedBindings && ts.isNamespaceImport(s.importClause.namedBindings)) moduleObjects.add(s.importClause.namedBindings.name.text);
  }
  for (const s of addedNodes) {
    const v = (x: ts.Node): void => {
      if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name)) {
        rebind.add(x.name.text);
        if (x.initializer && freshValue(x.initializer) && declCount.get(x.name.text) === 1) fresh.add(x.name.text);
      } else if (ts.isVariableDeclaration(x)) { const names = new Set<string>(); declaredNames(x.name, names); for (const n of names) rebind.add(n); }
      ts.forEachChild(x, v);
    };
    v(s);
  }
  const unwrap = (e: ts.Expression): ts.Expression => { let x = e; while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression; return x; };
  for (const s of addedNodes) {
    if (ts.isImportDeclaration(s)) {
      if (s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings)) for (const el of s.importClause.namedBindings.elements) if (BANNED_TEST_NAMES.has((el.propertyName ?? el.name).text)) refusals.push(`imports ${(el.propertyName ?? el.name).text}`);
      continue;
    }
    if (ts.isVariableStatement(s)) { if (!(s.declarationList.flags & ts.NodeFlags.Const)) refusals.push("added top-level let/var"); }
    else if (ts.isFunctionDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) { /* ok */ }
    else if (ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && ts.isIdentifier(s.expression.expression) && TEST_CALLEES.has(s.expression.expression.text)) {
      const a0 = s.expression.arguments[0];
      if (!a0 || !(ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0))) refusals.push("added test without a literal name");
      else if (s.expression.arguments.length !== 2) refusals.push(`test "${a0.text}" must be test(name, fn) (no options object)`);
      else added.push(a0.text);
    } else { refusals.push(`added top-level statement of kind ${ts.SyntaxKind[s.kind]} (only imports, consts, functions, types and test()/it() calls)`); continue; }
    const v = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && BANNED_TEST_NAMES.has(n.text)) refusals.push(`uses ${n.text}`);
      if (ts.isStringLiteral(n) && ts.isElementAccessExpression(n.parent) && n.parent.argumentExpression === n && BANNED_TEST_NAMES.has(n.text)) refusals.push(`uses ["${n.text}"]`);
      // B3: __defineGetter__ & co in any spelling, and computed member calls / computed writes on anything not fresh
      const folded = foldString(n);
      if (folded !== null && ACCESSOR_HACK.test(folded)) refusals.push(`uses an accessor-definition name ("${folded.slice(0, 30)}")`);
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const callee = unwrap(n.expression);
        if (ts.isElementAccessExpression(callee) && !ts.isNumericLiteral(unwrap(callee.argumentExpression))) refusals.push(`computed member call ${callee.getText(csf).slice(0, 40)} (call methods by name)`);
      }
      const writeTo = (target: ts.Expression) => {
        const t = unwrap(target);
        if (ts.isIdentifier(t)) { if (!rebind.has(t.text) || declCount.get(t.text) !== 1) refusals.push(`writes ${t.text} (not a variable declared once in the added code)`); return; }
        if (ts.isArrayLiteralExpression(t) || ts.isObjectLiteralExpression(t)) { for (const el of ts.isArrayLiteralExpression(t) ? t.elements : t.properties) { const e = ts.isShorthandPropertyAssignment(el) ? el.name : ts.isPropertyAssignment(el) ? el.initializer : ts.isSpreadElement(el) || ts.isSpreadAssignment(el) ? el.expression : ts.isOmittedExpression(el) ? null : (el as ts.Expression); if (e) writeTo(e as ts.Expression); } return; }
        const owner = (ts.isPropertyAccessExpression(t) || ts.isElementAccessExpression(t)) ? unwrap(t.expression) : null;
        if (ts.isElementAccessExpression(t) && owner && ts.isIdentifier(owner) && imported.has(owner.text)) refusals.push(`computed write ${target.getText(csf).slice(0, 40)} on an imported binding`);
        if (!owner || !ts.isIdentifier(owner) || !fresh.has(owner.text)) refusals.push(`writes ${target.getText(csf).slice(0, 40)} (only a value made in the added code may be written, one level deep)`);
      };
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) writeTo(n.left);
      if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) writeTo(n.operand);
      if (ts.isDeleteExpression(n)) writeTo(n.expression);
      if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && !ts.isVariableDeclarationList(n.initializer)) writeTo(n.initializer as ts.Expression);
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && MUTATORS.has(n.expression.name.text)) {
        const recv = unwrap(n.expression.expression);
        if (!freshValue(recv) && !(ts.isIdentifier(recv) && fresh.has(recv.text))) refusals.push(`mutates ${n.expression.getText(csf).slice(0, 40)} (only a value made in the added code may be mutated)`);
      }
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) for (const a of n.arguments ?? []) {
        const x = unwrap(ts.isSpreadElement(a) ? a.expression : a);
        if (ts.isIdentifier(x) && moduleObjects.has(x.text)) refusals.push(`passes ${x.text} to a call (a module or global object is never handed out whole)`);
        if (x.kind === ts.SyntaxKind.ThisKeyword) refusals.push("passes this to a call");
      }
      ts.forEachChild(n, v);
    };
    v(s);
  }
  const dup = added.filter((n, k) => added.indexOf(n) !== k || (bsf !== null && B.some((b) => b.includes(JSON.stringify(n)))));
  for (const d of new Set(dup)) refusals.push(`test name "${d}" is not unique in the file`);
  return { refusals: [...new Set(refusals)], added };
}

/** Names of lists whose growth weakens a gate (Auditor limit 2): allowlists, exemptions, known refusals, grandfathering. */
export const LISTY = /allow|exempt|known|grandfather|accept|skip|ignore|whitelist|permit|trusted|bypass|except|waive|tolerat/i;
/** Names of on/off switches: flipping one to true (or adding one set to true) is an enable flip (Auditor limit 1). */
export const FLAGGY = /enable|disabl|(^|_)on$|^on[A-Z_]|flag|switch|live$|^live/i;
function tsListElements(sf: ts.SourceFile): { lists: Map<string, string[]>; adds: number; flags: Map<string, string> } {
  const lists = new Map<string, string[]>();
  const flags = new Map<string, string>();
  let adds = 0;
  const elems = (e: ts.Expression | undefined): string[] | null => {
    if (!e) return null;
    let x = e;
    while (ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isParenthesizedExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
    if (ts.isArrayLiteralExpression(x)) return x.elements.map((y) => canon(y, sf));
    if (ts.isObjectLiteralExpression(x)) return x.properties.map((y) => canon(y, sf));
    if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && ["Set", "Map"].includes(x.expression.text)) return x.arguments?.length ? elems(x.arguments[0]) ?? [canon(x.arguments[0]!, sf)] : [];
    return null;
  };
  const visit = (n: ts.Node, scope: string): void => {
    let name: string | null = null;
    let init: ts.Expression | undefined;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) { name = n.name.text; init = n.initializer; }
    else if ((ts.isPropertyAssignment(n) || ts.isPropertyDeclaration(n)) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) { name = n.name.text; init = n.initializer; }
    const key = name ? (scope ? `${scope}.${name}` : name) : scope;
    if (name && LISTY.test(name)) { const el = elems(init); if (el) lists.set(key, [...(lists.get(key) ?? []), ...el]); }
    if (name && FLAGGY.test(name) && init && (init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword)) flags.set(key, init.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false");
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && MUTATORS.has(n.expression.name.text)) {
      const r = rootIdent(n.expression.expression);
      const recv = ts.isPropertyAccessExpression(n.expression.expression) ? n.expression.expression.name.text : r?.text ?? "";
      if (LISTY.test(recv)) adds++;
    }
    ts.forEachChild(n, (c) => visit(c, key));
  };
  visit(sf, "");
  return { lists, adds, flags };
}
function jsonFlags(v: unknown, path: string, out: Map<string, string>): void {
  if (Array.isArray(v)) { v.forEach((x, i) => jsonFlags(x, `${path}[${i}]`, out)); return; }
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (typeof x === "boolean" && FLAGGY.test(k)) out.set(`${path}.${k}`, String(x)); jsonFlags(x, `${path}.${k}`, out); }
}
const flipped = (b: Map<string, string>, c: Map<string, string>): string[] => [...c].filter(([k, v]) => (v === "true" && b.get(k) !== "true") || (v === "false" && b.get(k) === "true" && /disabl/i.test(k))).map(([k]) => `flips switch ${k}`);
function jsonListElements(v: unknown, path: string, listy: boolean, out: Map<string, string[]>): void {
  if (Array.isArray(v)) { if (listy) out.set(path, v.map((x) => JSON.stringify(x))); v.forEach((x, i) => jsonListElements(x, `${path}[${i}]`, listy, out)); return; }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (listy) out.set(`${path}{}`, Object.keys(o).map((k) => JSON.stringify([k, o[k]])));
    for (const k of Object.keys(o)) jsonListElements(o[k], `${path}.${k}`, listy || LISTY.test(k), out);
  }
}
/** Auditor limits 2 and 1 (non-test files): any element added to an allowlist-like list, a new mutation of one, or an enable flip (a switch turned on) is refused. */
export function listGrowthRefusals(path: string, base: string | null, cand: string): string[] {
  const out: string[] = [];
  const grown = (b: Map<string, string[]>, c: Map<string, string[]>) => {
    for (const [k, els] of c) {
      const left = [...(b.get(k) ?? [])];
      for (const e of els) { const i = left.indexOf(e); if (i >= 0) left.splice(i, 1); else { out.push(`adds an entry to allowlist-like ${k}`); break; } }
    }
  };
  if (/\.(ts|mts|tsx)$/.test(path)) {
    const csf = parseTs(path, cand);
    if (!csf) return ["file does not parse"];
    const bsf = base === null ? null : parseTs(path, base);
    const c = tsListElements(csf);
    const b = bsf ? tsListElements(bsf) : { lists: new Map<string, string[]>(), adds: 0, flags: new Map<string, string>() };
    grown(b.lists, c.lists);
    out.push(...flipped(b.flags, c.flags));
    if (c.adds > b.adds) out.push("adds a call that grows an allowlist-like list");
  } else if (/\.json$/.test(path)) {
    let cj: unknown, bj: unknown = null;
    try { cj = JSON.parse(cand); if (base !== null) bj = JSON.parse(base); } catch { return ["json does not parse"]; }
    const c = new Map<string, string[]>(), b = new Map<string, string[]>();
    const whole = LISTY.test(path.split("/").pop() ?? "");
    jsonListElements(cj, "$", whole, c);
    if (bj !== null) jsonListElements(bj, "$", whole, b);
    grown(b, c);
    const cf = new Map<string, string>(), bf = new Map<string, string>();
    jsonFlags(cj, "$", cf);
    if (bj !== null) jsonFlags(bj, "$", bf);
    out.push(...flipped(bf, cf));
  }
  return [...new Set(out)];
}

export interface Stage2Check { ok: boolean; refusals: { path: string; reason: string }[]; paths: string[]; newTests: { file: string; names: string[] }[] }
/** An executable change (anything but a root/peaceai doc page or a test) needs >= 1 new test that fails on the base. */
export const isStage2Executable = (p: string): boolean => !/\.md$/.test(p) && !isStage2TestPath(p);
/**
 * Limits 1 and 2 on a proposal: `diff` is the proposal (git diff), `read` gives a path's text at the base and on the
 * candidate (null = absent), `zone` is the base tree's never-zone closure (computeNeverZone). Binary, mode changes,
 * deletions, renames and copies are refused, as in M11. Callers that apply the diff must also run
 * appliedDiffRefusals on what git staged, and grade the canonical diff git produces, not the submitted text.
 */
export function checkStage2Proposal(diff: string, read: { base: (p: string) => string | null; cand: (p: string) => string | null }, zone: NeverZoneSet): Stage2Check {
  const { files, problems } = parseGitDiff(diff);
  const refusals: { path: string; reason: string }[] = [];
  const newTests: { file: string; names: string[] }[] = [];
  if (files.length === 0) refusals.push({ path: "-", reason: "diff is empty or not a git diff" });
  for (const p of problems) refusals.push({ path: "-", reason: `malformed diff: ${p}` });
  const paths = new Set<string>();
  for (const f of files) {
    for (const p of [f.oldPath, f.newPath]) {
      if (p === null) continue;
      paths.add(p);
      const r = stage2ZoneRefusal(p, zone, f.status === "A" && p === f.newPath);
      if (r) refusals.push({ path: p, reason: r });
    }
    const where = f.newPath ?? f.oldPath ?? "-";
    if (f.binary) refusals.push({ path: where, reason: "binary change" });
    for (const mode of [f.newMode, f.oldMode]) if (mode && mode !== "100644") refusals.push({ path: where, reason: `file mode ${mode}` });
    if (f.status === "D") refusals.push({ path: where, reason: "deletes a file" });
    if (f.status === "R" || f.status === "C") refusals.push({ path: where, reason: "renames or copies a file" });
    if (!/\.(ts|mts|cts|js|mjs|cjs)$/.test(where)) f.added.forEach((line) => { for (const b of STAGE2_CONTENT_BANNED) if (b.pattern.test(line)) refusals.push({ path: where, reason: `content (advisory lint): ${b.why}` }); });
    if (f.newPath === null || f.status === "D" || stage2ZoneRefusal(f.newPath, zone, f.status === "A")) continue;
    const cand = read.cand(f.newPath);
    if (cand === null) { refusals.push({ path: f.newPath, reason: "candidate file missing" }); continue; }
    const base = read.base(f.newPath);
    if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(f.newPath)) {
      // round 2 B1(3): ENFORCED engine-safety rule, new occurrences only (tests: same rule minus the assert/test import ban)
      const testFile = isStage2TestPath(f.newPath);
      const had = base === null ? [] : stage2EngineFindings(f.newPath, base, { testFile });
      for (const x of stage2EngineFindings(f.newPath, cand, { testFile })) { const i = had.indexOf(x); if (i >= 0) had.splice(i, 1); else refusals.push({ path: f.newPath, reason: x }); }
      const left = base === null ? [] : stage2ContentFindings(f.newPath, base);
      for (const x of stage2ContentFindings(f.newPath, cand)) { const i = left.indexOf(x); if (i >= 0) left.splice(i, 1); else refusals.push({ path: f.newPath, reason: x.replace(/^content: /, "content (advisory lint): ") }); }
    }
    if (isStage2TestPath(f.newPath)) {
      if (!/\.test\.ts$/.test(f.newPath)) { refusals.push({ path: f.newPath, reason: "test fixtures and non-.ts tests are not proposable (add-only cannot be checked)" }); continue; }
      const t = addOnlyTestCheck(f.newPath, base, cand);
      for (const r of t.refusals) refusals.push({ path: f.newPath, reason: `add-only: ${r}` });
      if (t.added.length) newTests.push({ file: f.newPath, names: t.added });
    } else for (const r of listGrowthRefusals(f.newPath, base, cand)) refusals.push({ path: f.newPath, reason: `weakening: ${r}` });
  }
  if ([...paths].some(isStage2Executable) && newTests.every((t) => t.names.length === 0)) refusals.push({ path: "-", reason: "an executable change needs at least one new test (it must fail on the base and pass on the candidate)" });
  const seen = new Set<string>();
  const uniq = refusals.filter((r) => { const k = `${r.path}\0${r.reason}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { ok: uniq.length === 0, refusals: uniq, paths: [...paths].sort(), newTests };
}

export interface CaseRun { exitCode: number; pass: number; fail: number }
export interface Stage2Record {
  schema: typeof STAGE2_SCHEMA;
  id: string;
  baseSha: string;
  candidateSha: string;
  /** sha256 of `git diff --binary --full-index --no-color --no-ext-diff --no-renames <base> <candidate>` (the proposal hash). */
  diffSha256: string;
  paths: string[];
  /** git blob id of every touched path on the candidate (null = absent), for the byte-identical credit check. */
  candidateBlobs: Record<string, string | null>;
  check: Stage2Check;
  baseSuite: TestRun;
  newTests: { file: string; name: string; onBase: CaseRun; onCandidate: CaseRun }[];
  /** Blocker 5: each grading phase ran in its own job; leftover processes after a phase fail it. */
  phases: { phase: Stage2Phase; ran: boolean; leftovers: number; tampered: number }[];
  /**
   * Auditor #504 round 2 B1: every pass/fail/exit count above is reported by a process that ran candidate code, in a
   * VM the candidate could tamper with. They are ADVISORY: a failing count blocks, a passing count never lands
   * anything on its own (landing needs the flag, the diff checks, Peace /verdict AND Auditor /auditor-pass).
   */
  countsTrust: typeof STAGE2_COUNTS_TRUST;
  /** Round 2 B4: the Results run that graded this id (the write-once ledger entry must name the same run). */
  run: { repository: string; runId: string; runAttempt: string } | null;
  status: "refused" | "tested-failing" | "awaiting-review";
  createdAt: string;
}
export const STAGE2_PHASES = ["suite", "new-on-candidate", "new-on-base"] as const;
export const STAGE2_COUNTS_TRUST = "candidate-process-reported, advisory" as const;
/** Round 2 B4: the write-once id ledger in PeaceAI-Results (one file per proposal id, created once, never updated). */
export const STAGE2_LEDGER_DIR = "self-proposals/ledger";
export interface Stage2LedgerEntry { schema: "peaceai-self-change-ledger:v1"; id: string; base: string; runId: string; patchSha256: string }
export type Stage2Phase = (typeof STAGE2_PHASES)[number];

/** Limit 3: the record proves the grading. `baseSuiteFiles` is the base commit's own test-file list. */
export function stage2GradeDecision(rec: Stage2Record, baseSuiteFiles: readonly string[]): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (rec.schema !== STAGE2_SCHEMA || rec.countsTrust !== STAGE2_COUNTS_TRUST) reasons.push("BAD_RECORD");
  if (!rec.check?.ok || !rec.paths.every((p) => stage2PathRefusal(p) === null)) reasons.push("CHECK_REFUSED");
  const s = rec.baseSuite;
  if (!s || baseSuiteFiles.length === 0 || s.filesSha256 !== listSha(baseSuiteFiles) || listSha(s.files) !== listSha(baseSuiteFiles)) reasons.push("BASE_SUITE_MISMATCH");
  else if (s.exitCode !== 0 || s.fail !== 0 || s.pass === 0) reasons.push("BASE_SUITE_FAILED_ON_CANDIDATE");
  const want = rec.check?.newTests?.flatMap((t) => t.names.map((n) => `${t.file}\0${n}`)) ?? [];
  const got = rec.newTests.map((t) => `${t.file}\0${t.name}`);
  if (want.length !== got.length || want.some((w) => !got.includes(w))) reasons.push("NEW_TESTS_NOT_ALL_RUN");
  if (rec.paths.some(isStage2Executable) && want.length === 0) reasons.push("NO_NEW_TEST_FOR_EXECUTABLE_CHANGE");
  for (const ph of STAGE2_PHASES) { const r = (rec.phases ?? []).find((x) => x.phase === ph); if (!r || !r.ran) reasons.push("PHASE_NOT_RUN"); else if (r.leftovers !== 0) reasons.push("LEFTOVER_PROCESSES"); else if (r.tampered !== 0) reasons.push("TREE_CHANGED_DURING_RUN"); }
  for (const t of rec.newTests) {
    if (t.onBase.exitCode === 0 && t.onBase.fail === 0) reasons.push("NEW_TEST_PASSES_ON_BASE");
    if (t.onCandidate.exitCode !== 0 || t.onCandidate.fail !== 0 || t.onCandidate.pass === 0) reasons.push("NEW_TEST_FAILS_ON_CANDIDATE");
  }
  if (!/^[0-9a-f]{40}$/.test(rec.candidateSha) || !/^[0-9a-f]{64}$/.test(rec.diffSha256)) reasons.push("BAD_RECORD");
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/** Limit 4: OFF unless the flag file says exactly { schema, enabled: true }. Missing or malformed = off. */
export function stage2Enabled(flagText: string | null): boolean {
  if (flagText === null) return false;
  try { const j = JSON.parse(flagText) as { schema?: unknown; enabled?: unknown }; return j.schema === STAGE2_FLAG_SCHEMA && j.enabled === true; } catch { return false; }
}

/**
 * Limit 4: may this proposal land? Needs the flag on, a passing grade, the PR head = graded candidate commit, the PR
 * diff hash = recorded proposal hash, Auditor `/auditor-pass <id> <head>` and Peace `/verdict <id> <head> right`
 * (both traced comments by the listed logins). Nothing here applies, pushes or merges anything.
 */
export interface Stage2PrFacts {
  headSha: string;
  /** stage2DiffSha of the real base..head diff */
  diffSha256: string;
  /** Blocker 6: rec.baseSha is an ancestor of main (and = merge-base(main, head)) */
  baseOnMain: boolean;
  /** Blocker 6: the PR's commits are exactly base..head (one commit, parent = base, head = graded candidate) */
  commitsExact: boolean;
  /** Blocker 1: checkStage2Proposal re-run on the real base..head diff with the base tree's never-zone */
  recheck: Stage2Check;
  /** Round 2 B4: the Results ledger entry for rec.id and how many commits ever touched it (write-once = exactly 1) */
  ledger: { entry: Stage2LedgerEntry | null; commits: number; runs?: Stage2RunFacts[]; recordSource?: "artifact" | "fixture" | "none"; templateBlob?: string | null };
}
/**
 * Round 3 R3-5 provenance: what decide2 reads (GETs only) about a self-change-stage2 run. `workflowBlob` is the git blob
 * of the run's workflow file at the run's head_sha; `recordJob` is the conclusion of its `record` job (attempt 1).
 */
export interface Stage2RunFacts { id: string; attempt: number; path: string; event?: string; headBranch?: string; headSha?: string; workflowBlob?: string | null; recordJob?: string | null }
/** Round 2 B4: the record must come from the ONE run the write-once ledger names for this id. */
export function stage2LedgerReasons(rec: Stage2Record, ledger: Stage2PrFacts["ledger"] | undefined): string[] {
  const e = ledger?.entry;
  if (!e || e.schema !== "peaceai-self-change-ledger:v1" || e.id !== rec.id) return ["LEDGER_MISSING"];
  const r: string[] = [];
  if (ledger!.commits !== 1) r.push("LEDGER_REWRITTEN");
  if (!rec.run || rec.run.repository !== "PeaceG03/PeaceAI-Results" || rec.run.runId !== e.runId || rec.run.runAttempt !== "1") r.push("RECORD_NOT_FROM_LEDGER_RUN");
  if (e.base !== rec.baseSha) r.push("LEDGER_BASE_MISMATCH");
  // R3-5: exactly ONE self-change-stage2 run ever named this id, and it is the ledger's run (attempt 1)
  const runs = ledger!.runs ?? [];
  if (runs.length !== 1) r.push("STAGE2_RUN_NOT_UNIQUE");
  else if (runs[0]!.id !== e.runId || runs[0]!.attempt !== 1 || !/(^|\/)self-change-stage2\.yml$/.test(runs[0]!.path)) r.push("RUN_NOT_LEDGER_RUN");
  else {
    // round 4: the run is the REVIEWED workflow, dispatched on Results main, and its record job finished successfully
    // (an edited copy dispatched on a side branch, or an artifact uploaded early in a run, does not count)
    const run = runs[0]!;
    if (run.headBranch !== "main") r.push("RUN_NOT_ON_MAIN");
    if (run.event !== "workflow_dispatch") r.push("RUN_NOT_WORKFLOW_DISPATCH");
    const t = ledger!.templateBlob;
    if (!t || !/^[0-9a-f]{40}$/.test(t) || run.workflowBlob !== t) r.push("RUN_WORKFLOW_NOT_REVIEWED_TEMPLATE");
    if (run.recordJob !== "success") r.push("RECORD_JOB_NOT_SUCCESS");
  }
  // R3-4: the record came from that run's artifact, downloaded by decide2 itself
  if (ledger!.recordSource !== "artifact") r.push(ledger!.recordSource === "fixture" ? "FIXTURE_RECORD_NEVER_LANDS" : "RECORD_NOT_FROM_LEDGER_RUN_ARTIFACT");
  return r;
}
export function stage2LandingDecision(rec: Stage2Record, baseSuiteFiles: readonly string[], pr: Stage2PrFacts, comments: readonly CommandComment[], approvers: { auditor: readonly string[]; peace: readonly string[] }, flagText: string | null): PromotionDecision {
  const reasons: string[] = [];
  if (!stage2Enabled(flagText)) reasons.push("STAGE2_OFF");
  reasons.push(...stage2GradeDecision(rec, baseSuiteFiles).reasons);
  const head = /^[0-9a-f]{40}$/.test(pr.headSha) ? pr.headSha : "";
  if (!head || head !== rec.candidateSha) reasons.push("HEAD_NOT_PROPOSAL");
  if (pr.diffSha256 !== rec.diffSha256) reasons.push("DIFF_NOT_PROPOSAL");
  if (pr.baseOnMain !== true) reasons.push("BASE_NOT_ON_MAIN");
  if (pr.commitsExact !== true) reasons.push("PR_COMMITS_NOT_BASE_HEAD");
  if (!pr.recheck?.ok) reasons.push("CHECK_REFUSED_ON_PR_DIFF");
  reasons.push(...stage2LedgerReasons(rec, pr.ledger));
  const valid = (c: CommandComment, who: readonly string[]) => tracedComment(c) && who.includes(c.author) && ["OWNER", "MEMBER", "COLLABORATOR"].includes(c.association);
  const pass = head ? comments.find((c) => valid(c, approvers.auditor) && c.body.trim() === `${AUDITOR_COMMAND} ${rec.id} ${head}`) : undefined;
  if (!pass) reasons.push(comments.some((c) => valid(c, approvers.auditor) && c.body.trim().startsWith(`${AUDITOR_COMMAND} ${rec.id} `)) ? "AUDITOR_PASS_STALE_OR_SHA_MISMATCH" : "AUDITOR_PASS_MISSING");
  const verdict = head ? comments.find((c) => valid(c, approvers.peace) && c.body.trim() === `${VERDICT_COMMAND} ${rec.id} ${head} right`) : undefined;
  if (!verdict) reasons.push(comments.some((c) => valid(c, approvers.peace) && c.body.trim().startsWith(`${VERDICT_COMMAND} ${rec.id} `)) ? "PEACE_VERDICT_STALE_OR_SHA_MISMATCH" : "PEACE_VERDICT_MISSING");
  const r = [...new Set(reasons)];
  return { ok: r.length === 0, reasons: r, ...(pass && verdict ? { auditorComment: pass.url, architectComment: verdict.url } : {}) };
}

/**
 * Limit 5 + Auditor #504 blocker 4: credit needs PROVENANCE, not just byte-identity. A stage-2 record is built from
 * whatever patch sits in Results self-proposals/<id>.patch; nothing yet ties it to a PeaceAI engine run whose only
 * input was the task text (no access to the answer commit), bound to that run's output hash. Until such a recorded
 * generator exists (a later PR, Auditor-reviewed), credit is HARD-REFUSED for every record, byte-identical or not.
 * Dry runs (row 57) are pipeline proof only, never credit.
 */
export const NO_GENERATOR_MARK = "no credit: no generator run record";
export function stage2Credit(rec: Stage2Record, landed: { paths: readonly string[]; blobs: Record<string, string | null> }): { credit: false; mark: string } {
  const want = [...rec.paths].sort();
  const got = [...new Set(landed.paths)].sort();
  const same = want.length === got.length && want.every((p, i) => p === got[i] && (landed.blobs[p] ?? null) === (rec.candidateBlobs[p] ?? null));
  return { credit: false, mark: same ? NO_GENERATOR_MARK : `${NO_GENERATOR_MARK} (and Builder-edited: landed change differs from the proposal)` };
}
