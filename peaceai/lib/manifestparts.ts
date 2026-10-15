// M51: a manifest stored either as one file (<base>.jsonl) or split into parts (<base>/index.json + part-NNN.jsonl,
// each under the pre-push 2 MB limit). The parts concatenate byte-for-byte to the single file, so the manifest's
// identity (the sha256 of the whole) is unchanged. Readers fail closed: both formats present, a missing index, a
// missing/altered/extra part, or a combined sha256 that does not match the index all throw. Python twin:
// peaceai/model/manifest_parts.py (parity-tested in m51-manifest-parts.test.ts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PARTS_SCHEMA = "peaceai-manifest-parts:v1";
export const PART_MAX_BYTES = 1_900_000;
const PART_NAME = /^part-\d{3}\.jsonl$/;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export interface PartsIndex { schema: string; combinedSha256: string; bytes: number; parts: { name: string; sha256: string; bytes: number }[] }

/** Deterministic split at line boundaries: greedy, each part <= max bytes and ending in "\n". */
export function splitLines(buf: Buffer, max = PART_MAX_BYTES): Buffer[] {
  if (buf.length === 0 || buf[buf.length - 1] !== 10) throw new Error("manifest must be non-empty and end with a newline");
  const out: Buffer[] = [];
  let start = 0;
  while (start < buf.length) {
    let end = Math.min(start + max, buf.length);
    if (end < buf.length) { const nl = buf.lastIndexOf(10, end - 1); if (nl < start) throw new Error("a single manifest line exceeds the part limit"); end = nl + 1; }
    out.push(buf.subarray(start, end)); start = end;
  }
  return out;
}

export function indexOf(buf: Buffer, max = PART_MAX_BYTES): { index: PartsIndex; parts: Buffer[] } {
  const parts = splitLines(buf, max);
  return { parts, index: { schema: PARTS_SCHEMA, combinedSha256: sha(buf), bytes: buf.length, parts: parts.map((p, i) => ({ name: `part-${String(i).padStart(3, "0")}.jsonl`, sha256: sha(p), bytes: p.length })) } };
}

/** Write <dir>/<base>/ as parts + index.json. Refuses when <base>.jsonl exists or <base>/ is not empty. */
export function writeParts(dir: string, base: string, buf: Buffer, max = PART_MAX_BYTES): PartsIndex {
  if (existsSync(join(dir, `${base}.jsonl`))) throw new Error(`mixed manifest formats: ${base}.jsonl exists`);
  const d = join(dir, base);
  if (existsSync(d) && readdirSync(d).length) throw new Error(`${base}/ is not empty`);
  mkdirSync(d, { recursive: true });
  const { index, parts } = indexOf(buf, max);
  parts.forEach((p, i) => writeFileSync(join(d, index.parts[i]!.name), p));
  writeFileSync(join(d, "index.json"), JSON.stringify(index, null, 1) + "\n");
  return index;
}

/** Check a parsed index against the files present; returns the combined bytes. Pure (the reader does the I/O). */
export function joinParts(index: unknown, files: ReadonlyMap<string, Buffer>): Buffer {
  const ix = index as PartsIndex;
  if (!ix || typeof ix !== "object" || ix.schema !== PARTS_SCHEMA || !Array.isArray(ix.parts) || ix.parts.length === 0) throw new Error("bad parts index");
  if (typeof ix.combinedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(ix.combinedSha256) || !Number.isInteger(ix.bytes)) throw new Error("bad parts index");
  const names = ix.parts.map((p, i) => { if (!p || p.name !== `part-${String(i).padStart(3, "0")}.jsonl`) throw new Error(`bad part name at ${i}`); return p.name; });
  for (const f of files.keys()) if (!names.includes(f)) throw new Error(`extra file in parts dir: ${f}`);
  const bufs = ix.parts.map((p) => {
    const b = files.get(p.name);
    if (!b) throw new Error(`missing part ${p.name}`);
    if (b.length !== p.bytes || sha(b) !== p.sha256) throw new Error(`altered part ${p.name}`);
    if (b.length === 0 || b[b.length - 1] !== 10) throw new Error(`part ${p.name} does not end at a line`);
    return b;
  });
  const all = Buffer.concat(bufs);
  if (all.length !== ix.bytes || sha(all) !== ix.combinedSha256) throw new Error("combined sha256 does not match the index");
  return all;
}

/** Read <dir>/<base>.jsonl or <dir>/<base>/ (never both). Returns the whole manifest's bytes. */
export function readManifestBytes(dir: string, base: string): Buffer {
  const single = join(dir, `${base}.jsonl`), d = join(dir, base);
  const hasSingle = existsSync(single), hasDir = existsSync(d);
  if (hasSingle && hasDir) throw new Error(`mixed manifest formats: both ${base}.jsonl and ${base}/`);
  if (hasSingle) return readFileSync(single);
  if (!hasDir || !statSync(d).isDirectory()) throw new Error(`no manifest: ${base}.jsonl or ${base}/`);
  const files = new Map<string, Buffer>();
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === "index.json") continue;
    if (!e.isFile() || !PART_NAME.test(e.name)) throw new Error(`extra file in parts dir: ${e.name}`);
    files.set(e.name, readFileSync(join(d, e.name)));
  }
  if (!existsSync(join(d, "index.json"))) throw new Error("missing parts index");
  return joinParts(JSON.parse(readFileSync(join(d, "index.json"), "utf8")), files);
}
