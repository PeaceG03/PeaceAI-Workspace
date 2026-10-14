// M9 corpus rules: which files may train the from-scratch model, and how each is recorded.
// Only Peace's own repositories and permissively licensed code (MIT, Apache-2.0, BSD-2/3-Clause, ISC).
import { createHash } from "node:crypto";
import { scanText } from "./leak.ts";

export const ALLOWED_SPDX = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"] as const;
export type Spdx = (typeof ALLOWED_SPDX)[number];
export const CODE_FILE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
export const MAX_FILE_BYTES = 150_000;
export const HELD_OUT_PERCENT = 5;

// Text that means a LICENSE file is not one plain permissive license.
const MIXED = /GNU (?:General|Lesser|Affero)|Mozilla Public|Blue ?Oak|Creative Commons|Server Side Public|Business Source|respective `?LICENSE|except those files/i;

/** Classifies a LICENSE text. null = not a single allowed permissive license (the source is refused). */
export function classifyLicense(text: string): Spdx | null {
  const t = text.replace(/\s+/g, " ");
  if (MIXED.test(t)) return null;
  if (/Apache License,? Version 2\.0, January 2004/i.test(t)) return "Apache-2.0";
  if (/Permission is hereby granted, free of charge, to any person obtaining a copy/i.test(t) && /PROVIDED "AS IS"/i.test(t)) return "MIT";
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice/i.test(t)) return "ISC";
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? "BSD-3-Clause" : "BSD-2-Clause";
  return null;
}

const HEADER_DENY = /\b(?:A?GPL|LGPL|GNU General|Mozilla Public|MPL-[0-9]|Creative Commons|CC-BY|Blue ?Oak|SSPL|Business Source License|proprietary)\b/i;
const SPDX_TAG = /SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+)/;

export type Exclusion =
  | "not-code" | "excluded-dir" | "minified" | "too-large" | "generated" | "nested-license" | "license-header" | "personal-info" | "binary" | "held-out";

/**
 * Held-out generation sets (peaceai/model/heldout.json, fixed before any run): every file a held-out commit
 * touched is excluded from the corpus for that source, at every commit, for BOTH sets (A: measured during
 * development; B: untouched, final pass rate only). Keys are `${source}\0${path}`.
 */
export interface HeldOutFile { schema: "peaceai-heldout:v1"; sets: Record<"A" | "B", { repo: string; sha: string; kind: string; paths: string[]; contentSha256?: string[] }[]> }
export function heldOutPaths(h: HeldOutFile): Set<string> {
  if (h.schema !== "peaceai-heldout:v1" || !Array.isArray(h.sets?.A) || !Array.isArray(h.sets?.B)) throw new Error("bad held-out file");
  return new Set([...h.sets.A, ...h.sets.B].flatMap((e) => e.paths.map((p) => `${e.repo}\0${p}`)));
}
/**
 * Round 2 (Auditor, M28 1): content sha256 of every blob of a held-out commit's touched paths (at the commit, its
 * parent and the pinned head). Any file in ANY corpus source (incl. byte-identical copies in the private PeaceAI
 * source, whose paths never match a public key) with one of these hashes is excluded. Fails closed if an entry has none.
 */
export function heldOutHashes(h: HeldOutFile): Set<string> {
  heldOutPaths(h);
  const out = new Set<string>();
  for (const e of [...h.sets.A, ...h.sets.B]) {
    if (!Array.isArray(e.contentSha256) || e.contentSha256.length === 0 || !e.contentSha256.every((x) => /^[0-9a-f]{64}$/.test(x))) throw new Error(`held-out entry ${e.sha} has no content hashes`);
    for (const x of e.contentSha256) out.add(x);
  }
  return out;
}
/** True when a corpus file is held out: by path in its own source, or by content in any source. */
export function isHeldOut(source: string, path: string, sha256: string, paths: ReadonlySet<string>, hashes: ReadonlySet<string>): boolean {
  return paths.has(`${source}\0${path}`) || hashes.has(sha256);
}

/** Why a file is not used (null = used). `licenseDirs` are directories (below the root) holding their own LICENSE. */
export function fileExclusion(path: string, text: string, licenseDirs: readonly string[], owner: boolean): Exclusion | null {
  if (!CODE_FILE.test(path)) return "not-code";
  if (/(?:^|\/)(?:node_modules|dist|build|vendor|vendors|third_party|coverage|\.git|fixtures?\/big)\//.test(path)) return "excluded-dir";
  if (/\.min\.[cm]?js$/.test(path)) return "minified";
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) return "too-large";
  if (text.includes("\u0000")) return "binary";
  const lines = text.split("\n");
  if (lines.length > 0 && text.length / lines.length > 300) return "minified";
  const head = lines.slice(0, 40).join("\n");
  if (/@generated|DO NOT EDIT|auto-?generated/i.test(lines.slice(0, 10).join("\n"))) return "generated";
  if (!owner) {
    if (licenseDirs.some((d) => path.startsWith(d + "/"))) return "nested-license";
    const tag = SPDX_TAG.exec(head)?.[1];
    if (HEADER_DENY.test(head) || (tag && !(ALLOWED_SPDX as readonly string[]).includes(tag))) return "license-header";
  }
  if (scanText(text).length > 0) return "personal-info";
  return null;
}

/** Deterministic held-out split by file identity (about HELD_OUT_PERCENT of files). */
export function splitOf(source: string, path: string): "train" | "heldout" {
  const b = createHash("sha256").update(`${source}\n${path}`).digest()[0]!;
  return b < Math.round((256 * HELD_OUT_PERCENT) / 100) ? "heldout" : "train";
}

export interface ManifestEntry {
  doc: number;
  source: string;
  visibility: "private" | "public";
  commit: string;
  path: string;
  sha256: string;
  bytes: number;
  license: string; // SPDX id, or "owner:PeaceG03" for Peace's own repositories
  split: "train" | "heldout";
}
