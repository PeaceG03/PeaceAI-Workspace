// M31 (Architect): the public-runner LM corpus. Peace's PUBLIC commits only (owner public sources pinned in
// peaceai/model/lm-public-allow.json), every heldout.json A+B file excluded by content sha256, no private source,
// no permissive/external code. The manifest check fails closed on any held-out sha or anything off the allowlist.
export const ALLOW_SCHEMA = "peaceai-lm-public-allow:v1";
export interface PublicAllow { schema: string; sources: Record<string, string>; sha256: string[] }
export interface PublicManifestEntry { doc: number; source: string; visibility: string; commit: string; path: string; sha256: string; bytes: number; license: string; split: string }

export function validAllow(raw: unknown): PublicAllow | null {
  const a = raw as PublicAllow;
  if (!a || a.schema !== ALLOW_SCHEMA || typeof a.sources !== "object" || !Array.isArray(a.sha256)) return null;
  if (!Object.keys(a.sources).length || !Object.keys(a.sources).every((s) => s.startsWith("PeaceG03/") && /^[0-9a-f]{40}$/.test(a.sources[s]!))) return null;
  if (!a.sha256.every((h) => /^[0-9a-f]{64}$/.test(h))) return null;
  return a;
}

/** Every reason the manifest may not be trained on; empty = OK. Reasons carry counts/sources, never text. */
export function manifestProblems(manifest: readonly PublicManifestEntry[], heldOut: ReadonlySet<string>, allow: PublicAllow): string[] {
  const allowed = new Set(allow.sha256);
  const n = { heldOut: 0, private: 0, source: 0, commit: 0, notAllowed: 0 };
  for (const m of manifest) {
    if (heldOut.has(m.sha256)) n.heldOut++;
    if (m.visibility !== "public") n.private++;
    if (!Object.hasOwn(allow.sources, m.source)) n.source++;
    else if (allow.sources[m.source] !== m.commit) n.commit++;
    if (!allowed.has(m.sha256)) n.notAllowed++;
  }
  const out: string[] = [];
  if (!manifest.length) out.push("empty manifest");
  if (n.heldOut) out.push(`held-out sha256 present: ${n.heldOut}`);
  if (n.private) out.push(`non-public entries: ${n.private}`);
  if (n.source) out.push(`source not in the public allowlist: ${n.source}`);
  if (n.commit) out.push(`commit differs from the pinned public commit: ${n.commit}`);
  if (n.notAllowed) out.push(`sha256 not in the public allowlist: ${n.notAllowed}`);
  return out;
}

/** Keeps the allowlisted, non-held-out public entries (renumbered); the check above still runs on the result. */
export function filterPublic(manifest: readonly PublicManifestEntry[], docs: readonly string[], heldOut: ReadonlySet<string>, allow: PublicAllow): { manifest: PublicManifestEntry[]; docs: string[]; dropped: number } {
  const allowed = new Set(allow.sha256);
  const outM: PublicManifestEntry[] = [], outD: string[] = [];
  manifest.forEach((m, i) => {
    if (heldOut.has(m.sha256) || m.visibility !== "public" || allow.sources[m.source] !== m.commit || !allowed.has(m.sha256)) return;
    const doc = outM.length;
    outM.push({ ...m, doc });
    outD.push(JSON.stringify({ doc, text: (JSON.parse(docs[i]!) as { text: string }).text }));
  });
  return { manifest: outM, docs: outD, dropped: manifest.length - outM.length };
}
