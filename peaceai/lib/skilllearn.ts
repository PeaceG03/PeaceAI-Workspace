// M22: the skill learner. Re-reads the public Builder task log (builder-log/tasks.jsonl) and, per pass,
// picks ONE missing skill to propose, with examples taken from the log, plus a ranked gap note for what it
// cannot turn into a rule. Deterministic counting over public log lines only: no model, no network, no other
// repository. A skill proposal is only a request: it never approves itself, never edits rules, and it becomes
// a learned rule only through the normal path (a code PR with tests for Auditor, a rule proposal, Architect's
// /approve-rule, live proofs).
import { createHash } from "node:crypto";
import { validateLog, type Entry } from "../../builder-log/check.ts";

export const SKILL_MARKER = "peaceai-skill-proposal:v1";
export const MAX_EXAMPLES = 5;
/** Skills that can never become a PeaceAI edit rule, and why (they go to the gap note only). */
export const NOT_RULEABLE: Readonly<Record<string, string>> = {
  PEACEAI_SELF_CHANGE: "PeaceAI's own tooling is protected; self-changes are never learned edits by design",
  OPS_ACTION: "no code edit (dispatch, close, label, diagnose)",
  ENV_FIX: "box/runner environment, no repository edit",
};
const REF = /(?:PeaceSTOCKS|PeaceAI-Workspace)@[0-9a-f]{7,40}|PeaceAI-Workspace#\d+/g;

export interface SkillRank { skill: string; entries: number; withCode: number; refs: string[]; seqs: number[] }
export interface Gap { skill: string; entries: number; reason: string }
export interface LearnPass { pick: SkillRank | null; ranked: SkillRank[]; gaps: Gap[]; logSha256: string }

/** Missing skills ranked by entries that carry a public code ref (mineable evidence), then entries, then name. */
export function learnPass(logText: string, alreadyProposed: ReadonlySet<string>): LearnPass {
  const errors = validateLog(logText);
  if (errors.length) throw new Error(`builder-log invalid: ${errors[0]}`);
  const entries = logText.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
  const by = new Map<string, Entry[]>();
  for (const e of entries) if (e.mark.startsWith("missing skill ")) by.set(e.skill, [...(by.get(e.skill) ?? []), e]);
  const ranked: SkillRank[] = [...by.entries()].map(([skill, list]) => {
    const refs = list.flatMap((e) => e.changed.match(REF) ?? []);
    return { skill, entries: list.length, withCode: entriesWithCode(list), refs: [...new Set(refs)], seqs: list.map((e) => e.seq) };
  }).sort((a, b) => b.withCode - a.withCode || b.entries - a.entries || a.skill.localeCompare(b.skill));
  const gaps: Gap[] = [];
  let pick: SkillRank | null = null;
  for (const r of ranked) {
    const why = NOT_RULEABLE[r.skill] ?? (r.withCode === 0 ? "no public code change in the log to learn from" : alreadyProposed.has(r.skill) ? "already proposed or in progress" : null);
    if (why === null && pick === null) { pick = r; continue; }
    gaps.push({ skill: r.skill, entries: r.entries, reason: why ?? `not this pass (one skill per pass; ${pick!.skill} ranks higher)` });
  }
  return { pick, ranked, gaps, logSha256: createHash("sha256").update(logText).digest("hex") };
}

function entriesWithCode(list: readonly Entry[]): number {
  return list.filter((e) => /(?:PeaceSTOCKS|PeaceAI-Workspace)@[0-9a-f]{7,40}|PeaceAI-Workspace#\d+/.test(e.changed)).length;
}

/** Proposal issue body: examples (log lines, public refs only), the gap note, and the normal path. */
export function skillProposalBody(p: LearnPass, logText: string): { title: string; body: string } | null {
  if (!p.pick) return null;
  const entries = logText.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
  const ex = entries.filter((e) => e.skill === p.pick!.skill && /(?:PeaceSTOCKS|PeaceAI-Workspace)[@#]/.test(e.changed)).slice(0, MAX_EXAMPLES);
  const body = [
    `<!-- ${SKILL_MARKER} skill=${p.pick.skill} log=${p.logSha256} -->`,
    `## Skill proposal: \`${p.pick.skill}\``,
    "",
    `Picked by the skill learner from \`builder-log/tasks.jsonl\` (sha256 \`${p.logSha256.slice(0, 16)}…\`): ${p.pick.entries} log entries need it, ${p.pick.withCode} of them with a public code change. Counting only, no model.`,
    "",
    "### Examples from the log",
    "",
    "| seq | asked | changed |",
    "|---:|---|---|",
    ...ex.map((e) => `| ${e.seq} | ${e.asked.replace(/\|/g, "/")} | ${e.changed} |`),
    "",
    "### Gap note (ranked; not turned into a proposal this pass)",
    "",
    "| skill | entries | why |",
    "|---|---:|---|",
    ...p.gaps.map((g) => `| ${g.skill} | ${g.entries} | ${g.reason} |`),
    "",
    "### What happens next (normal path only)",
    "",
    "This is a request, not a rule. It changes nothing and cannot approve itself. Builder mines the public commits above into a spec and an engine change with tests, as a PR for Auditor. After merge comes a rule-proposal issue for Architect's approval, then live proofs (valid tasks COUNT, a bad one is refused).",
  ].join("\n");
  return { title: `Skill proposal: ${p.pick.skill} (from the Builder task log)`, body };
}
