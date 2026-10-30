// M5: bounded source context for larger targets, and related-test selection for "related" suites.
import { posix } from "node:path";

export const MAX_SOURCES = 20; // kernel budget: 20 sources
export const MAX_SOURCE_BYTES = 190_000; // kernel budget: 200 KB, minus headroom

export interface SourceFile {
  path: string;
  content: string;
}

/** Identifier-like tokens in the task text: camelCase, PascalCase or SNAKE_CASE words. */
export function taskIdentifiers(objective: string): string[] {
  const words = objective.match(/[A-Za-z_$][\w$]{2,63}/g) ?? [];
  return [...new Set(words.filter((w) => /[a-z][A-Z]|^[A-Z][a-z]+[A-Z]|_/.test(w) || /^[A-Z][A-Z0-9_]{2,}$/.test(w)))];
}

/**
 * Picks at most MAX_SOURCES files within MAX_SOURCE_BYTES: files named in the task first, then files that
 * mention the task's identifiers (most mentions first), then the smallest remaining. Deterministic; the
 * result keeps the input order so small repos (everything fits) behave exactly as before.
 */
export function selectSources(
  objective: string,
  files: readonly SourceFile[],
  boost: ReadonlyMap<string, number> = new Map(),
): SourceFile[] {
  const named = new Set(objective.match(/\b[\w./-]+\.ts\b/g) ?? []);
  const ids = taskIdentifiers(objective);
  // M6: `boost` carries the symbol/keyword index's view (resolved targets, related files, BM25 hits).
  const score = (f: SourceFile) => {
    if (named.has(f.path)) return 1_000_000;
    return (boost.get(f.path) ?? 0) + ids.reduce((sum, id) => sum + (f.content.includes(id) ? 1 : 0), 0);
  };
  const ranked = [...files].sort((a, b) => score(b) - score(a) || a.content.length - b.content.length || (a.path < b.path ? -1 : 1));
  const chosen = new Set<string>();
  let bytes = 0;
  for (const f of ranked) {
    const size = Buffer.byteLength(f.content);
    if (chosen.size >= MAX_SOURCES || bytes + size > MAX_SOURCE_BYTES) continue;
    chosen.add(f.path);
    bytes += size;
  }
  return files.filter((f) => chosen.has(f.path));
}

/**
 * Existing tests related to the touched source files: tests whose name starts with a touched file's stem,
 * or that import a touched module. At most `limit`, sorted (with `ownFirst`: the touched modules' own tests first).
 */
export function relatedTests(touched: readonly string[], tests: readonly SourceFile[], limit = 6, options: { ownFirst?: boolean } = {}): string[] {
  const stems = touched.map((p) => p.replace(/\.ts$/, ""));
  const hits = tests.filter((t) => stems.some((stem) => isOwnTest(t.path, stem) || importsStem(t, stem)));
  const sorted = hits.map((t) => t.path).sort();
  // W619 (Auditor #620 follow-up): with ownFirst, the touched module's own test files (same directory,
  // `<stem>.*` / `<stem>-*`) come first, before importers, so a pool cut never drops the direct tests.
  // Stable: each group keeps the sorted order.
  const ordered = options.ownFirst
    ? [...sorted.filter((path) => stems.some((stem) => isOwnTest(path, stem))), ...sorted.filter((path) => !stems.some((stem) => isOwnTest(path, stem)))]
    : sorted;
  return ordered.slice(0, limit);
}

/** A test file in the touched module's directory whose name starts with `<stem>.` or `<stem>-`. */
function isOwnTest(path: string, stem: string): boolean {
  if (posix.dirname(path) !== posix.dirname(stem)) return false;
  const base = posix.basename(stem);
  const name = posix.basename(path);
  return name.startsWith(`${base}.`) || name.startsWith(`${base}-`);
}

function importsStem(t: SourceFile, stem: string): boolean {
  const rel = posix.relative(posix.dirname(t.path), stem).replace(/^(?!\.)/, "./");
  return new RegExp(`from\\s+["']${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.ts|\\.js)?["']`).test(t.content);
}

/**
 * M6: index-derived source priorities. Resolved task targets first (in resolution order), then files
 * related to them (imports, importers, references), then the BM25 keyword hits for the task text.
 */
export function indexBoost(
  targets: readonly string[],
  related: readonly string[],
  keywordHits: readonly string[],
): Map<string, number> {
  const boost = new Map<string, number>();
  const add = (path: string, value: number) => boost.set(path, Math.max(boost.get(path) ?? 0, value));
  targets.forEach((p, i) => add(p, 100_000 - i));
  related.forEach((p, i) => add(p, 10_000 - i));
  keywordHits.forEach((p, i) => add(p, 1_000 - i));
  return boost;
}
