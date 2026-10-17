// M26 (bulk teaching, family `code-shape`): the ADD_COMPLEX_FUNCTION learned rule. Planner-style pure functions
// beyond ADD_FUNCTION's single `return EXPR`: a small block of statements with bounded loops. Mined from Builder's
// own exported multi-statement pure functions in public commits (shape COMPLEX_FUNCTION, peaceai/lib/minecomplex.ts).
// The edit is fixed and stricter than the evidence:
// - ONE new `export function NAME(typed params): Type { BODY }` appended at the end of an existing source module,
//   plus ONE new test file from the task's bullets (same grammar as ADD_FUNCTION).
// - BODY statements only: `const|let NAME[: T] = EXPR;`, `NAME = EXPR;` / `NAME += EXPR;` / `NAME -= EXPR;` (own `let`
//   locals only), `LOCAL.push(EXPR);` (own `const X: T[] = []` arrays only), `if (EXPR) STMT [else STMT]`,
//   `{ ... }`, `for (const X of ITER) { ... }` (ITER a parameter or a `.slice(...)` of one; never a pushed local),
//   `for (let i = INT; i < BOUND; i++) { ... }` (BOUND an integer literal <= MAX_LOOP_BOUND or PARAM.length; `i`
//   never assigned in the body), `break;`, `continue;`, `return EXPR;`.
// - EXPR: ADD_FUNCTION's pure vocabulary over parameters AND the function's own locals, plus read-only element
//   access `X[INDEX]`. No other names (no module code, no globals), no `new`, no closures, no while/do, no try,
//   no throw, no labels, no `++/--` except a counted loop's own `i++`.
// - No helper calls (Auditor #219 note): a COMPLEX_FUNCTION or LOOP_FUNCTION body may not call another function
//   from the same module, even an exported pure one. Such a call is refused as body_refused (pinned in
//   m65-loop-wiring.test.ts). Allowing it needs its own spec, Auditor review and Peace /approve-rule.
// - Limits: MAX_STATEMENTS statements, MAX_LOOPS loops, nesting depth MAX_DEPTH, MAX_BODY_CHARS of body text.
//   Every loop terminates: for-of over an array the body cannot grow, counted loops with a fixed or input-length
//   bound and an untouched counter. Reads at least one parameter; the last statement is a `return`.
// - Issue cleaning strips `>`, `*`, `#` and backticks, so a body uses `<`/`<=` (swap the operands) and no `*`.
// M74 DATE family (public-date-function-v1, params.types "primitive+date", phrase "add date function"): the same
// grammar with loops ["none"], plus Date in the signature and in local annotations, and in expressions only the
// timezone-free Date API: getUTC* getters, getTime, toISOString, Date.UTC(...) and `new Date(EXPR)` with exactly one
// argument. Refused by name: local-time reads (date_local_time: getHours/getDay/... , toLocale*/toDateString/
// toTimeString, Date.parse, `new Date(y, m, ...)`), the clock (date_now: Date.now, `new Date()`), setters (date_setter).
// Job B grades it like ADD_FUNCTION: the new test passes with the function, fails with the module put back to the
// task base, and fails with the body replaced by a type-default `return` (stubComplexBody). No model.
import ts from "typescript";
import { FUNCTION_TYPES, safeBody, type ExtraVocab } from "./learned-function.ts";
import { buildTestEdit, parseTestTask, type TestTask } from "./learned-test.ts";
import { createHash } from "node:crypto";
import { PROTECTED_SELF } from "./selfchange.ts";

/** Off unless PEACEAI_COMPLEX_FUNCTION is exactly "true" (M26 refresh). */
export const COMPLEX_FUNCTION_FLAG = "PEACEAI_COMPLEX_FUNCTION";
export const complexFunctionEnabled = (env: Record<string, string | undefined>): boolean => env[COMPLEX_FUNCTION_FLAG] === "true";
/** M65 wiring: a spec that lists any loop form (public-loop-function-v1) also needs PEACEAI_LOOP_FUNCTION exactly "true" on the dev path. */
export const LOOP_FUNCTION_FLAG = "PEACEAI_LOOP_FUNCTION";
export const loopFunctionEnabled = (env: Record<string, string | undefined>): boolean => env[LOOP_FUNCTION_FLAG] === "true";
/** M74: a spec with types "primitive+date" (public-date-function-v1) also needs PEACEAI_DATE_FUNCTION exactly "true" on the dev path. */
export const DATE_FUNCTION_FLAG = "PEACEAI_DATE_FUNCTION";
export const dateFunctionEnabled = (env: Record<string, string | undefined>): boolean => env[DATE_FUNCTION_FLAG] === "true";
/** Named refusal for every loop form when the spec's `params.loops` is ["none"] (public-complex-function-v1, #211). */
export const LOOP_UNSUPPORTED = "loop_unsupported";
// M64 LOOP_FUNCTION (public-loop-function-v1): loops run only when the spec's params.loops lists the form.
// Named refusals (M59 refusal lines) when loops are enabled:
export const LOOP_UNBOUNDED = "loop_unbounded"; // while(true), a non-comparison condition, an unprovable bound or step
export const LOOP_ASYNC = "loop_async"; // async / await / for await anywhere in the body
export const LOOP_LABEL = "loop_label"; // labels, break/continue to a label
export const CLOSURE_NOT_ALLOWED = "closure_not_allowed"; // nested function, arrow or method
export const LOOP_WHILE_UNSUPPORTED = "loop_while_unsupported"; // a while when the spec allows for/for-of only
/** M74 DATE family named refusals. */
export const DATE_LOCAL_TIME = "date_local_time"; // a local-time read: getHours/getDay/..., toLocale*, toDateString/toTimeString, Date.parse, new Date(y, m, ...)
export const DATE_NOW = "date_now"; // the clock: Date.now or new Date() with no argument
export const DATE_SETTER = "date_setter"; // any Date setter (setUTCHours, setTime, ...)
export const NAMED_REFUSALS: ReadonlySet<string> = new Set([LOOP_UNSUPPORTED, LOOP_UNBOUNDED, LOOP_ASYNC, LOOP_LABEL, CLOSURE_NOT_ALLOWED, LOOP_WHILE_UNSUPPORTED, DATE_LOCAL_TIME, DATE_NOW, DATE_SETTER]);
/** M74: the only value of the optional params key `types` (a DATE family spec). */
export const COMPLEX_TYPES = ["primitive+date"] as const;
const DATE_CTOR = "__peaceaiDate";
const DATE_UTC = "__peaceaiDateUTC";
/** M74: what a DATE spec adds to ADD_FUNCTION's expression vocabulary (rewritten names; Date.UTC takes up to 7 args). */
export const DATE_VOCAB: ExtraVocab = {
  calls: new Map([[DATE_CTOR, 1], [DATE_UTC, 7]]),
  methods: new Set(["getUTCFullYear", "getUTCMonth", "getUTCDate", "getUTCDay", "getUTCHours", "getUTCMinutes", "getUTCSeconds", "getUTCMilliseconds", "getTime", "toISOString"]),
};
const LOCAL_DATE_READS = /^(?:getFullYear|getYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|getMilliseconds|getTimezoneOffset|toLocaleString|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString|toUTCString|toJSON)$/;
const DATE_SETTERS = /^set(?:UTC)?(?:FullYear|Year|Month|Date|Hours|Minutes|Seconds|Milliseconds|Time)$/;
/** M74: the named DATE refusal for a body, or null (the rest of the grammar is checked by blockRefusal). */
export function dateRefusal(body: ts.Node): string | null {
  let r: string | null = null;
  const set = (x: string) => { if (r === null || (r !== DATE_NOW && x === DATE_NOW)) r = x; };
  const isDate = (e: ts.Expression) => ts.isIdentifier(e) && e.text === "Date";
  const v = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && isDate(n.expression)) { const k = n.arguments?.length ?? 0; if (k === 0) set(DATE_NOW); else if (k > 1) set(DATE_LOCAL_TIME); }
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name)) {
      if (isDate(n.expression) && n.name.text === "now") set(DATE_NOW);
      else if (isDate(n.expression) && n.name.text === "parse") set(DATE_LOCAL_TIME);
      else if (LOCAL_DATE_READS.test(n.name.text)) set(DATE_LOCAL_TIME);
      else if (DATE_SETTERS.test(n.name.text)) set(DATE_SETTER);
    }
    ts.forEachChild(n, v);
  };
  v(body);
  return r;
}
/** Which loop forms a spec allows (bounds and starts: an integer literal 0..MAX_LOOP_BOUND or PARAM.length only). */
export interface LoopPolicy { forOf: boolean; counted: boolean; whileBounded: boolean; whileLiteral?: boolean }
export const NO_LOOPS: LoopPolicy = { forOf: false, counted: false, whileBounded: false };
export const loopPolicy = (loops: readonly string[]): LoopPolicy => ({
  forOf: loops.includes("for-of-param"), counted: loops.includes("counted-literal-or-length"), whileBounded: loops.includes("while-bounded"), whileLiteral: loops.includes("while-literal-counter"),
});
const anyLoops = (p: LoopPolicy) => p.forOf || p.counted || p.whileBounded || !!p.whileLiteral;
/** Auditor #135: no leading '/', and no '', '.' or '..' segments (same check as METHOD_GUARD). */
export const plainPath = (p: string): boolean => !p.startsWith("/") && !p.split("/").some((x) => x === "" || x === "." || x === "..");
const isProtected = (path: string) => PROTECTED_SELF.some((x) => x.pattern.test(path));

export const COMPLEX_PARAM_KEYS = ["body", "grading", "loops", "params", "placement", "returns", "test"] as const;
export const COMPLEX_VOCAB: Record<(typeof COMPLEX_PARAM_KEYS)[number], readonly string[]> = {
  body: ["bounded-block"],
  grading: ["self-fail-before-pass-after-and-stub"],
  loops: ["none", "for-of-param", "counted-literal-or-length", "while-bounded", "while-literal-counter"], // "while-literal-counter": undrop LOOP_WHILE (public-loop-function-v2); "none": #211's spec (every loop -> loop_unsupported); the others: M64 public-loop-function-v1
  params: ["typed"],
  placement: ["end-of-module"],
  returns: ["annotated"],
  test: ["new-file"],
};
/**
 * M85 (stress C3, L4; public-complex-calls-v1): two optional keys, always together in one spec.
 * - calls "module-exported-pure": the body may call the target module's own exported functions (Option A vetting:
 *   each callee's body passes this same vocabulary, depth <= MAX_CALL_DEPTH, no recursion). Without the key only the
 *   new function itself is the module (#219), so existing helpers stay uncallable for the older specs.
 * - callbacks "array-method-arrow": an arrow function only as the single argument of .map/.filter/.some/.every/.find/
 *   .findIndex, with one plain identifier parameter (optionally typed from the vocabulary), an expression body vetted
 *   by this vocabulary, no nesting. Any other function-like node is still refused.
 * A spec with these keys refuses a task that uses neither (not_needed): the older specs cover it.
 */
export const COMPLEX_OPTIONAL_VOCAB = { calls: ["module-exported-pure"], callbacks: ["array-method-arrow"] } as const;
export const CALLBACK_METHODS: ReadonlySet<string> = new Set(["map", "filter", "some", "every", "find", "findIndex"]);
export const MAX_CALLBACKS = 4;
export const NOT_NEEDED = "not_needed";
const CB = "__peaceaiCb";
export const MAX_STATEMENTS = 20;
export const MAX_LOOPS = 2;
export const MAX_DEPTH = 3;
export const MAX_BODY_CHARS = 800;
export const MAX_LOOP_BOUND = 1000;
export const MAX_PARAMS = 4;
const NAME = String.raw`[A-Za-z_$][\w$]*`;
const FILE = String.raw`[\w./-]+\.ts`;
const TYPE = String.raw`(?:readonly )?(?:string|number|boolean)(?:\[\])?`;
const PARAM = String.raw`${NAME}: ?${TYPE}`;
/** Header line; the body lines follow it (each a statement), then the test bullets. */
export const COMPLEX_TRIGGER = String.raw`^add (?:a )?complex function \x60?(?<fn>${NAME}) ?\((?<sig>${PARAM}(?:, ?${PARAM}){0,${MAX_PARAMS - 1}})\) ?: ?(?<ret>${TYPE})\x60? to \x60?(?<file>${FILE})\x60? with body ?:?[ \t]*$`;
/** M74: DATE family signature types: the COMPLEX types plus a plain `Date` (no Date[] / readonly Date). */
const DATE_TYPE = String.raw`(?:(?:readonly )?(?:string|number|boolean)(?:\[\])?|Date)`;
/** M74: DATE family header ("add date function ... with body:"); same grammar, Date allowed in the signature. */
export const DATE_TRIGGER = COMPLEX_TRIGGER.replace("complex function", "date function").replaceAll(TYPE, DATE_TYPE);
/** M64: LOOP_FUNCTION header ("add loop function ... with body:"); same signature grammar, its own phrase. */
export const LOOP_TRIGGER = COMPLEX_TRIGGER.replace("complex function", "loop function");
/** LOOP_WHILE (public-loop-function-v2): its own header phrase so v1 (while refused) and v2 never share a task. */
export const WHILE_TRIGGER = COMPLEX_TRIGGER.replace("complex function", "while loop function");
const LOCAL_TYPES = new Set(FUNCTION_TYPES as readonly string[]);
const RESERVED = /^(?:constructor|prototype|__proto__|eval|arguments|globalThis|process|require|import|Function|undefined|NaN|Infinity)$/;

export interface ComplexTask { fn: string; file: string; params: { name: string; type: string }[]; ret: string; body: string; test: TestTask }
export interface ComplexEdit { path: string; content: string; extra: { path: string; content: string; create: true }[]; selfGrade: true }

export function parseComplexTask(trigger: string, objective: string, dates = false): ComplexTask | null {
  const lines = objective.split("\n").map((l) => l.trim());
  const heads = lines.map((l, i) => (new RegExp(trigger, "i").test(l) ? i : -1)).filter((i) => i >= 0);
  if (heads.length !== 1) return null;
  const at = heads[0]!;
  const g = new RegExp(trigger, "i").exec(lines[at]!)!.groups ?? {};
  if (!g.fn || !g.sig || !g.ret || !g.file) return null;
  const params: { name: string; type: string }[] = [];
  for (const part of g.sig.split(",").map((p) => p.trim())) {
    const m = new RegExp(String.raw`^(${NAME}): ?(${dates ? DATE_TYPE : TYPE})$`).exec(part);
    if (!m || params.some((p) => p.name === m[1]) || RESERVED.test(m[1]!)) return null;
    params.push({ name: m[1]!, type: m[2]! });
  }
  const typeOk = (t: string) => LOCAL_TYPES.has(t) || (dates && t === "Date");
  if (!typeOk(g.ret) || params.some((p) => !typeOk(p.type))) return null;
  const bodyLines: string[] = [];
  let i = at + 1;
  for (; i < lines.length && !/^[-*] /.test(lines[i]!); i++) if (lines[i]) bodyLines.push(lines[i]!);
  const body = bodyLines.join("\n");
  if (!body || body.length > MAX_BODY_CHARS) return null;
  const bullets = lines.slice(i).filter((l) => /^[-*] /.test(l));
  const pseudo = createHash("sha256").update(`${g.file}\0${g.fn}\0${g.sig}\0${g.ret}\0${body}`).digest("hex").slice(0, 40);
  const testText = [`add a test for ${g.fn} in ${g.file}: ${g.fn} returns the expected values`, ...bullets, `Fix: ${pseudo}`].join("\n");
  const test = parseTestTask(String.raw`^add (?:a )?test for (?<symbol>${NAME}) in (?<file>${FILE})(?: ?: (?<title>[^\n]{1,120}?))?$`, testText);
  if (!test || test.symbol !== g.fn || test.file !== g.file || test.checks.length === 0 || test.checks.some((c) => c.kind === "rejects")) return null;
  return { fn: g.fn, file: g.file, params, ret: g.ret, body, test };
}

/**
 * True when every statement of the block is in the bounded grammar (see the header). `params` are read-only.
 * Returns the reason for a refusal (string) or null when the block is safe.
 */
export interface CallCtx { module: ReadonlyMap<string, ts.FunctionDeclaration | null>; stack: readonly string[]; called: Set<string>; loops?: LoopPolicy; /** M74 DATE family */ dates?: boolean; /** M85 array-method arrow callbacks */ callbacks?: boolean; /** M85: set when a callback was used */ usedCallback?: { v: boolean } }
/** Option A (Auditor): the callable module functions: exported, top-level, one declaration with a body, not async/generator. */
export function moduleFunctions(sf: ts.SourceFile): Map<string, ts.FunctionDeclaration | null> {
  const out = new Map<string, ts.FunctionDeclaration | null>();
  for (const s of sf.statements) {
    if (!ts.isFunctionDeclaration(s) || !s.name) continue;
    const n = s.name.text;
    const ok = !!s.body && !s.asteriskToken && !s.typeParameters?.length && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && !(ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword || m.kind === ts.SyntaxKind.DefaultKeyword);
    out.set(n, out.has(n) || !ok ? null : s); // overloads / duplicates / non-exported: present but never callable
  }
  return out;
}
/** Option A: call chain depth cap (the candidate body -> f -> g; g may call nothing). */
export const MAX_CALL_DEPTH = 2;

export function blockRefusal(block: ts.Block, params: ReadonlySet<string>, sf: ts.SourceFile, ctx: CallCtx = { module: moduleFunctions(sf), stack: [], called: new Set() }): string | null {
  let callRefusal: string | null = null;
  const callee = (name: string): boolean => {
    if (ctx.stack.includes(name)) { callRefusal = `recursive call to ${name}`; return false; }
    if (ctx.stack.length >= MAX_CALL_DEPTH) { callRefusal = `call depth over ${MAX_CALL_DEPTH}`; return false; }
    const f = ctx.module.get(name);
    if (!f || !f.body) { callRefusal = `${name} is not an exported same-file function`; return false; }
    const ps = new Set<string>();
    for (const x of f.parameters) { if (!ts.isIdentifier(x.name) || !x.type || x.dotDotDotToken || x.initializer || x.questionToken) { callRefusal = `${name} has untyped/destructured/optional parameters`; return false; } ps.add(x.name.text); }
    const r = blockRefusal(f.body, ps, sf, { module: ctx.module, stack: [...ctx.stack, name], called: ctx.called, loops: ctx.loops, dates: ctx.dates, callbacks: ctx.callbacks, usedCallback: ctx.usedCallback });
    if (r) { callRefusal = `${name}: ${r}`; return false; }
    ctx.called.add(name);
    return true;
  };
  const locals = new Map<string, { kind: "const" | "let"; pushable: boolean }>();
  const iterated = new Set<string>();
  const counters = new Set<string>();
  let statements = 0;
  let loops = 0;
  let usesParam = false;
  // Auditor follow-up (#218): PARAM.length is a loop bound/start only on a string- or array-typed parameter (never a
  // number, boolean or untyped one), read from the enclosing function's own parameter annotations.
  // NOTE (Auditor #219 note): this type check is a regex over the annotation's text, which is sound only because the
  // signature grammar (FUNCTION_TYPES) admits these plain spellings. Revisit it if that grammar widens (aliases,
  // Array<T>, unions, tuples, generics), or a widened annotation could slip past or be wrongly refused.
  const lengthParams = new Set<string>();
  if (ts.isFunctionLike(block.parent)) for (const x of block.parent.parameters) if (ts.isIdentifier(x.name) && x.type && /^(?:readonly )?(?:string|string\[\]|number\[\]|boolean\[\])$/.test(x.type.getText(sf).trim())) lengthParams.add(x.name.text);
  const names = () => new Set([...params, ...locals.keys(), ...counters]);
  const expr = (e: ts.Expression, esf: ts.SourceFile = sf, cb = false): boolean => {
    // M85: array-method arrow callbacks are vetted one by one (parameter as a const local), then replaced by a
    // placeholder identifier so the rest of the expression is checked by the unchanged vocabulary below.
    if (!cb) {
      const arrows: ts.ArrowFunction[] = [];
      let bad = false;
      const cv = (n: ts.Node): void => {
        if (ts.isFunctionLike(n)) {
          const p = n.parent;
          if (ctx.callbacks && ts.isArrowFunction(n) && ts.isCallExpression(p) && p.arguments.length === 1 && p.arguments[0] === n && ts.isPropertyAccessExpression(p.expression) && !p.expression.questionDotToken && !p.questionDotToken && !p.typeArguments && CALLBACK_METHODS.has(p.expression.name.text)) arrows.push(n);
          else bad = true;
          return;
        }
        ts.forEachChild(n, cv);
      };
      cv(e);
      // The placeholder name can never be written by a task (only with callbacks on, so older specs are unchanged).
      const iv = (n: ts.Node): void => { if (ts.isIdentifier(n) && n.text.startsWith("__peaceai")) bad = true; ts.forEachChild(n, iv); };
      if (ctx.callbacks) iv(e);
      if (bad || arrows.length > MAX_CALLBACKS) return false;
      if (arrows.length) {
        for (const a of arrows) {
          if (a.modifiers?.length || a.typeParameters || a.type || a.parameters.length !== 1 || ts.isBlock(a.body)) return false;
          const p = a.parameters[0]!;
          if (!ts.isIdentifier(p.name) || p.dotDotDotToken || p.questionToken || p.initializer || (p.type && !LOCAL_TYPES.has(p.type.getText(esf))) || !local(p.name.text)) return false;
          let nested = false;
          const nv = (n: ts.Node): void => { if (ts.isFunctionLike(n)) nested = true; else ts.forEachChild(n, nv); };
          nv(a.body);
          if (nested) return false;
          const name = p.name.text;
          locals.set(name, { kind: "const", pushable: false });
          const ok = expr(a.body as ts.Expression, esf, true);
          locals.delete(name);
          if (!ok) return false;
        }
        const start = e.getStart(esf);
        let text = e.getText(esf);
        for (const a of [...arrows].sort((x, y) => y.getStart(esf) - x.getStart(esf))) text = text.slice(0, a.getStart(esf) - start) + CB + text.slice(a.getEnd() - start);
        const rsf = ts.createSourceFile("cb.ts", `(${text});`, ts.ScriptTarget.Latest, true);
        const st = rsf.statements[0];
        if (rsf.statements.length !== 1 || !st || !ts.isExpressionStatement(st) || !ts.isParenthesizedExpression(st.expression) || (rsf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return false;
        if (ctx.usedCallback) ctx.usedCallback.v = true;
        return expr(st.expression.expression, rsf, true);
      }
    }
    // Read-only element access X[INDEX] is allowed on top of ADD_FUNCTION's vocabulary: check it by rewriting.
    let okAccess = true;
    const visit = (n: ts.Node): void => {
      if (ts.isElementAccessExpression(n)) { if (n.questionDotToken || !ts.isIdentifier(n.expression) || !names().has(n.expression.text)) okAccess = false; }
      if (ts.isIdentifier(n) && params.has(n.text)) usesParam = true;
      ts.forEachChild(n, visit);
    };
    visit(e);
    if (!okAccess) return false;
    const own = names();
    let callsOk = true;
    const calls = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && !own.has(n.expression.text) && ctx.module.has(n.expression.text)) {
        if (n.questionDotToken || n.typeArguments || n.arguments.some(ts.isSpreadElement) || !callee(n.expression.text)) callsOk = false;
      }
      ts.forEachChild(n, calls);
    };
    calls(e);
    if (!callsOk) return false;
    const rewritten = rewriteIndex(e, esf, (n) => !own.has(n) && ctx.module.has(n), ctx.dates === true);
    if (rewritten === null) return false;
    const re = ts.createSourceFile("e.ts", `(${rewritten});`, ts.ScriptTarget.Latest, true);
    const st = re.statements[0];
    if (re.statements.length !== 1 || !st || !ts.isExpressionStatement(st) || !ts.isParenthesizedExpression(st.expression) || (re as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return false;
    const withCb = cb && e.getText(esf).includes(CB);
    return safeBodyNoParam(st.expression.expression, withCb ? new Set([...names(), CB]) : names(), withCb);
  };
  const safeBodyNoParam = (e: ts.Expression, ns: Set<string>, withCb = false) => {
    // safeBody requires reading a parameter; locals-only expressions are fine inside a block (usesParam is tracked here).
    const dummy = "__p";
    const wrapped = ts.createSourceFile("e.ts", `((${e.getText()}) === ${dummy} || ${dummy});`, ts.ScriptTarget.Latest, true);
    const st = wrapped.statements[0] as ts.ExpressionStatement;
    const base = ctx.dates ? DATE_VOCAB : undefined;
    const vocab = withCb ? { calls: base?.calls ?? new Map<string, number>(), methods: new Set([...(base?.methods ?? []), ...CALLBACK_METHODS]) } : base;
    return safeBody((st.expression as ts.ParenthesizedExpression).expression, new Set([...ns, dummy]), vocab);
  };
  const local = (n: string) => !params.has(n) && !locals.has(n) && !counters.has(n) && !RESERVED.test(n);
  const pol = ctx.loops ?? NO_LOOPS;
  const on = anyLoops(pol);
  // Auditor #218: a loop bound and a loop start are each an integer literal 0..MAX_LOOP_BOUND or PARAM.length, nothing
  // else (no number parameters, no 1e17 / NaN / Infinity / negative values, no expressions).
  const fixedBound = (b: ts.Expression): boolean => {
    if (ts.isNumericLiteral(b)) return /^\d+$/.test(b.text) && Number(b.text) <= MAX_LOOP_BOUND;
    const param = ts.isPropertyAccessExpression(b) && b.name.text === "length" && ts.isIdentifier(b.expression) && params.has(b.expression.text) && lengthParams.has(b.expression.text);
    if (param && on) usesParam = true; // a loop bound reads its parameter
    return param;
  };
  const starts = new Map<string, ts.Expression>(); // own let local -> its initializer (a while counter's start)
  const stmt = (s: ts.Statement, depth: number, inLoop: boolean): string | null => {
    // #211 (loops ["none"]): every loop form is refused by name.
    if (!on && (ts.isForStatement(s) || ts.isForOfStatement(s) || ts.isForInStatement(s) || ts.isWhileStatement(s) || ts.isDoStatement(s))) return LOOP_UNSUPPORTED;
    if (on) {
      if (ts.isDoStatement(s) || ts.isForInStatement(s)) return LOOP_UNSUPPORTED;
      if (ts.isLabeledStatement(s) || ((ts.isBreakStatement(s) || ts.isContinueStatement(s)) && s.label)) return LOOP_LABEL;
      if (ts.isForOfStatement(s) && s.awaitModifier) return LOOP_ASYNC;
      if (ts.isForOfStatement(s) && !pol.forOf) return LOOP_UNSUPPORTED;
      if (ts.isForStatement(s) && !pol.counted) return LOOP_UNSUPPORTED;
      if (ts.isWhileStatement(s)) return whileStmt(s, depth);
    }
    if (++statements > MAX_STATEMENTS) return "too many statements";
    if (depth > MAX_DEPTH) return "nested too deep";
    if (ts.isBlock(s)) { statements--; for (const x of s.statements) { const r = stmt(x, depth, inLoop); if (r) return r; } return null; }
    if (ts.isVariableStatement(s)) {
      const fl = s.declarationList.flags;
      const kind = fl & ts.NodeFlags.Const ? "const" : fl & ts.NodeFlags.Let ? "let" : null;
      if (!kind || s.declarationList.declarations.length !== 1 || ts.getModifiers(s)?.length) return "only one const/let per statement";
      const d = s.declarationList.declarations[0]!;
      if (!ts.isIdentifier(d.name) || !local(d.name.text) || !d.initializer) return "bad declaration";
      if (d.type && !LOCAL_TYPES.has(d.type.getText(sf)) && !(ctx.dates && d.type.getText(sf) === "Date")) return "local type outside the vocabulary";
      const emptyArray = ts.isArrayLiteralExpression(d.initializer) && d.initializer.elements.length === 0;
      if (emptyArray && (!d.type || !/\[\]$/.test(d.type.getText(sf)))) return "an empty array needs an array type";
      if (!emptyArray && !expr(d.initializer)) return callRefusal ?? "initializer outside the vocabulary";
      locals.set(d.name.text, { kind, pushable: kind === "const" && emptyArray });
      if (kind === "let") starts.set(d.name.text, d.initializer);
      return null;
    }
    if (ts.isExpressionStatement(s)) {
      const e = s.expression;
      if (ts.isBinaryExpression(e) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken].includes(e.operatorToken.kind)) {
        if (!ts.isIdentifier(e.left) || locals.get(e.left.text)?.kind !== "let") return "assignment only to own let locals";
        return expr(e.right) ? null : "assigned value outside the vocabulary";
      }
      if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression) && e.expression.name.text === "push") {
        const arr = e.expression.expression.text;
        if (!locals.get(arr)?.pushable || iterated.has(arr) || e.arguments.length !== 1 || ts.isSpreadElement(e.arguments[0]!)) return "push only one value onto an own empty-initialized array";
        return expr(e.arguments[0]!) ? null : "pushed value outside the vocabulary";
      }
      return "expression statement not allowed";
    }
    if (ts.isIfStatement(s)) {
      // Option A: the only throw is a one-line guard `if (COND) throw new Error("literal");` (no else).
      const th = ts.isBlock(s.thenStatement) && s.thenStatement.statements.length === 1 ? s.thenStatement.statements[0]! : s.thenStatement;
      if (ts.isThrowStatement(th)) {
        const x = th.expression;
        const oneLine = sf.getLineAndCharacterOfPosition(s.getStart(sf)).line === sf.getLineAndCharacterOfPosition(s.getEnd()).line;
        if (s.elseStatement || !oneLine || !ts.isNewExpression(x) || !ts.isIdentifier(x.expression) || x.expression.text !== "Error" || x.arguments?.length !== 1 || !(ts.isStringLiteral(x.arguments[0]!) || ts.isNoSubstitutionTemplateLiteral(x.arguments[0]!))) return "throw only as a one-line guard if (COND) throw new Error(\"literal\")";
        return expr(s.expression) ? null : "condition outside the vocabulary";
      }
      if (!expr(s.expression)) return "condition outside the vocabulary";
      return stmt(s.thenStatement, depth + 1, inLoop) ?? (s.elseStatement ? stmt(s.elseStatement, depth + 1, inLoop) : null);
    }
    if (ts.isReturnStatement(s)) return s.expression && expr(s.expression) ? null : callRefusal ?? "return value outside the vocabulary";
    if (ts.isBreakStatement(s) || ts.isContinueStatement(s)) return !s.label && inLoop ? null : "break/continue only unlabeled, inside a loop";
    if (ts.isForOfStatement(s)) {
      if (++loops > MAX_LOOPS) return "too many loops";
      if (s.awaitModifier) return "for await";
      const init = s.initializer;
      if (!ts.isVariableDeclarationList(init) || !(init.flags & ts.NodeFlags.Const) || init.declarations.length !== 1 || !ts.isIdentifier(init.declarations[0]!.name)) return "for-of needs one const binding";
      const it = s.expression;
      const src = ts.isIdentifier(it) ? it : ts.isCallExpression(it) && ts.isPropertyAccessExpression(it.expression) && it.expression.name.text === "slice" && ts.isIdentifier(it.expression.expression) ? it.expression.expression : null;
      if (!src || !(params.has(src.text) || (locals.has(src.text) && !locals.get(src.text)!.pushable)) || !expr(it)) return "for-of only over a parameter, a non-growing local, or a slice of one";
      const v = init.declarations[0]!.name.text;
      if (!local(v)) return "loop variable shadows";
      iterated.add(src.text);
      locals.set(v, { kind: "const", pushable: false });
      const r = stmt(s.statement, depth + 1, true);
      locals.delete(v);
      return r;
    }
    if (ts.isForStatement(s)) {
      if (++loops > MAX_LOOPS) return "too many loops";
      const init = s.initializer;
      if (!init || !ts.isVariableDeclarationList(init) || !(init.flags & ts.NodeFlags.Let) || init.declarations.length !== 1) return "counted loop needs one let counter";
      const d = init.declarations[0]!;
      if (!ts.isIdentifier(d.name) || !local(d.name.text) || !d.initializer) return "counter starts at an integer literal";
      if (on ? !fixedBound(d.initializer) : (!ts.isNumericLiteral(d.initializer) || !/^\d+$/.test(d.initializer.text))) return on ? LOOP_UNBOUNDED : "counter starts at an integer literal";
      const i = d.name.text;
      const c = s.condition;
      if (!c || !ts.isBinaryExpression(c) || ![ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken].includes(c.operatorToken.kind) || !ts.isIdentifier(c.left) || c.left.text !== i) return on ? LOOP_UNBOUNDED : "condition must be i < BOUND or i <= BOUND";
      if (!fixedBound(c.right)) return on ? LOOP_UNBOUNDED : `bound must be an integer literal <= ${MAX_LOOP_BOUND} or PARAM.length`;
      const inc = s.incrementor;
      const plusPlus = !!inc && ts.isPostfixUnaryExpression(inc) && inc.operator === ts.SyntaxKind.PlusPlusToken && ts.isIdentifier(inc.operand) && inc.operand.text === i;
      const plusOne = on && !!inc && ts.isBinaryExpression(inc) && inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken && ts.isIdentifier(inc.left) && inc.left.text === i && ts.isNumericLiteral(inc.right) && inc.right.text === "1"; // M64: i += 1
      if (!plusPlus && !plusOne) return on ? LOOP_UNBOUNDED : "incrementor must be i++";
      counters.add(i);
      const r = stmt(s.statement, depth + 1, true);
      counters.delete(i);
      return r;
    }
    return `${ts.SyntaxKind[s.kind]} not allowed`;
  };
  // M64 bounded while: `while (C < B | C <= B)` (or `B > C`, `B >= C`) with exactly one top-level `C += POS` / `C++`, or
  // `while (C > B | C >= B)` (or `B < C`, `B <= C`) with exactly one top-level `C -= POS` / `C--`. C is an own let local
  // assigned nowhere else in the body; B is a literal <= MAX_LOOP_BOUND, a number parameter or PARAM.length (never a
  // local copy); no `continue` anywhere in the body (it could skip the step).
  function whileStmt(s: ts.WhileStatement, depth: number): string | null {
    if (!pol.whileBounded && !pol.whileLiteral) return LOOP_WHILE_UNSUPPORTED;
    // LOOP_WHILE (public-loop-function-v2, "while-literal-counter"): ONLY `while (C < LIT)` / `while (C <= LIT)` with C an
    // own let starting at an integer literal and exactly one top-level `C += 1`. Anything else is loop_unbounded.
    if (pol.whileLiteral && !pol.whileBounded) {
      const w = s.expression;
      const lit = (e: ts.Expression | undefined) => !!e && ts.isNumericLiteral(e) && /^\d+$/.test(e.text) && Number(e.text) <= MAX_LOOP_BOUND;
      if (!ts.isBinaryExpression(w) || (w.operatorToken.kind !== ts.SyntaxKind.LessThanToken && w.operatorToken.kind !== ts.SyntaxKind.LessThanEqualsToken)) return LOOP_UNBOUNDED;
      if (!ts.isIdentifier(w.left) || locals.get(w.left.text)?.kind !== "let" || !lit(w.right) || !lit(starts.get(w.left.text))) return LOOP_UNBOUNDED;
      const name = w.left.text;
      if (!ts.isBlock(s.statement)) return LOOP_UNBOUNDED;
      const plusOne = (x: ts.Statement) => ts.isExpressionStatement(x) && ts.isBinaryExpression(x.expression) && x.expression.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken && ts.isIdentifier(x.expression.left) && x.expression.left.text === name && ts.isNumericLiteral(x.expression.right) && x.expression.right.text === "1";
      if (s.statement.statements.filter(plusOne).length !== 1) return LOOP_UNBOUNDED;
    }
    if (++loops > MAX_LOOPS) return "too many loops";
    const c = s.expression;
    const L = ts.SyntaxKind.LessThanToken, LE = ts.SyntaxKind.LessThanEqualsToken, G = ts.SyntaxKind.GreaterThanToken, GE = ts.SyntaxKind.GreaterThanEqualsToken;
    if (!ts.isBinaryExpression(c) || ![L, LE, G, GE].includes(c.operatorToken.kind)) return LOOP_UNBOUNDED;
    const op = c.operatorToken.kind;
    const isCounter = (e: ts.Expression) => ts.isIdentifier(e) && locals.get(e.text)?.kind === "let";
    let k: string, bound: ts.Expression, up: boolean;
    if (isCounter(c.left) && !isCounter(c.right)) { k = (c.left as ts.Identifier).text; bound = c.right; up = op === L || op === LE; }
    else if (isCounter(c.right) && !isCounter(c.left)) { k = (c.right as ts.Identifier).text; bound = c.left; up = op === G || op === GE; }
    else return LOOP_UNBOUNDED;
    if (!fixedBound(bound) || !ts.isBlock(s.statement)) return LOOP_UNBOUNDED;
    const start = starts.get(k);
    if (!start || !fixedBound(start)) return LOOP_UNBOUNDED; // Auditor #218: the counter starts at a literal 0..MAX or PARAM.length
    const isStep = (x: ts.Statement): boolean => {
      if (!ts.isExpressionStatement(x)) return false;
      const e = x.expression;
      if (ts.isBinaryExpression(e)) return ts.isIdentifier(e.left) && e.left.text === k && e.operatorToken.kind === (up ? ts.SyntaxKind.PlusEqualsToken : ts.SyntaxKind.MinusEqualsToken) && ts.isNumericLiteral(e.right) && /^[1-9]\d*$/.test(e.right.text);
      return (ts.isPostfixUnaryExpression(e) || ts.isPrefixUnaryExpression(e)) && ts.isIdentifier(e.operand) && e.operand.text === k && e.operator === (up ? ts.SyntaxKind.PlusPlusToken : ts.SyntaxKind.MinusMinusToken);
    };
    const touches = (n: ts.Node): boolean => {
      let hit = false;
      const v = (x: ts.Node): void => {
        if (ts.isContinueStatement(x)) hit = true;
        if (ts.isBinaryExpression(x) && x.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && x.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(x.left) && x.left.text === k) hit = true;
        if ((ts.isPrefixUnaryExpression(x) || ts.isPostfixUnaryExpression(x)) && (x.operator === ts.SyntaxKind.PlusPlusToken || x.operator === ts.SyntaxKind.MinusMinusToken) && ts.isIdentifier(x.operand) && x.operand.text === k) hit = true;
        ts.forEachChild(x, v);
      };
      v(n);
      return hit;
    };
    const body = s.statement.statements;
    if (body.filter(isStep).length !== 1 || body.some((x) => !isStep(x) && touches(x))) return LOOP_UNBOUNDED;
    // The counter is assigned nowhere else in the function (so its start is its declaration), apart from this step.
    const step = body.find(isStep)!;
    let elsewhere = false;
    const ev = (x: ts.Node): void => {
      if (x === step) return;
      if (ts.isBinaryExpression(x) && x.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && x.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(x.left) && x.left.text === k) elsewhere = true;
      if ((ts.isPrefixUnaryExpression(x) || ts.isPostfixUnaryExpression(x)) && (x.operator === ts.SyntaxKind.PlusPlusToken || x.operator === ts.SyntaxKind.MinusMinusToken) && ts.isIdentifier(x.operand) && x.operand.text === k) elsewhere = true;
      ts.forEachChild(x, ev);
    };
    ev(block);
    if (elsewhere) return LOOP_UNBOUNDED;
    if (!expr(c)) return "condition outside the vocabulary";
    if (++statements > MAX_STATEMENTS) return "too many statements";
    if (depth + 1 > MAX_DEPTH) return "nested too deep";
    for (const x of body) { if (isStep(x)) continue; const r = stmt(x, depth + 1, true); if (r) return r; }
    return null;
  }
  const st = block.statements;
  if (st.length === 0 || !ts.isReturnStatement(st[st.length - 1]!)) return "the last statement must be a return";
  for (const s of st) { const r = stmt(s, 1, false); if (r) return r; }
  return usesParam ? null : "the body never reads a parameter";
}

/** Rewrites read-only `X[INDEX]` to `X.at(INDEX)` so ADD_FUNCTION's expression checker can vet it (at is pure). */
function rewriteIndex(e: ts.Expression, sf: ts.SourceFile, isModuleCall: (name: string) => boolean = () => false, dates = false): string | null {
  const text = e.getText(sf);
  const start = e.getStart(sf);
  const edits: { at: number; end: number; repl: string; check?: RegExp }[] = [];
  const visit = (n: ts.Node) => {
    // M74 (DATE family): `new Date(X)` (exactly one argument) and `Date.UTC(...)` are checked as two reserved callables
    // (DATE_VOCAB); every other `new` stays unrewritten and is refused by the expression checker.
    if (dates && ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date" && !n.typeArguments && n.arguments?.length === 1 && !ts.isSpreadElement(n.arguments[0]!)) {
      edits.push({ at: n.getStart(sf) - start, end: n.arguments.pos - start, repl: `${DATE_CTOR}(`, check: /^new\s+Date\s*\($/ });
    }
    if (dates && ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "Date" && n.expression.name.text === "UTC" && !n.questionDotToken && !n.expression.questionDotToken) {
      edits.push({ at: n.expression.getStart(sf) - start, end: n.arguments.pos - start, repl: `${DATE_UTC}(`, check: /^Date\s*\.\s*UTC\s*\($/ });
    }
    if (ts.isElementAccessExpression(n)) {
      const open = n.argumentExpression.getStart(sf) - 1;
      const close = n.getEnd() - 1;
      edits.push({ at: open - start, end: open - start + 1, repl: ".at(" }, { at: close - start, end: close - start + 1, repl: ")" });
    }
    // Option A: a vetted same-file call `f(a, b)` is checked as `[a, b].length` (its arguments stay checked).
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && isModuleCall(n.expression.text)) {
      const c0 = n.expression.getStart(sf);
      const open = n.arguments.pos - 1;
      const close = n.getEnd() - 1;
      edits.push({ at: c0 - start, end: open - start + 1, repl: "[" }, { at: close - start, end: close - start + 1, repl: "].length" });
    }
    ts.forEachChild(n, visit);
  };
  visit(e);
  let out = text;
  for (const ed of edits.sort((a, b) => b.at - a.at)) {
    const want = ed.check ? null : ed.repl === ")" ? "]" : ed.repl === ".at(" ? "[" : ed.repl === "].length" ? ")" : null;
    if (ed.check ? !ed.check.test(out.slice(ed.at, ed.end)) : want !== null ? out.slice(ed.at, ed.end) !== want : !/^[A-Za-z_$][\w$]*\s*\($/.test(out.slice(ed.at, ed.end))) return null;
    out = out.slice(0, ed.at) + ed.repl + out.slice(ed.end);
  }
  return out;
}

function declared(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const v = (n: ts.Node) => { const nm = (n as { name?: ts.Node }).name; if (nm && ts.isIdentifier(nm)) out.add(nm.text); ts.forEachChild(n, v); };
  v(sf);
  return out;
}

export function buildComplexEdit(params: Record<string, string | string[]>, task: ComplexTask, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), why?: { reason?: string }): ComplexEdit | null {
  const no = (r: string) => { if (why) why.reason = r; return null; };
  for (const k of COMPLEX_PARAM_KEYS) {
    const v = params[k];
    if (k === "loops") { if (!Array.isArray(v) || v.length === 0 || !v.every((x) => COMPLEX_VOCAB.loops.includes(x))) return no("bad_rule_params"); continue; }
    if (typeof v !== "string" || !COMPLEX_VOCAB[k].includes(v)) return no("bad_rule_params");
  }
  // M74: the optional `types` key ("primitive+date") makes a DATE family spec; it never mixes with loops.
  const dates = params.types === "primitive+date";
  // M85: the optional calls/callbacks pair (public-complex-calls-v1); never with Date types.
  const extended = "calls" in params || "callbacks" in params;
  if (extended && (params.calls !== COMPLEX_OPTIONAL_VOCAB.calls[0] || params.callbacks !== COMPLEX_OPTIONAL_VOCAB.callbacks[0] || "types" in params)) return no("bad_rule_params");
  if (Object.keys(params).some((k) => k !== "types" && k !== "calls" && k !== "callbacks" && !(COMPLEX_PARAM_KEYS as readonly string[]).includes(k)) || ("types" in params && !dates)) return no("bad_rule_params");
  if (dates && (params.loops as string[]).join(",") !== "none") return no("bad_rule_params");
  if (!dates && task.params.concat({ name: "", type: task.ret }).some((p) => p.type === "Date")) return no("bad_rule_params");
  if (!plainPath(task.file)) return no("path_not_plain");
  if (isProtected(task.file)) return no("protected_path");
  const target = files.find((f) => f.path === task.file);
  if (!target || isTest(target.path) || !/\.ts$/.test(target.path) || /\.d\.ts$/.test(target.path)) return no("target_file_not_found");
  const sf = ts.createSourceFile(target.path, target.content, ts.ScriptTarget.Latest, true);
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return no("edit_refused");
  if (declared(sf).has(task.fn) || new RegExp(String.raw`\b${task.fn.replace(/\$/g, "\\$")}\b`).test(target.content) || RESERVED.test(task.fn)) return no("edit_refused");
  const names = new Set(task.params.map((p) => p.name));
  if (names.has(task.fn)) return no("edit_refused");
  const sig = task.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  const fnText = `export function ${task.fn}(${sig}): ${task.ret} {\n${task.body.split("\n").map((l) => `  ${l}`).join("\n")}\n}\n`;
  const fsf = ts.createSourceFile("f.ts", fnText, ts.ScriptTarget.Latest, true);
  if ((fsf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length || fsf.statements.length !== 1) return no("edit_refused");
  const fd = fsf.statements[0]!;
  if (!ts.isFunctionDeclaration(fd) || !fd.body) return no("edit_refused");
  if (dates) {
    // M74: named DATE refusals first; reserved rewrite names and a shadowed `Date` are refused outright.
    const dr = dateRefusal(fd.body);
    if (dr) return no(dr);
    let shadow = false;
    const sv = (n: ts.Node): void => { if (ts.isIdentifier(n) && (n.text.startsWith("__peaceai") || (n.text === "Date" && ts.isVariableDeclaration(n.parent) && n.parent.name === n))) shadow = true; ts.forEachChild(n, sv); };
    sv(fd);
    if (shadow || task.params.some((p) => p.name === "Date")) return no("body_refused");
  }
  const allowedLoops = new Set(params.loops as string[]);
  const pol = loopPolicy([...allowedLoops]);
  if (anyLoops(pol)) {
    // M64: named refusals checked on the whole body before the statement grammar.
    if (/\b(?:async|await)\b/.test(task.body)) return no(LOOP_ASYNC);
    let closure = false;
    const v = (n: ts.Node): void => { if (ts.isFunctionLike(n)) closure = true; else ts.forEachChild(n, v); };
    fd.body.statements.forEach(v);
    if (closure && !extended) return no(CLOSURE_NOT_ALLOWED);
  }
  if (extended && /__peaceai/.test(task.body)) return no("body_refused");
  if (!allowedLoops.has("for-of-param") && /\bfor \(const /.test(task.body)) return no(LOOP_UNSUPPORTED);
  if (!allowedLoops.has("counted-literal-or-length") && /\bfor \(let /.test(task.body)) return no(LOOP_UNSUPPORTED);
  const base = target.content.endsWith("\n") ? target.content : `${target.content}\n`;
  const content = `${base}\n${fnText}`;
  if (!extended) {
    const refusal = blockRefusal(fd.body, names, fsf, { module: moduleFunctions(fsf), stack: [], called: new Set(), loops: pol, dates });
    if (refusal) return no(NAMED_REFUSALS.has(refusal) ? refusal : "body_refused");
  } else {
    // M85: vet the new function inside the whole module, so the module's own exported functions are callable.
    const msf = ts.createSourceFile(target.path, content, ts.ScriptTarget.Latest, true);
    if ((msf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return no("edit_refused");
    const mod = moduleFunctions(msf);
    const mfd = mod.get(task.fn);
    if (!mfd?.body) return no("edit_refused");
    const ctx: CallCtx = { module: mod, stack: [], called: new Set(), loops: pol, callbacks: true, usedCallback: { v: false } };
    const refusal = blockRefusal(mfd.body, names, msf, ctx);
    if (refusal) return no(NAMED_REFUSALS.has(refusal) ? refusal : "body_refused");
    if (ctx.called.size === 0 && !ctx.usedCallback!.v) return no(NOT_NEEDED);
  }
  const withFn = files.map((f) => (f.path === target.path ? { path: f.path, content } : f));
  // M85 (stress D2): a DATE task whose declared return is Date may write `is new Date("ISO")` (deepEqual); this
  // builder-only key is never a learned spec param, so ADD_TEST_CASE specs keep refusing Date expected values (M35).
  // M74: a DATE task with a Date parameter writes its checks with `new Date("ISO")` arguments (the M35 grammar).
  const testParams = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "12", placement: "new-file", ...(dates && task.params.some((p) => p.type === "Date") ? { args: "date-literal" } : {}), ...(dates && task.ret === "Date" ? { expected: "date-literal" } : {}) };
  const test = buildTestEdit(testParams, task.test, withFn, isTest);
  if (!test) return no("test_refused");
  if (!plainPath(test.path)) return no("path_not_plain"); // new test files match the protected *.test.ts pattern by design; only the path shape is checked here
  return { path: target.path, content, extra: [{ path: test.path, content: test.content, create: true }], selfGrade: true };
}

export function applyComplexRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean, env: Record<string, string | undefined> = process.env): ComplexEdit | null {
  if (!complexFunctionEnabled(env)) return null;
  if (Array.isArray(params.loops) && params.loops.some((x) => x !== "none") && !loopFunctionEnabled(env)) return null; // M65: loops behind their own flag
  if (params.types !== undefined && !dateFunctionEnabled(env)) return null; // M74: Date types behind their own flag
  const task = parseComplexTask(trigger, objective, params.types === "primitive+date");
  return task ? buildComplexEdit(params, task, files, isTest) : null;
}

/** Job A entry (wiring): admitted only via the hash-pinned approved list, so no flag here; reasons for M59 lines. */
export function runComplexRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean, why?: { reason?: string }): ComplexEdit | null {
  const task = parseComplexTask(trigger, objective, params.types === "primitive+date");
  if (!task) { if (why) why.reason = "task_unparsed"; return null; }
  return buildComplexEdit(params, task, files, isTest, why);
}

/** Job B's stub: the function's whole body replaced by a type-default return (types are always in the vocabulary). */
export function stubComplexBody(content: string, fn: string): string | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  const hits = sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fn);
  if (hits.length !== 1 || !hits[0]!.body || !hits[0]!.type) return null;
  const t = hits[0]!.type.getText(sf).replace(/^readonly /, "");
  const d = t === "string" ? '""' : t === "number" ? "0" : t === "boolean" ? "false" : /\[\]$/.test(t) ? "[]" : t === "Date" ? "new Date(0)" : null; // M74: Date -> epoch
  if (!d) return null;
  return content.slice(0, hits[0]!.body.getStart(sf)) + `{ return ${d}; }` + content.slice(hits[0]!.body.getEnd());
}

/** Option A: the same-file functions a body calls (transitively, vetted). Null when the body is refused. */
export function calledFunctions(block: ts.Block, params: ReadonlySet<string>, sf: ts.SourceFile, loops: LoopPolicy = NO_LOOPS, dates = false): string[] | null {
  const ctx: CallCtx = { module: moduleFunctions(sf), stack: [], called: new Set(), loops, dates };
  return blockRefusal(block, params, sf, ctx) === null ? [...ctx.called].sort() : null;
}

/**
 * Option A grading: stub `fn` AND every function it calls that the candidate added (`added`), so a test cannot pass
 * through a helper the candidate also wrote. Null (fail closed) when any of them cannot be stubbed.
 */
export function stubForGrading(content: string, fn: string, added: readonly string[]): string | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  const f = moduleFunctions(sf).get(fn);
  if (!f?.body) return null;
  const ps = new Set(f.parameters.map((x) => (ts.isIdentifier(x.name) ? x.name.text : "")));
  // M64: the candidate already passed Job A under its spec; list callees with every bounded loop form allowed.
  // M74: a function with Date in its signature passed Job A under the DATE spec; vet its callees with the Date vocabulary.
  const dates = [...f.parameters.map((x) => x.type?.getText(sf)), f.type?.getText(sf)].includes("Date");
  const called = calledFunctions(f.body, ps, sf, loopPolicy(["for-of-param", "counted-literal-or-length", "while-bounded"]), dates);
  if (called === null) return null;
  let cur: string | null = content;
  for (const n of [fn, ...called.filter((c) => added.includes(c))]) { cur = stubComplexBody(cur, n); if (cur === null) return null; }
  return cur;
}
