// peace-verdict parse job, `/auditor-pass` comments only (lib/auditor-pass.ts). Reads COMMENT_BODY and
// ISSUE_LABELS (JSON array of the issue's label names from the event payload). Outputs ok=true|false,
// scope=scanner-helper when the issue is in the delegated class, and refusal=<one-line text> otherwise.
// Writes nothing anywhere; the record job re-checks the task source, target and candidate diff against Results.
import { appendFileSync } from "node:fs";
import { auditorPassScope, parseAuditorPass, REFUSAL_TEXT, SCANNER_HELPER_LABEL } from "../lib/auditor-pass.ts";

let labels: string[] = [];
try {
  const v = JSON.parse(process.env.ISSUE_LABELS ?? "[]");
  if (Array.isArray(v)) labels = v.filter((x): x is string => typeof x === "string");
} catch {
  labels = [];
}
const parsed = parseAuditorPass(process.env.COMMENT_BODY ?? "");
const reason = !parsed.ok ? "malformed" : auditorPassScope(labels);
const out = reason
  ? { ok: "false", scope: "", refusal: REFUSAL_TEXT[reason] }
  : { ok: "true", scope: SCANNER_HELPER_LABEL, refusal: "" };
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
console.log(reason ? `auditor-pass refused: ${reason}` : "auditor-pass command ok (scanner-helper)");
