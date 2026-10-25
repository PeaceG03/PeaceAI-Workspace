// M72 SELF_CHANGE stage 1: PeaceAI may edit a SMALL safe zone of its own repository through the NORMAL task flow
// (peace-task issue on PeaceG03/PeaceAI-Workspace -> Job A rule -> Job B sandboxed grading -> Peace's verdict -> PR).
// It is off until targets.json sets `"selfZone": true` on the Workspace target (its own reviewed one-commit PR).
//
// Two lists, both fixed here (this file is itself protected):
//   PROTECTED - everything that judges or gates PeaceAI: grading, leak/tamper checks, the verdict/approval flow,
//               the allowed-file/deny lists, the model guard (lm.ts), workflows, and both protected lists
//               themselves (selfchange.ts PROTECTED_SELF and this file). A candidate touching any of them is refused
//               in applyRule (reason self_protected_path) and again by the protected-file digest in Job B.
//   SAFE ZONE - the only non-src paths a Workspace candidate may create or edit: new tests under
//               peaceai/self-tests/, docs under peaceai/docs/ and docs/ (M106), and the NAMED low-risk helpers below. Nothing
//               outside peaceai/self-tests/ may import from it (pinned by tests), so a safe-zone edit can never
//               change what a gate computes.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { PROTECTED_SELF } from "./selfchange.ts";

export const WORKSPACE_TARGET = "PeaceG03/PeaceAI-Workspace";

/** Protected on top of PROTECTED_SELF (which already holds gates, approval, leak, rules, grading, lm.ts, workflows). */
export const SELF_ZONE_EXTRA_PROTECTED: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /^peaceai\/lib\/self-zone\.ts$/, why: "the self-change protected list and safe zone (this list itself)" },
  { pattern: /^peaceai\/lib\/selfchange\.ts$/, why: "the PROTECTED_SELF list" },
  { pattern: /^peaceai\/proof\//, why: "the tamper proof and live-proof procedures" },
  { pattern: /^peaceai\/lib\/scope\.ts$|^peaceai\/lib\/target\.ts$|^peaceai\/targets\.json$/, why: "the allowed-file and deny lists (scope, targets)" },
  { pattern: /^peaceai\/lib\/lm\.ts$|^peaceai\/model\//, why: "the model and its job guard" },
  { pattern: /^peaceai\/bin\/(test-candidates|generate|regate|gate)\.ts$|^peaceai\/lib\/(records|rank|diff|learned[^/]*|repair|repairloop|repairrecord|gate)\.ts$/, why: "generation and grading: Job A rules, the Job B harness, its records and the repair loop" },
  { pattern: /^peaceai\/lib\/(leak|kernelguard|coretext|coreindex|substr|policy|prguard)\.ts$|^peaceai\/bin\/(leak-scan|prepush-scan|core-scan|kernel-guard|install-pre-push)\.(ts|sh)$/, why: "leak and core-text checks" },
  { pattern: /^peaceai\/lib\/(verdict|approval|approved|carry|regrade|stacked|rebase|results|trigger)\.ts$|^peaceai\/bin\/(approve-rule|approve-rule-pr|record-verdict|record-task|parse-verdict|apply-verdict-patch|carry-check|carry-verdict|verdict-stale|check-approved-list|await-checks|await-held-runs)\.(ts|sh)$/, why: "the verdict and approval flow" },
  { pattern: /^peaceai\/lib\/read-only-ops\.ts$|^peaceai\/bin\/read-only-ops\.ts$|^peaceai\/read-only-ops\.json$/, why: "the read-only ops allowlist and its enable file" },
  { pattern: /^peaceai\/rules\//, why: "the approved list and rule specs" },
  { pattern: /^\.github\//, why: "workflows" },
  { pattern: /^builder-log\//, why: "the Builder task log" },
  { pattern: /^peaceai\/test\//, why: "the live test suite" },
  { pattern: /^(package(-lock)?\.json|tsconfig[^/]*\.json|\.gitignore|\.gitattributes|\.npmrc)$/, why: "dependencies and build config" },
];

/** The named low-risk helpers: pure, dependency-free, imported only by peaceai/self-tests. */
export const SAFE_HELPERS = ["peaceai/self-tests/helpers/text.ts", "peaceai/self-tests/helpers/dates.ts"] as const;
const SEG = String.raw`[a-z0-9][a-z0-9._-]{0,80}`;
/** Safe-zone path shapes (plain lowercase segments, no dot-files). */
export const SAFE_ZONE: readonly { pattern: RegExp; what: string }[] = [
  { pattern: new RegExp(String.raw`^peaceai/self-tests/${SEG}\.test\.ts$`), what: "a new self-test" },
  { pattern: new RegExp(String.raw`^peaceai/self-tests/helpers/${SEG}\.test\.ts$`), what: "a new test of a named helper" },
  { pattern: new RegExp(String.raw`^peaceai/docs/${SEG}\.md$`), what: "a doc page" },
  // M106 (Auditor ruling (A) on the self-change plan, 2026-10-25): root docs/*.md, the same shape rules as peaceai/docs/
  { pattern: new RegExp(String.raw`^docs/${SEG}\.md$`), what: "a root doc page" },
];

const plain = (p: string) => !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((s) => s === "" || s === "." || s === ".." || s.startsWith("."));
const inSafeZoneShape = (path: string): boolean => (SAFE_HELPERS as readonly string[]).includes(path) || SAFE_ZONE.some((z) => z.pattern.test(path));

/**
 * The one PROTECTED_SELF entry src/ is exempt from: "existing tests anywhere". Under src/ that rule is enforced by the
 * scope gate instead (existing src tests are frozen; NEW src tests are how every ordinary candidate is graded), so the
 * digest must not treat a candidate's new src test as a protected change. Every other PROTECTED_SELF entry applies to
 * src/ paths too (Auditor #331: e.g. a src/...public-origin... file stays protected).
 */
export const SRC_EXEMPT_ENTRY = PROTECTED_SELF.find((p) => p.why.startsWith("existing tests anywhere"))!;

/** Protected for stage 1: the extra list, then PROTECTED_SELF (no early exit for safe-zone shapes; Auditor #331). */
export function selfProtectedReason(path: string): string | null {
  if (!plain(path)) return "path is not a plain relative path";
  const extra = SELF_ZONE_EXTRA_PROTECTED.find((p) => p.pattern.test(path));
  if (extra) return extra.why;
  const src = /^src\//.test(path);
  return PROTECTED_SELF.find((p) => !(src && p === SRC_EXEMPT_ENTRY) && p.pattern.test(path))?.why ?? null;
}
export const isSelfProtected = (path: string): boolean => selfProtectedReason(path) !== null;

/** A non-src path a Workspace candidate may touch: a safe-zone shape that no protected pattern covers. */
export function inSafeZone(path: string): boolean {
  return plain(path) && inSafeZoneShape(path) && !SELF_ZONE_EXTRA_PROTECTED.some((p) => p.pattern.test(path)) && !PROTECTED_SELF.some((p) => p.pattern.test(path));
}

/** applyRule's stage-1 check for a Workspace candidate: src/ (ordinary scope) or the safe zone, never protected. */
export function selfZoneEditRefusal(paths: readonly string[]): "self_protected_path" | "outside_safe_zone" | null {
  for (const p of paths) if (isSelfProtected(p)) return "self_protected_path"; // src/ too (only the frozen-test entry is left to scope)
  for (const p of paths) if (!/^src\//.test(p) && !inSafeZone(p)) return "outside_safe_zone";
  return null;
}

/**
 * Digest of every protected file in a working tree (tracked + untracked; symlinks by target): sha256 over sorted
 * `path\0sha256(content)` lines. Job B compares it before and after applying a Workspace candidate and again after
 * the tests ran; any difference fails the candidate closed.
 */
export function protectedDigest(dir: string): string {
  const ls = (...a: string[]) => execFileSync("git", ["-C", dir, "ls-files", "-z", ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const paths = [...new Set([...ls(), ...ls("--others", "--exclude-standard")])].filter((p) => !p.startsWith("node_modules/") && isSelfProtected(p)).sort();
  const h = createHash("sha256");
  for (const p of paths) {
    const full = join(dir, p);
    const st = lstatSync(full, { throwIfNoEntry: false });
    const c = !st ? "missing" : st.isSymbolicLink() ? `symlink:${readlinkSync(full)}` : st.isFile() ? createHash("sha256").update(readFileSync(full)).digest("hex") : `type:${st.mode}`;
    h.update(`${p}\0${c}\n`);
  }
  return h.digest("hex");
}

/** Files that must always be protected (tamper-proof runs selfZoneSelfCheck first, in CI). */
export const MUST_BE_PROTECTED = [
  "peaceai/lib/self-zone.ts", "peaceai/lib/selfchange.ts", "peaceai/targets.json", "peaceai/lib/target.ts", "peaceai/lib/scope.ts",
  "peaceai/lib/lm.ts", "peaceai/bin/test-candidates.ts", "peaceai/lib/records.ts", "peaceai/lib/leak.ts", "peaceai/bin/leak-scan.ts",
  "peaceai/proof/tamper-proof.ts", "peaceai/lib/verdict.ts", "peaceai/lib/approved.ts", "peaceai/bin/approve-rule.ts", "peaceai/bin/record-verdict.ts",
  "peaceai/rules/approved.json", ".github/workflows/ci.yml", ".github/workflows/peace-verdict.yml", "peaceai/lib/learned.ts", "peaceai/bin/generate.ts",
  "peaceai/lib/read-only-ops.ts", "peaceai/read-only-ops.json", "package.json",
  // Auditor #331: safe-zone shapes that a PROTECTED_SELF entry still covers (the public-origin allowlist).
  "peaceai/self-tests/public-origin.test.ts", "peaceai/self-tests/helpers/public-origin.test.ts", "peaceai/docs/peaceai-public-origin.md",
  "src/public-origin.ts", "src/x/peaceai-public-origin.json",
] as const;
export function selfZoneSelfCheck(): string[] {
  const problems: string[] = [];
  for (const p of MUST_BE_PROTECTED) {
    if (!isSelfProtected(p)) problems.push(`not protected: ${p}`);
    if (selfZoneEditRefusal([p]) !== "self_protected_path") problems.push(`edit not refused: ${p}`);
  }
  for (const p of [...SAFE_HELPERS, "peaceai/self-tests/a.test.ts", "peaceai/self-tests/helpers/a.test.ts", "peaceai/docs/a.md"])
    if (!inSafeZone(p) || isSelfProtected(p) || selfZoneEditRefusal([p]) !== null) problems.push(`safe zone overlaps protected: ${p}`);
  return problems;
}
