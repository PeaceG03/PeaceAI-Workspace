// Cases for the drop-hash file add-only guard (m156-droplog.ts): admits, and refused near misses. Shared by the M156
// test and its mutation check, which runs them against copies of the guard with one guard line deleted.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

type Check = (main: string, branch: string) => string | null;
const H = (s: string) => createHash("sha256").update(s).digest("hex");
const A = H("m156-a"), B = H("m156-b"), C = H("m156-c");
const L = (...rows: string[]) => rows.map((r) => r + "\n").join("");
const MAIN = L(A, B);

export const DROPLOG_CASES: { id: string; main: string; branch: string; want: string | null }[] = [
  { id: "admit: empty and unchanged", main: "", branch: "", want: null },
  { id: "admit: unchanged", main: MAIN, branch: MAIN, want: null },
  { id: "admit: first round on the empty file", main: "", branch: L(B, A), want: null },
  { id: "admit: a later round appended (order free)", main: MAIN, branch: MAIN + L(C), want: null },
  { id: "refuse: a hash edited in place", main: MAIN, branch: L(A, C), want: "rewritten" },
  { id: "refuse: a hash removed", main: MAIN, branch: L(A), want: "rewritten" },
  { id: "refuse: emptied", main: MAIN, branch: "", want: "rewritten" },
  { id: "refuse: reordered", main: MAIN, branch: L(B, A), want: "rewritten" },
  { id: "refuse: main without a final newline (an append would join its last line)", main: L(A).slice(0, -1), branch: L(A).slice(0, -1) + L(B), want: "main_no_final_newline" },
  { id: "refuse: appended line without a final newline", main: MAIN, branch: MAIN + C, want: "no_final_newline" },
  { id: "refuse: appended uppercase hash", main: MAIN, branch: MAIN + L(C.toUpperCase()), want: "file:drop_hashes_bad_line" },
  { id: "refuse: appended 63-char hash", main: MAIN, branch: MAIN + L(C.slice(1)), want: "file:drop_hashes_bad_line" },
  { id: "refuse: appended 65-char hash", main: MAIN, branch: MAIN + L(C + "0"), want: "file:drop_hashes_bad_line" },
  { id: "refuse: appended hash with a trailing space", main: MAIN, branch: MAIN + L(C + " "), want: "file:drop_hashes_bad_line" },
  { id: "refuse: appended CRLF line", main: MAIN, branch: MAIN + C + "\r\n", want: "file:drop_hashes_bad_line" },
  { id: "refuse: appended blank line", main: MAIN, branch: MAIN + "\n", want: "file:drop_hashes_bad_line" },
  { id: "refuse: appended a name or path", main: MAIN, branch: MAIN + L("src/x.ts"), want: "file:drop_hashes_bad_line" },
  { id: "refuse: appended a hash already in the file", main: MAIN, branch: MAIN + L(A), want: "file:drop_hashes_duplicate" },
];

/** Runs every case; returns the ids that did not get their expected answer. */
export function failingDropLogCases(check: Check): string[] {
  return DROPLOG_CASES.filter((c) => { try { assert.equal(check(c.main, c.branch), c.want); return false; } catch { return true; } }).map((c) => c.id);
}
