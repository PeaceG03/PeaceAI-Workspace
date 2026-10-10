// M8: turn mined shape statistics into learned-rule specs and proposal issue bodies. Deterministic.
import { MINER_VERSION, majority, type ShapeStats } from "./mine.ts";
import { nullishTrigger, RULE_SCHEMA, specHash, TRIGGERS, type RuleKind, type RuleSpec } from "./learned.ts";

export const MIN_COMMITS = 3;
export const MIN_FILES = 2;
/** A default kind is learned only with at least this many observed examples. */
export const MIN_KIND_SUPPORT = 2;
/** Rule versions. ADD_NULLISH_DEFAULT v2: single-read only, kinds with support, trigger limited to those kinds. */
const RULE_VERSION: Record<RuleKind, number> = { SET_LITERAL: 1, ADD_SWITCH_CASE: 1, ADD_NULLISH_DEFAULT: 2 };
const NAMED_CONTEXTS = ["object-property", "top-level-const", "local-const"];
const KIND_OF: Partial<Record<string, RuleKind>> = { LITERAL_CHANGE: "SET_LITERAL", SWITCH_CASE: "ADD_SWITCH_CASE", NULLISH_DEFAULT: "ADD_NULLISH_DEFAULT" };
const SLUG: Record<RuleKind, string> = { SET_LITERAL: "set-literal", ADD_SWITCH_CASE: "add-switch-case", ADD_NULLISH_DEFAULT: "add-nullish-default" };

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
    } else {
      const kinds = Object.entries(s.styles.default ?? {}).filter(([k, n]) => k !== "expression" && n >= MIN_KIND_SUPPORT).map(([k]) => k).sort();
      if (kinds.length === 0 || majority(s, "target") !== "member") { skipped.push({ shape: s.shape, why: "no-learnable-params" }); continue; }
      params = { kinds, reads: "single", target: "member" };
    }
    const spec: RuleSpec = {
      schema: RULE_SCHEMA, id: `${minedFrom}-${SLUG[kind]}-v${RULE_VERSION[kind]}`, kind, minedFrom, minerVersion: MINER_VERSION, shape: s.shape,
      trigger: kind === "ADD_NULLISH_DEFAULT" ? nullishTrigger(params.kinds as string[]) : TRIGGERS[kind], params, evidence: { hunks: s.hunks, commits: s.commits, files: s.files, repos: [...repos].sort() },
    };
    proposals.push({ spec, sha256: specHash(spec), stats: s });
  }
  return { proposals, skipped };
}

export const PHRASING: Record<RuleKind, string> = {
  SET_LITERAL: "set `NAME` to VALUE  (optionally: set `NAME` in `path/file.ts` to VALUE)",
  ADD_SWITCH_CASE: 'add case "label" returning VALUE to the switch in `functionName`',
  ADD_NULLISH_DEFAULT: "default `obj.field` to VALUE in `functionName`",
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
    "It produces one candidate when the edit site is unique; otherwise none. The candidate goes through the same scope, leak and core-text gates, the sandboxed tests and the M7 repair loop as every other candidate.",
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
