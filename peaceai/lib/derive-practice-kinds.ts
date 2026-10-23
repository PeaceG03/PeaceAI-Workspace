// M100: wrong picks from derive-practice reports, bunched by KIND (category + normalized program shape) instead of by
// case. The shape replaces parameter names by p0, p1, ... (signature order), number literals by K and string
// literals by S, so "n <= 412" and "n <= 7" are one kind. A kind is KNOWN when the derive mistakes ledger
// (peaceai/test/m99-derive-mistakes.json) holds an entry with the same shape (and, for practice entries, the same
// category); otherwise NEW. One smallest representative (fewest examples, then shortest program) is kept per kind.
export const KINDS_SCHEMA = "peaceai-derive-practice-kinds:v1";

export interface LedgerLike { id: string; params: string[]; wrongProgram: string; examples: unknown[][]; practice?: { category?: string; knownLimit?: boolean } }
export interface Kind { kind: string; category: string; shape: string; count: number; blocking: boolean; isNew: boolean; knownAs?: string; representative: LedgerLike & Record<string, unknown> }

/** The normalized program shape: parameters p0.., numbers K, strings S, single spaces. */
export function shapeOf(expr: string, params: readonly string[]): string {
  let s = expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "S");
  s = s.replace(/\b[A-Za-z_$][\w$]*\b/g, (w) => { const i = params.indexOf(w); return i >= 0 ? `p${i}` : w; });
  s = s.replace(/(^|[^\w$])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi, "$1K");
  return s.replace(/\s+/g, " ").trim();
}

const size = (e: LedgerLike) => e.examples.length * 10000 + e.wrongProgram.length;

/** Bunches report entries into kinds and marks the ones the ledger does not hold. */
export function kindsOf(entries: readonly (LedgerLike & Record<string, unknown>)[], ledger: readonly LedgerLike[], blocking: boolean): Kind[] {
  const known = ledger.map((e) => ({ id: e.id, shape: shapeOf(e.wrongProgram, e.params), category: e.practice?.category }));
  const out = new Map<string, Kind>();
  for (const e of entries) {
    const category = e.practice?.category ?? "unknown", shape = shapeOf(e.wrongProgram, e.params), kind = `${category} | ${shape}`;
    const k = out.get(kind);
    if (k) { k.count++; if (size(e) < size(k.representative)) k.representative = e; continue; }
    const hit = known.find((x) => x.shape === shape && (!x.category || x.category === category));
    out.set(kind, { kind, category, shape, count: 1, blocking, isNew: !hit, ...(hit ? { knownAs: hit.id } : {}), representative: e });
  }
  return [...out.values()].sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : 1));
}

/** Ledger-shaped entries (peaceai-derive-mistakes:v1) for the NEW kinds, ids made from the kind, ready to append. */
export function ledgerEntriesForNew(kinds: readonly Kind[]): Record<string, unknown>[] {
  return kinds.filter((k) => k.isNew).map((k) => {
    const slug = `${k.category}-${k.shape}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const { practice, ...rest } = k.representative as Record<string, unknown> & { practice?: Record<string, unknown> };
    return { ...rest, id: `m100-kind-${slug}`, practice: { ...(practice ?? {}), kind: k.kind, kindCount: k.count } };
  });
}
