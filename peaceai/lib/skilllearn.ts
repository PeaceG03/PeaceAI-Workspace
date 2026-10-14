// M22: the skill learner. Re-reads the public Builder task log (builder-log/tasks.jsonl) and, per pass,
// picks ONE missing skill to propose, with examples taken from the log, plus a ranked gap note for what it
// cannot turn into a rule. Deterministic counting over public log lines only: no model, no network, no other
// repository. A skill proposal is only a request: it never approves itself, never edits rules, and it becomes
// a learned rule only through the normal path (a code PR with tests for Auditor, a rule proposal, Architect's
// /approve-rule, live proofs).
import { createHash } from "node:crypto";
import * as logcheck from "../../builder-log/check.ts";
import { validateLog, type Entry } from "../../builder-log/check.ts";

/** Skills approved now: the validator's approved list plus any approved later (APPROVED_SINCE, #134). Never re-proposed. */
export const APPROVED_NOW: ReadonlySet<string> = new Set([...logcheck.APPROVED_SKILLS, ...Object.keys((logcheck as { APPROVED_SINCE?: Record<string, string> }).APPROVED_SINCE ?? {}), "WORKFLOW_STEP", "CHECK_OBJECT_LITERAL_ARGS"]);

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
export interface LearnPass { pick: SkillRank | null; picks: SkillRank[]; families: { family: string; skills: SkillRank[] }[]; ranked: SkillRank[]; gaps: Gap[]; logSha256: string }

/** Bulk teaching (Peace, Oct 14): several gaps per pass, grouped into families. Each skill is still its own spec. */
export const MAX_PICKS_PER_PASS = 3;
/** Skill families: skills that share mining, engine surface and live proofs. Unlisted skills form their own family. */
export const FAMILY_OF: Readonly<Record<string, string>> = {
  COMPLEX_FUNCTION: "code-shape",
  IMPORT_EDIT: "code-shape",
  MODIFY_LOGIC: "code-shape",
  WORKFLOW_JOB: "workflow",
  TSCONFIG_SCRIPT: "config",
};
export const familyOf = (skill: string): string => (Object.prototype.hasOwnProperty.call(FAMILY_OF, skill) ? FAMILY_OF[skill]! : skill.toLowerCase());

/** Missing skills ranked by entries that carry a public code ref (mineable evidence), then entries, then name. */
export function learnPass(logText: string, alreadyProposed: ReadonlySet<string>, maxPicks: number = MAX_PICKS_PER_PASS): LearnPass {
  if (!Number.isInteger(maxPicks) || maxPicks < 1 || maxPicks > MAX_PICKS_PER_PASS) throw new Error("maxPicks out of range");
  const errors = validateLog(logText);
  if (errors.length) throw new Error(`builder-log invalid: ${errors[0]}`);
  const entries = logText.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
  const by = new Map<string, Entry[]>();
  for (const e of entries) if (e.mark.startsWith("missing skill ") && !APPROVED_NOW.has(e.skill)) by.set(e.skill, [...(by.get(e.skill) ?? []), e]);
  const ranked: SkillRank[] = [...by.entries()].map(([skill, list]) => {
    const refs = list.flatMap((e) => e.changed.match(REF) ?? []);
    return { skill, entries: list.length, withCode: entriesWithCode(list), refs: [...new Set(refs)], seqs: list.map((e) => e.seq) };
  }).sort((a, b) => b.withCode - a.withCode || b.entries - a.entries || a.skill.localeCompare(b.skill));
  const gaps: Gap[] = [];
  const picks: SkillRank[] = [];
  for (const r of ranked) {
    const why = (Object.prototype.hasOwnProperty.call(NOT_RULEABLE, r.skill) ? NOT_RULEABLE[r.skill] : undefined) ?? (r.withCode === 0 ? "no public code change in the log to learn from" : alreadyProposed.has(r.skill) ? "already proposed or in progress" : null);
    if (why === null && picks.length < maxPicks) { picks.push(r); continue; }
    gaps.push({ skill: r.skill, entries: r.entries, reason: why ?? `not this pass (at most ${maxPicks} skills per pass; ${picks.map((x) => x.skill).join(", ")} rank higher)` });
  }
  const families: { family: string; skills: SkillRank[] }[] = [];
  for (const r of picks) {
    const f = familyOf(r.skill);
    const g = families.find((x) => x.family === f);
    if (g) g.skills.push(r); else families.push({ family: f, skills: [r] });
  }
  return { pick: picks[0] ?? null, picks, families, ranked, gaps, logSha256: createHash("sha256").update(logText).digest("hex") };
}

function entriesWithCode(list: readonly Entry[]): number {
  return list.filter((e) => /(?:PeaceSTOCKS|PeaceAI-Workspace)@[0-9a-f]{7,40}|PeaceAI-Workspace#\d+/.test(e.changed)).length;
}

/**
 * Auditor (#115): log text is untrusted in a proposal. Every cell is escaped (HTML-significant characters,
 * table pipes, backticks, line breaks) and the marker word is broken, so a copied marker in a log line can
 * never form an HTML comment or match the dedupe pattern. Cells are capped.
 */
export function cell(text: string, max = 160): string {
  const t = text.length > max ? text.slice(0, max) + "…" : text;
  return t
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "&#124;").replace(/`/g, "&#96;")
    .replace(/[\r\n]+/g, " ")
    .replace(/peaceai-skill-proposal/gi, "peaceai&#45;skill&#45;proposal");
}

/** The dedupe marker: ONLY the body's first line, exactly this form. Anything else in the body is ignored. */
export const MARKER_LINE = /^<!-- peaceai-skill-proposal:v1 skills=([A-Z][A-Z_]*(?:,[A-Z][A-Z_]*){0,9}) log=[0-9a-f]{64} -->$/;
export function markerSkills(body: string): string[] {
  const m = MARKER_LINE.exec(body.split("\n")[0]!.replace(/\r$/, ""));
  return m ? m[1]!.split(",") : [];
}

/** Proposal issue body: examples (log lines, public refs only), the gap note, and the normal path. */
export function skillProposalBody(p: LearnPass, logText: string): { title: string; body: string } | null {
  if (!p.pick) return null;
  const entries = logText.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
  const section = (r: SkillRank) => {
    const ex = entries.filter((e) => e.skill === r.skill && /(?:PeaceSTOCKS|PeaceAI-Workspace)[@#]/.test(e.changed)).slice(0, MAX_EXAMPLES);
    return [
      `#### \`${r.skill}\``,
      "",
      `${r.entries} log entries need it, ${r.withCode} of them with a public code change.`,
      "",
      "| seq | asked | changed |",
      "|---:|---|---|",
      ...ex.map((e) => `| ${Number(e.seq)} | ${cell(e.asked)} | ${cell(e.changed)} |`),
      "",
    ];
  };
  const skills = p.picks.map((r) => r.skill);
  const body = [
    `<!-- ${SKILL_MARKER} skills=${skills.join(",")} log=${p.logSha256} -->`,
    `## Skill proposal: ${p.families.map((f) => `${f.family} (${f.skills.map((r) => r.skill).join(", ")})`).join("; ")}`,
    "",
    `Picked by the skill learner from \`builder-log/tasks.jsonl\` (sha256 \`${p.logSha256.slice(0, 16)}…\`): the ${skills.length} highest-ranked missing skills with public code evidence, grouped into families. Counting only, no model.`,
    "",
    ...p.families.flatMap((f) => [`### Family \`${f.family}\``, "", ...f.skills.flatMap(section)]),
    "### Gap note (ranked; not turned into a proposal this pass)",
    "",
    "| skill | entries | why |",
    "|---|---:|---|",
    ...p.gaps.map((g) => `| ${g.skill} | ${g.entries} | ${g.reason} |`),
    "",
    "### What happens next (normal path only)",
    "",
    "This is a request, not a rule. It changes nothing and cannot approve itself. Builder mines the public commits into one spec per skill and the engine changes with tests, as one family PR for Auditor. Each skill is still tested, reviewed and proven on its own: rule-proposal issues per skill, approved by Architect (one batch approval PR may land several), then shared live proofs where each skill must COUNT and a bad case per skill is refused.",
  ].join("\n");
  return { title: `Skill proposal: ${p.families.map((f) => f.family).join(" + ")} (${skills.join(", ")}) from the Builder task log`, body };
}
