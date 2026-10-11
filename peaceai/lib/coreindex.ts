import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { addText, emptyIndex, type TextIndex } from "./coretext.ts";

const MAX_FILE_BYTES = 1_000_000;
const TEXT_EXT = /\.(?:[cm]?[jt]sx?|json|md|ya?ml|ps1|psm1|sh|py|txt|html|css|toml)$/i;

export interface TreeIndex {
  /** Paths left out of the text index because they matched a public-origin pin. */
  publicOrigin?: string[];
  text: TextIndex;
  /** Raw file contents, only when asked for (the memorization check's exact-substring scan). */
  raw?: string[];
  paths: Set<string>;
  basenames: Set<string>;
}

/**
 * Public-origin allowlist (core, Peace's decision): files that core shares byte-for-byte with a PUBLIC repo
 * (PeaceSTOCKS). Each entry pins an exact path and the sha256 of its exact bytes; no wildcards, globs or
 * directories. indexGitTree leaves a file out of the text index (and the raw substring index) ONLY when the
 * checkout tracks this allowlist, the file's path is listed, and its current bytes hash to the pinned sha256.
 * Changed content, another path, or an unreadable/malformed allowlist: the file is indexed as private (fail closed).
 * Paths and basenames are always kept.
 */
export const PUBLIC_ORIGIN_FILE = "docs/peaceai-public-origin.json";
export const PUBLIC_ORIGIN_SCHEMA = "peaceai-public-origin:v1";
const EXACT_PATH = /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._\-/]+(?<!\/)$/;

export function parsePublicOrigin(text: string): { ok: true; pins: Map<string, string> } | { ok: false; reason: string } {
  let doc: { schema?: unknown; files?: unknown };
  try { doc = JSON.parse(text); } catch { return { ok: false, reason: "NOT_JSON" }; }
  if (!doc || doc.schema !== PUBLIC_ORIGIN_SCHEMA || !Array.isArray(doc.files)) return { ok: false, reason: "BAD_SCHEMA" };
  const pins = new Map<string, string>();
  for (const f of doc.files as { path?: unknown; sha256?: unknown; origin?: unknown }[]) {
    if (!f || typeof f.path !== "string" || !EXACT_PATH.test(f.path)) return { ok: false, reason: "BAD_PATH" };
    if (typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) return { ok: false, reason: "BAD_SHA256" };
    if (typeof f.origin !== "string" || !f.origin) return { ok: false, reason: "NO_ORIGIN" };
    if (pins.has(f.path)) return { ok: false, reason: "DUPLICATE_PATH" };
    pins.set(f.path, f.sha256);
  }
  return { ok: true, pins };
}

function loadPublicOrigin(dir: string, tracked: readonly string[]): Map<string, string> {
  if (!tracked.includes(PUBLIC_ORIGIN_FILE)) return new Map();
  let text: string;
  try { text = readFileSync(join(dir, PUBLIC_ORIGIN_FILE), "utf8"); } catch { return new Map(); }
  const r = parsePublicOrigin(text);
  if (!r.ok) { process.stderr.write(`public-origin allowlist ignored (${r.reason}); all files indexed as private\n`); return new Map(); }
  return r.pins;
}

/** Indexes the tracked text files of a git checkout. Reads files only; keeps hashes and paths in memory. */
export function indexGitTree(dir: string, filter: (path: string) => boolean = () => true, keepRaw = false): TreeIndex {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
    .filter(filter);
  const pins = loadPublicOrigin(dir, files);
  const index: TreeIndex = { text: emptyIndex(), paths: new Set(), basenames: new Set(), ...(keepRaw ? { raw: [] } : {}) };
  for (const path of files) {
    index.paths.add(path);
    index.basenames.add(path.split("/").pop() ?? path);
    if (!TEXT_EXT.test(path)) continue;
    const full = join(dir, path);
    try {
      const stat = statSync(full);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      const bytes = readFileSync(full);
      const pinned = pins.get(path);
      if (pinned !== undefined && createHash("sha256").update(bytes).digest("hex") === pinned) { (index.publicOrigin ??= []).push(path); continue; }
      const content = bytes.toString("utf8");
      addText(index.text, content);
      index.raw?.push(content);
    } catch {
      // Unreadable files are skipped; they cannot be matched either way.
    }
  }
  return index;
}
