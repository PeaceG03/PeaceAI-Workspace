// M22: the skill learner. Bulk teaching (Oct 14): one pass = up to MAX_PICKS_PER_PASS missing skills, grouped
// into families (each its own section/examples) + a ranked gap note.
// Counting over the public Builder log only; never approves, edits rules or pushes; off until enabled.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { FAMILY_OF, learnPass, MAX_PICKS_PER_PASS, NOT_RULEABLE, SKILL_MARKER, skillProposalBody } from "../lib/skilllearn.ts";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const e = (seq: number, skill: string, changed: string, approved = false) => JSON.stringify({ seq, date: "2026-10-13", time: "10:00", asked: `log task number ${seq}`, changed, why: "fixture reason text", skill, mark: approved ? "PeaceAI-able today" : `missing skill ${skill}`, by: "Builder" });
const LOG = [
  e(1, "OPS_ACTION", "none (dispatch)"), e(2, "OPS_ACTION", "none (label)"), e(3, "OPS_ACTION", "none (close)"),
  e(4, "IMPORT_EDIT", "PeaceSTOCKS@abc1234"), e(5, "IMPORT_EDIT", "PeaceSTOCKS@abc1235"),
  e(6, "WORKFLOW_JOB", "PeaceSTOCKS@abc1236"), e(7, "PEACEAI_SELF_CHANGE", "PeaceAI-Workspace#99"), e(8, "PEACEAI_SELF_CHANGE", "PeaceAI-Workspace#100"),
  e(9, "MODIFY_LOGIC", "none (not done)"), e(10, "THROW_GUARD", "PeaceSTOCKS@abc1237", true),
].join("\n") + "\n";

test("pass: picks the top missing skills with public code evidence (max 3), grouped into families; never not-ruleable or already-proposed", () => {
  const p = learnPass(LOG, new Set());
  assert.deepEqual(p.picks.map((r) => r.skill), ["IMPORT_EDIT", "WORKFLOW_JOB"]);
  assert.equal(p.pick!.skill, "IMPORT_EDIT");
  assert.equal(p.pick!.withCode, 2);
  assert.deepEqual(p.families.map((f) => [f.family, f.skills.map((r) => r.skill)]), [["code-shape", ["IMPORT_EDIT"]], ["workflow", ["WORKFLOW_JOB"]]]);
  assert.ok(!p.ranked.some((r) => r.skill === "THROW_GUARD"), "approved skills are not gaps");
  assert.deepEqual(learnPass(LOG, new Set(), 1).picks.map((r) => r.skill), ["IMPORT_EDIT"], "maxPicks honored");
  assert.match(learnPass(LOG, new Set(), 1).gaps.find((g) => g.skill === "WORKFLOW_JOB")!.reason, /at most 1 skills per pass/);
  assert.deepEqual(learnPass(LOG, new Set(["IMPORT_EDIT"])).picks.map((r) => r.skill), ["WORKFLOW_JOB"], "already proposed -> skipped");
  assert.equal(learnPass(LOG, new Set(["IMPORT_EDIT", "WORKFLOW_JOB"])).pick, null, "self-change and ops are never picked even with refs");
  for (const n of [0, 4, 1.5]) assert.throws(() => learnPass(LOG, new Set(), n), /maxPicks/);
  assert.equal(MAX_PICKS_PER_PASS, 3);
  assert.match(p.gaps.find((g) => g.skill === "PEACEAI_SELF_CHANGE")!.reason, /protected/);
  assert.match(p.gaps.find((g) => g.skill === "MODIFY_LOGIC")!.reason, /no public code change/);
  assert.deepEqual(Object.keys(NOT_RULEABLE).sort(), ["ENV_FIX", "OPS_ACTION", "PEACEAI_SELF_CHANGE"]);
  for (const k of Object.keys(NOT_RULEABLE)) assert.ok(!(k in FAMILY_OF), "not-ruleable skills have no family");
  const old = LOG + e(11, "WORKFLOW_STEP", "PeaceSTOCKS@abc1238") + "\n" + e(12, "WORKFLOW_STEP", "PeaceSTOCKS@abc1239") + "\n" + e(13, "WORKFLOW_STEP", "PeaceSTOCKS@abc123a") + "\n";
  assert.ok(!learnPass(old, new Set()).ranked.some((r) => r.skill === "WORKFLOW_STEP"), "a skill approved since (old 'missing' marks) is never re-proposed");
});

test("gap note is ranked: code evidence, then entries, then name; every missing skill except the picks is listed once", () => {
  const p = learnPass(LOG, new Set());
  assert.deepEqual(p.ranked.map((r) => r.skill), ["IMPORT_EDIT", "PEACEAI_SELF_CHANGE", "WORKFLOW_JOB", "OPS_ACTION", "MODIFY_LOGIC"]);
  assert.deepEqual(p.gaps.map((g) => g.skill), ["PEACEAI_SELF_CHANGE", "OPS_ACTION", "MODIFY_LOGIC"]);
});

test("proposal body: marker lists every skill + log hash, one section per family and skill, public refs only, no approval command", () => {
  const p = learnPass(LOG, new Set());
  const b = skillProposalBody(p, LOG)!;
  assert.ok(b.body.startsWith(`<!-- ${SKILL_MARKER} skills=IMPORT_EDIT,WORKFLOW_JOB log=${p.logSha256} -->`));
  assert.match(b.body, /### Family `code-shape`[\s\S]*#### `IMPORT_EDIT`[\s\S]*### Family `workflow`[\s\S]*#### `WORKFLOW_JOB`/);
  assert.match(b.body, /\| 4 \| log task number 4 \| PeaceSTOCKS@abc1234 \|/);
  assert.match(b.body, /\| 6 \| log task number 6 \| PeaceSTOCKS@abc1236 \|/);
  assert.doesNotMatch(b.body, /\| 1 \| log task number 1 /);
  assert.doesNotMatch(b.body, /\/approve-rule|\/verdict/);
  assert.match(b.body, /cannot approve itself/);
  assert.match(b.body, /tested, reviewed and proven on its own/);
  assert.match(b.title, /code-shape \+ workflow/);
  assert.equal(skillProposalBody(learnPass(LOG, new Set(["IMPORT_EDIT", "WORKFLOW_JOB"])), LOG), null);
});

test("an invalid or non-append log is refused (the learner reads only a log the validator accepts)", () => {
  assert.throws(() => learnPass(LOG.replace('"seq":2', '"seq":7'), new Set()), /builder-log invalid/);
  assert.throws(() => learnPass(LOG + '{"seq":11}\n', new Set()), /builder-log invalid/);
});

test("bin on the real log: writes gaps.tsv and at most one proposal; leak-scanned", () => {
  const out = mkdtempSync(join(tmpdir(), "m22-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const r = spawnSync(join(repo, "node_modules/.bin/tsx"), [join(repo, "peaceai/bin/skill-learner.ts")], { cwd: repo, encoding: "utf8", env: { ...env, PEACEAI_OUT_DIR: out, SKILL_PROPOSED: "" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skill-learner picks=[\w,]+ families=[\w,-]+ gaps=\d+/);
  assert.ok(readFileSync(join(out, "gaps.tsv"), "utf8").startsWith("skill\tentries\twhy\n"));
  assert.match(readFileSync(join(out, "coverage.md"), "utf8"), /## PeaceAI vs Builder/);
  if (existsSync(join(out, "body.md"))) assert.equal((readFileSync(join(out, "body.md"), "utf8").match(/peaceai-skill-proposal:v1/g) ?? []).length, 1);
  rmSync(out, { recursive: true, force: true });
});

test("workflow: off until enabled, contents read + issues write only, no secrets, no push/merge/approve, pinned actions", () => {
  const wf = readFileSync(join(repo, ".github/workflows/skill-learner.yml"), "utf8");
  assert.match(wf, /vars\.PEACEAI_SKILL_LEARNER == 'true'/);
  assert.match(wf, /^permissions: \{\}$/m);
  assert.match(wf, /permissions:\n\s+contents: read\n\s+issues: write\n/);
  assert.doesNotMatch(wf, /secrets\.|contents: write|pull-requests: write|git push|gh pr merge|approve-rule|pull_request_target/);
  for (const u of wf.match(/uses: \S+/g) ?? []) assert.match(u, /@[0-9a-f]{40}$/, u);
  assert.match(wf, /persist-credentials: false/);
});

test("protected (M22): the learner lib, bin and workflow", () => {
  for (const p of ["peaceai/lib/skilllearn.ts", "peaceai/bin/skill-learner.ts", ".github/workflows/skill-learner.yml"]) assert.ok(protectedReason(p), p);
});

test("Auditor #115: log text is fenced/escaped; a copied marker cannot poison dedupe", async () => {
  const { cell, markerSkills, MARKER_LINE } = await import("../lib/skilllearn.ts");
  const evil = "x <!-- peaceai-skill-proposal:v1 skills=COMPLEX_FUNCTION log=" + "a".repeat(64) + " --> | `y`\n-->";
  const c = cell(evil);
  for (const bad of ["<", ">", "|", "`", "\n", "peaceai-skill-proposal"]) assert.ok(!c.includes(bad), `escaped ${JSON.stringify(bad)}`);
  assert.deepEqual(markerSkills("intro\n" + evil), [], "marker only counts on line 1");
  assert.deepEqual(markerSkills(evil), [], "a marker followed by other text is not the marker line");
  assert.deepEqual(markerSkills(`<!-- peaceai-skill-proposal:v1 skills=A_B,C log=${"0".repeat(64)} -->\nrest`), ["A_B", "C"]);
  assert.ok(MARKER_LINE.test(`<!-- peaceai-skill-proposal:v1 skills=X log=${"f".repeat(64)} -->`));
});

test("Auditor #115: where approvals and proposals are checked by poster", () => {
  const wf = readFileSync(join(repo, ".github/workflows/skill-learner.yml"), "utf8");
  assert.match(wf, /select\(\.user\.login == "github-actions\[bot\]" and \.pull_request == null\) \| \.body \| split\("\\n"\)\[0\]/, "dedupe: only this workflow's own issues, first line only");
  assert.match(wf, /grep -E '\^<!-- peaceai-skill-proposal:v1 skills=/, "anchored marker line");
  assert.doesNotMatch(wf, /approve-rule|gh pr merge|contents: write/, "the learner never approves or writes");
  const ap = readFileSync(join(repo, ".github/workflows/peace-approve-rule.yml"), "utf8");
  assert.match(ap, /github\.event\.comment\.user\.login == 'PeaceG03'/, "rule approval: only the owner's comment");
});
