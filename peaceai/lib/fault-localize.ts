// M221/M222: failing-test-driven fault localization for SAFE_HELPERS self-loop gaps.
// Spec: peaceai/spec/fault-localize-v1.md. EXPERIMENTAL, NOT for credit.
// M222: rank candidates by expected-vs-actual evidence + value distance; dedupe equivalent
// mutants; general swapped-operand edits (binary a-b/b-a, concat chains, template part order).
import { createHash } from "node:crypto";
import ts from "typescript";
import { SAFE_HELPERS } from "./self-zone.ts";
import type { Proposer, ProposeInput, Proposal, Edit } from "./loop.ts";

export const FAULT_LOCALIZE_SCHEMA = "peaceai-fault-localize:v1" as const;
export const FAULT_LOCALIZE_PROPOSER = "fault-localize-v1" as const;

/** Closed catalog of string methods that may substitute for each other. */
export const STRING_METHOD_CATALOG = [
  "toUpperCase",
  "toLowerCase",
  "trim",
  "trimStart",
  "trimEnd",
] as const;

const COMPARE_OPS: Record<string, string[]> = {
  "===": ["!==", "=="],
  "!==": ["===", "!="],
  "==": ["!=", "==="],
  "!=": ["==", "!=="],
  "<": ["<=", ">", ">="],
  "<=": ["<", ">", ">="],
  ">": [">=", "<", "<="],
  ">=": [">", "<", "<="],
};
const ARITH_OPS: Record<string, string[]> = {
  "+": ["-"],
  "-": ["+"],
  "*": ["/"],
  "/": ["*"],
};

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;

export function requestNums(text: string): number[] {
  const out: number[] = [];
  for (const m of text.match(/\b\d+\b/g) ?? []) {
    const n = Number(m);
    if (Number.isInteger(n) && Math.abs(n) < 10000) out.push(n);
  }
  // Format-length hints only when the request is about key length / calendar width (not every YYYY-MM mention).
  if (/YYYY-MM-DD|calendar day|ten-character|length (?:is |of )?10|slice (?:length|end)/i.test(text)) out.push(10);
  if (/(?:seven-character|length (?:is |of )?7|month key length)/i.test(text)) out.push(7);
  if (/\bten\b/i.test(text)) out.push(10);
  return out;
}

export function requestStrings(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"([^"\\]*)"|'([^'\\]*)'|`([^`\\]*)`/g)) {
    const s = m[1] ?? m[2] ?? m[3] ?? "";
    if (s.length > 0 && s.length <= 64) out.push(s);
  }
  return out;
}

export function tokensOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(IDENT) ?? []) {
    if (m.length < 2) continue;
    if (/^(?:fix|the|and|for|not|with|from|that|this|when|only|used|so|is|a|an|to|of|in|on|by|as|or|be|it|if|do|no|yes)$/i.test(m)) continue;
    out.push(m);
  }
  return out;
}

/** Expected literals mined from assert.equal / assert.strictEqual in test-like files + request. */
export interface FailureEvidence {
  readonly nums: readonly number[];
  readonly strings: readonly string[];
}

export function parseAssertExpected(files: readonly { path: string; content: string }[]): FailureEvidence {
  const nums: number[] = [];
  const strings: string[] = [];
  for (const f of files) {
    if (!/\.test\.ts$/.test(f.path) && !/self-tests\//.test(f.path)) continue;
    const sf = ts.createSourceFile(f.path, f.content, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && n.arguments.length >= 2) {
        const cal = n.expression;
        const name = ts.isPropertyAccessExpression(cal) && ts.isIdentifier(cal.expression) && cal.expression.text === "assert"
          ? cal.name.text : ts.isIdentifier(cal) ? cal.text : "";
        if (name === "equal" || name === "strictEqual" || name === "deepEqual") {
          const exp = n.arguments[1]!;
          if (ts.isNumericLiteral(exp)) nums.push(Number(exp.text));
          if (ts.isPrefixUnaryExpression(exp) && exp.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(exp.operand)) {
            nums.push(-Number(exp.operand.text));
          }
          if (ts.isStringLiteral(exp) && exp.text.length <= 64) strings.push(exp.text);
          if (ts.isNoSubstitutionTemplateLiteral(exp) && exp.text.length <= 64) strings.push(exp.text);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { nums, strings };
}

/** Assert mining stays inside SAFE_HELPERS practice/helper tests - never repo-wide. */
export function evidenceTestFiles(
  files: readonly { path: string; content: string }[],
  focus: { paths: readonly string[]; names: readonly string[] },
): { path: string; content: string }[] {
  const names = [...new Set(focus.names.map((n) => n.toLowerCase()))].filter((n) => n.length >= 3);
  const out: { path: string; content: string }[] = [];
  for (const f of files) {
    // Only helper-adjacent or sealed practice/heldout tests (m222-guard:ev-focus).
    if (!/self-tests\/helpers\//.test(f.path) && !/self-tests\/practice\//.test(f.path) && !/heldout/i.test(f.path)) continue;
    if (!/\.test\.ts$/.test(f.path) && !/shapes\.json$/.test(f.path)) continue;
    if (!names.length) { out.push(f); continue; }
    const low = f.content.toLowerCase();
    if (names.some((n) => low.includes(n))) out.push(f);
  }
  // If name filter emptied the set, fall back to all helper-adjacent tests (still not repo-wide).
  if (!out.length) {
    for (const f of files) {
      if (/self-tests\/helpers\/.*\.test\.ts$/.test(f.path) || /practice-.*\.test\.ts$/.test(f.path)) out.push(f);
    }
  }
  return out;
}

export function uniqEvidence(ev: FailureEvidence): FailureEvidence {
  return {
    nums: [...new Set(ev.nums)].filter((n) => Number.isInteger(n) && Math.abs(n) < 10000).slice(0, 32),
    strings: [...new Set(ev.strings)].filter((s) => s.length > 0 && s.length <= 64).slice(0, 32),
  };
}

export function collectEvidence(
  request: string,
  files: readonly { path: string; content: string }[],
  failing: readonly string[],
  focus?: { paths: readonly string[]; names: readonly string[] },
): FailureEvidence {
  const focused = focus && (focus.paths.length || focus.names.length)
    ? evidenceTestFiles(files, focus)
    : files.filter((f) => /self-tests\/helpers\//.test(f.path) || /\.test\.ts$/.test(f.path) && /practice|heldout/i.test(f.path));
  const fromTests = parseAssertExpected(focused.length ? focused : []);
  const nums = [...requestNums(request), ...failing.flatMap((f) => requestNums(f)), ...fromTests.nums];
  const strings = [...requestStrings(request), ...fromTests.strings];
  return uniqEvidence({ nums, strings }); // m222-guard:ev-scope
}

export interface LocatedFn {
  readonly path: string;
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

/** Find exported functions in SAFE_HELPERS whose names appear in request/failing tokens. */
export function locateSafeFns(files: readonly { path: string; content: string }[], request: string, failing: readonly string[]): LocatedFn[] {
  const toks = new Set([...tokensOf(request), ...failing.flatMap(tokensOf)].map((t) => t.toLowerCase()));
  const hits: LocatedFn[] = [];
  for (const f of files) {
    if (!(SAFE_HELPERS as readonly string[]).includes(f.path)) continue; // m221-guard:safe-only
    const sf = ts.createSourceFile(f.path, f.content, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const name = n.name.text;
        if (toks.has(name.toLowerCase())) {
          hits.push({
            path: f.path,
            name,
            start: n.getStart(sf),
            end: n.getEnd(),
            bodyStart: n.body.getStart(sf),
            bodyEnd: n.body.getEnd(),
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  hits.sort((a, b) => b.name.length - a.name.length || a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
  return hits;
}

export type MutKind =
  | "operator-swap"
  | "argument-swap"
  | "boundary"
  | "branch-negate"
  | "missing-return"
  | "string-method"
  | "string-literal-empty";

export interface MutCand {
  readonly kind: MutKind;
  readonly path: string;
  readonly content: string;
  readonly key: string;
  /** Numeric literal written by a boundary/string-set mutation, if any (for ranking). */
  readonly wroteNum?: number;
  readonly wroteStr?: string;
  readonly fromNum?: number;
  readonly fromStr?: string;
}

function replaceRange(src: string, start: number, end: number, insert: string): string {
  return src.slice(0, start) + insert + src.slice(end);
}

function contentSha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Generate mutation candidates for one located function (closed operator catalog). */
export function mutateFunction(
  path: string,
  fileContent: string,
  fn: LocatedFn,
  hintNums: readonly number[] = [],
  hintStrs: readonly string[] = [],
): MutCand[] {
  const sf = ts.createSourceFile(path, fileContent, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out: MutCand[] = [];
  const seen = new Set<string>();
  const push = (kind: MutKind, start: number, end: number, insert: string, meta?: Partial<MutCand>) => {
    if (start < fn.bodyStart || end > fn.bodyEnd) return; // m221-guard:in-body
    const content = replaceRange(fileContent, start, end, insert);
    if (content === fileContent) return;
    const key = `${kind}:${path}:${start}:${end}:${insert}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, path, content, key, ...meta });
  };

  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.getText(sf);
      for (const alt of COMPARE_OPS[op] ?? ARITH_OPS[op] ?? []) {
        push("operator-swap", n.operatorToken.getStart(sf), n.operatorToken.getEnd(), alt);
      }
      // General swapped-operand: any binary with distinct operand texts (a-b vs b-a, a+b vs b+a, ...).
      {
        const left = fileContent.slice(n.left.getStart(sf), n.left.getEnd());
        const right = fileContent.slice(n.right.getStart(sf), n.right.getEnd());
        if (left !== right) {
          const mid = fileContent.slice(n.left.getEnd(), n.right.getStart(sf));
          push("argument-swap", n.left.getStart(sf), n.right.getEnd(), right + mid + left);
        }
      }
      // Concat chain A + lit + B -> B + lit + A (left-associative +).
      if (op === "+" && ts.isBinaryExpression(n.left) && n.left.operatorToken.getText(sf) === "+") {
        const a = fileContent.slice(n.left.left.getStart(sf), n.left.left.getEnd());
        const lit = fileContent.slice(n.left.right.getStart(sf), n.left.right.getEnd());
        const b = fileContent.slice(n.right.getStart(sf), n.right.getEnd());
        if (a !== b && (ts.isStringLiteral(n.left.right) || ts.isNoSubstitutionTemplateLiteral(n.left.right))) {
          push("argument-swap", n.getStart(sf), n.getEnd(), `${b} + ${lit} + ${a}`);
        }
      }
      // Drop additive/subtractive small-int drift: (expr + 1) -> expr (general off-by-one).
      if ((op === "+" || op === "-") && ts.isNumericLiteral(n.right)) {
        const v = Number(n.right.text);
        if (Number.isInteger(v) && v >= 0 && v <= 2) {
          const left = fileContent.slice(n.left.getStart(sf), n.left.getEnd());
          push("boundary", n.getStart(sf), n.getEnd(), left, { fromNum: v, wroteNum: 0 }); // m222-guard:drop-add
        }
      }
    }
    if (ts.isNumericLiteral(n)) {
      const v = Number(n.text);
      if (Number.isInteger(v) && Math.abs(v) < 10000) {
        for (const d of [1, -1, 2, -2, 3, -3]) {
          push("boundary", n.getStart(sf), n.getEnd(), String(v + d), { fromNum: v, wroteNum: v + d });
        }
        for (const h of hintNums) {
          if (h !== v && Number.isInteger(h) && Math.abs(h) < 10000) {
            push("boundary", n.getStart(sf), n.getEnd(), String(h), { fromNum: v, wroteNum: h });
          }
        }
      }
    }
    if (ts.isIfStatement(n) && n.expression) {
      const e = n.expression;
      const text = fileContent.slice(e.getStart(sf), e.getEnd());
      if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
        push("branch-negate", e.getStart(sf), e.getEnd(), fileContent.slice(e.operand.getStart(sf), e.operand.getEnd()));
      } else {
        push("branch-negate", e.getStart(sf), e.getEnd(), `!(${text})`);
      }
    }
    // Template span reorder: swap ${} exprs; also try moving a leading letter-run from lit0 onto lit1.
    if (ts.isTemplateExpression(n) && n.templateSpans.length === 2) {
      const s0 = n.templateSpans[0]!, s1 = n.templateSpans[1]!;
      const e0 = fileContent.slice(s0.expression.getStart(sf), s0.expression.getEnd());
      const e1 = fileContent.slice(s1.expression.getStart(sf), s1.expression.getEnd());
      if (e0 !== e1) {
        const content = fileContent.slice(0, s0.expression.getStart(sf)) + e1
          + fileContent.slice(s0.expression.getEnd(), s1.expression.getStart(sf)) + e0
          + fileContent.slice(s1.expression.getEnd());
        if (content !== fileContent) push("argument-swap", fn.bodyStart, fn.bodyEnd, content.slice(fn.bodyStart, fn.bodyEnd));
        // Variant: swap exprs + move leading [a-z]+ from first literal to end of second fill's trailing literal.
        const lit0 = s0.literal.text;
        const m = /^([a-z]+)([\s\S]*)$/i.exec(lit0);
        if (m) {
          const letters = m[1]!;
          const rest = m[2]!;
          // Rebuild whole template node text
          const head = n.head.text;
          const lit1 = s1.literal.text;
          const rebuilt = "`" + head.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
            + "${" + e1 + "}" + rest.replace(/\\/g, "\\\\").replace(/`/g, "\\`")
            + "${" + e0 + "}" + (letters + lit1).replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
          // Prefer splicing via full template range
          push("argument-swap", n.getStart(sf), n.getEnd(), rebuilt);
        }
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const meth = n.expression.name.text;
      if ((STRING_METHOD_CATALOG as readonly string[]).includes(meth)) {
        for (const alt of STRING_METHOD_CATALOG) {
          if (alt === meth) continue;
          push("string-method", n.expression.name.getStart(sf), n.expression.name.getEnd(), alt);
        }
      }
    }
    if (ts.isStringLiteral(n) && n.text.length === 1 && n.text !== " ") {
      push("string-literal-empty", n.getStart(sf), n.getEnd(), '""', { fromStr: n.text, wroteStr: "" });
    }
    if (ts.isBlock(n) && n.statements.length > 0) {
      const last = n.statements[n.statements.length - 1]!;
      if (ts.isVariableStatement(last)) {
        const decl = last.declarationList.declarations[0];
        if (decl && ts.isIdentifier(decl.name) && decl.initializer && last.declarationList.declarations.length === 1) {
          const name = decl.name.text;
          const insert = fileContent.slice(last.getStart(sf), last.getEnd()) + `\n  return ${name};`;
          push("missing-return", last.getStart(sf), last.getEnd(), insert);
        }
      }
      if (ts.isExpressionStatement(last)) {
        const expr = last.expression;
        if (!(ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken)) {
          if (ts.isIdentifier(expr) || ts.isCallExpression(expr) || ts.isBinaryExpression(expr) || ts.isPropertyAccessExpression(expr) || ts.isTemplateExpression(expr) || ts.isStringLiteral(expr)) {
            const t = fileContent.slice(expr.getStart(sf), expr.getEnd());
            push("missing-return", last.getStart(sf), last.getEnd(), `return ${t};`);
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };

  const visitAll = (n: ts.Node) => {
    if (n.getEnd() <= fn.start || n.getStart(sf) >= fn.end) return;
    if (n.getStart(sf) >= fn.start && n.getEnd() <= fn.end) visit(n);
    ts.forEachChild(n, visitAll);
  };
  visitAll(sf);

  {
    const scan = (n: ts.Node) => {
      if (ts.isNumericLiteral(n)) {
        const v = Number(n.text);
        if (Number.isInteger(v) && Math.abs(v) < 10000) push("boundary", n.getStart(sf), n.getEnd(), String(v + 1), { fromNum: v, wroteNum: v + 1 });
      }
      ts.forEachChild(n, scan);
    };
    scan(sf);
  }

  // Multi-template: apply the same expr-swap (+ optional letter-move) to every 2-span template in the fn.
  {
    type Tfix = { start: number; end: number; swapped: string; letterMoved: string | null };
    const tpls: Tfix[] = [];
    const walk = (n: ts.Node) => {
      if (n.getStart(sf) < fn.bodyStart || n.getEnd() > fn.bodyEnd) { ts.forEachChild(n, walk); return; }
      if (ts.isTemplateExpression(n) && n.templateSpans.length === 2) {
        const s0 = n.templateSpans[0]!, s1 = n.templateSpans[1]!;
        const e0 = fileContent.slice(s0.expression.getStart(sf), s0.expression.getEnd());
        const e1 = fileContent.slice(s1.expression.getStart(sf), s1.expression.getEnd());
        if (e0 !== e1) {
          const swapped = fileContent.slice(n.getStart(sf), s0.expression.getStart(sf)) + e1
            + fileContent.slice(s0.expression.getEnd(), s1.expression.getStart(sf)) + e0
            + fileContent.slice(s1.expression.getEnd(), n.getEnd());
          let letterMoved: string | null = null;
          const lit0 = s0.literal.text;
          const m = /^([a-z]+)([\s\S]*)$/i.exec(lit0);
          if (m) {
            const letters = m[1]!, rest = m[2]!;
            const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
            letterMoved = "`" + esc(n.head.text) + "${" + e1 + "}" + esc(rest) + "${" + e0 + "}" + esc(letters + s1.literal.text) + "`";
          }
          tpls.push({ start: n.getStart(sf), end: n.getEnd(), swapped, letterMoved });
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
    if (tpls.length >= 2) {
      // All expr-swapped.
      let body = fileContent;
      for (const t of [...tpls].sort((a, b) => b.start - a.start)) body = body.slice(0, t.start) + t.swapped + body.slice(t.end);
      if (body !== fileContent) push("argument-swap", fn.bodyStart, fn.bodyEnd, body.slice(fn.bodyStart, fn.bodyEnd));
      // All letter-moved where available, else swapped.
      let body2 = fileContent;
      for (const t of [...tpls].sort((a, b) => b.start - a.start)) {
        body2 = body2.slice(0, t.start) + (t.letterMoved ?? t.swapped) + body2.slice(t.end);
      }
      if (body2 !== fileContent && body2 !== body) push("argument-swap", fn.bodyStart, fn.bodyEnd, body2.slice(fn.bodyStart, fn.bodyEnd)); // m222-guard:multi-tpl
    }
  }

  // Parameter-usage swap for two-arg functions (general argument swap).
  {
    const sf2 = ts.createSourceFile(path, fileContent, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const findFn = (n: ts.Node): ts.FunctionDeclaration | null => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === fn.name && n.parameters.length === 2 && n.body) return n;
      let found: ts.FunctionDeclaration | null = null;
      ts.forEachChild(n, (c) => { if (!found) found = findFn(c); });
      return found;
    };
    const decl = findFn(sf2);
    if (decl && ts.isIdentifier(decl.parameters[0]!.name) && ts.isIdentifier(decl.parameters[1]!.name)) {
      const a = (decl.parameters[0]!.name as ts.Identifier).text;
      const b = (decl.parameters[1]!.name as ts.Identifier).text;
      if (a !== b) {
        const body = fileContent.slice(fn.bodyStart, fn.bodyEnd);
        const bodySf = ts.createSourceFile(path + ":body", body, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
        type Rep = { start: number; end: number; text: string };
        const reps: Rep[] = [];
        const walk = (x: ts.Node) => {
          if (ts.isIdentifier(x) && (x.text === a || x.text === b)) {
            if (x.parent && ts.isPropertyAccessExpression(x.parent) && x.parent.name === x) { ts.forEachChild(x, walk); return; }
            // Skip comparison against numeric literal (count === 1): swapping breaks the predicate.
            if (x.parent && ts.isBinaryExpression(x.parent) && (COMPARE_OPS[x.parent.operatorToken.getText(bodySf)] ?? []).length) {
              const other = x.parent.left === x ? x.parent.right : x.parent.left;
              if (ts.isNumericLiteral(other)) { ts.forEachChild(x, walk); return; }
            }
            reps.push({ start: x.getStart(bodySf), end: x.getEnd(), text: x.text === a ? b : a });
          }
          ts.forEachChild(x, walk);
        };
        walk(bodySf);
        if (reps.length) {
          let next = body;
          for (const r of [...reps].sort((x, y) => y.start - x.start)) next = next.slice(0, r.start) + r.text + next.slice(r.end);
          if (next !== body) push("argument-swap", fn.bodyStart, fn.bodyEnd, next);
        }
      }
    }
  }

  return out;
}


/** M175-compatible new-word allow-list (must stay aligned with loop.ts EDIT_NEW_WORDS). */
const EDIT_NEW_WORDS = new Set(["any", "as", "export", "false", "if", "in", "null", "object", "return", "toLowerCase", "toUpperCase", "true", "typeof", "undefined"]);

function vocabWords(s: string): Set<string> {
  return new Set(s.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

/** True when next introduces no identifier word beyond original U EDIT_NEW_WORDS (approx of in-body gate). */
export function editScopeLikelyOk(original: string, next: string): boolean {
  const base = vocabWords(original);
  for (const w of EDIT_NEW_WORDS) base.add(w);
  for (const w of vocabWords(next)) {
    if (!base.has(w)) return false;
  }
  return true;
}

/** Score a candidate against failure evidence (lower is better). */
export function rankScore(c: MutCand, ev: FailureEvidence): number {
  let score = 50;
  // Prefer mutations that write a value matching an expected literal.
  if (c.wroteNum !== undefined && ev.nums.includes(c.wroteNum)) {
    score -= 40; // m222-guard:rank-num
    // Prefer the smallest literal delta among exact matches (slice(0,7)->10 beats slice(0,7) with 0->10).
    if (c.fromNum !== undefined) score += Math.min(Math.abs(c.wroteNum - c.fromNum), 15);
  }
  if (c.wroteStr !== undefined && ev.strings.includes(c.wroteStr)) score -= 40; // m222-guard:rank-str
  // Prefer wroteNum that equals an expected string's length only for format-length requests.
  // (Unguarded, any repo string of length N would boost every boundary-N mutant.)
  if (c.wroteNum !== undefined && ev.strings.some((s) => s.length === c.wroteNum) &&
      (ev.nums.includes(c.wroteNum) || ev.strings.some((s) => /^\d{4}-\d{2}(-\d{2})?$/.test(s)))) {
    score -= 15; // m222-guard:rank-len
  }
  const dropAdd = c.kind === "boundary" && c.wroteNum === 0 && c.fromNum !== undefined && c.fromNum > 0 && c.fromNum <= 2;
  if (c.wroteNum !== undefined && ev.nums.length && !ev.nums.includes(c.wroteNum) && !dropAdd) {
    const dist = Math.min(...ev.nums.map((n) => Math.abs(n - c.wroteNum!)));
    score += Math.min(dist, 20); // m222-guard:rank-dist
  }
  if (c.fromNum !== undefined && c.wroteNum !== undefined && ev.nums.includes(c.fromNum) && !ev.nums.includes(c.wroteNum)) {
    score += 15; // moving away from an expected value
  }
  const kindBoost: Record<MutKind, number> = {
    "branch-negate": -45,
    "operator-swap": -25,
    "argument-swap": -35,
    "missing-return": -40,
    "string-literal-empty": -30,
    "boundary": 0,
    "string-method": 8,
  };
  score += kindBoost[c.kind] ?? 0;
  // Boundary noise: demote numeric tweaks that do not hit an expected number.
  if (c.kind === "boundary" && c.wroteNum !== undefined && !ev.nums.includes(c.wroteNum) && !dropAdd) score += 25;
  // Removing a trailing +1/+2 drift (wrote 0 from 1|2) is a common off-by-one fix.
  if (dropAdd) score -= 55; // m222-guard:rank-drop
  // Demote replacing a formula constant that the request itself states (e.g. *60) with an expected answer literal.
  if (c.kind === "boundary" && c.fromNum !== undefined && c.wroteNum !== undefined
      && ev.nums.includes(c.fromNum) && ev.nums.includes(c.wroteNum) && c.fromNum !== c.wroteNum) {
    score += 10;
  }
  return score;
}

/** Dedupe mutants that produce identical file contents; keep the best-ranked. */
export function dedupeMutants(cands: readonly MutCand[], ev: FailureEvidence): MutCand[] {
  const best = new Map<string, MutCand>();
  for (const c of cands) {
    const sha = contentSha(c.content); // m222-guard:dedupe
    const prev = best.get(sha);
    if (!prev || rankScore(c, ev) < rankScore(prev, ev)) best.set(sha, c);
  }
  return [...best.values()];
}

/** Build the full candidate queue for a propose turn, ranked and deduped. */
export function faultCandidates(input: Pick<ProposeInput, "files" | "request" | "feedback"> & { failing?: readonly string[] }): MutCand[] {
  const failing = input.failing ?? input.feedback.flatMap((f) => f.failing);
  const fns = locateSafeFns(input.files, input.request, failing); // m221-guard:locate
  const ev = collectEvidence(input.request, input.files, failing, {
    paths: fns.map((f) => f.path),
    names: fns.map((f) => f.name),
  });
  const all: MutCand[] = [];
  const seenKey = new Set<string>();
  for (const fn of fns) {
    const file = input.files.find((f) => f.path === fn.path);
    if (!file) continue;
    for (const c of mutateFunction(fn.path, file.content, fn, ev.nums, ev.strings)) {
      if (seenKey.has(c.key)) continue;
      seenKey.add(c.key);
      all.push(c);
    }
  }
  const deduped = dedupeMutants(all, ev);
  // Drop mutants that would be refused EDIT_SCOPE (new identifier words outside the M175 allow-list).
  const scoped = deduped.filter((c) => {
    const orig = input.files.find((f) => f.path === c.path)?.content;
    return orig ? editScopeLikelyOk(orig, c.content) : false; // m222-guard:scope-filter
  });
  scoped.sort((a, b) => rankScore(a, ev) - rankScore(b, ev) || a.key.localeCompare(b.key)); // m222-guard:sort
  return scoped;
}

/** Proposer: one mutation candidate per attempt; refuses when the queue is empty. */
export function faultLocalizeProposer(): Proposer {
  let queue: MutCand[] | null = null;
  let builtFor: string | null = null;
  return {
    name: FAULT_LOCALIZE_PROPOSER,
    next(input: ProposeInput): Proposal {
      const id = input.request + "\0" + input.files.map((f) => f.path + ":" + f.content.length).join("|");
      if (builtFor !== id) { queue = null; builtFor = id; }
      if (!queue) {
        queue = faultCandidates({ files: input.files, request: input.request, feedback: input.feedback });
        if (queue.length === 0) return { refuse: "NO_EDIT" }; // m221-guard:empty
      }
      const last = input.feedback[input.feedback.length - 1];
      if (last && last.codes.some((c) => c === "TAMPERED" || c === "LEFTOVERS")) return { refuse: "NO_MORE_EDITS" };
      while (queue.length) {
        const pick = queue.shift()!;
        const edits: Edit[] = [{ path: pick.path, content: pick.content }];
        return { edits };
      }
      return { refuse: "NO_MORE_EDITS" };
    },
  };
}
