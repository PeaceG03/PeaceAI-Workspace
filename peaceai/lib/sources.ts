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
export function selectSources(objective: string, files: readonly SourceFile[]): SourceFile[] {
  const named = new Set(objective.match(/\b[\w./-]+\.ts\b/g) ?? []);
  const ids = taskIdentifiers(objective);
  const score = (f: SourceFile) => {
    if (named.has(f.path)) return 1_000_000;
    return ids.reduce((sum, id) => sum + (f.content.includes(id) ? 1 : 0), 0);
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
 * or that import a touched module. At most `limit`, sorted.
 */
export function relatedTests(touched: readonly string[], tests: readonly SourceFile[], limit = 6): string[] {
  const stems = touched.map((p) => p.replace(/\.ts$/, ""));
  const hits = tests.filter((t) =>
    stems.some((stem) => {
      const base = posix.basename(stem);
      if (posix.dirname(t.path) === posix.dirname(stem) && posix.basename(t.path).startsWith(`${base}.`)) return true;
      if (posix.dirname(t.path) === posix.dirname(stem) && posix.basename(t.path).startsWith(`${base}-`)) return true;
      const rel = posix.relative(posix.dirname(t.path), stem).replace(/^(?!\.)/, "./");
      return new RegExp(`from\\s+["']${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.ts|\\.js)?["']`).test(t.content);
    }),
  );
  return hits.map((t) => t.path).sort().slice(0, limit);
}
