// M221 (batch 57): failing-test-driven fault localization for SAFE_HELPERS self-loop gaps.
// Spec: peaceai/spec/fault-localize-v1.md. EXPERIMENTAL, NOT for credit.
// General: locate export functions named by the request / failing-test tokens inside SAFE_HELPERS
// files, rank their statements, propose edits from a closed catalog of mutation operators.
// Does not special-case M220 shape ids or held-out ids.
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
  // YYYY-MM-DD implies 10; YYYY-MM implies 7 - general format-length hints from the request text.
  if (/YYYY-MM-DD|calendar day/i.test(text)) out.push(10);
  if (/YYYY-MM(?!-DD)|month key|month prefix/i.test(text)) out.push(7);
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
  // Prefer longer / more specific names first; stable by path then name.
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
}

function replaceRange(src: string, start: number, end: number, insert: string): string {
  return src.slice(0, start) + insert + src.slice(end);
}

/** Generate mutation candidates for one located function (closed operator catalog). */
export function mutateFunction(path: string, fileContent: string, fn: LocatedFn, hintNums: readonly number[] = []): MutCand[] {
  const sf = ts.createSourceFile(path, fileContent, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out: MutCand[] = [];
  const seen = new Set<string>();
  const push = (kind: MutKind, start: number, end: number, insert: string) => {
    if (start < fn.bodyStart || end > fn.bodyEnd) return; // m221-guard:in-body
    const content = replaceRange(fileContent, start, end, insert);
    if (content === fileContent) return;
    const key = `${kind}:${path}:${start}:${end}:${insert}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, path, content, key });
  };

  const visit = (n: ts.Node) => {
    // operator swap (binary)
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.getText(sf);
      for (const alt of COMPARE_OPS[op] ?? ARITH_OPS[op] ?? []) {
        push("operator-swap", n.operatorToken.getStart(sf), n.operatorToken.getEnd(), alt);
      }
      // argument / operand swap for + and * and comparisons (symmetric-ish)
      if (["+", "*", "===", "!==", "==", "!="].includes(op)) {
        const left = fileContent.slice(n.left.getStart(sf), n.left.getEnd());
        const right = fileContent.slice(n.right.getStart(sf), n.right.getEnd());
        if (left !== right) {
          const mid = fileContent.slice(n.left.getEnd(), n.right.getStart(sf));
          push("argument-swap", n.left.getStart(sf), n.right.getEnd(), right + mid + left);
        }
      }
    }
    // boundary: numeric literal +/- 1
    if (ts.isNumericLiteral(n)) {
      const v = Number(n.text);
      if (Number.isInteger(v) && Math.abs(v) < 10000) {
        push("boundary", n.getStart(sf), n.getEnd(), String(v + 1));
        push("boundary", n.getStart(sf), n.getEnd(), String(v - 1));
        push("boundary", n.getStart(sf), n.getEnd(), String(v + 2));
        push("boundary", n.getStart(sf), n.getEnd(), String(v - 2));
        push("boundary", n.getStart(sf), n.getEnd(), String(v + 3));
        push("boundary", n.getStart(sf), n.getEnd(), String(v - 3));
        for (const h of hintNums) {
          if (h !== v && Number.isInteger(h) && Math.abs(h) < 10000) push("boundary", n.getStart(sf), n.getEnd(), String(h));
        }
      }
    }
    // branch negate: if (cond) -> if (!(cond))
    if (ts.isIfStatement(n) && n.expression) {
      const e = n.expression;
      const text = fileContent.slice(e.getStart(sf), e.getEnd());
      if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
        push("branch-negate", e.getStart(sf), e.getEnd(), fileContent.slice(e.operand.getStart(sf), e.operand.getEnd()));
      } else {
        push("branch-negate", e.getStart(sf), e.getEnd(), `!(${text})`);
      }
    }
    // Template span argument-swap: swap two ${...} expressions when a template has exactly two spans.
    if (ts.isTemplateExpression(n) && n.templateSpans.length === 2) {
      const s0 = n.templateSpans[0]!, s1 = n.templateSpans[1]!;
      const e0 = fileContent.slice(s0.expression.getStart(sf), s0.expression.getEnd());
      const e1 = fileContent.slice(s1.expression.getStart(sf), s1.expression.getEnd());
      if (e0 !== e1) {
        // Rebuild template: head + ${e1} + lit0 + ${e0} + lit1  (swap expressions, keep literal tails)
        const head = n.head.text;
        const lit0 = s0.literal.text;
        const lit1 = s1.literal.text;
        // Preserve raw quote style from original slice
        const orig = fileContent.slice(n.getStart(sf), n.getEnd());
        const quote = orig.startsWith("`") ? "`" : "`";
        const rebuilt = quote + head.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "${" + e1 + "}" + lit0.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "${" + e0 + "}" + lit1.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + quote;
        // Safer: splice expression ranges only
        const content = fileContent.slice(0, s0.expression.getStart(sf)) + e1 + fileContent.slice(s0.expression.getEnd(), s1.expression.getStart(sf)) + e0 + fileContent.slice(s1.expression.getEnd());
        const key = `argument-swap:${path}:${s0.expression.getStart(sf)}:tmpl`;
        if (content !== fileContent) {
          // use push via manual since we already built full content
          const start = fn.bodyStart, end = fn.bodyEnd;
          const body = content.slice(start, end);
          push("argument-swap", start, end, body);
        }
      }
    }
    // string method substitution
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const meth = n.expression.name.text;
      if ((STRING_METHOD_CATALOG as readonly string[]).includes(meth)) {
        for (const alt of STRING_METHOD_CATALOG) {
          if (alt === meth) continue;
          push("string-method", n.expression.name.getStart(sf), n.expression.name.getEnd(), alt);
        }
      }
    }
    // string literal "?" / "x" / single junk -> empty (closed: only short non-empty literals of length 1)
    if (ts.isStringLiteral(n) && n.text.length === 1 && n.text !== " ") {
      push("string-literal-empty", n.getStart(sf), n.getEnd(), '""');
    }
    // missing return: block ending with VariableStatement const/let name = expr;
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
      // also: expression statement that should be returned
      if (ts.isExpressionStatement(last) && !ts.isReturnStatement(last as any)) {
        const expr = last.expression;
        if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          /* assignment stmt - skip */
        } else if (!ts.isCallExpression(expr) || true) {
          // only if it looks like a value expression (identifier, call, binary)
          if (ts.isIdentifier(expr) || ts.isCallExpression(expr) || ts.isBinaryExpression(expr) || ts.isPropertyAccessExpression(expr) || ts.isTemplateExpression(expr) || ts.isStringLiteral(expr)) {
            const t = fileContent.slice(expr.getStart(sf), expr.getEnd());
            push("missing-return", last.getStart(sf), last.getEnd(), `return ${t};`);
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };

  // Walk only within the function node range
  const visitAll = (n: ts.Node) => {
    if (n.getEnd() <= fn.start || n.getStart(sf) >= fn.end) return;
    if (n.getStart(sf) >= fn.start && n.getEnd() <= fn.end) visit(n);
    ts.forEachChild(n, visitAll);
  };
  visitAll(sf);

  // File-wide numeric literals: push() enforces in-body (so outside literals are refused unless that guard is deleted).
  {
    const scan = (n: ts.Node) => {
      if (ts.isNumericLiteral(n)) {
        const v = Number(n.text);
        if (Number.isInteger(v) && Math.abs(v) < 10000) push("boundary", n.getStart(sf), n.getEnd(), String(v + 1));
      }
      ts.forEachChild(n, scan);
    };
    scan(sf);
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

  // Prefer kinds that match common self-loop faults, then stable by key.
  const order: MutKind[] = ["branch-negate", "operator-swap", "string-literal-empty", "argument-swap", "missing-return", "boundary", "string-method"];
  out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.key.localeCompare(b.key));
  return out;
}

/** Build the full candidate queue for a propose turn. */
export function faultCandidates(input: Pick<ProposeInput, "files" | "request" | "feedback"> & { failing?: readonly string[] }): MutCand[] {
  const failing = input.failing ?? input.feedback.flatMap((f) => f.failing);
  const fns = locateSafeFns(input.files, input.request, failing); // m221-guard:locate
  const all: MutCand[] = [];
  const seen = new Set<string>();
  const hintNums = [...requestNums(input.request), ...failing.flatMap((f) => requestNums(f))];
  for (const fn of fns) {
    const file = input.files.find((f) => f.path === fn.path);
    if (!file) continue;
    for (const c of mutateFunction(fn.path, file.content, fn, hintNums)) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      all.push(c);
    }
  }
  return all;
}

/** Proposer: one mutation candidate per attempt; refuses when the queue is empty. */
export function faultLocalizeProposer(): Proposer {
  let queue: MutCand[] | null = null;
  let builtFor: string | null = null;
  return {
    name: FAULT_LOCALIZE_PROPOSER,
    next(input: ProposeInput): Proposal {
      // Rebuild when the task identity changes (one proposer instance may grade many practice shapes).
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
