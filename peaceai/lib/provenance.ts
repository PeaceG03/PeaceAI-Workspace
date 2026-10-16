// One-off provenance check for memcheck unexplained runs (memcheck run 38913032640). Pure helpers; no I/O.
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

// ---- prompt overlap (Architect/Auditor #285): each run vs its own sample's prompt (the context before the output).
/** A tail continuation counts only when the shared part is at least PROMPT_OVERLAP_MIN (16) characters and is not
 *  whitespace- or punctuation-dominated (`dominated`); shorter or filler overlaps (indentation, `function `) are none. */
export const PROMPT_OVERLAP_MIN = 16;
export type PromptOverlap = "inside" | "extends" | "none";
/** Tail continuation length: the run must start at offset 0 of the generated output, and the longest prefix of it that
 *  equals a suffix of the prompt is the overlap. A run elsewhere, or a mid-prompt substring match, has overlap 0. */
export function tailOverlapLength(run: string, start: number, prompt: string): number {
  if (start !== 0) return 0;
  for (let k = Math.min(run.length, prompt.length); k > 0; k--) if (prompt.endsWith(run.slice(0, k))) return k;
  return 0;
}
/** inside: the whole run is the prompt's tail continuation; extends: a qualifying tail continuation, then more; else none.
 *  NOTE: PROMPT_LINKED_ALL never lifts the class verdict's BLOCK (exit code unchanged); it can only justify a memcheck
 *  exemption PR and a re-run. */
export function promptOverlap(run: string, start: number, prompt: string): { overlap: number; cls: PromptOverlap } {
  const overlap = tailOverlapLength(run, start, prompt);
  const ok = overlap >= PROMPT_OVERLAP_MIN && dominated(run.slice(0, overlap)) === "none";
  return { overlap, cls: !ok ? "none" : overlap === run.length ? "inside" : "extends" };
}
export const promptVerdict = (classes: readonly PromptOverlap[]): "PROMPT_LINKED_ALL" | "LEAK" => (classes.length > 0 && classes.every((c) => c !== "none") ? "PROMPT_LINKED_ALL" : "LEAK");
