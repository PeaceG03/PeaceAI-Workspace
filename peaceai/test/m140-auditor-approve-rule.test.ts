// M140: the delegated `/auditor-approve-rule <id> <sha256>` (Peace, 2026-10-30 ~12:47 AM MT: "Yes I want it handed
// off to you and auditor as well the only input I should be giving is the end goal or a direction and things like
// that"). Team-picked, 0-credit public rules only; one appended entry with source auditor-approve-rule and
// delegatedBy owner; never an owner approval, no credit, listed apart, revertible by Peace. Peace's own
// /approve-rule is unchanged. Every refusal has a test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { admitRules, APPROVED_SCHEMA, AUDITOR_SOURCE, validateEntry, validateList, withEntry, type ApprovalEntry, type ApprovedList } from "../lib/approved.ts";
import {
  APPROVE_COMMAND, AUDITOR_APPROVE_COMMAND, AUDITOR_DELEGABLE_KINDS, approvalMessage, auditorPolicyProblem, branchProblem, oneAppendProblem,
  revertProblem, SOURCE_BUILDER_LABEL, teamPickedProblem, validateAuditorApproval, validateWorkspaceApproval, type CommentEvent, type ProposalIssue,
} from "../lib/approval.ts";
import { specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { BUILDER_LABEL, creditTemplatesFrom } from "../lib/policy.ts";
import { proposalMarker } from "../lib/propose.ts";
import { checkRuleSkills, delegatedRules } from "../../builder-log/rule-skill.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const scratch = () => mkdtempSync(join(tmpdir(), "m140-"));
const readSpec = (id: string) => JSON.parse(readFileSync(join(repo, "peaceai/rules/learned", `${id}.json`), "utf8")) as RuleSpec;

const SPEC = readSpec("public-derive-wire-v2");
const SHA = specHash(SPEC);
const URL0 = "https://github.com/PeaceG03/PeaceAI-Workspace/issues/613#issuecomment-9001";
const RECORD = { id: SPEC.id, teamPicked: true, credit: 0 };
const bodyFor = (spec: RuleSpec, sha = specHash(spec)) =>
  [`<!-- peaceai-rule-proposal:v1 id=${spec.id} sha256=${sha} source=public -->`, "## proposal", "", "<!-- spec -->", "```json", JSON.stringify(spec, null, 2), "```", "<!-- /spec -->", ""].join("\n");
const ev = (o: Partial<CommentEvent> = {}): CommentEvent => ({
  repo: "PeaceG03/PeaceAI-Workspace", body: `/auditor-approve-rule ${SPEC.id} ${SHA}`, author: "PeaceG03", association: "OWNER",
  commentId: 9001, url: URL0, createdAt: "2026-10-30T07:00:00.123Z", issue: 613, labels: ["rule-proposal", "source:builder"], issueBody: bodyFor(SPEC), ...o,
});
const issues = (o: ProposalIssue[] = []): ProposalIssue[] => [{ number: 613, body: bodyFor(SPEC), isPull: false }, { number: 532, body: bodyFor(readSpec("public-derive-wire-v1")), isPull: false }, ...o];
const ownerEntry = (id: string, sha: string, n = 77): ApprovalEntry => ({ id, sha256: sha, source: "workspace", approval: { url: `https://github.com/PeaceG03/PeaceAI-Workspace/issues/${n}#issuecomment-${n}00`, commentId: n * 100, issue: n, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-01T00:00:00Z" } });
const OTHER = ownerEntry("public-test-case-v1", "a".repeat(64));
const run = (o: Partial<CommentEvent> = {}, files: { spec: unknown; record: unknown } = { spec: SPEC, record: RECORD }, props = issues(), current: ApprovalEntry[] = [OTHER]) =>
  validateAuditorApproval(ev(o), files, props, current);
const reason = (r: ReturnType<typeof run>) => (r.ok ? "OK" : r.reason);

test("accepted: one delegated entry (source auditor-approve-rule, delegatedBy owner), valid in the list and admitted by Job A", () => {
  const r = run();
  assert.ok(r.ok, reason(r));
  if (!r.ok) return;
  assert.deepEqual(r.entry, { id: SPEC.id, sha256: SHA, source: "auditor-approve-rule", delegatedBy: "owner", approval: { url: URL0, commentId: 9001, issue: 613, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-30T07:00:00Z" } });
  assert.equal(AUDITOR_SOURCE, "auditor-approve-rule");
  assert.ok(validateEntry(r.entry));
  const list = withEntry({ schema: APPROVED_SCHEMA, rules: [OTHER] }, r.entry);
  assert.ok(validateList(list));
  assert.deepEqual(admitRules([SPEC], { ok: true, list }).map((a) => a.decision), ["APPROVED"]);
  assert.match(approvalMessage([r.entry]), /Approval-Source: auditor-approve-rule \(delegated by the owner; not an owner approval; 0 credit\)/);
  assert.doesNotMatch(approvalMessage([OTHER]), /Approval-Source/, "owner approvals keep their message");
  assert.equal(SOURCE_BUILDER_LABEL, BUILDER_LABEL, "the proposal label is policy.ts's Builder label");
});

test("refused: not a rule proposal, not source:builder", () => {
  assert.equal(reason(run({ labels: ["source:builder"] })), "NOT_A_PROPOSAL");
  assert.equal(reason(run({ labels: ["rule-proposal"] })), "NOT_SOURCE_BUILDER");
  assert.equal(reason(run({ labels: ["rule-proposal", "source:peace"] })), "NOT_SOURCE_BUILDER");
});

test("refused: bad command forms (Peace's /approve-rule is not this command; the id and the sha are both required)", () => {
  for (const body of [`/approve-rule ${SHA}`, `/auditor-approve-rule ${SHA}`, `/auditor-approve-rule ${SPEC.id}`, `/auditor-approve-rule ${SPEC.id} ${SHA.toUpperCase()}`, `/auditor-approve-rule ${SPEC.id} ${SHA} please`, `please /auditor-approve-rule ${SPEC.id} ${SHA}`, `/auditor-approve-rule  ${SPEC.id} ${SHA}`, `/auditor-approve-rule core-x-v1 ${SHA}`, `/auditor-approve-rule ../x-v1 ${SHA}`, `/auditor-approve-rule ${SPEC.id} ${SHA}\nmore`])
    assert.equal(reason(run({ body })), "BAD_COMMAND", body);
  assert.ok(run({ body: `/auditor-approve-rule ${SPEC.id} ${SHA}\r\n` }).ok, "a trailing newline is fine");
});

test("refused: wrong author or association, wrong repository or marker source", () => {
  assert.equal(reason(run({ author: "someone" })), "WRONG_AUTHOR");
  assert.equal(reason(run({ author: "github-actions[bot]" })), "WRONG_AUTHOR");
  assert.equal(reason(run({ association: "COLLABORATOR" })), "NOT_OWNER");
  assert.equal(reason(run({ repo: "PeaceG03/PeaceAI-Results" })), "WRONG_SOURCE");
  assert.equal(reason(run({ issueBody: bodyFor(SPEC).replace("source=public", "source=core") })), "WRONG_SOURCE");
});

test("refused: no single marker, marker id or hash not the command's", () => {
  assert.equal(reason(run({ issueBody: "no marker" })), "NO_MARKER");
  assert.equal(reason(run({ issueBody: bodyFor(SPEC) + bodyFor(SPEC) })), "NO_MARKER");
  const v1 = readSpec("public-derive-wire-v1");
  assert.equal(reason(run({ issueBody: bodyFor(v1) })), "ID_NOT_PROPOSAL");
  assert.equal(reason(run({ issueBody: bodyFor(SPEC, "b".repeat(64)) })), "HASH_NOT_PROPOSAL");
});

test("refused: the proposal body's spec JSON must hash to the sha (missing block, edited block, other id)", () => {
  const marker = `<!-- peaceai-rule-proposal:v1 id=${SPEC.id} sha256=${SHA} source=public -->`;
  assert.equal(reason(run({ issueBody: marker })), "BODY_SPEC_MISMATCH");
  assert.equal(reason(run({ issueBody: bodyFor({ ...SPEC, trigger: SPEC.trigger + "|x" }, SHA) })), "BODY_SPEC_MISMATCH");
  assert.equal(reason(run({ issueBody: bodyFor({ ...SPEC, minerVersion: "edited" }, SHA) })), "BODY_SPEC_MISMATCH");
});

test("refused: spec file on main missing, invalid or not hashing to the sha", () => {
  assert.equal(reason(run({}, { spec: null, record: RECORD })), "SPEC_MISSING");
  assert.equal(reason(run({}, { spec: { invalid: true }, record: RECORD })), "SPEC_INVALID");
  assert.equal(reason(run({}, { spec: { ...SPEC, minedFrom: "core" }, record: RECORD })), "SPEC_INVALID");
  assert.equal(reason(run({}, { spec: readSpec("public-derive-wire-v1"), record: RECORD })), "SPEC_INVALID");
  assert.equal(reason(run({}, { spec: { ...SPEC, minerVersion: "edited" }, record: RECORD })), "SPEC_HASH_MISMATCH");
});

test("refused: the id is already in approved.json (any hash, owner or delegated)", () => {
  assert.equal(reason(run({}, undefined, undefined, [OTHER, ownerEntry(SPEC.id, "c".repeat(64))])), "ALREADY_LISTED");
  assert.equal(reason(run({}, undefined, undefined, [OTHER, ownerEntry(SPEC.id, SHA)])), "ALREADY_LISTED");
  const r = run();
  assert.ok(r.ok);
  if (r.ok) assert.equal(reason(run({ commentId: 9002, url: URL0.replace("9001", "9002") }, undefined, undefined, [OTHER, r.entry])), "ALREADY_LISTED");
});

test("refused: not exactly one rule-proposal issue for the id (a duplicate, or this issue missing from the list)", () => {
  assert.equal(reason(run({}, undefined, issues([{ number: 700, body: bodyFor(SPEC), isPull: false }]))), "PROPOSAL_NOT_UNIQUE");
  assert.equal(reason(run({}, undefined, issues([{ number: 701, body: bodyFor(SPEC, "d".repeat(64)), isPull: false }]))), "PROPOSAL_NOT_UNIQUE", "same id, other hash");
  assert.equal(reason(run({}, undefined, [{ number: 532, body: bodyFor(readSpec("public-derive-wire-v1")), isPull: false }])), "PROPOSAL_NOT_UNIQUE");
  assert.equal(reason(run({}, undefined, [{ number: 614, body: bodyFor(SPEC), isPull: false }])), "PROPOSAL_NOT_UNIQUE", "the single one is another issue");
  assert.ok(run({}, undefined, issues([{ number: 702, body: bodyFor(SPEC), isPull: true }])).ok, "a pull request is not a proposal issue");
});

test("refused: the proposal record on main does not say team-picked and 0 credit (as fields)", () => {
  for (const record of [null, { id: SPEC.id }, { ...RECORD, teamPicked: false }, { ...RECORD, teamPicked: "true" }, { ...RECORD, credit: 1 }, { ...RECORD, credit: "0" }, { ...RECORD, id: "public-other-v1" }])
    assert.equal(reason(run({}, { spec: SPEC, record })), "NOT_TEAM_PICKED", JSON.stringify(record));
  assert.equal(teamPickedProblem(SPEC.id, RECORD), false);
  // Today's records carry only prose: they must gain the fields (through a PR Peace merges) before any delegated approval.
  const onMain = JSON.parse(readFileSync(join(repo, "peaceai/rules/proposals/public-derive-wire-v2.json"), "utf8"));
  assert.equal(teamPickedProblem(SPEC.id, onMain), true);
});

test("refused: kinds outside source and tests (workflow, env, tsconfig) are never delegable", () => {
  for (const id of ["public-workflow-job-v1", "public-workflow-step-v2", "public-env-fix-v2", "public-tsconfig-script-v1"]) {
    const spec = readSpec(id);
    assert.ok(validateSpec(spec), id);
    assert.equal(auditorPolicyProblem(spec), "KIND_NOT_DELEGABLE", id);
    const sha = specHash(spec);
    const r = validateAuditorApproval(ev({ body: `/auditor-approve-rule ${id} ${sha}`, issueBody: bodyFor(spec) }), { spec, record: { id, teamPicked: true, credit: 0 } }, [{ number: 613, body: bodyFor(spec), isPull: false }], [OTHER]);
    assert.equal(r.ok ? "OK" : r.reason, "KIND_NOT_DELEGABLE", id);
  }
  assert.equal(auditorPolicyProblem({ ...SPEC, kind: "SOME_NEW_KIND" }), "KIND_NOT_DELEGABLE", "an unknown kind is refused (allow-list)");
  for (const k of ["ADD_WORKFLOW_STEP", "WORKFLOW_JOB", "ENV_FIX", "TSCONFIG_SCRIPT", "PACKAGE_SCRIPT", "PACKAGE_SCRIPT_V2", "IMPORT_EDIT"]) assert.ok(!AUDITOR_DELEGABLE_KINDS.has(k), k);
});

test("refused: a rule naming never-zone / protected paths, workflows, gates, credit, tokens or secrets, the verdict, auditor-pass, approve-rule or stage 2", () => {
  const words = [".github/workflows/ci.yml", "peaceai/lib/gate.ts", "never-zone", "neverzone", "protected", "CODEOWNERS", "leak-check", "tamper-proof", "the gate", "test:self", "secret", "TARGET_PR_TOKEN", "credential", "deploy_key", "credit", "coverage", "verdict", "/auditor-pass", "auditor", "/approve-rule", "approval", "approved.json", "stage2", "stage-2", "self-change", "package.json", "tsconfig.json", "x.yml", ".env", ".npmrc", "PeaceAI-Results"];
  for (const w of words) assert.equal(auditorPolicyProblem({ ...SPEC, trigger: `${SPEC.trigger}|${w}` }), "TOUCHES_PROTECTED", w);
  for (const w of words.slice(0, 4)) assert.equal(auditorPolicyProblem({ ...SPEC, params: { ...SPEC.params, extra: [w] } }), "TOUCHES_PROTECTED", `params ${w}`);
  // End to end: a valid spec whose id names a token.
  const spec = { ...SPEC, id: "public-token-wire-v1" } as RuleSpec;
  assert.ok(validateSpec(spec));
  const sha = specHash(spec);
  const r = validateAuditorApproval(ev({ body: `/auditor-approve-rule ${spec.id} ${sha}`, issueBody: bodyFor(spec) }), { spec, record: { id: spec.id, teamPicked: true, credit: 0 } }, [{ number: 613, body: bodyFor(spec), isPull: false }], [OTHER]);
  assert.equal(r.ok ? "OK" : r.reason, "TOUCHES_PROTECTED");
  // Public repo names in evidence.repos are not scanned (they are not paths the rule edits).
  assert.equal(auditorPolicyProblem({ ...SPEC, evidence: { ...SPEC.evidence, repos: ["someone/token-workflow"] } }), null);
  // Every other learned spec on main inside the delegable kinds passes the word scan.
  for (const f of readdirSync(join(repo, "peaceai/rules/learned"))) {
    const s = readSpec(f.replace(/\.json$/, ""));
    if (AUDITOR_DELEGABLE_KINDS.has(s.kind)) assert.equal(auditorPolicyProblem(s), null, f);
  }
});

test("approved.json schema: a delegated entry needs delegatedBy owner; owner entries never carry it; public Workspace ids only", () => {
  const r = run();
  assert.ok(r.ok);
  if (!r.ok) return;
  const { delegatedBy: _d, ...noDelegation } = r.entry;
  assert.equal(validateEntry(noDelegation), false);
  assert.equal(validateEntry({ ...r.entry, delegatedBy: "auditor" }), false);
  assert.equal(validateEntry({ ...OTHER, delegatedBy: "owner" }), false, "an owner entry never carries delegatedBy");
  assert.equal(validateEntry({ ...r.entry, id: "core-set-literal-v1" }), false);
  assert.equal(validateEntry({ ...r.entry, approval: { ...r.entry.approval, url: "https://github.com/PeaceG03/PeaceAI-Results/issues/5#issuecomment-9001", repo: "PeaceG03/PeaceAI-Results", issue: 5 } }), false);
  assert.equal(validateEntry({ ...r.entry, approval: { ...r.entry.approval, author: "someone" } }), false);
  assert.equal(validateEntry({ ...r.entry, extra: 1 }), false);
  assert.equal(validateEntry({ ...r.entry, source: "auditor" }), false);
  // A delegated entry for a core-mined spec is never admitted.
  const list: ApprovedList = { schema: APPROVED_SCHEMA, rules: [r.entry] };
  assert.equal(admitRules([{ ...SPEC, id: SPEC.id, minedFrom: "core" }], { ok: true, list })[0]!.decision, "SPEC_INVALID");
  // The real list on main still validates (no delegated entries today).
  const main = JSON.parse(readFileSync(join(repo, "peaceai/rules/approved.json"), "utf8"));
  assert.ok(validateList(main));
});

test("0 credit: a delegated entry never fills the credit template slot, and a by:PeaceAI landing from it is a rule-skill error", () => {
  const r = run();
  assert.ok(r.ok);
  if (!r.ok) return;
  const files = [`${SPEC.id}.json`, `${OTHER.id}.json`];
  const text = JSON.stringify({ schema: APPROVED_SCHEMA, rules: [OTHER, r.entry] });
  assert.deepEqual([...creditTemplatesFrom(files, text)], [OTHER.id]);
  assert.deepEqual([...creditTemplatesFrom(files, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [OTHER, ownerEntry(SPEC.id, SHA, 78)] }))].sort(), [SPEC.id, OTHER.id].sort(), "the same id approved by Peace earns credit");
  const delegated = delegatedRules(text);
  assert.deepEqual([...delegated], [SPEC.id]);
  assert.deepEqual([...delegatedRules("not json")], []);
  const entry = { seq: 500, date: "2026-10-30", time: "01:00", asked: "x", changed: "PeaceSTOCKS@" + "e".repeat(40), why: "PeaceAI-Workspace#700", skill: "EXISTING_FUNCTION_EDIT", mark: "PeaceAI-able today", by: "PeaceAI" } as never;
  const errs = checkRuleSkills([entry], () => [SPEC.id], { ci: true, delegated });
  assert.equal(errs.length, 1);
  assert.match(errs[0]!, /delegated \(auditor-approve-rule\) rule, which earns no credit/);
  assert.doesNotMatch(errs[0]!, /public-derive-wire/, "ci output names no rule id");
});

test("(d) one append: the list to land is main's list plus exactly the delegated entry", () => {
  const r = run();
  assert.ok(r.ok);
  if (!r.ok) return;
  const main: ApprovedList = { schema: APPROVED_SCHEMA, rules: [OTHER] };
  const good = withEntry(main, r.entry);
  assert.equal(oneAppendProblem(main, good, SPEC.id), null);
  assert.equal(oneAppendProblem(main, good, "public-other-v1"), "the new entry is not the delegated entry for this id");
  const second = ownerEntry("public-test-case-append-v1", "f".repeat(64), 79);
  assert.equal(oneAppendProblem(main, withEntry(good, second), SPEC.id), "not exactly one new entry");
  assert.equal(oneAppendProblem(main, { schema: APPROVED_SCHEMA, rules: [r.entry] }, SPEC.id), "an existing entry was changed or removed");
  assert.equal(oneAppendProblem(main, withEntry({ schema: APPROVED_SCHEMA, rules: [{ ...OTHER, sha256: "9".repeat(64) }] }, r.entry), SPEC.id), "an existing entry was changed or removed");
  assert.equal(oneAppendProblem(main, withEntry(main, ownerEntry(SPEC.id, SHA, 80)), SPEC.id), "the new entry is not the delegated entry for this id");
  assert.equal(oneAppendProblem(main, main, SPEC.id), "not exactly one new entry");
  assert.equal(oneAppendProblem(main, { schema: APPROVED_SCHEMA, rules: [OTHER, r.entry] }, SPEC.id), "the list is not main's list plus this one entry", "not in withEntry's id order");
  assert.equal(oneAppendProblem({ bad: 1 }, good, SPEC.id), "list invalid");
});

test("Peace can revert: a peaceai-revert-auditor-rule/<id> branch may only remove that one delegated entry", () => {
  const r = run();
  assert.ok(r.ok);
  if (!r.ok) return;
  const main: ApprovedList = withEntry({ schema: APPROVED_SCHEMA, rules: [OTHER] }, r.entry);
  const b = `peaceai-revert-auditor-rule/${SPEC.id}`;
  assert.equal(revertProblem(b, main, { schema: APPROVED_SCHEMA, rules: [OTHER] }), null);
  assert.equal(revertProblem(b, main, { schema: APPROVED_SCHEMA, rules: [] }), "the list is not main's list minus that one delegated entry");
  assert.equal(revertProblem(b, main, main), "the list is not main's list minus that one delegated entry");
  assert.equal(revertProblem(`peaceai-revert-auditor-rule/${OTHER.id}`, main, { schema: APPROVED_SCHEMA, rules: [r.entry] }), "the id is not a delegated (auditor-approve-rule) entry on main", "an owner approval is not reverted this way");
  assert.equal(revertProblem("peaceai-revert-auditor-rule/../x", main, main), "not a revert branch");
  assert.equal(branchProblem(b, ["peaceai/rules/approved.json"], 1), null);
  assert.equal(branchProblem(b, ["peaceai/rules/approved.json", "peaceai/lib/gate.ts"], 1), "revert branch changes files other than the approved list");
  assert.equal(branchProblem(b, ["peaceai/rules/approved.json"], 2), "revert branch must be exactly one commit ahead of main");
  assert.equal(branchProblem("feature/x", ["peaceai/rules/approved.json"], 1), "approved list changed outside the approval workflow");
});

test("Peace's own /approve-rule is unchanged: same command, and it refuses the delegated command form", () => {
  assert.equal(String(APPROVE_COMMAND), String(/^\/approve-rule ([0-9a-f]{64})\s*$/));
  const pubEv: CommentEvent = { ...ev(), body: `/auditor-approve-rule ${SPEC.id} ${SHA}` };
  assert.deepEqual(validateWorkspaceApproval(pubEv, SPEC, []), { ok: false, reason: "BAD_COMMAND" });
  const owner = validateWorkspaceApproval({ ...ev(), body: `/approve-rule ${SHA}`, labels: ["rule-proposal"] }, SPEC, []);
  assert.ok(owner.ok && owner.entry.source === "workspace" && !("delegatedBy" in owner.entry), "Peace's approval is still an owner (workspace) entry");
  assert.equal(AUDITOR_APPROVE_COMMAND.test(`/approve-rule ${SHA}`), false);
  // The catch-up pass never lands a delegated entry (it refuses anything but a workspace entry).
  assert.match(readFileSync(join(repo, "peaceai/lib/approval.ts"), "utf8"), /if \(claimed\.source !== "workspace"\) return refuse\("NOT_WORKSPACE"\);/);
});

// ---- approve-rule.ts auditor / check-append (the workflow's entry points)

function cli(mode: string, env: Record<string, string>) {
  return spawnSync(tsx, [join(repo, "peaceai/bin/approve-rule.ts"), mode], { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } });
}
const outOf = (f: string) => Object.fromEntries(readFileSync(f, "utf8").trim().split("\n").map((l) => l.split("=") as [string, string]));

test("approve-rule.ts auditor: writes the one delegated entry and the message; a refusal writes nothing; check-append re-checks it", () => {
  const dir = scratch();
  try {
    const rules = join(dir, "learned"); const recs = join(dir, "proposals");
    mkdirSync(rules); mkdirSync(recs);
    writeFileSync(join(rules, `${SPEC.id}.json`), JSON.stringify(SPEC));
    writeFileSync(join(recs, `${SPEC.id}.json`), JSON.stringify(RECORD));
    const list = join(dir, "approved.json");
    const start = JSON.stringify({ schema: APPROVED_SCHEMA, rules: [OTHER] }, null, 2) + "\n";
    writeFileSync(list, start);
    writeFileSync(join(dir, "main.json"), start);
    writeFileSync(join(dir, "proposals.json"), JSON.stringify(issues().map((i) => ({ number: i.number, body: i.body }))));
    const e = ev();
    const env = (o: Record<string, string> = {}) => ({
      PEACEAI_APPROVED_LIST_OUT: list, PEACEAI_RULES_DIR: rules, PEACEAI_PROPOSAL_RECORDS_DIR: recs, PEACEAI_PROPOSALS_FILE: join(dir, "proposals.json"),
      GITHUB_REPOSITORY: e.repo, COMMENT_BODY: e.body, COMMENT_AUTHOR: e.author, COMMENT_ASSOCIATION: e.association, COMMENT_ID: String(e.commentId),
      COMMENT_URL: e.url, COMMENT_CREATED_AT: e.createdAt, ISSUE_NUMBER: String(e.issue), ISSUE_LABELS: JSON.stringify(e.labels), ISSUE_BODY: e.issueBody,
      PEACEAI_MESSAGE_FILE: join(dir, "msg.txt"), GITHUB_OUTPUT: join(dir, "out.txt"), ...o,
    });
    // Refusals write nothing.
    for (const [o, why] of [[{ ISSUE_LABELS: JSON.stringify(["rule-proposal"]) }, "NOT_SOURCE_BUILDER"], [{ COMMENT_BODY: `/approve-rule ${SHA}` }, "BAD_COMMAND"], [{ PEACEAI_PROPOSAL_RECORDS_DIR: join(dir, "none") }, "NOT_TEAM_PICKED"], [{ PEACEAI_PROPOSALS_FILE: join(dir, "missing.json") }, "BAD_EVENT"]] as const) {
      writeFileSync(join(dir, "out.txt"), "");
      const r = cli("auditor", env(o));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(outOf(join(dir, "out.txt")).reason, why);
      assert.equal(outOf(join(dir, "out.txt")).changed, "false");
      assert.equal(readFileSync(list, "utf8"), start, why);
      assert.equal(existsSync(join(dir, "msg.txt")), false);
    }
    writeFileSync(join(dir, "out.txt"), "");
    const ok = cli("auditor", env());
    assert.equal(ok.status, 0, ok.stderr);
    const out = outOf(join(dir, "out.txt"));
    assert.deepEqual([out.ok, out.changed, out.reason, out.rules], ["true", "true", "ADDED", SPEC.id]);
    const landed = JSON.parse(readFileSync(list, "utf8")) as ApprovedList;
    assert.equal(landed.rules.length, 2);
    assert.equal(landed.rules.find((x) => x.id === SPEC.id)!.source, "auditor-approve-rule");
    assert.match(readFileSync(join(dir, "msg.txt"), "utf8"), /^approve learned rule: public-derive-wire-v2\n[\s\S]*Approval-Source: auditor-approve-rule/);
    // check-append: PASS on this list, FAIL on a list with one more change.
    writeFileSync(join(dir, "out.txt"), "");
    const ca = cli("check-append", { PEACEAI_APPROVED_LIST_OUT: list, PEACEAI_MAIN_LIST: join(dir, "main.json"), PEACEAI_AUDITOR_RULE: SPEC.id, GITHUB_OUTPUT: join(dir, "out.txt") });
    assert.match(ca.stdout, /check-append PASS/);
    assert.equal(outOf(join(dir, "out.txt")).ok, "true");
    writeFileSync(list, JSON.stringify(withEntry(landed, ownerEntry("public-test-case-append-v1", "f".repeat(64), 79)), null, 2));
    writeFileSync(join(dir, "out.txt"), "");
    const bad = cli("check-append", { PEACEAI_APPROVED_LIST_OUT: list, PEACEAI_MAIN_LIST: join(dir, "main.json"), PEACEAI_AUDITOR_RULE: SPEC.id, GITHUB_OUTPUT: join(dir, "out.txt") });
    assert.match(bad.stdout, /check-append FAIL: not exactly one new entry/);
    assert.deepEqual([outOf(join(dir, "out.txt")).ok, outOf(join(dir, "out.txt")).reason], ["false", "NOT_ONE_APPEND"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- check-approved-list.ts (tamper-proof) re-reads a delegated entry

function fakeGh(dir: string, o: { comment: unknown; issue: unknown; proposals: unknown[]; main?: unknown; files?: string[]; ahead?: number }): string {
  const f = join(dir, "gh");
  writeFileSync(f, `#!/usr/bin/env node
const p = process.argv.slice(2).find((a) => a.startsWith("repos/"));
const o = ${JSON.stringify(o)};
if (p.includes("/issues/comments/")) process.stdout.write(JSON.stringify(o.comment));
else if (p.includes("/issues?labels=")) process.stdout.write(JSON.stringify([o.proposals]));
else if (p.includes("/contents/")) process.stdout.write(JSON.stringify({ content: Buffer.from(JSON.stringify(o.main)).toString("base64") }));
else if (p.includes("/compare/main...")) process.stdout.write(JSON.stringify({ ahead_by: o.ahead ?? 1, files: (o.files ?? []).map((filename) => ({ filename })) }));
else if (/\\/issues\\/\\d+$/.test(p)) process.stdout.write(JSON.stringify(o.issue));
else process.exit(1);
`);
  chmodSync(f, 0o755);
  return f;
}

test("check-approved-list.ts: a delegated entry is re-read (exact command, source:builder, one proposal, record, policy) and listed apart", () => {
  const dir = scratch();
  try {
    const r = run();
    assert.ok(r.ok);
    if (!r.ok) return;
    const rules = join(dir, "learned"); const recs = join(dir, "proposals");
    mkdirSync(rules); mkdirSync(recs);
    writeFileSync(join(rules, `${SPEC.id}.json`), JSON.stringify(SPEC));
    writeFileSync(join(recs, `${SPEC.id}.json`), JSON.stringify(RECORD));
    const list = join(dir, "approved.json");
    const landed = withEntry({ schema: APPROVED_SCHEMA, rules: [] }, r.entry);
    writeFileSync(list, JSON.stringify(landed));
    const comment = { user: { login: "PeaceG03" }, author_association: "OWNER", body: `/auditor-approve-rule ${SPEC.id} ${SHA}`, html_url: URL0, issue_url: "https://api.github.com/repos/PeaceG03/PeaceAI-Workspace/issues/613" };
    const issue = { labels: [{ name: "rule-proposal" }, { name: "source:builder" }], body: bodyFor(SPEC) };
    const proposals = [{ number: 613, body: bodyFor(SPEC) }];
    const go = (o: Partial<Parameters<typeof fakeGh>[1]> = {}, branch = "main", envX: Record<string, string> = {}) => spawnSync(tsx, [join(repo, "peaceai/bin/check-approved-list.ts")], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_HEAD_REF: "", GITHUB_REF_NAME: branch, GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace", PEACEAI_APPROVED_LIST: list, PEACEAI_RULES_DIR: rules, PEACEAI_PROPOSAL_RECORDS_DIR: recs, PEACEAI_GH: fakeGh(dir, { comment, issue, proposals, ...o }), ...envX } });
    const good = go();
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /APPROVED LIST OK public-derive-wire-v2 \(delegated\)/);
    assert.match(good.stdout, /APPROVED LIST DELEGATED public-derive-wire-v2: auditor-approve-rule, delegatedBy owner \(not an owner approval, 0 credit\)/);
    assert.match(good.stdout, /APPROVED LIST PASS rules=1 owner=0 delegated=1/);
    const fails: [Partial<Parameters<typeof fakeGh>[1]>, RegExp][] = [
      [{ comment: { ...comment, body: `/approve-rule ${SHA}` } }, /not exactly \/auditor-approve-rule <id> <pinned hash>/],
      [{ comment: { ...comment, user: { login: "someone" } } }, /author is not PeaceG03/],
      [{ issue: { ...issue, labels: [{ name: "rule-proposal" }] } }, /not a source:builder rule proposal/],
      [{ issue: { ...issue, body: bodyFor(SPEC).replace(/<!-- spec -->[\s\S]*<!-- \/spec -->/, "") } }, /spec block does not hash/],
      [{ proposals: [...proposals, { number: 700, body: bodyFor(SPEC) }] }, /not exactly one rule-proposal issue/],
    ];
    for (const [o, re] of fails) { const x = go(o); assert.equal(x.status, 1, String(re)); assert.match(x.stdout, re); }
    const noRec = go({}, "main", { PEACEAI_PROPOSAL_RECORDS_DIR: join(dir, "none") });
    assert.match(noRec.stdout, /proposal record does not say team-picked and 0 credit/);
    // Approval branch: a new delegated entry must be the only change against main's list.
    const files = ["peaceai/rules/approved.json"];
    assert.equal(go({ main: { schema: APPROVED_SCHEMA, rules: [] }, files }, "peaceai-approve-rule/abc").status, 0);
    writeFileSync(list, JSON.stringify(withEntry(landed, ownerEntry("public-test-case-v1", "a".repeat(64)))));
    const extra = go({ main: { schema: APPROVED_SCHEMA, rules: [] }, files }, "peaceai-approve-rule/abc");
    assert.equal(extra.status, 1);
    assert.match(extra.stdout, /delegated entry: not exactly one new entry/);
    // Revert branch: only that one delegated entry removed.
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [] }));
    assert.equal(go({ main: landed, files }, `peaceai-revert-auditor-rule/${SPEC.id}`).status, 0);
    writeFileSync(list, JSON.stringify(landed));
    const notRemoved = go({ main: landed, files }, `peaceai-revert-auditor-rule/${SPEC.id}`);
    assert.equal(notRemoved.status, 1);
    assert.match(notRemoved.stdout, /not main's list minus that one delegated entry/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- workflow wiring

test("workflow: the auditor job, the one-append re-check before landing, the required checks; Peace's workspace job unchanged", () => {
  const wf = readFileSync(join(repo, ".github/workflows/peace-approve-rule.yml"), "utf8");
  const job = wf.slice(wf.indexOf("\n  auditor:"), wf.indexOf("\n  results-read:"));
  assert.match(job, /contains\(github\.event\.issue\.labels\.\*\.name, 'rule-proposal'\)/);
  assert.match(job, /contains\(github\.event\.issue\.labels\.\*\.name, 'source:builder'\)/);
  assert.match(job, /github\.event\.comment\.user\.login == 'PeaceG03'/);
  assert.match(job, /startsWith\(github\.event\.comment\.body, '\/auditor-approve-rule'\)/);
  assert.match(job, /issues\?labels=rule-proposal&state=all/);
  assert.match(job, /approve-rule\.ts auditor/);
  assert.match(job, /permissions:\n      contents: read\n      issues: write\n/);
  assert.doesNotMatch(job, /secrets\.|environment:|contents: write/);
  const ws = wf.slice(wf.indexOf("\n  workspace:"), wf.indexOf("\n  auditor:"));
  assert.match(ws, /startsWith\(github\.event\.comment\.body, '\/approve-rule'\)/);
  assert.match(ws, /approve-rule\.ts workspace/);
  const land = wf.slice(wf.indexOf("\n  results-land:"), wf.indexOf("\n  approval-catchup:"));
  assert.match(land, /needs: \[workspace, auditor, results-reverify\]/);
  assert.match(land, /needs\.auditor\.outputs\.changed == 'true'/);
  const check = land.indexOf("approve-rule.ts check-append");
  assert.ok(check > land.indexOf("check-approved-list.ts") && check < land.indexOf("approve-rule-pr.sh"), "re-checked before landing");
  assert.match(land, /steps\.append\.outputs\.ok != 'true'[\s\S]*exit 1/);
  assert.doesNotMatch(wf, /PEACEAI_REQUIRED_CHECKS/);
  assert.match(readFileSync(join(repo, "peaceai/bin/approve-rule-pr.sh"), "utf8"), /REQUIRED_CHECKS="\$\{PEACEAI_REQUIRED_CHECKS:-leak-check tamper-proof tests\}"/);
});
