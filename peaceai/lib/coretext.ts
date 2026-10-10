import { createHash } from "node:crypto";

// Detects text copied from a private reference tree using hashed lines and hashed 3-line shingles.
// Only hashes are kept in memory; matched text is never printed.
export const LONG_LINE = 60;
export const SHINGLE_LINE = 12;
export const SHINGLE_SIZE = 4;

export function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

// Module boilerplate is shared by unrelated code and is ignored.
const BOILERPLATE = /^(?:import\b.*\bfrom\s+["'][^"']+["'];?|import\s+["'][^"']+["'];?|export\s+(?:\*|\{[^}]*\})\s+from\s+["'][^"']+["'];?|(?:const|let|var)\s+\w+\s*=\s*require\(["'][^"']+["']\);?)$/;

export function isBoilerplate(normalized: string): boolean {
  return BOILERPLATE.test(normalized);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export interface TextIndex {
  lines: Set<string>;
  shingles: Set<string>;
}

export function emptyIndex(): TextIndex {
  return { lines: new Set(), shingles: new Set() };
}

function shingleKeys(normalized: readonly string[]): string[] {
  const keys: string[] = [];
  const usable = normalized.filter((line) => line.length >= SHINGLE_LINE && !isBoilerplate(line));
  for (let i = 0; i + SHINGLE_SIZE <= usable.length; i += 1)
    keys.push(hash(usable.slice(i, i + SHINGLE_SIZE).join("\n")));
  return keys;
}

export function addText(index: TextIndex, text: string): void {
  const normalized = text.split("\n").map(normalizeLine);
  for (const line of normalized) if (line.length >= LONG_LINE && !isBoilerplate(line)) index.lines.add(hash(line));
  for (const key of shingleKeys(normalized)) index.shingles.add(key);
}

export interface CoreTextHits {
  lineHits: number;
  shingleHits: number;
}

/**
 * Counts copied lines/shingles in `added`, ignoring anything already present in `baseline`
 * (text that already exists in the public workspace cannot leak through this change).
 */
export function findCoreText(added: readonly string[], core: TextIndex, baseline: TextIndex): CoreTextHits {
  const normalized = added.map(normalizeLine);
  let lineHits = 0;
  for (const line of normalized) {
    if (line.length < LONG_LINE || isBoilerplate(line)) continue;
    const key = hash(line);
    if (core.lines.has(key) && !baseline.lines.has(key)) lineHits += 1;
  }
  let shingleHits = 0;
  for (const key of shingleKeys(normalized)) if (core.shingles.has(key) && !baseline.shingles.has(key)) shingleHits += 1;
  return { lineHits, shingleHits };
}

const GENERIC_BASENAMES = new Set([
  "index.ts",
  "index.js",
  "types.ts",
  "utils.ts",
  "README.md",
  "package.json",
  "tsconfig.json",
  "LICENSE",
  ".gitignore",
]);

/** Path-level check: same relative path as a core file, or a distinctive core file name. */
export function corePathCollision(path: string, corePaths: ReadonlySet<string>, coreBasenames: ReadonlySet<string>): boolean {
  if (corePaths.has(path)) return true;
  const base = path.split("/").pop() ?? path;
  return !GENERIC_BASENAMES.has(base) && coreBasenames.has(base);
}
