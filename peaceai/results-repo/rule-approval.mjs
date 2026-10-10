// M8, installed in PeaceAI-Results as .github/rule-approval/rule-approval.mjs (canonical copy lives in
// PeaceAI-Workspace peaceai/results-repo/). Validates Peace's `/approve-rule <hash>` comment on a private
// core rule-proposal issue and writes the attestation rules/approvals/<hash>.json. Dependency-free.
// Event data comes from env only. Prints fixed strings only. Mirrors attestationFor() in lib/approval.ts.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map((x) => canonicalJson(x)).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}
export const specHash = (s) => createHash("sha256").update(canonicalJson(s), "utf8").digest("hex");
const APPROVE = /^\/approve-rule ([0-9a-f]{64})\s*$/;
const KINDS = ["SET_LITERAL", "ADD_SWITCH_CASE", "ADD_NULLISH_DEFAULT"];

export function attestationFor(ev) {
  if (!ev.labels.includes("rule-proposal")) return { ok: false, reason: "NOT_A_PROPOSAL" };
  const cmd = APPROVE.exec(ev.body.replace(/\r\n/g, "\n"));
  if (!cmd) return { ok: false, reason: "BAD_COMMAND" };
  if (ev.author !== "PeaceG03") return { ok: false, reason: "WRONG_AUTHOR" };
  if (ev.association !== "OWNER") return { ok: false, reason: "NOT_OWNER" };
  const markers = [...ev.issueBody.matchAll(/<!-- peaceai-rule-proposal:v1 id=([a-z0-9-]+) sha256=([0-9a-f]{64}) source=(public|core) -->/g)];
  if (markers.length !== 1) return { ok: false, reason: "NO_MARKER" };
  const [, id, sha, source] = markers[0];
  if (sha !== cmd[1]) return { ok: false, reason: "HASH_NOT_PROPOSAL" };
  if (source !== "core" || ev.repo !== "PeaceG03/PeaceAI-Results") return { ok: false, reason: "WRONG_SOURCE" };
  const block = /<!-- spec -->\n```json\n([\s\S]*?)\n```\n<!-- \/spec -->/.exec(ev.issueBody);
  let spec = null;
  try { spec = block ? JSON.parse(block[1]) : null; } catch { spec = null; }
  if (!spec || spec.schema !== "peaceai-learned-rule:v1" || spec.id !== id || spec.minedFrom !== "core" || !/^core-[a-z0-9-]+-v[0-9]+$/.test(id) || !KINDS.includes(spec.kind)) return { ok: false, reason: "SPEC_INVALID" };
  if (specHash(spec) !== cmd[1]) return { ok: false, reason: "SPEC_HASH_MISMATCH" };
  return { ok: true, attestation: { schema: "peaceai-rule-approval:v1", id, sha256: cmd[1], issue: ev.issue, commentId: ev.commentId, commentUrl: ev.url, author: "PeaceG03", approvedAt: ev.createdAt.replace(/\.\d+Z$/, "Z") } };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const e = process.env;
  let labels = [];
  try { labels = JSON.parse(e.ISSUE_LABELS ?? "[]"); } catch { labels = []; }
  const r = attestationFor({ repo: e.GITHUB_REPOSITORY ?? "", body: e.COMMENT_BODY ?? "", author: e.COMMENT_AUTHOR ?? "", association: e.COMMENT_ASSOCIATION ?? "", commentId: Number(e.COMMENT_ID), url: e.COMMENT_URL ?? "", createdAt: e.COMMENT_CREATED_AT ?? "", issue: Number(e.ISSUE_NUMBER), labels, issueBody: e.ISSUE_BODY ?? "" });
  const out = (k, v) => e.GITHUB_OUTPUT && appendFileSync(e.GITHUB_OUTPUT, `${k}=${v}\n`);
  out("ok", String(r.ok));
  out("reason", r.ok ? "ATTESTED" : r.reason);
  if (r.ok) {
    const dir = join(e.RESULTS_ROOT ?? ".", "rules", "approvals");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${r.attestation.sha256}.json`), JSON.stringify(r.attestation, null, 2) + "\n");
    out("sha", r.attestation.sha256);
    out("rule", r.attestation.id);
  }
  console.log(`rule-approval ok=${r.ok} reason=${r.ok ? "ATTESTED" : r.reason}`);
}
