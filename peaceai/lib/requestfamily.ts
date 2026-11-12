// Experimental. credit is false.
// Maps a request onto a PeaceAI edit family. Each family has a cue taken from its own name
// and trigger wording, not from any one builder-log row. A cue that mislabels the dev split
// is dropped. Zero cues or two cues refuse. A request that names PeaceAI's own tooling, and
// no edit family, refuses as a self-change. A hash of seq and asked text holds rows out.
import { createHash } from "node:crypto";

export const REQUEST_FAMILY_SCHEMA = "peaceai-request-family:v1";
export const NONE_FAMILY = "none";
const SELF = new Set(["PEACEAI_SELF_CHANGE", "OPS_ACTION"]);

export interface FamilyRow { seq: number; asked: string; skill: string }

/** Family cues. The words are the family's name or its trigger, not a row. */
const CUES: readonly { family: string; re: RegExp }[] = [
  { family: "TEST_CASE_EXISTING", re: /characteri[sz]ation test/i },
  { family: "TEST_CASE_APPEND", re: /\bappend(?:ed|ing)? (?:a |an )?test\b/i },
  { family: "TEST_CASE", re: /\b(?:regression|value) tests?\b/i },
  { family: "METHOD_GUARD", re: /\bmethod-guard\b|\bwith a method\b/i },
  // The throw-guard trigger is "guard … : throw", not the bare word. "with a method" is the method-guard trigger.
  { family: "THROW_GUARD", re: /\bguard\b(?![^\n]{0,200}\bwith a method\b)[^\n]{0,160}:\s*throw\b/i },
  { family: "ENV_FIX", re: /\benv-fix\b|\bmake env\b|\benvironment variable\b/i },
  { family: "IMPORT_EDIT", re: /\bimport\b/i },
  { family: "DERIVE_FROM_BEHAVIOR", re: /\bbehavior-only\b|\bderive\b/i },
  { family: "LOOP_FUNCTION", re: /\bloop function\b|\bretag\b[^\n]*\bloop\b/i },
  { family: "COMPLEX_FUNCTION", re: /\bcomplex function\b|\bdate function\b/i },
  { family: "WORKFLOW_JOB", re: /\bworkflow\b|\bjob\b/i },
  { family: "WORKFLOW_STEP", re: /\bworkflow-step\b|\bcron\b/i },
  { family: "ADD_FUNCTION_NEW_MODULE", re: /\bnew module\b/i },
  { family: "ADD_FUNCTION", re: /\badd helper\b|\badd (?:a )?(?:pure )?function\b/i },
  { family: "TSCONFIG_SCRIPT", re: /\btypecheck\b|\btsconfig\b/i },
  { family: "MODIFY_LOGIC", re: /\bfail closed\b/i },
  { family: "CHECK_OBJECT_LITERAL_ARGS", re: /\bobject-literal\b/i },
];

export interface RequestModel {
  schema: typeof REQUEST_FAMILY_SCHEMA;
  experimental: true;
  credit: false;
  families: string[];
}

export function heldOutRow(seq: number, asked: string): boolean {
  return createHash("sha256").update(`${seq}\n${asked}`).digest()[0]! % 5 === 0;
}

/**
 * Code next to a cue. A real path (a letter-led file with a source extension), a call with no space
 * before the parenthesis, a backticked name, or a snake_case name. Not a brand, a digit-word,
 * a parenthesis in prose, "test file", or a bare "src/".
 */
const CODE_EXT = "ts|tsx|mts|cts|js|jsx|mjs|cjs|json|py|sh|yml|yaml";
const CODE_CONTEXT = new RegExp(String.raw`(?:(?:^|[^\w./-])(?:\.{1,2}/)?(?:[A-Za-z_][\w.-]*/)+[A-Za-z_][\w.-]*\.(?:${CODE_EXT})\b|\b[A-Za-z_$][\w$]*\(|\`[A-Za-z_$][\w$]*\`|\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b)`);

function contextNear(text: string, start: number, end: number): boolean {
  const from = Math.max(0, start - 96);
  const to = Math.min(text.length, end + 96);
  return CODE_CONTEXT.test(`${text.slice(from, start)} ${text.slice(end, to)}`);
}

function matched(text: string, families: readonly string[]): string[] {
  const allow = new Set(families);
  const hits: string[] = [];
  for (const cue of CUES) {
    if (!allow.has(cue.family)) continue;
    const re = new RegExp(cue.re.source, `${cue.re.flags}g`);
    let found = false;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (contextNear(text, m.index, m.index + m[0].length)) { found = true; break; }
      if (m[0].length === 0) break;
    }
    if (found) hits.push(cue.family);
  }
  return [...new Set(hits)];
}

/** Drop any family whose unique dev hits are not all that family. */
export function trainRequestModel(rows: readonly FamilyRow[]): RequestModel {
  let families = [...new Set(CUES.map((c) => c.family))];
  for (let pass = 0; pass < 3; pass++) {
    const wrong = new Set<string>();
    for (const row of rows) {
      if (heldOutRow(row.seq, row.asked) || SELF.has(row.skill)) continue;
      const hit = matched(row.asked, families);
      if (hit.length === 1 && hit[0] !== row.skill) wrong.add(hit[0]!);
    }
    if (wrong.size === 0) break;
    families = families.filter((f) => !wrong.has(f));
  }
  return { schema: REQUEST_FAMILY_SCHEMA, experimental: true, credit: false, families };
}

/**
 * A change to PeaceAI's own tooling. The words are the family's name and the tooling's own paths.
 * A characterization test or other edit cue still wins; this only speaks when no edit family matched.
 * The same cues are inlined in nlparse.ts (that module must not import this file).
 */
const SELF_CHANGE_TEXT: readonly RegExp[] = [
  /\bself[- ]changes?\b/i,
  /\bPEACEAI_SELF_CHANGE\b/,
  /\bbuilder-log\b/i,
  /\bteach PeaceAI\b/i,
  /\bnever-zone\b/i,
  /\bsafe zone\b/i,
  /\bapprove-rule\b/i,
  /\bpeaceai\/(?:bin|lib|rules|model)\//i,
  /\bpeaceai\/self\//i,
];

export function selfChangeRequest(asked: string): boolean {
  return SELF_CHANGE_TEXT.some((re) => re.test(asked));
}

export interface FamilyGuess { family: string | null; share: number; none: boolean; refusal?: "SELF_CHANGE" }

export function guessFamily(model: RequestModel, asked: string): FamilyGuess {
  const hit = matched(asked, model.families);
  if (hit.length === 1) return { family: hit[0]!, share: 1, none: false };
  if (hit.length === 0 && selfChangeRequest(asked)) return { family: null, share: 0, none: false, refusal: "SELF_CHANGE" };
  return { family: null, share: 0, none: false };
}

export interface FamilyScore { rows: number; correct: number; wrong: number; refused: number }

export function scoreFamilies(model: RequestModel, rows: readonly FamilyRow[], heldOut: boolean): FamilyScore {
  const score: FamilyScore = { rows: 0, correct: 0, wrong: 0, refused: 0 };
  for (const row of rows) {
    if (heldOutRow(row.seq, row.asked) !== heldOut || SELF.has(row.skill)) continue;
    score.rows++;
    const g = guessFamily(model, row.asked);
    if (!g.family) score.refused++;
    else if (g.family === row.skill) score.correct++;
    else score.wrong++;
  }
  return score;
}

/** Kept so callers can ask for a dev-chosen bar. Cue dropping already is that bar. */
export function thresholdOnDev(rows: readonly FamilyRow[]): number {
  trainRequestModel(rows);
  return 1;
}

const NAME = String.raw`[A-Za-z_$][\w$]{0,63}`;
const FILE = String.raw`[\w./-]+\.[cm]?[jt]sx?`;
const ENVNAME = String.raw`[A-Z][A-Z0-9_]{1,80}`;

/** A canonical Job A line, only when every slot is already written in the request. */
export function canonicalRequest(family: string, asked: string): string | null {
  if (family === "TEST_CASE_EXISTING") {
    const m = new RegExp(String.raw`characteri[sz]ation test for \`?(${NAME})\`? in \`?(${FILE})`, "i").exec(asked);
    if (!m) return null;
    const title = new RegExp(String.raw` in \`?${FILE}\`?: ([^#\n]{1,120}?)(?:\s+#|\s*$)`, "i").exec(asked);
    const base = `add a characterization test for ${m[1]} in ${m[2]}`;
    return title ? `${base}: ${title[1]!.trim()}` : base;
  }
  if (family === "ENV_FIX") {
    const m = new RegExp(String.raw`make (?:the )?env(?:ironment variable)? \`?(${ENVNAME})\`? strict in \`?(${FILE})\`? as (?:a |an )?(flag|integer 1\.\.(\d{1,9}))`, "i").exec(asked);
    if (!m) return null;
    const how = m[3]!.toLowerCase() === "flag" ? "a flag" : `integer 1..${m[4]}`;
    return `make env ${m[1]} strict in ${m[2]} as ${how}`;
  }
  return null;
}
