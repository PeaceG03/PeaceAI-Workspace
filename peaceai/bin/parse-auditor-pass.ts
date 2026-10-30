// peace-verdict parse job, `/auditor-pass` comments only (lib/auditor-pass.ts). Reads COMMENT_BODY and
// ISSUE_LABELS (JSON array of the issue's label names from the event payload). Outputs ok=true|false,
// scope=scanner-helper|scanner-wiring when the issue is in exactly one delegated class, and refusal=<one-line text> otherwise.
// Writes nothing anywhere; the record job re-checks the task source, target and candidate diff against Results.
import { appendFileSync } from "node:fs";
import { auditorPassClass, parseAuditorPass, REFUSAL_TEXT } from "../lib/auditor-pass.ts";

let labels: string[] = [];
try {
  const v = JSON.parse(process.env.ISSUE_LABELS ?? "[]");
  if (Array.isArray(v)) labels = v.filter((x): x is string => typeof x === "string");
} catch {
  labels = [];
}
const parsed = parseAuditorPass(process.env.COMMENT_BODY ?? "");
const scope = auditorPassClass(labels);
const reason = !parsed.ok ? "malformed" : scope.refusal;
const out = reason || !scope.cls
  ? { ok: "false", scope: "", refusal: REFUSAL_TEXT[reason ?? "not-scanner-helper"] }
  : { ok: "true", scope: scope.cls, refusal: "" };
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
console.log(reason ? `auditor-pass refused: ${reason}` : `auditor-pass command ok (${out.scope})`);
