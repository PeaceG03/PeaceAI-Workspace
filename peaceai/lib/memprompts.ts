// Memcheck prompt construction, shared by lm-memcheck.ts and lm-provenance.ts so both build the exact same prompts.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { indexGitTree, TEXT_EXT } from "./coreindex.ts";
import { isAsciiBlank } from "./lm.ts";
import type { ManifestEntry } from "./lmcorpus.ts";
import { readManifestBytes } from "./manifestparts.ts";

export interface MemcheckPrompts {
  manifest: ManifestEntry[]; texts: Map<number, string>; tree0: ReturnType<typeof indexGitTree> | null;
  prompts: { id: string; text: string }[]; built: { core: number; public: number; empty: number };
  promptShortfall: { kind: string; count: number; reason: string }[];
}

export function buildMemcheckPrompts(corpus: string, coreDir: string, counts: { core: number; public: number; empty: number }, CORE_SOURCE: string): MemcheckPrompts {
  const manifest: ManifestEntry[] = readManifestBytes(corpus, "manifest").toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const texts = new Map<number, string>();
  for (const l of readFileSync(join(corpus, "docs.jsonl"), "utf8").split("\n")) if (l) { const d = JSON.parse(l); texts.set(d.doc, d.text); }
  const h = (s: string) => createHash("sha256").update(s).digest("hex");
  const pick = (list: ManifestEntry[], n: number) => [...list].sort((a, b) => (h(`m9:${a.path}`) < h(`m9:${b.path}`) ? -1 : 1)).slice(0, n);
  const promptOf = (m: ManifestEntry) => {
    const t = texts.get(m.doc) ?? "";
    const lines = t.split("\n");
    const start = parseInt(h(`off:${m.path}`).slice(0, 8), 16) % Math.max(1, lines.length - 8);
    return lines.slice(start).join("\n").slice(0, 400);
  };
  // Run 38905982366: a core-free corpus holds no core docs, so core prompts drawn only from the corpus were 0 of 96
  // (40 prompts x 2 decodings = 80 samples). Core prompts now come from the corpus's core docs first, then from the
  // core checkout itself (text files, public-origin pins excluded, blank files skipped), same deterministic pick.
  let tree0: ReturnType<typeof indexGitTree> | null = null;
  try { tree0 = indexGitTree(coreDir, () => true, true); } catch { tree0 = null; }
  const fromCorpus = pick(manifest.filter((m) => m.source === CORE_SOURCE && (texts.get(m.doc) ?? "").trim() !== ""), counts.core).map(promptOf);
  const corePaths = tree0 ? [...tree0.paths].filter((p) => TEXT_EXT.test(p) && !(tree0!.publicOrigin ?? []).includes(p)) : [];
  const fromTree: string[] = [];
  for (const p of [...corePaths].sort((a, b) => (h(`m9:${a}`) < h(`m9:${b}`) ? -1 : 1))) {
    if (fromCorpus.length + fromTree.length >= counts.core) break;
    try {
      const full = join(coreDir, p);
      if (!statSync(full).isFile() || statSync(full).size > 2 * 1024 * 1024) continue;
      const t = readFileSync(full, "utf8");
      if (isAsciiBlank(t)) continue;
      const lines = t.split("\n");
      const start = parseInt(h(`off:${p}`).slice(0, 8), 16) % Math.max(1, lines.length - 8);
      const text = lines.slice(start).join("\n").slice(0, 400);
      if (text.trim() !== "") fromTree.push(text);
    } catch { /* unreadable: skipped, reported as a shortfall */ }
  }
  const publicPrompts = pick(manifest.filter((m) => m.source !== CORE_SOURCE && (texts.get(m.doc) ?? "").trim() !== ""), counts.public).map(promptOf);
  const prompts = [
    ...[...fromCorpus, ...fromTree].map((text, i) => ({ id: `core-${i}`, text })),
    ...publicPrompts.map((text, i) => ({ id: `public-${i}`, text })),
    ...Array.from({ length: counts.empty }, (_, i) => ({ id: `empty-${i}`, text: "" })),
  ];
  const kindOf = (id: string) => id.split("-")[0]!;
  const built = { core: fromCorpus.length + fromTree.length, public: publicPrompts.length, empty: counts.empty };
  const promptShortfall: { kind: string; count: number; reason: string }[] = [];
  if (built.core < counts.core) promptShortfall.push({ kind: "core", count: counts.core - built.core, reason: tree0 ? "NOT_ENOUGH_CORE_TEXT (corpus core docs + core checkout files)" : "CORE_CHECKOUT_UNREADABLE" });
  if (built.public < counts.public) promptShortfall.push({ kind: "public", count: counts.public - built.public, reason: "NOT_ENOUGH_PUBLIC_DOCS" });
  return { manifest, texts, tree0, prompts, built, promptShortfall };
}
