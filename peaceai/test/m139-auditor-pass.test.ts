// Auditor-pass (Peace, 2026-10-29): `/auditor-pass <letter> <candidate diff sha256>` counts as a `right` ONLY for
// scanner-helper tasks, is recorded as source auditor-pass (never as the owner's verdict), and gives 0 credit.
// Auditor's requirements: (1) source: builder + `scanner-helper` label, (2) only new files under src/, no protected
// path, no edit of an existing file, (3) the posted sha equals the recorded candidate diff's sha256, (4) 0 credit
// and never an owner verdict in any tally. (5): the approve-rule path is untouched (pinned below).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AUDITOR_PASS_DELEGATED_BY, AUDITOR_PASS_SOURCE, auditorPassClass, auditorPassScope, checkHelperDiff, checkWiringDiff, parseAuditorPass, REFUSAL_TEXT, taskScopeRefusal,
} from "../lib/auditor-pass.ts";
import type { SummaryCandidate } from "../lib/gate.ts";
import { planPr } from "../lib/prguard.ts";
import type { CandidateResult } from "../lib/rank.ts";
import { toExample, trainExclusion, isEvalExample } from "../lib/ranker/pipeline.ts";
import { buildRecords, buildSummary, effectiveVerdict, stableJson, taskEntry, VERDICT_SCHEMA, type VerdictRecord } from "../lib/records.ts";
import { loadTargets } from "../lib/target.ts";
import { parseVerdict } from "../lib/verdict.ts";
import { taskDir, writeNew } from "../lib/store.ts";
import { workspaceRefusal, type DeriveRunFacts, type WorkspaceProofChecker } from "../../builder-log/coverage.ts";

const STOCKS = "PeaceG03/PeaceSTOCKS";
const RULES = loadTargets().targets[STOCKS]!;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const newFile = (path: string, lines: string[]) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..2e6f7fb\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;
// The shape of PeaceSTOCKS #102 (issue #606): one new test file, one new module, both under src/.
const TEST_FILE = newFile("src/incomplete-names.incomplete-names-1dfd4d7.test.ts", ['import test from "node:test";', 'import { incompleteNames } from "./incomplete-names";', 'test("x", () => { incompleteNames([]); });']);
const MODULE = newFile("src/incomplete-names.ts", ["export function incompleteNames(names: { securityId: string; complete: boolean }[]): string[] {", "  return names.filter((x) => !x.complete).map((x) => x.securityId);", "}"]);
const GOOD = TEST_FILE + MODULE;
const EDIT_EXISTING = TEST_FILE +
  "diff --git a/src/intraday.ts b/src/intraday.ts\nindex 1111111..2222222 100644\n--- a/src/intraday.ts\n+++ b/src/intraday.ts\n@@ -1,1 +1,1 @@\n-export const a = 1;\n+export const a = 2;\n";

// ---------- parser ----------
test("parser: an exact /auditor-pass <letter> <64 hex> is accepted (letter upper-cased); only the first line counts", () => {
  const s = sha(GOOD);
  assert.deepEqual(parseAuditorPass(`/auditor-pass A ${s}`), { ok: true, command: { label: "A", diffSha256: s } });
  assert.deepEqual(parseAuditorPass(`/auditor-pass b ${s}  \nnotes below`), { ok: true, command: { label: "B", diffSha256: s } });
});

test("parser: malformed commands are refused", () => {
  const s = sha(GOOD);
  for (const body of [
    "/auditor-pass", "/auditor-pass A", `/auditor-pass A ${s.slice(0, 63)}`, `/auditor-pass A ${s}0`, `/auditor-pass A ${s.toUpperCase()}`,
    `/auditor-pass none ${s}`, `/auditor-pass AB ${s}`, `/auditor-pass A right ${s}`, `/auditor-pass A ${s} right`, `/auditor-pass\tA`,
  ]) assert.deepEqual(parseAuditorPass(body), { ok: false, error: "malformed" }, body);
  assert.equal(parseAuditorPass(`/verdict A right`).ok, false);
  assert.equal(parseAuditorPass(`please /auditor-pass A ${s}`).ok, false);
  // The owner's parser never accepts an auditor pass, and this parser never accepts a /verdict.
  assert.equal(parseVerdict(`/auditor-pass A ${s}`).ok, false);
});

// ---------- (1) scope ----------
test("(1) scope: needs both peace-task and scanner-helper labels; missing label refuses with a clear reason", () => {
  assert.equal(auditorPassScope(["peace-task", "scanner-helper", "peaceai:done"]), null);
  assert.equal(auditorPassScope(["peace-task"]), "not-scanner-helper");
  assert.equal(auditorPassScope(["scanner-helper"]), "not-peace-task");
  assert.equal(auditorPassScope([]), "not-peace-task");
  assert.match(REFUSAL_TEXT["not-scanner-helper"], /not labelled `scanner-helper`/);
});

test("(1) scope: the derive run's task record must say source: builder (absent or peace refuses) and target PeaceSTOCKS", () => {
  assert.equal(taskScopeRefusal({ source: "builder", target: STOCKS }), null);
  assert.equal(taskScopeRefusal({ source: "peace", target: STOCKS }), "not-source-builder");
  assert.equal(taskScopeRefusal({ target: STOCKS }), "not-source-builder");
  assert.equal(taskScopeRefusal({ source: "builder" }), "wrong-target");
  assert.equal(taskScopeRefusal({ source: "builder", target: "PeaceG03/PeaceAI-Workspace" }), "wrong-target");
});

// ---------- (2) + (3) diff checks ----------
test("(3) diff: accepted only when the posted sha256 equals the candidate diff bytes", () => {
  assert.equal(checkHelperDiff(GOOD, sha(GOOD), RULES), null);
  assert.equal(checkHelperDiff(GOOD, sha(GOOD + "\n"), RULES), "sha-mismatch");
  assert.equal(checkHelperDiff(GOOD, "0".repeat(64), RULES), "sha-mismatch");
  assert.equal(checkHelperDiff(GOOD, "", RULES), "sha-mismatch");
});

test("(2) diff: an edit to an existing file is refused", () => {
  assert.equal(checkHelperDiff(EDIT_EXISTING, sha(EDIT_EXISTING), RULES), "not-new-file");
  const del = TEST_FILE + "diff --git a/src/a.ts b/src/a.ts\ndeleted file mode 100644\nindex 2e6f7fb..0000000\n--- a/src/a.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x\n";
  assert.equal(checkHelperDiff(del, sha(del), RULES), "not-new-file");
  const exec = TEST_FILE + MODULE.replace("new file mode 100644", "new file mode 100755");
  assert.equal(checkHelperDiff(exec, sha(exec), RULES), "not-new-file");
  const ren = TEST_FILE + "diff --git a/src/a.ts b/src/b.ts\nsimilarity index 100%\nrename from src/a.ts\nrename to src/b.ts\n";
  assert.equal(checkHelperDiff(ren, sha(ren), RULES), "unparsable-diff");
});

test("(2) diff: a path outside src/ (workflow, peaceai/, package file) is refused", () => {
  for (const p of [".github/workflows/x.yml", "peaceai/lib/x.ts", "package.json", "x.ts", "src/../package.json", "src/.hidden.ts"]) {
    const d = TEST_FILE + newFile(p, ["x"]);
    const r = checkHelperDiff(d, sha(d), RULES);
    assert.ok(r === "path-not-src" || r === "unparsable-diff", `${p}: ${r}`);
  }
});

test("(2) diff: a protected or target-denied path under src/ is refused (PeaceSTOCKS denyPatterns)", () => {
  for (const p of ["src/host.ts", "src/scheduler.ts", "src/token-store.ts", "src/fixtures/a.ts", "src/x.json"]) {
    const d = TEST_FILE + newFile(p, ["export const x = 1;"]);
    assert.equal(checkHelperDiff(d, sha(d), RULES), "path-denied", p);
  }
});

test("(2) diff: exactly one new module plus one new test", () => {
  assert.equal(checkHelperDiff(MODULE, sha(MODULE), RULES), "not-two-files");
  const three = GOOD + newFile("src/other.ts", ["export const y = 1;"]);
  assert.equal(checkHelperDiff(three, sha(three), RULES), "not-two-files");
  const twoModules = MODULE + newFile("src/other.ts", ["export const y = 1;"]);
  assert.equal(checkHelperDiff(twoModules, sha(twoModules), RULES), "not-module-plus-test");
  const twoTests = TEST_FILE + newFile("src/b.test.ts", ["x"]);
  assert.equal(checkHelperDiff(twoTests, sha(twoTests), RULES), "not-module-plus-test");
  assert.equal(checkHelperDiff("", sha(""), RULES), "unparsable-diff");
});

// ---------- (4) credit ----------
const sc = (id: string, lines: number): SummaryCandidate => ({ id, file: `candidates/${id}.diff`, transformations: ["X"], operationId: "learned:public-derive-from-behavior-v4", diffBytes: lines * 10, diffLines: lines });
const res = (id: string, lines: number): CandidateResult => ({ id, diffBytes: lines * 10, diffLines: lines, applied: true, typecheckPassed: true, originalSuitePassed: true, newTestsPassed: true, newTestFiles: 1 });
const twoEdits = (issue: number) => buildRecords(
  { issue, runId: "41003947137", recordedAt: "2026-10-30T05:00:00Z", baseSha: "a".repeat(40), title: "Scanner helper", body: "", source: "builder", target: STOCKS },
  [sc("candidate-1", 5), sc("candidate-2", 9)], [res("candidate-1", 5), res("candidate-2", 9)], "s");
const row = (commentId: string, minute: number, label: string | null, candidateId: string | null, verdict: VerdictRecord["verdict"], auditor = false): VerdictRecord => ({
  schema: "peaceai-results-verdict:v1", issue: 900, runId: "41003947137", commentId, recordedAt: `2026-10-30T05:${String(minute).padStart(2, "0")}:00Z`, label, candidateId, verdict,
  ...(auditor ? { source: AUDITOR_PASS_SOURCE, delegatedBy: AUDITOR_PASS_DELEGATED_BY, diffSha256: "f".repeat(64) } : {}),
});

test("(4) credit: an auditor pass backs the PR pick but is never an owner verdict in agreement, training or counts", () => {
  const r = twoEdits(900);
  const top = r.ranking.rankerTop!;
  const label = r.ranking.presentation.find((p) => p.id === top)!.label;
  const rows = [row("700", 1, label, top, "right", true)];
  const e = effectiveVerdict(rows);
  assert.deepEqual(e.pick, { decided: true, candidateId: top }, "the PR route still sees the pick");
  assert.equal(e.delegated, true);
  assert.equal(e.total, 0, "owner verdict count");
  assert.equal(e.delegatedRows, 1);
  const entry = taskEntry(r.task, r.ranking, rows);
  assert.equal(entry.delegatedPick, true);
  assert.equal(entry.peacePick, null);
  assert.equal(entry.decided, false);
  assert.equal(entry.verdicts, 0);
  assert.equal(entry.latestVerdict, null);
  assert.equal(entry.agree, null);
  assert.equal(entry.countsTowardAgreement, false);
  assert.equal(entry.trainable, false);
  const s = buildSummary([entry]);
  assert.deepEqual(s.agreement, { counted: 0, agree: 0, rate: null });
  assert.deepEqual(s.agreementBySource.builder, { counted: 0, agree: 0, rate: null });
  assert.equal(s.trainableTasks, 0);
  assert.equal(s.reviewedTasks, 0);
  assert.equal(s.delegatedPickTasks, 1);
  // The same pick by the owner counts as before.
  const owner = taskEntry(r.task, r.ranking, [row("701", 2, label, top, "right")]);
  assert.equal(owner.countsTowardAgreement, true);
  assert.equal(owner.trainable, true);
  assert.equal(owner.delegatedPick, false);
});

test("(4) credit: ranker training and held-out evaluation exclude an auditor-pass pick", () => {
  const r = twoEdits(901);
  const top = r.ranking.rankerTop!;
  const rows = [row("702", 1, "A", top, "right", true)];
  const x = toExample(r.task, r.ranking, effectiveVerdict(rows), () => "");
  assert.equal(trainExclusion(x), "delegated");
  assert.equal(isEvalExample({ ...x, heldOut: true }), false);
  const y = toExample(r.task, r.ranking, effectiveVerdict([row("703", 1, "A", top, "right")]), () => "");
  assert.equal(y.delegated, undefined, "owner examples are byte-identical to before");
});

test("(4) credit: the owner can still withdraw or override an auditor pass; an owner right afterwards is an owner pick", () => {
  const r = twoEdits(902);
  const top = r.ranking.rankerTop!;
  const withdrawn = effectiveVerdict([row("704", 1, "A", top, "right", true), row("705", 2, "A", top, "wrong")]);
  assert.equal(withdrawn.pick.decided, false);
  assert.equal(withdrawn.delegated, false);
  const confirmed = effectiveVerdict([row("706", 1, "A", top, "right", true), row("707", 2, "A", top, "right")]);
  assert.equal(confirmed.delegated, false);
  assert.equal(taskEntry(r.task, r.ranking, [row("706", 1, "A", top, "right", true), row("707", 2, "A", top, "right")]).trainable, true);
  // An auditor pass after an owner pick never overrides him: it is ignored (replayed old Results included).
  const after = effectiveVerdict([row("708", 1, "A", top, "right"), row("709", 2, "A", top, "right", true)]);
  assert.equal(after.delegated, false);
  assert.deepEqual(after.pick, { decided: true, candidateId: top });
});

test("(4) credit: builder-log coverage refuses an auditor-pass verdict as Workspace proof (W_NO_VERDICT)", () => {
  const diff = GOOD;
  const facts = (verdicts: VerdictRecord[]): DeriveRunFacts => ({
    latestRunId: "111", target: "PeaceG03/PeaceAI-Workspace", source: "peace", candidate: { eligible: true, operationId: "learned:x" },
    candidateDiffSha256: sha(diff), candidateDiff: diff, verdicts,
  });
  const v = (auditor: boolean): VerdictRecord => ({ ...row("555", 1, "A", "candidate-1", "right", auditor), issue: 700, runId: "111" });
  const chk = (verdicts: VerdictRecord[]): WorkspaceProofChecker => ({ derive: () => facts(verdicts), landing: () => null });
  const entry = {
    seq: 1, date: "2026-10-30", time: "01:00", by: "PeaceAI", asked: "Peace's task PeaceAI-Workspace#700 (source: peace): x",
    changed: "PeaceAI-Workspace#700, PeaceAI-Workspace@abcdef1", why: `ws-proof: run 111 candidate-1 diff-sha256 ${sha(diff)} verdict 555`,
  } as unknown as Parameters<typeof workspaceRefusal>[0];
  assert.equal(workspaceRefusal(entry, chk([v(true)])), "W_NO_VERDICT");
  // The owner's verdict passes this check (it then fails later, on the landing lookup this fake does not provide).
  assert.equal(workspaceRefusal(entry, chk([v(false)])), "W_LOOKUP_FAILED");
});

// ---------- record-verdict end to end (fake Results checkout) ----------
function results(o: { source?: "builder" | "peace"; target?: string; diff?: string; cls?: "scanner-helper" | "scanner-wiring" | null; verdicts?: VerdictRecord[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "m139-"));
  const r = buildRecords(
    {
      issue: 606, runId: "41003947137", recordedAt: "2026-10-30T05:00:00Z", baseSha: "d".repeat(40), title: "incompleteNames", body: "", source: o.source ?? "builder", target: o.target ?? STOCKS,
      ...(o.cls === null ? {} : { auditorPassClass: o.cls ?? "scanner-helper" }),
    },
    [sc("candidate-1", 5)], [res("candidate-1", 5)], "s");
  const dir = taskDir(root, 606, "41003947137");
  writeNew(join(dir, "task.json"), stableJson(o.source === undefined ? r.task : { ...r.task, source: o.source }));
  writeNew(join(dir, "ranking.json"), stableJson(r.ranking));
  writeNew(join(dir, "candidates", "candidate-1.diff"), o.diff ?? GOOD);
  for (const v of o.verdicts ?? []) writeNew(join(dir, "verdicts", `${v.commentId}.json`), stableJson(v));
  return { root, dir };
}
function record(root: string, env: Record<string, string>) {
  const outFile = join(root, "gh-output");
  writeFileSync(outFile, "");
  const p = spawnSync(join("node_modules", ".bin", "tsx"), ["peaceai/bin/record-verdict.ts"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH!, RESULTS_DIR: root, GITHUB_OUTPUT: outFile, ISSUE_NUMBER: "606", COMMENT_ID: "6515151128", COMMENT_CREATED_AT: "2026-10-30T05:30:00Z", CHOSEN_OUT_DIR: join(root, "chosen"), ...env },
  });
  assert.equal(p.status, 0, p.stderr);
  return Object.fromEntries(readFileSync(outFile, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
}
const AP = (s = sha(GOOD)) => ({ VERDICT_KIND: "auditor-pass", AUDITOR_PASS_SCOPE: "scanner-helper", COMMENT_BODY: `/auditor-pass A ${s}` });

test("record: an accepted auditor pass is written as right with source auditor-pass and delegatedBy, and hands the exact bytes on", () => {
  const { root, dir } = results();
  try {
    const out = record(root, AP());
    assert.equal(out.status, "recorded");
    assert.equal(out.source, "auditor-pass");
    assert.equal(out.verdict, "right");
    assert.equal(out.diff_sha256, sha(GOOD));
    const v = JSON.parse(readFileSync(join(dir, "verdicts", "6515151128.json"), "utf8"));
    assert.equal(v.source, "auditor-pass");
    assert.equal(v.delegatedBy, "owner (scanner-helper class)");
    assert.equal(v.diffSha256, sha(GOOD));
    assert.equal(v.verdict, "right");
    const idx = readFileSync(join(root, "index.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(idx.at(-1).source, "auditor-pass");
    const summary = JSON.parse(readFileSync(join(root, "summary.json"), "utf8"));
    assert.equal(summary.delegatedPickTasks, 1);
    assert.equal(summary.reviewedTasks, 0);
    assert.equal(summary.trainableTasks, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("record: every refusal writes nothing to Results and says why", () => {
  const cases: [string, ReturnType<typeof results>, Record<string, string>, string][] = [
    ["wrong sha", results(), AP("0".repeat(64)), "sha-mismatch"],
    ["no scope from the parse job", results(), { ...AP(), AUDITOR_PASS_SCOPE: "" }, "not-scoped"],
    ["intake source peace", results({ source: "peace" }), AP(), "not-source-builder"],
    ["Workspace target", results({ target: "PeaceG03/PeaceAI-Workspace" }), AP(), "wrong-target"],
    ["edits an existing file", results({ diff: EDIT_EXISTING }), AP(sha(EDIT_EXISTING)), "not-new-file"],
    ["unknown letter", results(), { ...AP(), COMMENT_BODY: `/auditor-pass C ${sha(GOOD)}` }, "unknown-label"],
  ];
  for (const [name, { root, dir }, env, reason] of cases) {
    try {
      const out = record(root, env);
      assert.equal(out.status, "auditor-pass-refused", name);
      assert.equal(out.reason, reason, name);
      assert.ok(out.refusal && out.refusal.startsWith("Auditor pass not recorded:"), name);
      assert.equal(existsSync(join(dir, "verdicts")), false, name);
      assert.equal(existsSync(join(root, "index.jsonl")), false, name);
      assert.equal(existsSync(join(root, "chosen")), false, name);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("record: a malformed auditor pass, or a /verdict sent down the auditor-pass path, is malformed; /verdict is unchanged", () => {
  for (const body of ["/auditor-pass A", "/verdict A right"]) {
    const { root } = results();
    try { assert.equal(record(root, { ...AP(), COMMENT_BODY: body }).status, "malformed", body); }
    finally { rmSync(root, { recursive: true, force: true }); }
  }
  const { root, dir } = results();
  try {
    const out = record(root, { COMMENT_BODY: "/verdict A right" });
    assert.equal(out.status, "recorded");
    assert.equal(out.source, "owner");
    const v = JSON.parse(readFileSync(join(dir, "verdicts", "6515151128.json"), "utf8"));
    assert.deepEqual(Object.keys(v).sort(), ["candidateId", "commentId", "issue", "label", "recordedAt", "runId", "schema", "verdict"], "owner rows unchanged");
    // An auditor-pass body never reaches the owner path.
    const { root: r2 } = results();
    try { assert.equal(record(r2, { COMMENT_BODY: `/auditor-pass A ${sha(GOOD)}` }).status, "malformed"); }
    finally { rmSync(r2, { recursive: true, force: true }); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------- workflow wiring ----------
const wf = readFileSync(".github/workflows/peace-verdict.yml", "utf8");

test("workflow: /verdict trigger unchanged; /auditor-pass reaches the parse job and is refused there out of scope", () => {
  assert.match(wf, /\(contains\(github\.event\.issue\.labels\.\*\.name, 'peace-task'\) &&\n\s+startsWith\(github\.event\.comment\.body, '\/verdict'\)\n\s+\) \|\|\n\s+startsWith\(github\.event\.comment\.body, '\/auditor-pass'\)\n/);
  assert.match(wf, /startsWith\(github\.event\.comment\.body, '\/auditor-pass'\)/);
  assert.match(wf, /github\.event\.comment\.user\.login == 'PeaceG03'/);
  assert.match(wf, /ISSUE_LABELS: \$\{\{ toJSON\(github\.event\.issue\.labels\.\*\.name\) \}\}/);
  assert.match(wf, /peaceai\/bin\/parse-auditor-pass\.ts/);
  assert.match(wf, /VERDICT_KIND: \$\{\{ needs\.parse\.outputs\.kind \}\}/);
  assert.match(wf, /AUDITOR_PASS_SCOPE: \$\{\{ needs\.parse\.outputs\.ap_scope \}\}/);
});

test("workflow: the target PR body and reply say auditor-pass; no Workspace PR, carry or retrain from an auditor pass", () => {
  assert.match(wf, /\(auditor-pass candidate\)/);
  assert.match(wf, /auditor-pass: %s diff-sha256 %s comment %s source auditor-pass delegatedBy %s/);
  assert.equal([...wf.matchAll(/case "\$DELEGATED_BY" in "owner \(scanner-helper class\)"\|"owner \(scanner-wiring class\)"\) ;; \*\) echo "bad delegation"; exit 1 ;; esac/g)].length, 3);
  assert.match(wf, /not an owner verdict, 0 credit/);
  assert.match(wf, /refused: only an owner verdict opens a Workspace PR/);
  assert.equal([...wf.matchAll(/VERDICT_SOURCE: \$\{\{ needs\.parse\.outputs\.kind == 'auditor-pass' && 'auditor-pass' \|\| needs\.parse\.outputs\.source \}\}/g)].length, 2, "target-pr and target-patch stale steps (the Workspace path never runs for an auditor pass)");
  assert.match(wf, /needs\.record\.outputs\.source != 'auditor-pass'/);
  // TARGET_PR_TOKEN is used only where it was before (no new step reads it).
  assert.equal([...wf.matchAll(/secrets\.TARGET_PR_TOKEN/g)].length, 3);
});

test("(5) the approve-rule path is untouched by the auditor pass", () => {
  for (const f of [".github/workflows/peace-approve-rule.yml", "peaceai/bin/approve-rule.ts", "peaceai/lib/approval.ts", "peaceai/lib/approved.ts"])
    assert.doesNotMatch(readFileSync(f, "utf8"), /auditor-pass/i, f);
  assert.ok(readdirSync("peaceai/bin").includes("parse-auditor-pass.ts"));
});

test("simulated PR body via prguard: the reply still names the letter so builder-log trace can follow the landing", () => {
  const p = planPr({ label: "A", verdict: "right", candidateId: "candidate-1" }, []);
  assert.equal(p.open, true);
  assert.match(p.reply, /Opening a PR for A\.$/);
});

// ---------- scanner-wiring (Peace, 2026-10-30 ~12:47 AM MT): edits of existing src/ files ----------
const edit = (path: string, minus: string, plus: string) =>
  `diff --git a/${path} b/${path}\nindex 1a2b3c4..5d6e7f8 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,2 @@\n import { x } from "./x";\n-${minus}\n+${plus}\n`;
const WIRING = edit("src/intraday.ts", "export const scan = () => [];", "export const scan = () => incompleteNames([]);") + MODULE;

test("wiring scope: scanner-wiring is its own class; both labels at once is refused; neither label is refused", () => {
  assert.deepEqual(auditorPassClass(["peace-task", "scanner-wiring"]), { cls: "scanner-wiring", refusal: null });
  assert.deepEqual(auditorPassClass(["peace-task", "scanner-helper"]), { cls: "scanner-helper", refusal: null });
  assert.equal(auditorPassClass(["peace-task", "scanner-helper", "scanner-wiring"]).refusal, "ambiguous-class");
  assert.equal(auditorPassClass(["peace-task", "scanner-wirin"]).refusal, "not-scanner-helper", "wrong label");
  assert.equal(auditorPassClass(["scanner-wiring"]).refusal, "not-peace-task");
});

test("wiring diff: edits of existing src/ files (plus new src/ files) with the posted sha are accepted", () => {
  assert.equal(checkWiringDiff(WIRING, sha(WIRING), RULES), null);
  const one = edit("src/scanner.ts", "a();", "b();");
  assert.equal(checkWiringDiff(one, sha(one), RULES), null);
  // The stricter helper check still refuses the same bytes (an edit is not a helper).
  assert.equal(checkHelperDiff(WIRING, sha(WIRING), RULES), "not-new-file");
});

test("wiring diff: sha mismatch is refused", () => {
  assert.equal(checkWiringDiff(WIRING, sha(GOOD), RULES), "sha-mismatch");
  assert.equal(checkWiringDiff(WIRING, "A".repeat(64), RULES), "sha-mismatch");
});

test("wiring diff: protected paths are refused (peaceai/, .github/, workflows, CODEOWNERS, package and dot files)", () => {
  for (const p of ["peaceai/lib/records.ts", ".github/workflows/ci.yml", "src/.github/workflows/x.yml", "CODEOWNERS", "src/CODEOWNERS", "docs/CODEOWNERS",
    "package.json", "src/package.json", "tsconfig.json", "src/peaceai/x.ts", "src/.env", "src/config.yml"]) {
    const d = edit(p, "a", "b");
    assert.equal(checkWiringDiff(d, sha(d), RULES), "path-protected", p);
  }
  for (const p of ["scripts/x.ts", "x.ts", "lib/x.ts"]) {
    const d = edit(p, "a", "b");
    assert.equal(checkWiringDiff(d, sha(d), RULES), "path-not-src", p);
  }
  for (const p of ["src/host.ts", "src/scheduler.ts", "src/token-store.ts", "src/fixtures/a.ts"]) {
    const d = edit(p, "a", "b");
    assert.equal(checkWiringDiff(d, sha(d), RULES), "path-denied", p);
  }
});

test("wiring diff: delete, rename, mode change, binary and a repeated path are refused", () => {
  const del = "diff --git a/src/a.ts b/src/a.ts\ndeleted file mode 100644\nindex 2e6f7fb..0000000\n--- a/src/a.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x\n";
  const ren = "diff --git a/src/a.ts b/src/b.ts\nsimilarity index 100%\nrename from src/a.ts\nrename to src/b.ts\n";
  const mode = "diff --git a/src/a.ts b/src/a.ts\nold mode 100644\nnew mode 100755\n";
  const modeEdit = "diff --git a/src/a.ts b/src/a.ts\nindex 1a2b3c4..5d6e7f8 100755\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n";
  const bin = "diff --git a/src/a.ts b/src/a.ts\nindex 1a2b3c4..5d6e7f8 100644\nBinary files a/src/a.ts and b/src/a.ts differ\n";
  const twice = edit("src/a.ts", "a", "b") + edit("src/a.ts", "b", "c");
  for (const [n, d, r] of [["delete", del, "not-edit-or-add"], ["rename", ren, "unparsable-diff"], ["mode", mode, "not-edit-or-add"], ["mode on edit", modeEdit, "not-edit-or-add"],
    ["binary", bin, "not-edit-or-add"], ["repeated path", twice, "unparsable-diff"], ["empty", "", "unparsable-diff"]] as const)
    assert.equal(checkWiringDiff(d, sha(d), RULES), r, n);
});

test("wiring record: accepted as right with delegatedBy owner (scanner-wiring class), 0 credit; wrong scope refuses and writes nothing", () => {
  const { root, dir } = results({ diff: WIRING, cls: "scanner-wiring" });
  try {
    const out = record(root, { ...AP(sha(WIRING)), AUDITOR_PASS_SCOPE: "scanner-wiring" });
    assert.equal(out.status, "recorded");
    assert.equal(out.source, "auditor-pass");
    assert.equal(out.delegated_by, "owner (scanner-wiring class)");
    const v = JSON.parse(readFileSync(join(dir, "verdicts", "6515151128.json"), "utf8"));
    assert.equal(v.delegatedBy, "owner (scanner-wiring class)");
    const summary = JSON.parse(readFileSync(join(root, "summary.json"), "utf8"));
    assert.equal(summary.delegatedPickTasks, 1);
    assert.equal(summary.reviewedTasks, 0);
    assert.equal(summary.trainableTasks, 0);
    assert.deepEqual(summary.agreement, { counted: 0, agree: 0, rate: null });
  } finally { rmSync(root, { recursive: true, force: true }); }
  // The same edit diff under the helper scope is refused (classes do not leak into each other).
  const h = results({ diff: WIRING });
  try {
    const out = record(h.root, AP(sha(WIRING)));
    assert.equal(out.reason, "not-new-file");
    assert.equal(existsSync(join(h.dir, "verdicts")), false);
  } finally { rmSync(h.root, { recursive: true, force: true }); }
  const cases: [string, ReturnType<typeof results>, Record<string, string>, string][] = [
    ["wiring sha mismatch", results({ diff: WIRING, cls: "scanner-wiring" }), { ...AP(sha(GOOD)), AUDITOR_PASS_SCOPE: "scanner-wiring" }, "sha-mismatch"],
    ["wiring protected path", results({ diff: edit("peaceai/lib/x.ts", "a", "b"), cls: "scanner-wiring" }), { ...AP(sha(edit("peaceai/lib/x.ts", "a", "b"))), AUDITOR_PASS_SCOPE: "scanner-wiring" }, "path-protected"],
    ["wiring intake source peace", results({ diff: WIRING, source: "peace", cls: "scanner-wiring" }), { ...AP(sha(WIRING)), AUDITOR_PASS_SCOPE: "scanner-wiring" }, "not-source-builder"],
    ["unknown class from the parse job", results({ diff: WIRING }), { ...AP(sha(WIRING)), AUDITOR_PASS_SCOPE: "scanner-anything" }, "not-scoped"],
  ];
  for (const [name, { root: r, dir: d }, env, reason] of cases) {
    try {
      const out = record(r, env);
      assert.equal(out.status, "auditor-pass-refused", name);
      assert.equal(out.reason, reason, name);
      assert.equal(existsSync(join(d, "verdicts")), false, name);
      assert.equal(existsSync(join(r, "index.jsonl")), false, name);
    } finally { rmSync(r, { recursive: true, force: true }); }
  }
});

test("wiring parse job: labels pick the class, and the scope output names it", () => {
  const run = (labels: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "m139-"));
    try {
      const f = join(dir, "o");
      writeFileSync(f, "");
      const p = spawnSync(join("node_modules", ".bin", "tsx"), ["peaceai/bin/parse-auditor-pass.ts"], {
        encoding: "utf8", env: { PATH: process.env.PATH!, GITHUB_OUTPUT: f, COMMENT_BODY: `/auditor-pass A ${sha(WIRING)}`, ISSUE_LABELS: JSON.stringify(labels) },
      });
      assert.equal(p.status, 0, p.stderr);
      return Object.fromEntries(readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  assert.deepEqual(run(["peace-task", "scanner-wiring"]), { ok: "true", scope: "scanner-wiring", refusal: "" });
  assert.deepEqual(run(["peace-task", "scanner-helper"]), { ok: "true", scope: "scanner-helper", refusal: "" });
  assert.equal(run(["peace-task"]).ok, "false");
  assert.equal(run(["peace-task", "scanner-helper", "scanner-wiring"]).refusal, REFUSAL_TEXT["ambiguous-class"]);
});

// ---------- Auditor FAIL at 11948581 (Oct 30): an auditor pass never overrides Peace ----------
const vrow = (commentId: string, at: string, label: string, verdict: "right" | "wrong" | "unsure", auditor = false, candidateId: string | null = label === "none" ? null : "candidate-1"): VerdictRecord => ({
  schema: VERDICT_SCHEMA, issue: 606, runId: "41003947137", commentId, recordedAt: at, label: label === "none" ? null : label, candidateId, verdict,
  ...(auditor ? { source: "auditor-pass" as const, delegatedBy: "owner (scanner-helper class)" as const, diffSha256: sha(GOOD) } : {}),
});

test("owner first: owner wrong, B right or none wrong, then /auditor-pass -> owner-decided, nothing written", () => {
  for (const [name, prior] of [
    ["owner A wrong", [vrow("100", "2026-10-30T05:10:00Z", "A", "wrong")]],
    ["owner B right", [vrow("101", "2026-10-30T05:10:00Z", "B", "right", false, "candidate-2")]],
    ["owner none wrong", [vrow("102", "2026-10-30T05:10:00Z", "none", "wrong")]],
    ["owner right then unsure (withdrawn)", [vrow("103", "2026-10-30T05:10:00Z", "A", "right"), vrow("104", "2026-10-30T05:11:00Z", "A", "unsure")]],
  ] as const) {
    const { root, dir } = results({ verdicts: [...prior] });
    try {
      const before = readdirSync(join(dir, "verdicts")).sort();
      const out = record(root, AP());
      assert.equal(out.status, "auditor-pass-refused", name);
      assert.equal(out.reason, "owner-decided", name);
      assert.equal(out.refusal, REFUSAL_TEXT["owner-decided"], name);
      assert.deepEqual(readdirSync(join(dir, "verdicts")).sort(), before, name);
      assert.equal(existsSync(join(root, "index.jsonl")), false, name);
      assert.equal(existsSync(join(root, "chosen")), false, name);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  // An owner `unsure` alone is not a decision: the pass is still accepted.
  const u = results({ verdicts: [vrow("105", "2026-10-30T05:10:00Z", "A", "unsure")] });
  try { assert.equal(record(u.root, AP()).status, "recorded"); } finally { rmSync(u.root, { recursive: true, force: true }); }
});

test("owner first, replayed Results: effectiveVerdict ignores a delegated row after an owner decision", () => {
  const ownerWrong = vrow("200", "2026-10-30T05:10:00Z", "A", "wrong");
  const ownerB = vrow("201", "2026-10-30T05:10:00Z", "B", "right", false, "candidate-2");
  const ownerNone = vrow("202", "2026-10-30T05:10:00Z", "none", "wrong");
  const pass = vrow("299", "2026-10-30T05:30:00Z", "A", "right", true);
  const a = effectiveVerdict([ownerWrong, pass]);
  assert.equal(a.delegated, false);
  assert.deepEqual(a.pick, { decided: false, candidateId: null }, "owner A wrong; the later pass does not pick A");
  assert.equal(a.latest?.commentId, "200");
  const b = effectiveVerdict([ownerB, pass]);
  assert.deepEqual(b.pick, { decided: true, candidateId: "candidate-2" });
  assert.equal(b.delegated, false);
  const n = effectiveVerdict([ownerNone, pass]);
  assert.deepEqual(n.pick, { decided: true, candidateId: null });
  assert.equal(n.delegated, false);
});

test("auditor-pass first, then the owner's verdict: the owner wins (right, wrong, none wrong)", () => {
  const pass = vrow("300", "2026-10-30T05:10:00Z", "A", "right", true);
  assert.deepEqual(effectiveVerdict([pass, vrow("301", "2026-10-30T05:20:00Z", "B", "right", false, "candidate-2")]).pick, { decided: true, candidateId: "candidate-2" });
  assert.equal(effectiveVerdict([pass, vrow("301", "2026-10-30T05:20:00Z", "B", "right", false, "candidate-2")]).delegated, false);
  const w = effectiveVerdict([pass, vrow("302", "2026-10-30T05:20:00Z", "A", "wrong")]);
  assert.deepEqual(w.pick, { decided: false, candidateId: null });
  assert.equal(w.delegated, false);
  assert.deepEqual(effectiveVerdict([pass, vrow("303", "2026-10-30T05:20:00Z", "none", "wrong")]).pick, { decided: true, candidateId: null });
  // And a second pass after the owner's verdict is ignored too.
  const again = effectiveVerdict([pass, vrow("304", "2026-10-30T05:20:00Z", "B", "right", false, "candidate-2"), vrow("305", "2026-10-30T05:30:00Z", "A", "right", true)]);
  assert.deepEqual(again.pick, { decided: true, candidateId: "candidate-2" });
  assert.equal(again.delegated, false);
  // The owner's /verdict is always recorded on top of an auditor pass (the owner path has no such refusal).
  const { root, dir } = results({ verdicts: [pass] });
  try {
    const out = record(root, { COMMENT_BODY: "/verdict none wrong" });
    assert.equal(out.status, "recorded");
    assert.equal(out.source, "owner");
    assert.equal(readdirSync(join(dir, "verdicts")).length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("one auditor pass per attempt: a second /auditor-pass on the same candidate is refused, so no second PR can open", () => {
  const { root, dir } = results({ verdicts: [vrow("400", "2026-10-30T05:10:00Z", "A", "right", true)] });
  try {
    const out = record(root, AP());
    assert.equal(out.status, "auditor-pass-refused");
    assert.equal(out.reason, "already-passed");
    assert.equal(readdirSync(join(dir, "verdicts")).length, 1);
    assert.equal(existsSync(join(root, "chosen")), false, "no chosen diff is handed to the PR jobs");
  } finally { rmSync(root, { recursive: true, force: true }); }
  // The PR jobs only run on status recorded (the respond job reads it); and even then prguard would not open a
  // second PR while one already holds the candidate.
  assert.match(wf, /needs\.record\.outputs\.status == 'recorded'|status == 'recorded'/);
  const p = planPr({ label: "A", verdict: "right", candidateId: "candidate-1" }, [{ number: 7, candidateId: "candidate-1" }]);
  assert.equal(p.open, false);
});

test("intake class: recorded from the labels at intake; a mismatch (or none recorded) is refused", () => {
  const r = buildRecords({ issue: 1, runId: "1", recordedAt: "2026-10-30T05:00:00Z", baseSha: "d".repeat(40), title: "t", body: "", auditorPassClass: "scanner-wiring" }, [sc("candidate-1", 5)], [res("candidate-1", 5)], "s");
  assert.equal(r.task.auditorPassClass, "scanner-wiring");
  const bogus = buildRecords({ issue: 1, runId: "1", recordedAt: "2026-10-30T05:00:00Z", baseSha: "d".repeat(40), title: "t", body: "", auditorPassClass: "x" as never }, [sc("candidate-1", 5)], [res("candidate-1", 5)], "s");
  assert.equal("auditorPassClass" in bogus.task, false);
  for (const [name, cls, scope, diff] of [
    ["helper intake, wiring post", "scanner-helper", "scanner-wiring", WIRING],
    ["wiring intake, helper post", "scanner-wiring", "scanner-helper", GOOD],
    ["no class at intake", null, "scanner-helper", GOOD],
  ] as const) {
    const { root, dir } = results({ cls, diff });
    try {
      const out = record(root, { ...AP(sha(diff)), AUDITOR_PASS_SCOPE: scope });
      assert.equal(out.reason, "class-mismatch", name);
      assert.equal(existsSync(join(dir, "verdicts")), false, name);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  // record-task.ts writes the class from the re-read labels (exactly one class label; both or neither -> absent).
  const src = readFileSync("peaceai/bin/record-task.ts", "utf8");
  assert.match(src, /\.\.\.auditorPassClassAtIntake\(issue\.labels\)/);
  assert.match(src, /auditorPassClass\(names\)\.cls/);
});
