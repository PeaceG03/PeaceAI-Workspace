// M156 drop-hash file guard: peaceai/model/lb-hidden-drop-hashes.txt holds Auditor's --matched-out hashes (hashes
// only). Rounds land via PRs, so a branch may APPEND whole lines to it but never rewrite it, and the whole file must
// stay a valid --drop-hashes file (parseDropHashes: lowercase 64-hex, LF, no duplicate across rounds) once it is not
// empty. Each guard is one line tagged "// guard:<id>"; the M156 mutation test deletes each one in a copy and requires
// a case in m156-droplog-cases.ts to fail.
import { parseDropHashes } from "../lib/lbclean.ts";

/** null when `branch` is `main` plus whole lines and, if not empty, a valid drop-hash file. */
export function dropLogAddOnlyProblem(main: string, branch: string): string | null {
  if (!branch.startsWith(main)) return "rewritten"; // guard:drop-log-prefix
  if (main.length > 0 && !main.endsWith("\n")) return "main_no_final_newline"; // guard:drop-log-main-newline
  const added = branch.slice(main.length);
  if (added.length > 0 && !added.endsWith("\n")) return "no_final_newline"; // guard:drop-log-newline
  const r = branch.length > 0 ? parseDropHashes(Buffer.from(branch, "utf8")) : null;
  if (r && "code" in r) return `file:${r.code}`; // guard:drop-log-file
  return null;
}
