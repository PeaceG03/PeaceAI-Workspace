// M20: the object-literal argument checker for `args: object-literal` test specs (protected).
import ts from "typescript";

/** M20 (`args: object-literal` specs only): longer checks whose extra length is bounded object-literal arguments. */
export const MAX_OBJECT_EXPR_CHARS = 600;
export const MAX_OBJECT_DEPTH = 3;
export const MAX_OBJECT_KEYS = 16;
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * M20: every object literal in the check is plain data: property assignments only (no spread, shorthand,
 * methods, getters, computed keys), identifier or string keys that are not __proto__/constructor/prototype and
 * not repeated, at most MAX_OBJECT_KEYS keys each, nested at most MAX_OBJECT_DEPTH deep. Null when fine.
 */
export function objectArgsReason(e: ts.Node, depth = 0): string | null {
  if (ts.isObjectLiteralExpression(e)) {
    if (depth >= MAX_OBJECT_DEPTH) return "too deep";
    if (e.properties.length > MAX_OBJECT_KEYS) return "too many keys";
    const seen = new Set<string>();
    for (const p of e.properties) {
      if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return "not a plain property";
      const k = p.name.text;
      if (BAD_KEYS.has(k) || seen.has(k)) return "bad or repeated key";
      seen.add(k);
      const r = objectArgsReason(p.initializer, depth + 1);
      if (r) return r;
    }
    return null;
  }
  let r: string | null = null;
  ts.forEachChild(e, (c) => { r ??= objectArgsReason(c, depth); });
  return r;
}
