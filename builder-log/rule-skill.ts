// Cross-check (Auditor, #244): a by:PeaceAI repo@sha landing line's `skill` must match the learned rule that
// produced the landed candidate. The rule comes from Results: the issue's `right` verdict record names
// (runId, candidateId); that run's ranking.json gives the candidate's operationId (learned:<rule>@<sha256>).
// Usage: tsx builder-log/rule-skill.ts --results-dir <PeaceAI-Results clone> [--ci]   (--ci: errors name skills only)
// Fails closed: unknown rule, missing record, several rules, or a mismatch are all errors.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE_LANDING_REF, LOG_PATH, type Entry } from "./check.ts";
import { issueOf } from "./trace.ts";

/** Learned rule id -> builder-log skill. */
export const RULE_SKILL: Readonly<Record<string, string>> = {
  "public-test-case-v1": "TEST_CASE",
  "public-test-case-append-v1": "TEST_CASE_APPEND",
  "public-test-case-objargs-v1": "CHECK_OBJECT_LITERAL_ARGS",
  "public-test-case-append-objargs-v1": "CHECK_OBJECT_LITERAL_ARGS",
  "public-throw-guard-v1": "THROW_GUARD",
  "public-add-function-v1": "ADD_FUNCTION",
  "public-add-function-v2": "ADD_FUNCTION_NEW_MODULE",
  "public-method-guard-v1": "METHOD_GUARD",
  "public-complex-function-v1": "COMPLEX_FUNCTION",
  "public-date-function-v1": "COMPLEX_FUNCTION", // M74 DATE family: the COMPLEX_FUNCTION engine with Date types (kind COMPLEX_FUNCTION)
  "public-loop-function-v1": "LOOP_FUNCTION",
  "public-loop-function-v2": "LOOP_FUNCTION",
  "public-env-fix-v1": "ENV_FIX",
  "public-env-fix-v2": "ENV_FIX",
  "public-workflow-job-v1": "WORKFLOW_JOB",
  "public-tsconfig-script-v1": "TSCONFIG_SCRIPT",
  "public-import-edit-v2": "IMPORT_EDIT",
  "public-test-case-existing-v1": "TEST_CASE_EXISTING", // M80: kind TEST_EXISTING, shape TEST_CASE_EXISTING
  "public-test-case-existing-v2": "TEST_CASE_EXISTING", // M85: v2 target (plain-data object/array signatures, sibling imports); same kind
  "public-test-case-existing-v3": "TEST_CASE_EXISTING", // M88: v3 target (the global Date in signatures, Date literals, objects nested in arrays); same kind
  "public-test-case-existing-v4": "TEST_CASE_EXISTING", // M90: v4 target (optional / literal-default params, Array/ReadonlyArray/Readonly/Partial/Record/Pick/Omit, wider type bounds); same kind
  "public-test-case-existing-v5": "TEST_CASE_EXISTING", // M91: v5 target (typeof of literal consts, string-literal property lookups); same kind
  "public-test-case-existing-v6": "TEST_CASE_EXISTING", // M93: v6 target (top-level unknown params, NodeJS.ProcessEnv params with an overridden process.env default); same kind
};

/** Reviewed exemptions: seq -> reason (reported, never silent). */
export const RULE_SKILL_EXEMPT: Readonly<Record<number, string>> = {
  85: "WORKFLOW_STEP landed through PeaceSTOCKS PR #6 (task #131), not a verdict candidate; no issue on the line",
};

const OP = /^learned:([a-z0-9-]+)@[0-9a-f]{64}$/;

/** Rule ids of the candidates chosen `right` on an issue (null = lookup failed). */
export type RuleLookup = (issue: number) => string[] | null;

/** ci: errors name builder-log skills only, never learned rule ids (public CI step summary). */
export function checkRuleSkills(entries: readonly Entry[], lookup: RuleLookup, opts: { ci?: boolean } = {}): string[] {
  const errs: string[] = [];
  for (const e of entries) {
    if (e.by !== "PeaceAI" || !LIVE_LANDING_REF.test(e.changed)) continue;
    if (RULE_SKILL_EXEMPT[e.seq]) continue;
    const issue = issueOf(e);
    if (issue === null) { errs.push(`seq ${e.seq}: no single PeaceAI-Workspace#N to find the producing rule`); continue; }
    const rules = lookup(issue);
    if (rules === null || rules.length === 0) { errs.push(`seq ${e.seq}: no chosen candidate rule for #${issue} (fail closed)`); continue; }
    const skills = [...new Set(rules.map((r) => RULE_SKILL[r] ?? (opts.ci ? "unknown rule" : `unknown rule ${r}`)))];
    if (skills.length !== 1) { errs.push(`seq ${e.seq}: #${issue} chosen candidates map to several skills: ${skills.join(", ")}`); continue; }
    if (skills[0] !== e.skill) errs.push(opts.ci ? `seq ${e.seq}: skill ${e.skill} but #${issue}'s landed candidate's skill is ${skills[0]}` : `seq ${e.seq}: skill ${e.skill} but #${issue}'s landed candidate came from ${rules.join(", ")} (${skills[0]})`);
  }
  return errs;
}

/** Results-clone lookup: tasks/<N>/<run>/verdicts/*.json `right` -> ranking.json candidate operationId. */
export function resultsDirLookup(dir: string): RuleLookup {
  return (issue) => {
    try {
      const base = join(dir, "tasks", String(issue));
      if (!existsSync(base)) return null;
      const out: string[] = [];
      for (const run of readdirSync(base)) {
        const vd = join(base, run, "verdicts");
        if (!existsSync(vd)) continue;
        for (const f of readdirSync(vd)) {
          const v = JSON.parse(readFileSync(join(vd, f), "utf8")) as { verdict?: string; runId?: string; candidateId?: string };
          if (v.verdict !== "right") continue;
          // The run id names a directory under tasks/<N>/: digits only, never a path (Auditor).
          if (typeof v.runId !== "string" || !/^[0-9]{1,20}$/.test(v.runId)) return null;
          const rk = JSON.parse(readFileSync(join(base, v.runId, "ranking.json"), "utf8")) as { candidates: { id: string; operationId: string | null }[] };
          const c = rk.candidates.find((x) => x.id === v.candidateId);
          const m = c?.operationId ? OP.exec(c.operationId) : null;
          if (!m) return null;
          out.push(m[1]!);
        }
      }
      return [...new Set(out)];
    } catch {
      return null;
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--results-dir");
  if (i < 0 || !process.argv[i + 1]) { console.error("rule-skill: --results-dir <PeaceAI-Results clone> is required"); process.exit(2); }
  const entries = readFileSync(LOG_PATH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
  const errs = checkRuleSkills(entries, resultsDirLookup(process.argv[i + 1]!), { ci: process.argv.includes("--ci") });
  for (const e of errs) console.error(`rule-skill: ${e}`);
  for (const [s, r] of Object.entries(RULE_SKILL_EXEMPT)) console.log(`rule-skill: seq ${s} exempt: ${r}`);
  if (errs.length) process.exit(1);
  console.log("rule-skill: every by:PeaceAI landing's skill matches its producing rule");
}
