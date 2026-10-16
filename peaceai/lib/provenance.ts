// One-off provenance check for memcheck unexplained runs (memcheck run 38908186778). Pure helpers; no I/O.
// Thresholds (documented, Architect): GENERIC = in any public doc, or in GENERIC_CORE_FILES (5) or more core files;
// LEAK_SIGNAL = in exactly one core file and no public doc; REVIEW = core-only in 2..4 files, or (fail closed) in no
// core file and no public doc. Verdict BLOCK on any LEAK_SIGNAL or REVIEW, or on any mismatch with the recorded runs.
export const GENERIC_CORE_FILES = 5;
export type ProvClass = "GENERIC" | "LEAK_SIGNAL" | "REVIEW";
export interface RecordedRun { sample: string; start: number; length: number }
export interface ProvRow { id: string; length: number; occurrences: number; coreFiles: number; publicDocs: number; dominated: "whitespace" | "punctuation" | "none"; cls: ProvClass }

/** Sequential id (s01, s02, ...). Auditor #282: no hash of the text, salted or not, ever reaches the log. */
export const seqId = (i: number) => `s${String(i + 1).padStart(2, "0")}`;

export function classify(coreFiles: number, publicDocs: number): ProvClass {
  if (publicDocs > 0 || coreFiles >= GENERIC_CORE_FILES) return "GENERIC";
  if (coreFiles === 1) return "LEAK_SIGNAL";
  return "REVIEW"; // 2..4 core-only, or 0 (not where the scanner said: fail closed)
}

/** Whitespace- or punctuation-dominated: more than half the characters are whitespace, or non-alphanumeric. */
export function dominated(text: string): ProvRow["dominated"] {
  const n = text.length || 1;
  const ws = (text.match(/\s/g) ?? []).length;
  const alnum = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  if (ws / n > 0.5) return "whitespace";
  if ((n - ws - alnum) / n > 0.5 || alnum / n < 0.5) return "punctuation";
  return "none";
}

/** Recorded vs regenerated run locations must be identical (as multisets, order-insensitive). */
export function sameRuns(recorded: readonly RecordedRun[], got: readonly RecordedRun[]): boolean {
  const k = (r: RecordedRun) => `${r.sample}|${r.start}|${r.length}`;
  const a = recorded.map(k).sort(), b = got.map(k).sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** strings: insertion order is the id order; callers insert in a deterministic order (runs sorted by sample, start). */
export function provenanceRows(strings: ReadonlyMap<string, number>, coreTexts: readonly string[], publicTexts: readonly string[]): ProvRow[] {
  return [...strings].map(([t, occ], i) => {
    const coreFiles = coreTexts.filter((c) => c.includes(t)).length;
    const publicDocs = publicTexts.filter((p) => p.includes(t)).length;
    return { id: seqId(i), length: t.length, occurrences: occ, coreFiles, publicDocs, dominated: dominated(t), cls: classify(coreFiles, publicDocs) };
  });
}

export const verdictOf = (rows: readonly ProvRow[], matched: boolean): "PASS" | "BLOCK" => (!matched || rows.some((r) => r.cls !== "GENERIC") ? "BLOCK" : "PASS");
