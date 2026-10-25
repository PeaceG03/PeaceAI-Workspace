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
  { pattern: /^\.github\//, why: "workflows, required checks and approval workflows" },
  { pattern: /^\.githooks\/|(^|\/)\.git\//, why: "git hooks" },
  { pattern: /^(package(-lock)?\.json|npm-shrinkwrap\.json|\.npmrc|tsconfig[^/]*\.json|\.gitignore|\.gitattributes)$/, why: "dependencies and build config" },
  { pattern: /^(README\.md|CONSTITUTION[^/]*|SECURITY[^/]*|CODEOWNERS|LICENSE[^/]*)$/, why: "governance documents" },
  { pattern: /^peaceai\/rules\//, why: "approved learned-rule list and rule specs" },
  { pattern: /^peaceai\/test\//, why: "the live test suite (new tests go under peaceai/self-tests/)" },
  { pattern: /^(?!peaceai\/self-tests\/)(.*\/)?[^/]*\.test\.ts$/, why: "existing tests anywhere (new tests go under peaceai/self-tests/)" },
  { pattern: /^peaceai\/bin\/(approve-rule[^/]*|check-approved-list\.ts|leak-scan\.ts|prepush-scan\.ts|core-scan\.ts|install-pre-push\.sh|push-proof-main\.sh|await-checks\.sh|await-held-runs\.sh|clone-core\.sh|self-change\.ts|nl-refusal\.ts|regate\.ts|gate\.ts)$/, why: "approval, leak, scan, hook, gate and self-change tools" },
  { pattern: /^peaceai\/bin\/test-candidates\.ts$/, why: "the grading harness (M14)" },
  { pattern: /^peaceai\/bin\/(?:pr-guard|verdict-patch|parse-verdict|target-check|issue-fetch|lm-fill|lm-provenance|no-candidate-comment|review-comment|select|train)\.ts$|^peaceai\/proof\/tamper-proof\.ts$/, why: "the TypeScript tools workflow steps run on the trusted runner: pr-guard.ts (its output drives the target-pr step holding TARGET_PR_TOKEN), verdict-patch.ts, parse-verdict.ts, target-check.ts (also in target-pr), issue-fetch.ts, lm-fill.ts, lm-provenance.ts, no-candidate-comment.ts, review-comment.ts, select.ts, train.ts (holds the Results deploy key) and the tamper-proof check (M95)" },
  { pattern: /^peaceai\/bin\/[^/]+\.sh$/, why: "every shell script under peaceai/bin: they run on the trusted runner in workflow jobs, many holding secrets or write tokens (clone-target.sh, install-target.sh, with-deploy-key.sh, results-write.sh, stage-chosen.sh, build-kernel.sh, key-proof-*.sh, apply-verdict-patch.sh; M94, Auditor #459)" },
  { pattern: /^peaceai\/bin\/(verdict-stale|regrade-fetch|record-task|record-verdict|carry-check|carry-verdict)\.ts$|^peaceai\/lib\/(regrade|carry)\.ts$/, why: "the stale-base regrade route through Job B and its Results records (M18), and carry-forward verdicts" },
  { pattern: /^peaceai\/bin\/(generate|regate)\.ts$|^peaceai\/lib\/(records|rank|diff)\.ts$/, why: "candidate generation and the Job B check files: grading, eligibility and diff parsing (M17)" },
  { pattern: /^peaceai\/bin\/apply-verdict-patch\.ts$|^peaceai\/lib\/(rebase|stacked)\.ts$/, why: "the stale-base re-apply and fresh regrade (M16), and the stacked-batch landing exception" },
  { pattern: /^peaceai\/lib\/(?:patch|self-zone|queue|fill|dedupe|provenance|sourcehunt|memprompts|refusal-reason|review|repair|repairrecord|repairloop|symbols|sources|nlparse|store|mine|minegit|propose)\.ts$|^peaceai\/lib\/ranker\/(?:features|model|pipeline)\.ts$|^peaceai\/bin\/kernel-guard\.ts$/, why: "the lib import closure of the protected tools: code in these modules runs in the same trusted workflow steps (patch.ts checks the verdict patch author in apply-verdict-patch, self-zone.ts is the safe-zone list, queue.ts feeds issue-fetch, sources/nlparse/symbols/fill/refusal-reason run in Job A generate, the repair and ranker modules in record-task, mine/propose in approve-rule-catchup), plus kernel-guard.ts run by build-kernel.sh (M96, Auditor #463)" },
  { pattern: /^peaceai\/lib\/(leak|approval|approved|scope|prguard|kernelguard|coretext|coreindex|substr|policy|gate|selfchange|selfpropose|learned|learned-test|learned-guard|learned-function|learned-complex|learned-body|minebody|learned-workflow|objargs|minetest|mineworkflow|results|verdict|trigger|diff)\.ts$/, why: "gates, approvals, leak/scope scanners and the self-change rules" },
  { pattern: /^peaceai\/lib\/target\.ts$|^peaceai\/targets\.json$/, why: "per-target scope config, incl. opted-in workflow files (M19)" },
  { pattern: /^peaceai\/proof\/workflow-step-proof\.md$/, why: "workflow-step grading and live-proof procedure (Auditor #107 changes 4, 6)" },
  { pattern: /^peaceai\/lib\/lm\.ts$|^peaceai\/model\/|^peaceai\/test\/m39-corefree-ext\.test\.ts$|^peaceai\/bin\/lm-memcheck\.ts$|^peaceai\/test\/m40-corefree-followups\.test\.ts$|^peaceai\/test\/m52-corefree-ft\.test\.ts$/, why: "the model, its memcheck and job guard" },
  { pattern: /^peaceai\/lib\/(lmcorpus|heldout)\.ts$|^peaceai\/bin\/(lm-corpus|heldout-select|ext-corpus|ext-fetch|ext-manifest-check|ext-memcheck)\.ts$|^peaceai\/lib\/extcorpus\.ts$|^peaceai\/model\/(ext-corpus\.json|ext-manifest\.jsonl|ext-train\.json|ext-summary\.json|ext-memcheck\.json|ext-doc-exclusions\.json|heldout-c\.json|heldout-c-excluded\.json|eval_c\.py)$|^peaceai\/model\/ext-manifest\/(index\.json|part-\d{3}\.jsonl)$|^peaceai\/lib\/manifestparts\.ts$|^peaceai\/model\/manifest_parts\.py$|^peaceai\/test\/m51-manifest-parts\.test\.ts$|^peaceai\/test\/m49-ext-doc-exclusions\.test\.ts$|^peaceai\/test\/m3[67]-ext-(corpus|train)\.test\.ts$/, why: "the training corpus builders and the held-out selection/exclusion (M28, external corpus and set C v2 M36, training M37)" },
  { pattern: /^peaceai\/lib\/lmpublic\.ts$|^peaceai\/bin\/(lm-manifest-check|lm-public-corpus)\.ts$|^peaceai\/model\/lm-public-allow\.json$/, why: "the public-runner LM corpus allowlist and held-out manifest check (M31)" },
  { pattern: /^peaceai\/lib\/learned-multibody\.ts$|^peaceai\/spec\/multibody-v1\.md$|^peaceai\/test\/m32-multibody\.test\.ts$/, why: "the multi-line body edit rule, its spec and its proofs (M32)" },
  { pattern: /^peaceai\/spec\/test-dateargs-v1\.md$|^peaceai\/test\/m35-date-args\.test\.ts$/, why: "the Date-argument test-line grammar spec and its proofs (M35)" },
  { pattern: /^peaceai\/lib\/taskmap\.ts$|^peaceai\/test\/m46-issue-text\.test\.ts$/, why: "the issue-text cleaning that feeds every rule trigger, and its proofs (M46)" },
  { pattern: /^peaceai\/spec\/throw-guard-top-v1\.md$|^peaceai\/test\/m47-guard-top\.test\.ts$/, why: "the throw-guard function-top placement proposal, its spec and proofs (M47)" },
  { pattern: /^peaceai\/bin\/heldout-c-tasks\.ts$|^peaceai\/model\/heldout-c-tasks\.json$|^peaceai\/spec\/heldout-c-tasks-v1\.md$|^peaceai\/test\/m48-setc-tasks\.test\.ts$/, why: "the set C v2 task list PeaceAI is measured on, its builder, spec and proofs (M48)" },
  { pattern: /^peaceai\/lib\/setc-grade\.ts$|^peaceai\/bin\/setc-grade\.ts$|^peaceai\/spec\/setc-grade-v1\.md$|^peaceai\/test\/m50-setc-grade\.test\.ts$/, why: "the set C v2 grader PeaceAI is scored by, its spec and proofs (M50)" },
  { pattern: /^peaceai\/lib\/learned-config\.ts$|^peaceai\/spec\/(import-edit|package-script)-v1\.md$|^peaceai\/test\/m45-config-kinds\.test\.ts$/, why: "the IMPORT_EDIT and PACKAGE_SCRIPT proposal kinds, their specs and proofs (M45)" },
  { pattern: /^\.github\/workflows\/peace-lm-train-m49\.yml$|^peaceai\/model\/ext-train-m49\.json$|^peaceai\/lib\/ftpairs\.ts$|^peaceai\/bin\/ft-pairs\.ts$|^peaceai\/lib\/ftgate\.ts$|^peaceai\/bin\/ft-gate\.ts$|^peaceai\/model\/ft-corefree(-proof)?\.json$|^peaceai\/test\/m49-ft-core-gate\.test\.ts$|^peaceai\/model\/(eval_ab|gen_c)\.py$|^peaceai\/model\/spans\.cjs$|^peaceai\/spec\/lm-run-m49\.md$|^peaceai\/test\/m49-lm-workflow\.test\.ts$/, why: "the M49 training workflow, its fine-tune data selection, evals, spec and proofs" },
  { pattern: /^peaceai\/lib\/import-edit-v2\.ts$|^peaceai\/spec\/import-edit-v2\.md$|^peaceai\/test\/m56-import-edit-v2\.test\.ts$|^peaceai\/rules\/learned\/public-import-edit-v2\.json$|^peaceai\/test\/m66-import-edit-v2-wiring\.test\.ts$/, why: "the IMPORT_EDIT v2 kind, its learned spec, engine, spec and proofs (M56/M66)" },
  { pattern: /^peaceai\/lib\/(?:workflow-job|tsconfig-script|env-fix)\.ts$|^peaceai\/spec\/undrop-skills-v1\.md$|^peaceai\/rules\/learned\/public-(?:workflow-job|tsconfig-script|env-fix)-v1\.json$|^peaceai\/rules\/learned\/public-loop-function-v2\.json$|^peaceai\/rules\/proposals\/public-(?:workflow-job|tsconfig-script|env-fix)-v1\.json$|^peaceai\/rules\/proposals\/public-loop-function-v2\.json$|^peaceai\/test\/m67-(?:undrop-skills|loop-while)\.test\.ts$|^peaceai\/test\/fixtures\/m67\//, why: "the M67 un-drop batch kinds (WORKFLOW_JOB, TSCONFIG_SCRIPT, ENV_FIX, LOOP_WHILE), their learned specs, spec, fixtures and proofs" },
  { pattern: /^peaceai\/lib\/package-script-v2\.ts$|^peaceai\/spec\/package-script-v2\.md$|^peaceai\/test\/m57-package-script-v2\.test\.ts$/, why: "the PACKAGE_SCRIPT v2 proposal kind, its spec and proofs (M57)" },
  { pattern: /^peaceai\/test\/m26-complex-function\.test\.ts$|^peaceai\/rules\/proposals\/m26-complex-function-evidence\.json$|^peaceai\/test\/fixtures\/m26\/|^peaceai\/rules\/learned\/public-complex-function-v1\.json$|^peaceai\/rules\/proposals\/public-complex-function-v1\.json$|^peaceai\/test\/m26-new-test-path\.test\.ts$/, why: "the COMPLEX_FUNCTION proofs, its mined evidence, blob-pinned fixtures, learned spec and proposal record, and the all-kinds new-test-path proofs (M26)" },
  { pattern: /^peaceai\/test\/m64-loop-function\.test\.ts$|^peaceai\/rules\/proposals\/m64-loop-function-evidence\.json$|^peaceai\/test\/fixtures\/m64\/|^peaceai\/rules\/learned\/public-loop-function-v1\.json$|^peaceai\/rules\/proposals\/public-loop-function-v1\.json$|^peaceai\/test\/m65-loop-wiring\.test\.ts$/, why: "the LOOP_FUNCTION proofs, its mined evidence, blob-pinned fixtures, learned spec and proposal record (M64), and its wiring proofs (M65)" },
  { pattern: /^peaceai\/lib\/method-guard\.ts$|^peaceai\/spec\/method-guard-v1\.md$|^peaceai\/test\/m58-method-guard\.test\.ts$|^peaceai\/rules\/learned\/public-method-guard-v1\.json$/, why: "the METHOD_GUARD proposal kind, its learned spec, engine and proofs (M58/M62)" },
  { pattern: /^peaceai\/lib\/learned-test-existing\.ts$|^peaceai\/spec\/test-case-existing-v1\.md$|^peaceai\/test\/m80-test-case-existing\.test\.ts$|^peaceai\/rules\/proposals\/m80-test-case-existing-evidence\.json$|^peaceai\/test\/fixtures\/m80\/|^peaceai\/rules\/learned\/public-test-case-existing-v1\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v1\.json$/, why: "the TEST_CASE_EXISTING kind (fix-free characterization tests), its engine, spec, mined evidence, blob-pinned fixtures, learned spec, proposal record and proofs (M80)" },
  { pattern: /^peaceai\/spec\/(?:complex-calls-v1|test-case-existing-v2|replace-expression-v2)\.md$|^peaceai\/test\/m85-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m85-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m85-[\w-]+\/|^peaceai\/rules\/learned\/public-(?:complex-calls-v1|test-case-existing-v2|replace-expression-v2)\.json$|^peaceai\/rules\/proposals\/public-(?:complex-calls-v1|test-case-existing-v2|replace-expression-v2)\.json$/, why: "the M85 skill batch (COMPLEX calls/callbacks, TEST_CASE_EXISTING v2, REPLACE_EXPRESSION v2): specs, proofs, mined evidence, blob-pinned fixtures, learned specs and proposal records" },
  { pattern: /^peaceai\/spec\/test-case-existing-v3\.md$|^peaceai\/test\/m88-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m88-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m88-[\w-]+\/|^peaceai\/rules\/learned\/public-test-case-existing-v3\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v3\.json$/, why: "M88 TEST_CASE_EXISTING v3 (Date signatures, Date literals, objects nested in arrays): spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/spec\/test-case-existing-v4\.md$|^peaceai\/test\/m90-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m90-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m90-[\w-]+\/|^peaceai\/rules\/learned\/public-test-case-existing-v4\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v4\.json$/, why: "M90 TEST_CASE_EXISTING v4 (optional / literal-default params, plain-data generic references, wider type bounds): spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/spec\/test-case-existing-v5\.md$|^peaceai\/test\/m91-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m91-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m91-[\w-]+\/|^peaceai\/rules\/learned\/public-test-case-existing-v5\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v5\.json$/, why: "M91 TEST_CASE_EXISTING v5 (literal-const typeof, string-literal property lookups): spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/spec\/test-case-existing-v6\.md$|^peaceai\/test\/m93-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m93-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m93-[\w-]+\/|^peaceai\/rules\/learned\/public-test-case-existing-v6\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v6\.json$/, why: "M93 TEST_CASE_EXISTING v6 (top-level unknown params, NodeJS.ProcessEnv params with an overridden process.env default): spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/spec\/test-case-existing-v7\.md$|^peaceai\/test\/m97-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m97-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m97-[\w-]+\/|^peaceai\/rules\/learned\/public-test-case-existing-v7\.json$|^peaceai\/rules\/proposals\/public-test-case-existing-v7\.json$/, why: "M97 TEST_CASE_EXISTING v7 (Map / Set signatures and literals, void returns with throws checks, v7 closure hardening): spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/lib\/learned-edit-existing\.ts$|^peaceai\/spec\/existing-function-edit-v1\.md$|^peaceai\/test\/m98-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m98-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m98-[\w-]+\/|^peaceai\/rules\/learned\/public-existing-function-edit-v1\.json$|^peaceai\/rules\/proposals\/public-existing-function-edit-v1\.json$/, why: "M98 EXISTING_FUNCTION_EDIT (G1 statement edit inside an existing function / class method + G2 fake-driven test, hermetic walk, Job B zone+locale grading): engine, spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^peaceai\/lib\/derive\.ts$|^peaceai\/lib\/learned-derive\.ts$|^peaceai\/spec\/derive-from-behavior-v1\.md$|^peaceai\/test\/m99-[\w-]+\.test\.ts$|^peaceai\/rules\/proposals\/m99-[\w-]+-evidence\.json$|^peaceai\/test\/fixtures\/m99-[\w-]+\/|^peaceai\/rules\/learned\/public-derive-from-behavior-v1\.json$|^peaceai\/rules\/proposals\/public-derive-from-behavior-v1\.json$/, why: "M99 DERIVE_FROM_BEHAVIOR (typed-DSL program search from behavior + examples, anti-credit guard, AMBIGUOUS refusal): engine, rule, spec doc, proofs, mined evidence, blob-pinned fixtures, learned spec and proposal record" },
  { pattern: /^\.github\/workflows\/corpus-checks\.yml$/, why: "the dispatch-only whole-corpus memcheck and core-free proof (no training)" },
  { pattern: /^\.github\/workflows\/derive-practice\.yml$|^peaceai\/lib\/derive-practice(-kinds)?\.ts$|^peaceai\/lib\/derive-practice-families\.json$|^peaceai\/bin\/derive-practice(-kinds|-dedup)?\.ts$|^peaceai\/bin\/derive-family-census\.ts$|^peaceai\/lib\/derive-family-census\.ts$/, why: "M100 derive practice workflow (checks only, no training), its families manifest and the tools it runs (with the census lib the census bin imports: Peace, 2026-10-23, for now)" },
  { pattern: /^peaceai\/test\/m42-prepush-reach\.test\.ts$/, why: "the pre-push hook reachability and attack proofs (M42, Auditor #157)" },
  { pattern: /^peaceai\/self\//, why: "self-change records and configuration" },
  { pattern: /^builder-log\//, why: "the Builder task log and its validator (append-only, PR-reviewed; M21)" },
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

/** Parses `git diff --find-renames --find-copies --binary` output. Unknown structure is reported, not skipped. */
export function parseGitDiff(diff: string): { files: DiffFile[]; malformed: boolean } {
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let malformed = false;
  const unq = (p: string) => (p.startsWith('"') ? JSON.parse(p) : p);
  for (const line of diff.split("\n")) {
    const head = /^diff --git (\S+|"[^"]*") (\S+|"[^"]*")$/.exec(line);
    if (head) {
      cur = { oldPath: unq(head[1]!).replace(/^a\//, ""), newPath: unq(head[2]!).replace(/^b\//, ""), status: "M", binary: false, added: [] };
      files.push(cur);
      continue;
    }
    if (!cur) { if (line.trim()) malformed = true; continue; }
    let m: RegExpExecArray | null;
    if ((m = /^new file mode (\d+)$/.exec(line))) { cur.status = "A"; cur.newMode = m[1]; cur.oldPath = null; }
    else if ((m = /^deleted file mode (\d+)$/.exec(line))) { cur.status = "D"; cur.oldMode = m[1]; cur.newPath = null; }
    else if ((m = /^old mode (\d+)$/.exec(line))) cur.oldMode = m[1];
    else if ((m = /^new mode (\d+)$/.exec(line))) cur.newMode = m[1];
    else if ((m = /^rename from (.+)$/.exec(line))) { cur.status = "R"; cur.oldPath = unq(m[1]!); }
    else if ((m = /^rename to (.+)$/.exec(line))) cur.newPath = unq(m[1]!);
    else if ((m = /^copy from (.+)$/.exec(line))) { cur.status = "C"; cur.oldPath = unq(m[1]!); }
    else if ((m = /^copy to (.+)$/.exec(line))) cur.newPath = unq(m[1]!);
    else if (/^(GIT binary patch|Binary files )/.test(line)) cur.binary = true;
    else if (line.startsWith("+") && !line.startsWith("+++")) cur.added.push(line.slice(1));
  }
  return { files, malformed: malformed || files.length === 0 };
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
  const { files, malformed } = parseGitDiff(diff);
  const refusals: { path: string; reason: string }[] = [];
  if (malformed) refusals.push({ path: "-", reason: "diff is empty or not a git diff" });
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

/** Strings a stage-2 proposal may not ADD anywhere (credentials, hooks, approval commands, dynamic code, gate variables). */
const STAGE2_CONTENT_BANNED: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /GITHUB_TOKEN|GH_TOKEN|DEPLOY_KEY|PEACEAI_[A-Z_]*KEY|TARGET_PR_TOKEN|secrets\./, why: "names a credential" },
  { pattern: /hooksPath|--no-verify/, why: "touches git hooks" },
  { pattern: /\/approve-rule|\/promote-self-change|\/auditor-pass/, why: "names an approval command" },
  { pattern: /\beval\s*\(|new Function\s*\(|require\(\s*[^"'`]/, why: "dynamic code loading" },
  { pattern: /process\.env\.(PEACEAI_SELF|GITHUB_)/, why: "reads a self-change / runner variable" },
];

const plainPath = (p: string) => !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((s) => s === "" || s === "." || s === "..");
/** Where a stage-2 proposal may write: PeaceAI's own tree (peaceai/**) and the root doc pages (docs/<seg>.md). */
const STAGE2_AREA = /^peaceai\/|^docs\/[a-z0-9][a-z0-9._-]{0,80}\.md$/;

/** Auditor limit 1: why PeaceAI may not propose a change to this path, or null. */
export function stage2PathRefusal(path: string): string | null {
  if (!plainPath(path)) return "never-zone: path is not a plain relative path";
  const n = NEVER_ZONE.find((z) => z.pattern.test(path));
  if (n) return `never-zone: ${n.why}`;
  if (!STAGE2_AREA.test(path)) return "outside the stage-2 areas (peaceai/**, docs/*.md)";
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

const BANNED_TEST_NAMES = new Set(["skip", "only", "todo", "timeout", "concurrency", "mock", "mocks", "stub", "stubs", "spy", "spyOn", "fake", "fakes", "sinon", "jest", "vi", "before", "beforeEach", "after", "afterEach", "beforeAll", "afterAll", "defineProperty", "defineProperties", "setPrototypeOf", "Reflect", "__proto__", "prototype"]);
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
function declaredNames(n: ts.Node, out: Set<string>): void {
  const bind = (b: ts.BindingName) => {
    if (ts.isIdentifier(b)) out.add(b.text);
    else for (const el of b.elements) if (!ts.isOmittedExpression(el)) bind(el.name);
  };
  const v = (x: ts.Node): void => {
    if (ts.isVariableDeclaration(x) || ts.isParameter(x) || ts.isBindingElement(x)) bind(x.name);
    if ((ts.isFunctionDeclaration(x) || ts.isFunctionExpression(x) || ts.isClassDeclaration(x)) && x.name) out.add(x.name.text);
    ts.forEachChild(x, v);
  };
  v(n);
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
  const local = new Set<string>();
  for (const s of addedNodes) declaredNames(s, local);
  for (const s of addedNodes) {
    if (ts.isImportDeclaration(s)) {
      if (s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings)) for (const el of s.importClause.namedBindings.elements) if (BANNED_TEST_NAMES.has((el.propertyName ?? el.name).text)) refusals.push(`imports ${(el.propertyName ?? el.name).text}`);
      if (s.importClause?.name) local.add(s.importClause.name.text);
      if (s.importClause?.namedBindings) { if (ts.isNamespaceImport(s.importClause.namedBindings)) local.add(s.importClause.namedBindings.name.text); else for (const el of s.importClause.namedBindings.elements) local.add(el.name.text); }
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
      const writeTo = (t: ts.Expression) => {
        if (ts.isIdentifier(t) ? !local.has(t.text) : (() => { const r = rootIdent(t); return !r || !local.has(r.text) || isImportedLocal(r.text); })()) refusals.push(`writes ${t.getText(csf).slice(0, 40)} (not declared in the added code)`);
      };
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) writeTo(n.left);
      if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) writeTo(n.operand);
      if (ts.isDeleteExpression(n)) writeTo(n.expression);
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && MUTATORS.has(n.expression.name.text) && !freshValue(n.expression.expression)) {
        const r = rootIdent(n.expression.expression);
        if (!r || !local.has(r.text) || isImportedLocal(r.text)) refusals.push(`mutates ${n.expression.getText(csf).slice(0, 40)} (not declared in the added code)`);
      }
      ts.forEachChild(n, v);
    };
    v(s);
  }
  // imported bindings are shared with the graded code: never a write target even though they are "added"
  function isImportedLocal(name: string): boolean {
    return csf!.statements.some((s) => ts.isImportDeclaration(s) && !!s.importClause && (s.importClause.name?.text === name || (!!s.importClause.namedBindings && (ts.isNamespaceImport(s.importClause.namedBindings) ? s.importClause.namedBindings.name.text === name : s.importClause.namedBindings.elements.some((e) => e.name.text === name)))));
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
/**
 * Limits 1 and 2 on a proposal: `diff` is the proposal (git diff), `read` gives a path's text at the base and on the
 * candidate (null = absent). Binary, mode changes, deletions, renames and copies are refused, as in M11.
 */
export function checkStage2Proposal(diff: string, read: { base: (p: string) => string | null; cand: (p: string) => string | null }): Stage2Check {
  const { files, malformed } = parseGitDiff(diff);
  const refusals: { path: string; reason: string }[] = [];
  const newTests: { file: string; names: string[] }[] = [];
  if (malformed) refusals.push({ path: "-", reason: "diff is empty or not a git diff" });
  const paths = new Set<string>();
  for (const f of files) {
    for (const p of [f.oldPath, f.newPath]) {
      if (p === null) continue;
      paths.add(p);
      const r = stage2PathRefusal(p);
      if (r) refusals.push({ path: p, reason: r });
    }
    const where = f.newPath ?? f.oldPath ?? "-";
    if (f.binary) refusals.push({ path: where, reason: "binary change" });
    for (const mode of [f.newMode, f.oldMode]) if (mode && mode !== "100644") refusals.push({ path: where, reason: `file mode ${mode}` });
    if (f.status === "D") refusals.push({ path: where, reason: "deletes a file" });
    if (f.status === "R" || f.status === "C") refusals.push({ path: where, reason: "renames or copies a file" });
    f.added.forEach((line) => { for (const b of STAGE2_CONTENT_BANNED) if (b.pattern.test(line)) refusals.push({ path: where, reason: `content: ${b.why}` }); });
    if (f.newPath === null || f.status === "D" || stage2PathRefusal(f.newPath)) continue;
    const cand = read.cand(f.newPath);
    if (cand === null) { refusals.push({ path: f.newPath, reason: "candidate file missing" }); continue; }
    const base = read.base(f.newPath);
    if (isStage2TestPath(f.newPath)) {
      if (!/\.test\.ts$/.test(f.newPath)) { refusals.push({ path: f.newPath, reason: "test fixtures and non-.ts tests are not proposable (add-only cannot be checked)" }); continue; }
      const t = addOnlyTestCheck(f.newPath, base, cand);
      for (const r of t.refusals) refusals.push({ path: f.newPath, reason: `add-only: ${r}` });
      if (t.added.length) newTests.push({ file: f.newPath, names: t.added });
    } else for (const r of listGrowthRefusals(f.newPath, base, cand)) refusals.push({ path: f.newPath, reason: `weakening: ${r}` });
  }
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
  status: "refused" | "tested-failing" | "awaiting-review";
  createdAt: string;
}

/** Limit 3: the record proves the grading. `baseSuiteFiles` is the base commit's own test-file list. */
export function stage2GradeDecision(rec: Stage2Record, baseSuiteFiles: readonly string[]): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (rec.schema !== STAGE2_SCHEMA) reasons.push("BAD_RECORD");
  if (!rec.check?.ok || !rec.paths.every((p) => stage2PathRefusal(p) === null)) reasons.push("CHECK_REFUSED");
  const s = rec.baseSuite;
  if (!s || baseSuiteFiles.length === 0 || s.filesSha256 !== listSha(baseSuiteFiles) || listSha(s.files) !== listSha(baseSuiteFiles)) reasons.push("BASE_SUITE_MISMATCH");
  else if (s.exitCode !== 0 || s.fail !== 0 || s.pass === 0) reasons.push("BASE_SUITE_FAILED_ON_CANDIDATE");
  const want = rec.check?.newTests?.flatMap((t) => t.names.map((n) => `${t.file}\0${n}`)) ?? [];
  const got = rec.newTests.map((t) => `${t.file}\0${t.name}`);
  if (want.length !== got.length || want.some((w) => !got.includes(w))) reasons.push("NEW_TESTS_NOT_ALL_RUN");
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
export function stage2LandingDecision(rec: Stage2Record, baseSuiteFiles: readonly string[], pr: { headSha: string; diffSha256: string }, comments: readonly CommandComment[], approvers: { auditor: readonly string[]; peace: readonly string[] }, flagText: string | null): PromotionDecision {
  const reasons: string[] = [];
  if (!stage2Enabled(flagText)) reasons.push("STAGE2_OFF");
  reasons.push(...stage2GradeDecision(rec, baseSuiteFiles).reasons);
  const head = /^[0-9a-f]{40}$/.test(pr.headSha) ? pr.headSha : "";
  if (!head || head !== rec.candidateSha) reasons.push("HEAD_NOT_PROPOSAL");
  if (pr.diffSha256 !== rec.diffSha256) reasons.push("DIFF_NOT_PROPOSAL");
  const valid = (c: CommandComment, who: readonly string[]) => tracedComment(c) && who.includes(c.author) && ["OWNER", "MEMBER", "COLLABORATOR"].includes(c.association);
  const pass = head ? comments.find((c) => valid(c, approvers.auditor) && c.body.trim() === `${AUDITOR_COMMAND} ${rec.id} ${head}`) : undefined;
  if (!pass) reasons.push(comments.some((c) => valid(c, approvers.auditor) && c.body.trim().startsWith(`${AUDITOR_COMMAND} ${rec.id} `)) ? "AUDITOR_PASS_STALE_OR_SHA_MISMATCH" : "AUDITOR_PASS_MISSING");
  const verdict = head ? comments.find((c) => valid(c, approvers.peace) && c.body.trim() === `${VERDICT_COMMAND} ${rec.id} ${head} right`) : undefined;
  if (!verdict) reasons.push(comments.some((c) => valid(c, approvers.peace) && c.body.trim().startsWith(`${VERDICT_COMMAND} ${rec.id} `)) ? "PEACE_VERDICT_STALE_OR_SHA_MISMATCH" : "PEACE_VERDICT_MISSING");
  const r = [...new Set(reasons)];
  return { ok: r.length === 0, reasons: r, ...(pass && verdict ? { auditorComment: pass.url, architectComment: verdict.url } : {}) };
}

/**
 * Limit 5: credit only when the landed commit changed exactly the proposal's paths to exactly the proposal's blobs.
 * Any Builder edit (another blob, another path, a missing path) is NO credit, marked so.
 */
export function stage2Credit(rec: Stage2Record, landed: { paths: readonly string[]; blobs: Record<string, string | null> }): { credit: boolean; mark: string } {
  const want = [...rec.paths].sort();
  const got = [...new Set(landed.paths)].sort();
  if (want.length !== got.length || want.some((p, i) => p !== got[i])) return { credit: false, mark: "no credit: Builder-edited (landed paths differ from the proposal)" };
  for (const p of want) if ((landed.blobs[p] ?? null) !== (rec.candidateBlobs[p] ?? null)) return { credit: false, mark: `no credit: Builder-edited (${p} differs from the proposal)` };
  return { credit: true, mark: "PeaceAI stage-2 proposal, landed byte-identical" };
}
