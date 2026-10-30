// M10: plain-language tasks. Turns task wording into a PeaceAI plan that the existing engines already run:
// one edit-family phrase, a multi-step `Step N:` plan, or an approved learned rule's trigger phrase.
// PeaceAI's own code only: deterministic slot grammars per edit family plus a small from-scratch naive Bayes
// classifier (peaceai/nl/model.json, trained by peaceai/bin/nl-train.ts on public task texts only) that
// decides between families and recognizes requests no family supports. No pretrained model of any kind.
//
// Fail closed. The parser answers `unsure` (and the task gets the supported phrasings, not a guess) when no
// family's grammar matches, when two families match and the classifier cannot separate them, when the
// classifier says the request is not an edit we support, when a learned rule is not approved, or when the
// rendered plan would contain any name, value or path that is not in the task text (no scope widening).
// A parsed plan is only text: it still goes through Job A's scope check, the gate, the sandboxed tests, the
// repair loop and the blind review exactly like a task written in the canonical phrasing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanIssueText } from "./taskmap.ts";
import { TEST_TRIGGER } from "./learned-test.ts";
import { TEST_EXISTING_TRIGGER } from "./learned-test-existing.ts";
import { EXISTING_EDIT_TRIGGER } from "./learned-edit-existing.ts";
import { DERIVE_APPEND_TRIGGER, DERIVE_LIST_TRIGGER, DERIVE_STRING_TRIGGER, DERIVE_TRIGGER } from "./learned-derive.ts";
import { DERIVE_WIRE_TRIGGER } from "./derive-wire.ts";
import { DERIVE_WIRE_LOOP_TRIGGER, DERIVE_WIRE_V2_TRIGGER } from "./derive-wire-v2.ts";
import { GUARD_TOP_TRIGGER, GUARD_TRIGGER } from "./learned-guard.ts";
import { METHOD_GUARD_TRIGGER } from "./method-guard.ts";
import { IMPORT_EDIT_V2_TRIGGER } from "./import-edit-v2.ts";
import { WORKFLOW_JOB_TRIGGER } from "./workflow-job.ts";
import { TSCONFIG_SCRIPT_TRIGGER } from "./tsconfig-script.ts";
import { ENV_FIX_TRIGGER } from "./env-fix.ts";
import { COMPLEX_TRIGGER, DATE_TRIGGER, LOOP_TRIGGER, WHILE_TRIGGER } from "./learned-complex.ts";
import { REPLACE_TRIGGER } from "./learned-body.ts";
import { FUNCTION_TRIGGER } from "./learned-function.ts";
import { WORKFLOW_TRIGGER } from "./learned-workflow.ts";

export const NL_SCHEMA = "peaceai-nl-model:v1";
export const FAMILIES = ["object-property", "guard", "array-item", "exported-constant", "try-catch", "union-member", "type-field", "set-literal", "switch-case", "nullish-default"] as const;
export type Family = (typeof FAMILIES)[number];
export type Label = Family | "none";
export const LABELS: readonly Label[] = [...FAMILIES, "none"];
/** Learned-rule families and the rule kind that must be on the approved list for the parser to use them. */
export const LEARNED_KIND: Partial<Record<Family, string>> = { "set-literal": "SET_LITERAL", "switch-case": "ADD_SWITCH_CASE", "nullish-default": "ADD_NULLISH_DEFAULT" };
export const MAX_PLAN_STEPS = 6;
/** Minimum share of the classifier's probability (among matching families) needed to pick one. */
export const MIN_SHARE = 0.8;
/** Above this, the classifier's `none` vote alone refuses even when a grammar matched. */
export const MAX_NONE = 0.9;

const LIT = String.raw`"(?:[^"\\\n]|\\.){0,200}"|'(?:[^'\\\n]|\\.){0,200}'|-?\d{1,15}(?:\.\d{1,15})?|true|false|null`;
const ID = String.raw`[A-Za-z_$][\w$]{0,63}`;
const FILE = String.raw`[\w./-]+\.tsx?`;
const TYPE = String.raw`(?:${ID}(?:\[\])?|"[^"\n]{0,40}"|'[^'\n]{0,40}')(?: ?\| ?(?:${ID}(?:\[\])?|"[^"\n]{0,40}"|'[^'\n]{0,40}'))*`;
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static await async the a an to of in it is".split(" "));

// ---- canonical phrasings (what the engines already accept; a task containing one is left unchanged)

const PLAIN_CANONICAL: readonly RegExp[] = [
  new RegExp(String.raw`\badd (?:a |an |the )?(?:property|key|entry|field) ${ID} with (?:the )?value (?:${LIT}) to (?:the )?(?:object |config |constant )?${ID}\b`, "iu"),
  new RegExp(String.raw`\badd (?:a |an )?(?:guard(?: clause)?|early return) to (?:the )?(?:function )?${ID} that returns (?:${LIT}) (?:when|if) (?:the )?(?:parameter )?${ID} is (?:empty|blank|null|undefined|missing|negative|zero|not finite|nan)\b`, "iu"),
  new RegExp(String.raw`\badd (?:the (?:value|item) )?(?:${LIT}) to (?:the )?(?:array|list) ${ID}\b`, "iu"),
  new RegExp(String.raw`\badd (?:an |a )?exported constant ${ID} (?:with (?:the )?value|set to|equal to|=) (?:${LIT})`, "iu"),
  new RegExp(String.raw`\bwrap (?:the body of )?(?:the )?(?:function )?${ID} in (?:a )?try[ /-]?catch(?: block)? that returns (?:${LIT}) on (?:any )?(?:error|failure|exception)\b`, "iu"),
  new RegExp(String.raw`\badd (?:the (?:value|member) )?(?:${LIT}) to (?:the )?union(?: type)? ${ID}\b`, "iu"),
  new RegExp(String.raw`\badd (?:an? )?(?:optional )?(?:field|property|member) ${ID} of type [A-Za-z_$][\w$<>\[\]| ,"'.-]{0,80}? to (?:the )?(?:object )?type ${ID}\b`, "iu"),
  // M9 gap-fill template, kernel-native helper and rename tasks.
  /\badd (?:an |a )?exported (?:constant|const) `?[A-Z][A-Z0-9_]{1,40}`?(?: of type (?:string|number|boolean))? (?:to|in) `?[A-Za-z0-9_./-]+\.tsx?`?/i,
  /\badd (?:a |an )?helper\b/i,
  /\brename (?:the )?(?:symbol |function |const(?:ant)? |type )?[A-Za-z_$][\w$]* to [A-Za-z_$][\w$]*/i,
];
/**
 * Learned-rule triggers (line-anchored, as the rule engine reads them), keyed by name. Each entry carries the rule kind
 * that must be approved before its wording counts as canonical. M75: keyed by name instead of length-N indexing, so
 * adding a trigger can never shift another trigger's kind.
 */
export const LEARNED_CANONICAL = {
  // M8 learned-rule triggers (line-anchored, as the rule engine reads them).
  setLiteral: { re: new RegExp(String.raw`^(?:set|change|update) (?:the )?(?:value of )?${ID}(?: in ${FILE})? to (?:"[^"\n]*"|'[^'\n]*'|-?\d+(?:\.\d+)?|true|false)\.?$`, "imu"), kind: "SET_LITERAL", family: "set-literal" },
  switchCase: { re: new RegExp(String.raw`^add (?:a )?case (?:"[^"\n]+"|'[^'\n]+') (?:returning|that returns) (?:${LIT}) to (?:the )?switch in ${ID}(?: in ${FILE})?\.?$`, "imu"), kind: "ADD_SWITCH_CASE", family: "switch-case" },
  nullishDefault: { re: new RegExp(String.raw`^default ${ID}(?:\.${ID})+ to (?:\[\]|null|"[^"\n]*"|'[^'\n]*'|-?\d+(?:\.\d+)?|true|false) in ${ID}(?: in ${FILE})?\.?$`, "imu"), kind: "ADD_NULLISH_DEFAULT", family: "nullish-default" },
  // M12: the ADD_TEST_CASE rule's header line (its own trigger; the checks and the fix line follow it).
  testCase: { re: new RegExp(TEST_TRIGGER, "imu"), kind: "ADD_TEST_CASE", family: null },
  // M13: the ADD_THROW_GUARD rule's header line (its test bullets follow it).
  throwGuard: { re: new RegExp(GUARD_TRIGGER, "imu"), kind: "ADD_THROW_GUARD", family: null },
  // M15: the ADD_FUNCTION rule's header line (its test bullets follow it).
  addFunction: { re: new RegExp(FUNCTION_TRIGGER, "imu"), kind: "ADD_FUNCTION", family: null },
  // M19: the ADD_WORKFLOW_STEP rule's header line.
  workflowStep: { re: new RegExp(WORKFLOW_TRIGGER, "imu"), kind: "ADD_WORKFLOW_STEP", family: null },
  // M27: the REPLACE_EXPRESSION rule's header line (its test bullets follow it).
  replaceExpression: { re: new RegExp(REPLACE_TRIGGER, "imu"), kind: "REPLACE_EXPRESSION", family: null },
  // M57: the ADD_THROW_GUARD function-top header line (public-throw-guard-top-v1, approved in #185).
  throwGuardTop: { re: new RegExp(GUARD_TOP_TRIGGER, "imu"), kind: "ADD_THROW_GUARD", family: null },
  // M62: METHOD_GUARD (method call in the condition; distinct phrase).
  methodGuard: { re: new RegExp(METHOD_GUARD_TRIGGER, "imu"), kind: "METHOD_GUARD", family: null },
  // M26 wiring: COMPLEX_FUNCTION header line ("add complex function ... with body:"); canonical form only.
  complexFunction: { re: new RegExp(COMPLEX_TRIGGER, "imu"), kind: "COMPLEX_FUNCTION", family: null },
  // M64: LOOP_FUNCTION header line ("add loop function ... with body:"), public-loop-function-v1 (kind COMPLEX_FUNCTION).
  loopFunction: { re: new RegExp(LOOP_TRIGGER, "imu"), kind: "COMPLEX_FUNCTION", family: null },
  // M66: IMPORT_EDIT v2 header line ("change import of SPEC in FILE to: import ..."); canonical form only.
  importEditV2: { re: new RegExp(IMPORT_EDIT_V2_TRIGGER, "imu"), kind: "IMPORT_EDIT_V2", family: null },
  // M67 un-drop batch: LOOP_WHILE (kind COMPLEX_FUNCTION), WORKFLOW_JOB, TSCONFIG_SCRIPT, ENV_FIX header lines; canonical form only.
  loopWhile: { re: new RegExp(WHILE_TRIGGER, "imu"), kind: "COMPLEX_FUNCTION", family: null },
  workflowJob: { re: new RegExp(WORKFLOW_JOB_TRIGGER, "imu"), kind: "WORKFLOW_JOB", family: null },
  tsconfigScript: { re: new RegExp(TSCONFIG_SCRIPT_TRIGGER, "imu"), kind: "TSCONFIG_SCRIPT", family: null },
  envFix: { re: new RegExp(ENV_FIX_TRIGGER, "imu"), kind: "ENV_FIX", family: null },
  // M74: DATE family header line ("add date function ... with body:"), public-date-function-v1 (kind COMPLEX_FUNCTION).
  dateFunction: { re: new RegExp(DATE_TRIGGER, "imu"), kind: "COMPLEX_FUNCTION", family: null },
  // M80: TEST_CASE_EXISTING header line ("add a characterization test for ..."), public-test-case-existing-v1 (kind TEST_EXISTING).
  testExisting: { re: new RegExp(TEST_EXISTING_TRIGGER, "imu"), kind: "TEST_EXISTING", family: null },
  // M98: EXISTING_EDIT header line ("in T in src/f.ts: replace statement OLD with NEW"), public-existing-function-edit-v1.
  existingEdit: { re: new RegExp(EXISTING_EDIT_TRIGGER, "imu"), kind: "EXISTING_EDIT", family: null },
  // M99: DERIVE_FROM_BEHAVIOR header line ("add a new module src/x.ts exporting name(a: T): R"), public-derive-from-behavior-v1.
  deriveFromBehavior: { re: new RegExp(DERIVE_TRIGGER, "imu"), kind: "DERIVE_FROM_BEHAVIOR", family: null },
  // M112: public-derive-from-behavior-v3 appends the derived function to an existing module (its own phrasing).
  deriveAppend: { re: new RegExp(DERIVE_APPEND_TRIGGER, "imu"), kind: "DERIVE_FROM_BEHAVIOR", family: null },
  // M113: public-derive-from-behavior-v4, a function over a list (either header phrasing, a `T[]` parameter).
  deriveList: { re: new RegExp(DERIVE_LIST_TRIGGER, "imu"), kind: "DERIVE_FROM_BEHAVIOR", family: null },
  // M114: public-derive-from-behavior-v5, a string parser (its own "string parser" phrasing, either placement).
  deriveString: { re: new RegExp(DERIVE_STRING_TRIGGER, "imu"), kind: "DERIVE_FROM_BEHAVIOR", family: null },
  // G18: public-derive-wire-v1 (kind EXISTING_EDIT) derives a try / catch wrap ("in the existing function f in src/x.ts, handle a failing call").
  deriveWire: { re: new RegExp(DERIVE_WIRE_TRIGGER, "imu"), kind: "EXISTING_EDIT", family: null },
  // G18 v2: public-derive-wire-v2 (kind EXISTING_EDIT) derives a bounded retry ("..., retry a failing call") or a
  // filtered, recorded skip in a loop ("..., record a failing call and go on").
  deriveWire2: { re: new RegExp(DERIVE_WIRE_V2_TRIGGER, "imu"), kind: "EXISTING_EDIT", family: null },
  // G28: public-derive-wire-loop-v1 (kind EXISTING_EDIT) derives a new module that goes over a list ("add a new module
  // src/x.ts exporting async f(list: string[], c: { m(..): Promise<T> }) that returns the R and an E list of { .. }").
  deriveWireLoop: { re: new RegExp(DERIVE_WIRE_LOOP_TRIGGER, "imu"), kind: "EXISTING_EDIT", family: null },
} as const satisfies Record<string, { re: RegExp; kind: string; family: Family | null }>;
export type LearnedTriggerName = keyof typeof LEARNED_CANONICAL;
const CANONICAL: readonly RegExp[] = [...PLAIN_CANONICAL, ...Object.values(LEARNED_CANONICAL).map((t) => t.re)];
// Numbered plan lines ("Step 2: ...", "2. ...", "2) ..."), read the same way the planner reads them.
const STEP_WORD = /^step\s*\d{1,2}\s*[-:.)]\s*/iu;
const STEP_NUM = /^\d{1,2}\s*[.)]\s*/u;
function stepBodies(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[ \t]+/, "");
    const head = STEP_WORD.exec(line) ?? STEP_NUM.exec(line);
    if (!head) continue;
    const body = line.slice(head[0].length);
    if (/^\S/u.test(body)) out.push(body);
  }
  return out;
}

/** True when the text already uses a supported phrasing (or a numbered plan whose steps all do). */
export function isCanonical(text: string): boolean {
  const steps = stepBodies(text);
  if (steps.length >= 2) return steps.every((s) => TEST_ONLY.test(s.trim()) || CANONICAL.some((r) => r.test(s.trim())));
  return CANONICAL.some((r) => r.test(text));
}

// ---- plain-language grammars: each returns slots, rendered into the canonical phrase

type Slots = Record<string, string>;
interface Grammar { family: Family; patterns: RegExp[]; render: (s: Slots) => string | null }
const r = (src: string) => new RegExp(`^(?:please |can you |could you |we need to |i want to |let's |lets )?${src}[.!]?$`, "iu");
const COND: Record<string, string> = {
  empty: "empty", "an empty string": "empty", "the empty string": "empty", blank: "blank", "only whitespace": "blank", null: "null", undefined: "undefined",
  missing: "missing", "not provided": "missing", "not given": "missing", negative: "negative", "below zero": "negative", "less than zero": "negative", "less than 0": "negative",
  zero: "zero", "0": "zero", "not finite": "not finite", infinite: "not finite", nan: "nan", "not a number": "nan",
};
const CONDS = Object.keys(COND).sort((a, b) => b.length - a.length).map((c) => c.replace(/ /g, " ")).join("|");
const ERR = String.raw`(?:on |if |when |for )?(?:any |an |a )?(?:error|errors|failure|exception|exceptions|it throws|anything throws|something throws|it fails)(?: occurs| happens| is thrown)?`;
const TESTS = String.raw`(?:,? (?:and |with |plus )(?:add |write |include )?(?:a |an |some |focused |unit )*tests?(?: for it)?)?`;

const GRAMMARS: Grammar[] = [
  {
    family: "array-item",
    patterns: [
      r(String.raw`(?:add|append|include|put|push|insert) (?:the )?(?:value |item |entry |string |number )?(?<value>${LIT}) (?:to|into|onto|in) (?:the )?(?:end of (?:the )?)?(?:(?:array|list) )?(?<name>${ID})(?: (?:array|list))?${TESTS}`),
      r(String.raw`(?:the )?(?:array |list )?(?<name>${ID})(?: (?:array|list))? (?:should|must|needs to) (?:also )?(?:include|contain|have) (?<value>${LIT})${TESTS}`),
      r(String.raw`(?:make|let) (?:the )?(?:array |list )?(?<name>${ID}) (?:also )?(?:include|contain) (?<value>${LIT})${TESTS}`),
    ],
    render: (s) => `Add ${s.value} to the array ${s.name}`,
  },
  {
    family: "union-member",
    patterns: [
      r(String.raw`(?:add|allow|include|accept) (?:the )?(?:value |member |variant |option )?(?<value>${LIT}) (?:to|in|into) (?:the )?(?:union(?: type)? |type |enum-like type )?(?<name>${ID})(?: (?:union|type))?${TESTS}`),
      r(String.raw`(?:add|allow) (?<value>${LIT}) as (?:a |an )?(?:new |another )?(?:option|member|variant|value|kind) (?:of|for|in) (?:the )?(?:union(?: type)? |type )?(?<name>${ID})${TESTS}`),
      r(String.raw`(?:let|make) (?:the )?(?:union |type )?(?<name>${ID}) (?:also )?(?:accept|allow|include) (?<value>${LIT})${TESTS}`),
      r(String.raw`(?:the )?(?:type |union )?(?<name>${ID}) (?:should|must) (?:also )?(?:accept|allow) (?<value>${LIT})${TESTS}`),
    ],
    render: (s) => (/^["']/.test(s.value!) ? `Add ${s.value} to the union type ${s.name}` : null),
  },
  {
    family: "object-property",
    patterns: [
      r(String.raw`(?:add|put|give|set) (?:a |an |the )?(?:new )?(?:property |key |entry |setting |option )?(?<key>${ID}) (?:of|with (?:the )?value|=|:|set to|equal to|as) (?<value>${LIT}) (?:to|in|on|into) (?:the )?(?:object |config |constant |settings )?(?<name>${ID})(?: object)?${TESTS}`),
      r(String.raw`(?:give|add to) (?:the )?(?:object )?(?<name>${ID})(?: object)? (?:a |an )?(?:new )?(?:property|key|entry|setting) (?<key>${ID}) (?:of|with (?:the )?value|=|set to|equal to) (?<value>${LIT})${TESTS}`),
      r(String.raw`(?:the )?(?:object )?(?<name>${ID}) (?:should|needs to) (?:have|get) (?:a |an )?(?:new )?(?:property|key|entry|setting) (?<key>${ID}) (?:of|with (?:the )?value|=|set to|equal to) (?<value>${LIT})${TESTS}`),
    ],
    render: (s) => `Add property ${s.key} with value ${s.value} to object ${s.name}`,
  },
  {
    family: "type-field",
    patterns: [
      r(String.raw`(?:add|give|declare) (?:an? )?(?<opt>optional )?(?:new )?(?:field|property|member|prop) (?<field>${ID}) (?:of type|typed as|typed|with type|:) (?<type>${TYPE}) (?:to|on|in) (?:the )?(?:object )?(?:type |interface )?(?<name>${ID})(?: type| interface)?(?<opt2>,? (?:and )?(?:make it |mark it |it is |it's )?optional)?${TESTS}`),
      r(String.raw`(?:give|add to) (?:the )?(?:type |interface )?(?<name>${ID})(?: type| interface)? (?:an? )?(?<opt>optional )?(?:new )?(?:field|property|member) (?<field>${ID}) (?:of type|typed as|typed|with type|:) (?<type>${TYPE})${TESTS}`),
      r(String.raw`(?:the )?(?:type |interface )?(?<name>${ID}) (?:should|needs to) (?:have|get) (?:an? )?(?<opt>optional )?(?:field|property|member) (?<field>${ID}) (?:of type|typed as|typed|:) (?<type>${TYPE})${TESTS}`),
    ],
    render: (s) => `Add ${s.opt || s.opt2 ? "an optional" : "a"} field ${s.field} of type ${s.type} to type ${s.name}`,
  },
  {
    family: "exported-constant",
    patterns: [
      r(String.raw`(?:add|create|define|introduce|export|declare) (?:a |an |the )?(?:new )?(?:exported )?(?:constant|const|config value|setting) (?:called |named )?(?<name>${ID}) (?:with (?:the )?value|set to|equal to|=|of|as) (?<value>${LIT}) (?:to|in|into|from) (?:the file )?(?<file>${FILE})${TESTS}`),
      r(String.raw`in (?<file>${FILE}),? (?:add|create|define|introduce|export|declare) (?:a |an |the )?(?:new )?(?:exported )?(?:constant|const|config value|setting) (?:called |named )?(?<name>${ID}) (?:with (?:the )?value|set to|equal to|=|of|as) (?<value>${LIT})${TESTS}`),
      r(String.raw`(?:export|add) (?<name>${ID}) ?= ?(?<value>${LIT}) (?:from|to|in) (?<file>${FILE})${TESTS}`),
    ],
    render: (s) => `Add an exported constant ${s.name} with value ${s.value} to ${s.file}`,
  },
  {
    family: "guard",
    patterns: [
      r(String.raw`(?:make|have) (?:the function )?(?<fn>${ID}) (?:immediately |just |simply )?return (?<value>${LIT}) (?:early )?(?:when|if) (?:the )?(?:parameter |argument |input )?(?<param>${ID}) is (?<cond>${CONDS})${TESTS}`),
      r(String.raw`(?:if|when) (?:the )?(?:parameter |argument |input )?(?<param>${ID}) is (?<cond>${CONDS}),? (?:the function )?(?<fn>${ID}) should (?:just |simply |immediately )?return (?<value>${LIT})${TESTS}`),
      r(String.raw`(?:add|put) (?:a |an )?(?:guard|check|early return|early exit)(?: clause)? (?:to|in|at the top of) (?:the )?(?:function )?(?<fn>${ID}) (?:so (?:that )?it |that |to |which )?(?:returns?) (?<value>${LIT}) (?:when|if) (?:the )?(?:parameter |argument |input )?(?<param>${ID}) is (?<cond>${CONDS})${TESTS}`),
      r(String.raw`(?:the function )?(?<fn>${ID}) should (?:just |simply |immediately )?return (?<value>${LIT}) (?:when|if) (?:the )?(?:parameter |argument |input )?(?<param>${ID}) is (?<cond>${CONDS})${TESTS}`),
    ],
    render: (s) => `Add a guard to ${s.fn} that returns ${s.value} when ${s.param} is ${COND[s.cond!.toLowerCase()]}`,
  },
  {
    family: "try-catch",
    patterns: [
      r(String.raw`(?:wrap|surround|put) (?:the body of )?(?:the )?(?:function )?(?<fn>${ID})(?:'s body)? (?:in|with) (?:a )?try[ /-]?catch(?: block)?,? (?:that |which |and |to )?(?:returns?|return) (?<value>${LIT}) ${ERR}${TESTS}`),
      r(String.raw`(?:make|have) (?:the function )?(?<fn>${ID}) return (?<value>${LIT}) ${ERR}${TESTS}`),
      r(String.raw`(?:catch|handle) (?:any |all )?(?:errors|exceptions|failures) in (?:the function )?(?<fn>${ID}) and return (?<value>${LIT})(?: instead)?${TESTS}`),
      r(String.raw`(?:the function )?(?<fn>${ID}) should return (?<value>${LIT}) (?:instead of throwing|${ERR})${TESTS}`),
    ],
    render: (s) => `Wrap the body of ${s.fn} in try/catch that returns ${s.value} on error`,
  },
  {
    family: "set-literal",
    patterns: [
      r(String.raw`(?:change|set|update|make) (?:the )?(?:value of )?(?<name>${ID})(?: in (?<file>${FILE}))? (?:to|=|be|equal to) (?<value>"[^"\n]*"|'[^'\n]*'|-?\d+(?:\.\d+)?|true|false)`),
      r(String.raw`(?:in (?<file>${FILE}),? )?(?<name>${ID}) should be (?<value>"[^"\n]*"|'[^'\n]*'|-?\d+(?:\.\d+)?|true|false)(?: instead)?(?: in (?<file2>${FILE}))?`),
    ],
    render: (s) => `set ${s.name}${s.file || s.file2 ? ` in ${s.file || s.file2}` : ""} to ${s.value}`,
  },
  {
    family: "switch-case",
    patterns: [
      r(String.raw`(?:handle|add|support) (?:the )?(?:case )?(?<label>"[^"\n]+"|'[^'\n]+') in (?:the )?switch (?:in|of|inside) (?<fn>${ID}) (?:and |by |to )?return(?:ing)? (?<value>${LIT})`),
      r(String.raw`(?:make )?(?<fn>${ID}) (?:should )?return (?<value>${LIT}) for (?:the case )?(?<label>"[^"\n]+"|'[^'\n]+')(?: in its switch)?`),
    ],
    render: (s) => `add case ${s.label} returning ${s.value} to the switch in ${s.fn}`,
  },
  {
    family: "nullish-default",
    patterns: [
      r(String.raw`(?:default|fall back) (?<expr>${ID}(?:\.${ID})+) to (?<value>\[\]|${LIT}) in (?<fn>${ID})`),
      r(String.raw`(?:use|make) (?<value>\[\]|${LIT}) (?:as )?(?:the )?(?:default|fallback) (?:for|of) (?<expr>${ID}(?:\.${ID})+) in (?<fn>${ID})`),
      r(String.raw`in (?<fn>${ID}),? (?:default|fall back) (?<expr>${ID}(?:\.${ID})+) to (?<value>\[\]|${LIT})`),
    ],
    render: (s) => `default ${s.expr} to ${s.value} in ${s.fn}`,
  },
];

// ---- the classifier (multinomial naive Bayes over masked word uni/bigrams)

export interface NbModel { schema: string; labels: Label[]; docs: Record<string, number>; tokens: Record<string, number>; counts: Record<string, Record<string, number>>; vocab: number }

/** Masks names, literals and paths so the classifier learns phrasing, not identifiers. */
export function features(text: string): string[] {
  const t = text
    .replace(/[\w./-]+\.tsx?\b/g, " PATHTOK ")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, " STRTOK ")
    .replace(/\b-?\d+(?:\.\d+)?\b/g, " NUMTOK ")
    .replace(/\[\]/g, " ARRTOK ")
    .replace(/\b(?=[A-Za-z_$]*[A-Z_$])(?![A-Z][a-z]+\b)[A-Za-z_$][\w$]*\b/g, (m) => (/^(PATHTOK|STRTOK|NUMTOK|ARRTOK)$/.test(m) ? m : " IDTOK "))
    .toLowerCase()
    .replace(/[^a-z0-9_ ]+/g, " ");
  const words = t.split(/\s+/).filter(Boolean);
  const out = words.map((w) => `u:${w}`);
  for (let i = 0; i + 1 < words.length; i += 1) out.push(`b:${words[i]}_${words[i + 1]}`);
  return out;
}

export function trainNb(examples: readonly { text: string; label: Label }[], keep: (feature: string) => boolean = () => true): NbModel {
  const m: NbModel = { schema: NL_SCHEMA, labels: [...LABELS], docs: {}, tokens: {}, counts: {}, vocab: 0 };
  const vocab = new Set<string>();
  for (const l of LABELS) { m.docs[l] = 0; m.tokens[l] = 0; m.counts[l] = {}; }
  for (const e of examples) {
    m.docs[e.label]! += 1;
    for (const f of features(e.text)) {
      if (!keep(f)) continue;
      m.counts[e.label]![f] = (m.counts[e.label]![f] ?? 0) + 1; m.tokens[e.label]! += 1; vocab.add(f);
    }
  }
  m.vocab = vocab.size;
  // Deterministic file: sorted keys.
  for (const l of LABELS) m.counts[l] = Object.fromEntries(Object.entries(m.counts[l]!).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return m;
}

export function classify(model: NbModel, text: string): Record<Label, number> {
  const fs = features(text);
  const total = Object.values(model.docs).reduce((a, b) => a + b, 0);
  const logp: Record<string, number> = {};
  for (const l of model.labels) {
    let s = Math.log((model.docs[l]! + 1) / (total + model.labels.length));
    for (const f of fs) s += Math.log(((model.counts[l]![f] ?? 0) + 1) / (model.tokens[l]! + model.vocab + 1));
    logp[l] = s;
  }
  const max = Math.max(...Object.values(logp));
  const z = Object.values(logp).reduce((a, v) => a + Math.exp(v - max), 0);
  return Object.fromEntries(model.labels.map((l) => [l, Math.exp(logp[l]! - max) / z])) as Record<Label, number>;
}

let cached: NbModel | null = null;
export function loadModel(path = join(import.meta.dirname, "../nl/model.json")): NbModel | null {
  if (cached) return cached;
  try {
    const m = JSON.parse(readFileSync(path, "utf8"));
    if (m.schema !== NL_SCHEMA || !Array.isArray(m.labels)) return null;
    return (cached = m);
  } catch { return null; }
}

/** Labeled examples, one JSON object per line: {label, text, expect?}. */
export type EvalLabel = Label | "plan" | "ambiguous";
export function readJsonl(path: string, evalLabels = false): { text: string; label: EvalLabel; expect?: string }[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).map((e) => {
    if (typeof e.text !== "string" || !(LABELS.includes(e.label) || (evalLabels && (e.label === "plan" || e.label === "ambiguous")))) throw new Error(`bad example in ${path}`);
    return { text: e.text, label: e.label, ...(typeof e.expect === "string" ? { expect: e.expect } : {}) };
  });
}

// ---- parsing

export type Refusal = "EMPTY" | "NO_MODEL" | "NO_FAMILY" | "AMBIGUOUS" | "NOT_SUPPORTED" | "RULE_NOT_APPROVED" | "WIDENS" | "PARTIAL_PLAN" | "TOO_MANY_STEPS" | "BAD_VALUE";
export type ParseResult =
  | { status: "canonical"; objective: string }
  | { status: "parsed"; objective: string; steps: { family: Family; text: string }[]; withTests: boolean }
  | { status: "unsure"; reason: Refusal; hint: Family | null };

export interface ParseOptions { model: NbModel | null; approvedKinds: ReadonlySet<string> }

// M12: ADD_TEST_CASE has no plain-language family (family null): it is only accepted in its canonical form.
const LEARNED_TRIGGERS: readonly { name: LearnedTriggerName; re: RegExp; kind: string; family: Family | null }[] = (Object.keys(LEARNED_CANONICAL) as LearnedTriggerName[]).map((name) => ({ name, ...LEARNED_CANONICAL[name] }));

const TEST_ONLY = /^(?:then |and |also |finally )?(?:add|write|include) (?:a |an |some |focused |unit )*tests?\b[^.]*\.?$/iu;

/** Splits plain wording into clauses: numbered/bulleted lines, sentences, "then", ";". */
export function clauses(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const listed = lines.filter((l) => /^(?:[-*•]|\d{1,2}[.)]|step \d{1,2}[:.)-]?)\s+/i.test(l));
  const units = listed.length >= 2 ? listed.map((l) => l.replace(/^(?:[-*•]|\d{1,2}[.)]|step \d{1,2}[:.)-]?)\s+/i, "")) : [lines.join(" ")];
  const out: string[] = [];
  for (const u of units)
    for (const piece of u.split(/(?<=[.!?])\s+(?=[A-Z])|;\s*|,?\s+(?:and then|then|after that|afterwards|next,|finally,?|also,)\s+(?=\S)/)) {
      const t = piece.trim().replace(/^(?:and then|then|after that|afterwards|next|finally|also),?\s+/i, "").replace(/[.!]+$/, "");
      if (t) out.push(t);
    }
  return out;
}

function matchClause(clause: string): { family: Family; slots: Slots; withTests: boolean }[] {
  const found: { family: Family; slots: Slots; withTests: boolean }[] = [];
  for (const g of GRAMMARS) {
    for (const p of g.patterns) {
      const m = p.exec(clause);
      if (!m) continue;
      const slots = Object.fromEntries(Object.entries(m.groups ?? {}).filter(([, v]) => v !== undefined)) as Slots;
      if (Object.entries(slots).some(([k, v]) => ["name", "fn", "param", "key", "field"].includes(k) && RESERVED.has(v.toLowerCase()))) continue;
      found.push({ family: g.family, slots, withTests: /\btests?\b/i.test(clause) });
      break;
    }
  }
  return found;
}

/** Every name, literal and path in the plan must appear in the task text (a parse can never add a target). */
export function widens(input: string, output: string): boolean {
  const atoms = (s: string) => new Set([...(s.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[\w./-]+\.tsx?\b|[A-Za-z_$][\w$]*|-?\d+(?:\.\d+)?/g) ?? [])]);
  const template = new Set("add a an the to with value property object guard that returns when is array exported constant wrap body of in try catch on error union type optional field set case returning switch default step test focused tests empty blank null undefined missing negative zero not finite nan true false".split(" "));
  const inAtoms = atoms(input);
  const lowerIn = new Set([...inAtoms].map((a) => a.toLowerCase()));
  for (const a of atoms(output.replace(/^Step \d{1,2}: /gm, ""))) {
    if (template.has(a.toLowerCase())) continue;
    if (!inAtoms.has(a) && !lowerIn.has(a.toLowerCase())) return true;
  }
  return false;
}

function decide(clause: string, opts: ParseOptions): { family: Family; text: string; withTests: boolean } | { refuse: Refusal; hint: Family | null } {
  const probs = opts.model ? classify(opts.model, clause) : null;
  const top = probs ? (Object.entries(probs).sort((a, b) => b[1] - a[1])[0]![0] as Label) : null;
  const hint = top && top !== "none" ? (top as Family) : null;
  if (!probs) return { refuse: "NO_MODEL", hint: null };
  const matches = matchClause(clause);
  if (matches.length === 0) return { refuse: probs.none >= 0.5 ? "NOT_SUPPORTED" : "NO_FAMILY", hint };
  if (probs.none >= MAX_NONE) return { refuse: "NOT_SUPPORTED", hint };
  const mass = matches.reduce((a, m) => a + probs[m.family], 0);
  const best = [...matches].sort((a, b) => probs[b.family] - probs[a.family])[0]!;
  if (mass <= 0 || probs[best.family] / mass < MIN_SHARE) return { refuse: "AMBIGUOUS", hint: best.family };
  // With a single matching grammar the classifier must still lean towards it over the other families.
  if (matches.length === 1 && top !== best.family && probs[best.family] < 0.2) return { refuse: "AMBIGUOUS", hint: best.family };
  const kind = LEARNED_KIND[best.family];
  if (kind && !opts.approvedKinds.has(kind)) return { refuse: "RULE_NOT_APPROVED", hint: best.family };
  const text = GRAMMARS.find((g) => g.family === best.family)!.render(best.slots);
  if (!text) return { refuse: "BAD_VALUE", hint: best.family };
  return { family: best.family, text, withTests: best.withTests };
}

/** Parse a task (title and body). Canonical text passes through unchanged; anything unclear is refused. */
export function parseTask(task: { title: string; body: string }, opts: ParseOptions): ParseResult {
  const full = `${task.title}\n\n${task.body}`.trim();
  if (!full) return { status: "unsure", reason: "EMPTY", hint: null };
  if (isCanonical(full)) {
    // A learned-rule trigger is only canonical once that rule is approved; otherwise say so instead.
    const learned = LEARNED_TRIGGERS.find((t) => t.re.test(full.split("\n").map((l) => l.trim()).filter(Boolean).join("\n")) || full.split("\n").some((l) => t.re.test(l.trim())));
    const other = PLAIN_CANONICAL.some((re) => re.test(full));
    if (learned && !other && !opts.approvedKinds.has(learned.kind)) return { status: "unsure", reason: "RULE_NOT_APPROVED", hint: learned.family };
    return { status: "canonical", objective: full };
  }
  // The body is the task; a title alone counts when there is no body. "[test] ..." markers are not wording.
  const source = (task.body.trim() || task.title).replace(/^\s*\[test\][^\n]*?(?::|\n|$)/i, (m) => (task.body.trim() ? m : "")).replace(/^\s*\[test\]\s*/i, "").trim();
  const parts = clauses(source);
  if (parts.length === 0) return { status: "unsure", reason: "EMPTY", hint: null };
  const steps: { family: Family; text: string }[] = [];
  let withTests = false;
  const testAfter: boolean[] = [];
  for (const c of parts) {
    if (TEST_ONLY.test(c)) { if (steps.length === 0) return { status: "unsure", reason: "PARTIAL_PLAN", hint: null }; testAfter[steps.length - 1] = true; withTests = true; continue; }
    const d = decide(c, opts);
    if ("refuse" in d) return { status: "unsure", reason: parts.length > 1 && steps.length > 0 ? "PARTIAL_PLAN" : d.refuse, hint: d.hint };
    steps.push({ family: d.family, text: d.text });
    if (d.withTests) { testAfter[steps.length - 1] = true; withTests = true; }
  }
  if (steps.length > MAX_PLAN_STEPS) return { status: "unsure", reason: "TOO_MANY_STEPS", hint: null };
  // Learned rules run only as single-step tasks (the multi-step planner executes edit families only).
  if (steps.length > 1 && steps.some((s) => LEARNED_KIND[s.family])) return { status: "unsure", reason: "PARTIAL_PLAN", hint: steps.find((s) => LEARNED_KIND[s.family])!.family };
  let objective: string;
  if (steps.length === 1) objective = LEARNED_KIND[steps[0]!.family] ? steps[0]!.text : `${steps[0]!.text}${withTests ? ", with focused tests." : ""}`;
  else {
    const lines: string[] = [];
    steps.forEach((s, i) => { lines.push(s.text); if (testAfter[i]) lines.push("add a test"); });
    objective = lines.map((l, i) => `Step ${i + 1}: ${l}`).join("\n");
  }
  if (widens(source, objective)) return { status: "unsure", reason: "WIDENS", hint: null };
  // The rendered plan must itself be canonical, so the engines read it exactly as written.
  if (!isCanonical(objective)) return { status: "unsure", reason: "BAD_VALUE", hint: steps[0]?.family ?? null };
  return { status: "parsed", objective, steps, withTests };
}

// ---- the refusal comment (fixed text only: no task text, no code)

export const PHRASINGS: Record<Family, string> = {
  "object-property": "Add property timeoutMs with value 3000 to object LIMITS",
  guard: "Add a guard to parseQuantity that returns 0 when raw is empty",
  "array-item": 'Add "pdf" to the array EXPORT_KINDS',
  "exported-constant": "Add an exported constant MAX_PAGES with value 50 to src/config.ts",
  "try-catch": "Wrap the body of readProfile in try/catch that returns null on error",
  "union-member": 'Add "critical" to the union type Severity',
  "type-field": "Add an optional field email of type string to type Profile",
  "set-literal": 'set NAME in src/file.ts to VALUE (learned rule; runs only once approved)',
  "switch-case": 'add case "label" returning VALUE to the switch in fn (learned rule; runs only once approved)',
  "nullish-default": "default obj.field to VALUE in fn (learned rule; runs only once approved)",
};
const REASON_TEXT: Record<Refusal, string> = {
  EMPTY: "The task has no wording to parse.",
  NO_MODEL: "The task parser's model is missing, so nothing was guessed.",
  NO_FAMILY: "PeaceAI couldn't match this wording to an edit it can make.",
  AMBIGUOUS: "This wording fits more than one kind of edit, so PeaceAI didn't guess.",
  NOT_SUPPORTED: "This doesn't look like one of the small edits PeaceAI can make yet.",
  RULE_NOT_APPROVED: "This wording maps to a learned rule that isn't approved yet.",
  WIDENS: "The parsed plan would name something the task doesn't, so it was refused.",
  PARTIAL_PLAN: "At least one step couldn't be parsed, and a partial plan is never run.",
  TOO_MANY_STEPS: `Plans can have at most ${MAX_PLAN_STEPS} steps.`,
  BAD_VALUE: "A value in the task doesn't fit the edit it asks for.",
};
/** The comment posted when the parser is unsure. Fixed strings and the static phrasing list only. */
export function refusalComment(reason: Refusal, hint: Family | null): string {
  const order = hint ? [hint, ...FAMILIES.filter((f) => f !== hint)] : [...FAMILIES];
  return [
    `PeaceAI didn't run this task. ${REASON_TEXT[reason]} (parse: ${reason.toLowerCase()})`,
    "",
    "Reword it in one of these shapes (names must already exist; values are literals):",
    "",
    ...order.map((f) => `- ${PHRASINGS[f]}`),
    "",
    "For several edits, use numbered lines (`Step 1: ...`, `Step 2: ...`, optionally `Step 3: add a test`). Add `, with focused tests.` to ask for a test.",
  ].join("\n");
}
export const isRefusal = (s: string): s is Refusal => Object.prototype.hasOwnProperty.call(REASON_TEXT, s);

// ---- Job A entry point

export type NlDecision = ParseResult | { status: "off" };
/**
 * Job A's call. `flag` is vars.PEACEAI_NL_PARSE: "off" is the kill switch (the task text is used unchanged,
 * as before M10); anything else parses. The issue text is cleaned the same way the engines clean it.
 */
export function nlDecision(issue: { title: string; body: string }, flag: string | undefined, approvedKinds: ReadonlySet<string>, model: NbModel | null = loadModel()): NlDecision {
  if (flag === "off") return { status: "off" };
  const title = cleanIssueText({ title: issue.title, body: "" });
  const body = cleanIssueText({ title: "", body: issue.body });
  return parseTask({ title, body }, { model, approvedKinds });
}
