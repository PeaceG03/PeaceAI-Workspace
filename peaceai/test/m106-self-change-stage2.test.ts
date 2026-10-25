// M106: self-change stage 2. PeaceAI may PROPOSE changes to its own protected code under Auditor's limits 1-5;
// every limit is enforced by code and each has negative tests here. Nothing here enables stage 2 (the flag stays off).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addOnlyTestCheck, checkStage2Proposal, listGrowthRefusals, listSha, NEVER_ZONE, protectedReason,
  stage2Credit, stage2DiffSha, stage2Enabled, stage2GradeDecision, stage2LandingDecision, stage2PathRefusal,
  STAGE2_FLAG_PATH, STAGE2_SCHEMA, type CommandComment, type Stage2Record,
} from "../lib/selfchange.ts";
import { inSafeZone } from "../lib/self-zone.ts";
import { proposeStage2InSandbox } from "../lib/selfpropose.ts";

const repo = join(import.meta.dirname, "../..");

// ---- a tiny proposal builder: one git-diff entry per file, every candidate line counted as added
interface F { path: string; base: string | null; cand: string | null; mode?: string; renameFrom?: string; binary?: boolean }
function proposal(files: F[]) {
  const parts: string[] = [];
  for (const f of files) {
    const from = f.renameFrom ?? f.path;
    parts.push(`diff --git a/${from} b/${f.path}`);
    if (f.renameFrom) parts.push("similarity index 90%", `rename from ${f.renameFrom}`, `rename to ${f.path}`);
    if (f.base === null) parts.push(`new file mode ${f.mode ?? "100644"}`);
    else if (f.cand === null) parts.push("deleted file mode 100644");
    else if (f.mode) parts.push("old mode 100644", `new mode ${f.mode}`);
    if (f.binary) { parts.push(`Binary files a/${from} and b/${f.path} differ`); continue; }
    parts.push(f.base === null ? "--- /dev/null" : `--- a/${from}`, f.cand === null ? "+++ /dev/null" : `+++ b/${f.path}`, "@@ -1 +1 @@");
    const old = new Set((f.base ?? "").split("\n"));
    for (const l of (f.cand ?? "").split("\n")) if (!old.has(l)) parts.push(`+${l}`);
  }
  const diff = parts.join("\n") + "\n";
  const read = {
    base: (p: string) => files.find((f) => f.path === p)?.base ?? null,
    cand: (p: string) => files.find((f) => f.path === p)?.cand ?? null,
  };
  return checkStage2Proposal(diff, read);
}
const reasons = (c: { refusals: { reason: string }[] }) => c.refusals.map((r) => r.reason).join(" | ");

const BASE_TEST = [
  'import assert from "node:assert/strict";',
  'import test from "node:test";',
  'import { LIST, f } from "../lib/thing.ts";',
  "",
  'test("one", () => {',
  "  assert.equal(f(1), 2);",
  "});",
  "",
  'test("two", () => {',
  "  assert.equal(LIST.length, 3);",
  "});",
  "",
].join("\n");
const add = (extra: string) => BASE_TEST + extra + "\n";
const T = "peaceai/test/m999-x.test.ts";

test("M106 limit 1: every never-zone path is refused, even as a proposal; PeaceAI's own engines and root docs are proposable", () => {
  const never = [
    ".github/workflows/peace-task.yml", ".github/CODEOWNERS", ".githooks/pre-push", ".env", ".npmrc", "peaceai/.env", "CODEOWNERS", "docs/CODEOWNERS",
    "README.md", "SECURITY.md", "package.json", "package-lock.json", "tsconfig.json", "docs/peaceai-public-origin.json",
    "peaceai/lib/leak.ts", "peaceai/bin/leak-scan.ts", "peaceai/bin/prepush-scan.ts", "peaceai/lib/kernelguard.ts", "peaceai/lib/scope.ts", "peaceai/proof/tamper-proof.ts", "peaceai/bin/pr-guard.ts",
    "peaceai/lib/self-zone.ts", "peaceai/lib/selfchange.ts", "peaceai/lib/selfpropose.ts", "peaceai/bin/self-change.ts",
    "peaceai/results-repo/self-change-stage2.yml", "peaceai/results-repo/rule-approval.yml", "peaceai/self/stage2.json", "peaceai/self/approvers.json",
    "peaceai/rules/approved.json", "peaceai/rules/learned/public-x-v1.json", "peaceai/rules/proposals/x.json", "peaceai/approved.json",
    "peaceai/lib/verdict.ts", "peaceai/lib/approval.ts", "peaceai/lib/approved.ts", "peaceai/lib/trigger.ts", "peaceai/lib/results.ts", "peaceai/lib/patch.ts",
    "peaceai/bin/parse-verdict.ts", "peaceai/bin/record-verdict.ts", "peaceai/bin/approve-rule.ts", "peaceai/bin/approve-rule-catchup.ts", "peaceai/bin/check-approved-list.ts", "peaceai/bin/apply-verdict-patch.ts",
    "peaceai/bin/test-candidates.ts", "peaceai/bin/gate.ts", "peaceai/lib/gate.ts", "peaceai/lib/records.ts", "peaceai/bin/clone-target.sh",
    "peaceai/targets.json", "peaceai/lib/target.ts", "peaceai/read-only-ops.json", "peaceai/lib/lm.ts", "peaceai/model/ext-train.json",
    "builder-log/check.ts", "builder-log/trace.ts", "builder-log/coverage.test.ts", "builder-log/log.jsonl",
    "src/universe.ts", "docs/sub/a.md", "docs/A.md", "/peaceai/lib/x.ts", "peaceai/../package.json", "peaceai//lib/x.ts", "peaceai/./lib/x.ts",
  ];
  for (const p of never) assert.ok(stage2PathRefusal(p), `${p} must be refused`);
  // Stage 1 (M11) is closed to these too, except the gaps below. This PR leaves PROTECTED_SELF (and its pinned
  // digest) unchanged; the gaps are listed for Auditor as a follow-up tightening, and stage 2 closes them already.
  const STAGE1_GAPS = ["peaceai/.env", "peaceai/approved.json", "peaceai/read-only-ops.json", "peaceai/results-repo/self-change-stage2.yml", "peaceai/results-repo/rule-approval.yml"];
  for (const p of never.filter((p) => !p.startsWith("src/") && !p.startsWith("docs/sub") && p !== "docs/A.md" && !STAGE1_GAPS.includes(p))) {
    assert.ok(protectedReason(p), `${p} must also be closed to M11 stage 1`);
  }
  for (const p of STAGE1_GAPS) assert.ok(stage2PathRefusal(p), `${p}: stage 2 closes the stage-1 gap`);
  for (const p of ["peaceai/lib/propose.ts", "peaceai/lib/learned.ts", "peaceai/lib/nlparse.ts", "peaceai/bin/generate.ts", "peaceai/test/m999-x.test.ts", "peaceai/docs/a.md", "docs/guide.md"]) {
    assert.equal(stage2PathRefusal(p), null, p);
  }
  // Auditor ruling (A): root docs/*.md is in the stage-1 safe zone with the peaceai/docs shape rules
  assert.ok(inSafeZone("docs/guide.md"));
  for (const p of ["docs/sub/a.md", "docs/A.md", "docs/.a.md", "docs/a.txt", "docs/../a.md"]) assert.ok(!inSafeZone(p), p);
  // the never-zone names its own machinery
  assert.ok(NEVER_ZONE.some((z) => z.pattern.test("peaceai/lib/selfchange.ts")) && NEVER_ZONE.some((z) => z.pattern.test(STAGE2_FLAG_PATH)));
});

test("M106 limit 1: a proposal touching any never-zone path, by any side of a rename, is refused whole", () => {
  const ok = { path: "peaceai/lib/propose.ts", base: "export const a = 1;\n", cand: "export const a = 2;\n" };
  assert.equal(proposal([ok]).ok, true, reasons(proposal([ok])));
  for (const bad of [".github/workflows/x.yml", "peaceai/lib/selfchange.ts", "peaceai/self/stage2.json", "peaceai/rules/approved.json", "builder-log/check.ts", "peaceai/lib/verdict.ts"]) {
    const c = proposal([ok, { path: bad, base: "x\n", cand: "y\n" }]);
    assert.equal(c.ok, false, bad);
    assert.match(reasons(c), /never-zone/, bad);
  }
  assert.match(reasons(proposal([{ path: "peaceai/lib/x2.ts", renameFrom: "peaceai/lib/verdict.ts", base: "a\n", cand: "a\n" }])), /never-zone[^|]*verdict|renames/);
  assert.match(reasons(proposal([{ path: "peaceai/lib/verdict.ts", renameFrom: "peaceai/lib/x2.ts", base: "a\n", cand: "a\n" }])), /never-zone/);
});

test("M106: binary, mode changes, symlinks, deletions and renames are refused", () => {
  assert.match(reasons(proposal([{ path: "peaceai/lib/a.ts", base: "a\n", cand: "b\n", binary: true }])), /binary change/);
  assert.match(reasons(proposal([{ path: "peaceai/lib/a.ts", base: "a\n", cand: "a\n", mode: "100755" }])), /file mode 100755/);
  assert.match(reasons(proposal([{ path: "peaceai/lib/a.ts", base: null, cand: "a\n", mode: "120000" }])), /file mode 120000/);
  assert.match(reasons(proposal([{ path: "peaceai/lib/a.ts", base: "a\n", cand: null }])), /deletes a file/);
  assert.match(reasons(proposal([{ path: "peaceai/lib/b.ts", renameFrom: "peaceai/lib/a.ts", base: "a\n", cand: "a\n" }])), /renames or copies/);
  assert.match(reasons(checkStage2Proposal("", { base: () => null, cand: () => null })), /not a git diff/);
});

test("M106: content bans (credentials, hooks, approval commands, dynamic code, runner variables)", () => {
  for (const [line, why] of [
    ["const t = process.env.GITHUB_TOKEN;", /credential/], ["const k = secrets.X;", /credential/], ['run("git", ["push", "--no-verify"]);', /git hooks/],
    ['const c = "/auditor-pass sc-x abc";', /approval command/], ['const c = "/approve-rule abc";', /approval command/], ['eval("1");', /dynamic code/],
    ['const f = new Function("return 1");', /dynamic code/], ["const m = require(name);", /dynamic code/], ["if (process.env.PEACEAI_SELF_X) {}", /self-change \/ runner/],
  ] as const) {
    assert.match(reasons(proposal([{ path: "peaceai/lib/a.ts", base: "export const a = 1;\n", cand: `export const a = 1;\n${line}\n` }])), why, line);
  }
});

test("M106 limit 2: test edits are add-only, checked on the AST against the base", () => {
  const refused: [string, string, RegExp][] = [
    ["changed assertion", BASE_TEST.replace("f(1), 2", "f(1), 3"), /existing statement .* changed/],
    ["weakened assertion (comment-only change is fine, this is not)", BASE_TEST.replace("assert.equal(f(1), 2);", "assert.ok(true);"), /existing statement .* changed/],
    ["removed test", BASE_TEST.replace(/test\("two"[\s\S]*?\}\);\n/, ""), /existing statement .* changed/],
    ["reordered tests", BASE_TEST.split("\n\n").slice(0, 1).concat(BASE_TEST.split("\n\n").slice(2, 3), BASE_TEST.split("\n\n").slice(1, 2)).join("\n\n"), /existing statement .* changed/],
    ["test.skip", add('test.skip("three", () => {});'), /test\(\)\/it\(\)|uses skip/],
    ["test.only", add('test.only("three", () => {});'), /uses only|test\(\)\/it\(\)/],
    ["test.todo", add('test.todo("three");'), /uses todo|test\(\)\/it\(\)/],
    ["options object (skip)", add('test("three", { skip: true }, () => {});'), /test\(name, fn\)/],
    ["options object (timeout)", add('test("three", { timeout: 1 }, () => {});'), /test\(name, fn\)/],
    ["t.skip inside", add('test("three", (t) => { t.skip(); });'), /uses skip/],
    ["t.mock", add('test("three", (t) => { t.mock.method(Math, "random"); });'), /uses mock/],
    ["import mock", add('import { mock } from "node:test";'), /imports mock/],
    ["beforeEach", add('import { beforeEach } from "node:test";'), /imports beforeEach/],
    ["stub helper", add('test("three", () => { const stub = 1; assert.ok(stub); });'), /uses stub/],
    ["write process.env", add('test("three", () => { process.env.X = "1"; });'), /writes process\.env/],
    ["push into an imported list", add('test("three", () => { LIST.push(4); });'), /mutates LIST/],
    ["assign into an imported binding", add('test("three", () => { (f as any).x = 1; });'), /writes/],
    ["delete from an imported binding", add('test("three", () => { delete (LIST as any)[0]; });'), /writes/],
    ["Object.defineProperty", add('test("three", () => { Object.defineProperty(LIST, "length", { value: 3 }); });'), /uses defineProperty/],
    ["Reflect", add('test("three", () => { Reflect.set(LIST, 0, 1); });'), /uses Reflect/],
    ["prototype patch", add('test("three", () => { const p = Array.prototype; assert.ok(p); });'), /uses prototype/],
    ['["skip"]', add('test["skip"]("three", () => {});'), /\["skip"\]|test\(\)\/it\(\)/],
    ["describe", add('describe("d", () => {});'), /top-level statement of kind/],
    ["top-level if", add("if (LIST.length) {}"), /top-level statement of kind IfStatement/],
    ["top-level loop", add('for (const x of [1]) test(`t${x}`, () => {});'), /top-level statement of kind ForOfStatement/],
    ["top-level let", add("let n = 1;"), /added top-level let\/var/],
    ["computed name", add('const n = "x"; test(n, () => {});'), /without a literal name/],
    ["duplicate new name", add('test("three", () => {});\ntest("three", () => {});'), /not unique/],
    ["reuses an existing name", add('test("one", () => {});'), /not unique/],
    ["does not parse", add('test("three", () => {'), /does not parse/],
  ];
  for (const [what, cand, why] of refused) {
    const r = addOnlyTestCheck(T, BASE_TEST, cand);
    assert.ok(r.refusals.length > 0, `${what}: must be refused`);
    assert.match(r.refusals.join(" | "), why, `${what}: ${r.refusals.join(" | ")}`);
  }
  // positive controls: comments/whitespace on old statements, new imports/consts/helpers/tests, local mutation, fresh copies
  const ok = addOnlyTestCheck(T, BASE_TEST, BASE_TEST.replace("assert.equal(f(1), 2);", "// why\n    assert.equal( f(1),  2 );") + [
    'import { g } from "../lib/other.ts";',
    "const CASES = [1, 2];",
    "function twice(x: number) { return x * 2; }",
    'test("three", () => {',
    "  const seen: number[] = [];",
    "  for (const c of CASES) seen.push(twice(c));",
    "  assert.deepEqual([...LIST].sort(), [1, 2, 3]);",
    "  assert.deepEqual(seen, [2, 4]);",
    "  assert.equal(g(), 1);",
    "});",
    'it("four", () => { assert.equal("a/b".split("/").pop(), "b"); });',
  ].join("\n") + "\n");
  assert.deepEqual(ok.refusals, []);
  assert.deepEqual(ok.added, ["three", "four"]);
  assert.deepEqual(addOnlyTestCheck(T, null, 'import test from "node:test";\ntest("new file", () => {});\n'), { refusals: [], added: ["new file"] });
  // via the proposal: fixtures and non-.ts tests cannot be checked add-only, so they are refused
  assert.match(reasons(proposal([{ path: "peaceai/test/fixtures/m999/a.txt", base: null, cand: "x\n" }])), /fixtures/);
  assert.match(reasons(proposal([{ path: "peaceai/test/helper.ts", base: "a\n", cand: "b\n" }])), /fixtures and non-\.ts tests/);
  assert.match(reasons(proposal([{ path: "peaceai/self-tests/x.test.mjs", base: null, cand: "x\n" }])), /non-\.ts tests/);
  const p = proposal([{ path: T, base: BASE_TEST, cand: add('test("three", () => { assert.equal(f(2), 4); });') }]);
  assert.equal(p.ok, true, reasons(p));
  assert.deepEqual(p.newTests, [{ file: T, names: ["three"] }]);
});

test("M106 limit 2: growing any allowlist / exemption / KNOWN_* / GRANDFATHERED / accepted-reason list is a weakening; so is an enable flip", () => {
  const ts = (base: string, cand: string) => listGrowthRefusals("peaceai/lib/a.ts", base, cand);
  assert.match(ts('export const KNOWN_REFUSALS = ["a"];', 'export const KNOWN_REFUSALS = ["a", "b"];').join(), /allowlist-like KNOWN_REFUSALS/);
  assert.match(ts('const GRANDFATHERED = new Set(["a"]);', 'const GRANDFATHERED = new Set(["a", "b"]);').join(), /GRANDFATHERED/);
  assert.match(ts('const ACCEPTED_REASONS = { a: 1 };', 'const ACCEPTED_REASONS = { a: 1, b: 2 };').join(), /ACCEPTED_REASONS/);
  assert.match(ts("const cfg = { allow: [1] };", "const cfg = { allow: [1, 2] };").join(), /cfg\.allow/);
  assert.match(ts("const EXEMPT_PATHS: string[] = [];", "const EXEMPT_PATHS: string[] = [];\nEXEMPT_PATHS.push(\"x\");").join(), /grows an allowlist-like list/);
  assert.match(ts("const s = { trusted: new Set<string>() };", "const s = { trusted: new Set<string>() };\ns.trusted.add(\"x\");").join(), /grows an allowlist-like list/);
  assert.match(ts("export const STAGE_ENABLED = false;", "export const STAGE_ENABLED = true;").join(), /flips switch STAGE_ENABLED/);
  assert.match(ts("const o = { liveMode: false };", "const o = { liveMode: true };").join(), /flips switch/);
  assert.match(ts("", "export const NEW_FEATURE_FLAG = true;").join(), /flips switch/);
  assert.match(ts("const disableGate = true;", "const disableGate = false;").join(), /flips switch/);
  const json = (path: string, base: string | null, cand: string) => listGrowthRefusals(path, base, cand);
  assert.match(json("peaceai/x-allowlist.json", "[1]", "[1, 2]").join(), /allowlist-like/);
  assert.match(json("peaceai/conf.json", '{"exemptions": ["a"]}', '{"exemptions": ["a", "b"]}').join(), /allowlist-like/);
  assert.match(json("peaceai/conf.json", '{"rules": {"known": {"a": 1}}}', '{"rules": {"known": {"a": 1, "b": 2}}}').join(), /allowlist-like/);
  assert.match(json("peaceai/conf.json", '{"enabled": false}', '{"enabled": true}').join(), /flips switch \$\.enabled/);
  // through the proposal, on a test-free engine change
  assert.match(reasons(proposal([{ path: "peaceai/lib/propose.ts", base: 'const KNOWN_X = ["a"];\n', cand: 'const KNOWN_X = ["a", "b"];\n' }])), /weakening: adds an entry/);
  // controls: removing an entry, reordering, growing a non-list name, turning a switch off
  assert.deepEqual(ts('const KNOWN_X = ["a", "b"];', 'const KNOWN_X = ["a"];'), []);
  assert.deepEqual(ts('const KNOWN_X = ["a", "b"];', 'const KNOWN_X = ["b", "a"];'), []);
  assert.deepEqual(ts('const CASES = ["a"];', 'const CASES = ["a", "b"];'), []);
  assert.deepEqual(ts("const STAGE_ENABLED = true;", "const STAGE_ENABLED = false;"), []);
  assert.deepEqual(json("peaceai/conf.json", '{"items": [1]}', '{"items": [1, 2]}'), []);
});

// ---- limit 3: the grade
const SUITE = ["peaceai/test/a.test.ts", "peaceai/test/b.test.ts", "src/c.test.ts"];
const HEAD = "a".repeat(40);
function goodRecord(): Stage2Record {
  return {
    schema: STAGE2_SCHEMA, id: "sc-demo", baseSha: "b".repeat(40), candidateSha: HEAD, diffSha256: "d".repeat(64),
    paths: ["peaceai/lib/propose.ts", T], candidateBlobs: { "peaceai/lib/propose.ts": "1".repeat(40), [T]: "2".repeat(40) },
    check: { ok: true, refusals: [], paths: ["peaceai/lib/propose.ts", T], newTests: [{ file: T, names: ["three"] }] },
    baseSuite: { suite: "live", files: [...SUITE], filesSha256: listSha(SUITE), exitCode: 0, pass: 40, fail: 0 },
    newTests: [{ file: T, name: "three", onBase: { exitCode: 1, pass: 0, fail: 1 }, onCandidate: { exitCode: 0, pass: 1, fail: 0 } }],
    status: "awaiting-review", createdAt: "2026-10-25T07:00:00.000Z",
  };
}

test("M106 limit 3: grade = unchanged base suite passes on the candidate, each new test fails on base and passes on the candidate", () => {
  assert.deepEqual(stage2GradeDecision(goodRecord(), SUITE), { ok: true, reasons: [] });
  const bad: [string, (r: Stage2Record) => void, string][] = [
    ["schema", (r) => { (r as { schema: string }).schema = "peaceai-self-change:v1"; }, "BAD_RECORD"],
    ["check refused", (r) => { r.check.ok = false; }, "CHECK_REFUSED"],
    ["never-zone path in record", (r) => { r.paths.push("peaceai/lib/selfchange.ts"); }, "CHECK_REFUSED"],
    ["suite file dropped", (r) => { r.baseSuite.files = SUITE.slice(1); }, "BASE_SUITE_MISMATCH"],
    ["suite hash forged", (r) => { r.baseSuite.filesSha256 = listSha(["x"]); }, "BASE_SUITE_MISMATCH"],
    ["suite from the candidate (extra file)", (r) => { r.baseSuite.files = [...SUITE, "peaceai/test/new.test.ts"]; r.baseSuite.filesSha256 = listSha(r.baseSuite.files); }, "BASE_SUITE_MISMATCH"],
    ["base suite fails on candidate", (r) => { r.baseSuite.fail = 1; }, "BASE_SUITE_FAILED_ON_CANDIDATE"],
    ["base suite non-zero exit", (r) => { r.baseSuite.exitCode = 1; }, "BASE_SUITE_FAILED_ON_CANDIDATE"],
    ["base suite ran nothing", (r) => { r.baseSuite.pass = 0; }, "BASE_SUITE_FAILED_ON_CANDIDATE"],
    ["new test not run", (r) => { r.newTests = []; }, "NEW_TESTS_NOT_ALL_RUN"],
    ["new test passes on base", (r) => { r.newTests[0]!.onBase = { exitCode: 0, pass: 1, fail: 0 }; }, "NEW_TEST_PASSES_ON_BASE"],
    ["new test fails on candidate", (r) => { r.newTests[0]!.onCandidate = { exitCode: 1, pass: 0, fail: 1 }; }, "NEW_TEST_FAILS_ON_CANDIDATE"],
    ["new test ran nothing on candidate", (r) => { r.newTests[0]!.onCandidate = { exitCode: 0, pass: 0, fail: 0 }; }, "NEW_TEST_FAILS_ON_CANDIDATE"],
    ["no candidate sha", (r) => { r.candidateSha = ""; }, "BAD_RECORD"],
    ["no diff hash", (r) => { r.diffSha256 = "x"; }, "BAD_RECORD"],
  ];
  for (const [what, mut, reason] of bad) {
    const r = goodRecord();
    mut(r);
    const d = stage2GradeDecision(r, SUITE);
    assert.equal(d.ok, false, what);
    assert.ok(d.reasons.includes(reason), `${what}: ${d.reasons}`);
  }
  assert.ok(stage2GradeDecision(goodRecord(), []).reasons.includes("BASE_SUITE_MISMATCH"), "an empty base suite never grades");
});

// ---- limit 4: landing
const AUD = { auditor: ["PeaceG03"], peace: ["PeaceG03"] };
const ON = JSON.stringify({ schema: "peaceai-self-stage2:v1", enabled: true });
let nextId = 100;
const comment = (body: string, over: Partial<CommandComment> = {}): CommandComment => {
  const id = nextId++;
  return { id, url: `https://github.com/PeaceG03/PeaceAI-Workspace/pull/9#issuecomment-${id}`, body, author: "PeaceG03", association: "OWNER", createdAt: "2026-10-25T07:00:00Z", ...over };
};
const both = (sha = HEAD) => [comment(`/auditor-pass sc-demo ${sha}`), comment(`/verdict sc-demo ${sha} right`)];
const PR = { headSha: HEAD, diffSha256: "d".repeat(64) };

test("M106 limit 4: lands only with the flag on, PR = graded proposal, Peace /verdict AND Auditor /auditor-pass on that exact commit", () => {
  const ok = stage2LandingDecision(goodRecord(), SUITE, PR, both(), AUD, ON);
  assert.equal(ok.ok, true, ok.reasons.join());
  assert.match(ok.auditorComment ?? "", /#issuecomment-\d+$/);
  const has = (d: { reasons: string[] }, r: string) => assert.ok(d.reasons.includes(r), `${r} not in ${d.reasons}`);
  // OFF by default: the committed flag, a missing flag, a malformed flag, a truthy-but-not-true flag
  const committed = readFileSync(join(repo, STAGE2_FLAG_PATH), "utf8");
  assert.equal(stage2Enabled(committed), false, "the committed stage-2 flag must stay off (only Peace flips it)");
  for (const f of [committed, null, "{", '{"enabled": true}', '{"schema":"peaceai-self-stage2:v1","enabled":"true"}', '{"schema":"peaceai-self-stage2:v1","enabled":1}']) {
    has(stage2LandingDecision(goodRecord(), SUITE, PR, both(), AUD, f), "STAGE2_OFF");
  }
  // a later push (head moved) voids both approvals; a different diff is not the proposal
  const NEW = "c".repeat(40);
  has(stage2LandingDecision(goodRecord(), SUITE, { ...PR, headSha: NEW }, both(), AUD, ON), "HEAD_NOT_PROPOSAL");
  has(stage2LandingDecision(goodRecord(), SUITE, { ...PR, headSha: NEW }, both(NEW), AUD, ON), "HEAD_NOT_PROPOSAL");
  has(stage2LandingDecision(goodRecord(), SUITE, { ...PR, headSha: "" }, both(), AUD, ON), "HEAD_NOT_PROPOSAL");
  has(stage2LandingDecision(goodRecord(), SUITE, { ...PR, diffSha256: "e".repeat(64) }, both(), AUD, ON), "DIFF_NOT_PROPOSAL");
  // each approval is required, on this id and this sha, by the listed login, traced, with a member association
  has(stage2LandingDecision(goodRecord(), SUITE, PR, [comment(`/verdict sc-demo ${HEAD} right`)], AUD, ON), "AUDITOR_PASS_MISSING");
  has(stage2LandingDecision(goodRecord(), SUITE, PR, [comment(`/auditor-pass sc-demo ${HEAD}`)], AUD, ON), "PEACE_VERDICT_MISSING");
  has(stage2LandingDecision(goodRecord(), SUITE, PR, [comment(`/auditor-pass sc-demo ${NEW}`), comment(`/verdict sc-demo ${HEAD} right`)], AUD, ON), "AUDITOR_PASS_STALE_OR_SHA_MISMATCH");
  has(stage2LandingDecision(goodRecord(), SUITE, PR, [comment(`/auditor-pass sc-demo ${HEAD}`), comment(`/verdict sc-demo ${NEW} right`)], AUD, ON), "PEACE_VERDICT_STALE_OR_SHA_MISMATCH");
  has(stage2LandingDecision(goodRecord(), SUITE, PR, [comment(`/auditor-pass sc-demo ${HEAD}`), comment(`/verdict sc-demo ${HEAD} wrong`)], AUD, ON), "PEACE_VERDICT_STALE_OR_SHA_MISMATCH");
  has(stage2LandingDecision(goodRecord(), SUITE, PR, [comment(`/auditor-pass sc-other ${HEAD}`), comment(`/verdict sc-demo ${HEAD} right`)], AUD, ON), "AUDITOR_PASS_MISSING");
  has(stage2LandingDecision(goodRecord(), SUITE, PR, [comment(`/auditor-pass sc-demo ${HEAD}`, { author: "someone" }), comment(`/verdict sc-demo ${HEAD} right`)], AUD, ON), "AUDITOR_PASS_MISSING");
  has(stage2LandingDecision(goodRecord(), SUITE, PR, [comment(`/auditor-pass sc-demo ${HEAD}`), comment(`/verdict sc-demo ${HEAD} right`, { author: "peaceai-bot" })], AUD, ON), "PEACE_VERDICT_MISSING");
  has(stage2LandingDecision(goodRecord(), SUITE, PR, [comment(`/auditor-pass sc-demo ${HEAD}`, { url: "https://example.com/x" }), comment(`/verdict sc-demo ${HEAD} right`)], AUD, ON), "AUDITOR_PASS_MISSING");
  has(stage2LandingDecision(goodRecord(), SUITE, PR, [comment(`/auditor-pass sc-demo ${HEAD}`, { association: "NONE" }), comment(`/verdict sc-demo ${HEAD} right`)], AUD, ON), "AUDITOR_PASS_MISSING");
  has(stage2LandingDecision(goodRecord(), SUITE, PR, [comment(`/auditor-pass sc-demo ${HEAD} please`), comment(`/verdict sc-demo ${HEAD} right`)], AUD, ON), "AUDITOR_PASS_STALE_OR_SHA_MISMATCH");
  // a failing grade blocks landing even with both approvals
  const r = goodRecord(); r.baseSuite.fail = 2;
  has(stage2LandingDecision(r, SUITE, PR, both(), AUD, ON), "BASE_SUITE_FAILED_ON_CANDIDATE");
  // the proposal hash is the canonical diff text, trailing whitespace-insensitive only
  assert.equal(stage2DiffSha("diff\n"), stage2DiffSha("diff"));
  assert.notEqual(stage2DiffSha("diff a"), stage2DiffSha("diff b"));
});

test("M106 limit 5: credit only when the landed change is byte-identical to the recorded proposal", () => {
  const rec = goodRecord();
  assert.deepEqual(stage2Credit(rec, { paths: [...rec.paths].reverse(), blobs: { ...rec.candidateBlobs } }), { credit: true, mark: "PeaceAI stage-2 proposal, landed byte-identical" });
  for (const [what, landed] of [
    ["one blob edited", { paths: rec.paths, blobs: { ...rec.candidateBlobs, "peaceai/lib/propose.ts": "9".repeat(40) } }],
    ["extra path", { paths: [...rec.paths, "peaceai/lib/other.ts"], blobs: { ...rec.candidateBlobs, "peaceai/lib/other.ts": "3".repeat(40) } }],
    ["missing path", { paths: rec.paths.slice(0, 1), blobs: rec.candidateBlobs }],
    ["deleted instead", { paths: rec.paths, blobs: { ...rec.candidateBlobs, [T]: null } }],
  ] as const) {
    const c = stage2Credit(rec, landed);
    assert.equal(c.credit, false, what);
    assert.match(c.mark, /^no credit: Builder-edited/, what);
  }
});

test("M106 limit 3/4: the grading job runs only in a private ephemeral Actions job; the workflow template has no secrets and no write", () => {
  const r = proposeStage2InSandbox({ id: "sc-test", diff: "", source: repo, base: "HEAD", out: "/nonexistent", budget: "1" });
  assert.equal(r.code, 3);
  assert.match(r.message, /^self-change stage2 refused reason=(PRIVATE_ACTIONS_ONLY|PUBLIC_RUNNER_REFUSED)$/, "off Actions, and on the public Workspace runner");
  const wf = readFileSync(join(repo, "peaceai/results-repo/self-change-stage2.yml"), "utf8");
  const code = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.match(code, /^on:\n  workflow_dispatch:/m, "dispatch only");
  assert.match(code, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(code, /secrets\.|GH_TOKEN|GITHUB_TOKEN|write|git push|gh (pr|issue|api)|\/verdict|\/auditor-pass|merge/);
  assert.equal((code.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.match(code, /npm ci --ignore-scripts/);
  assert.match(code, /github\.repository == 'PeaceG03\/PeaceAI-Results'/);
  assert.match(code, /self-change\.ts propose2 /);
  assert.doesNotMatch(code, /\$\{\{[^}]*inputs\.[^}]*\}\}[^\n]*\n?\s*node_modules/, "inputs reach the run script only by env");
  // the CLI decides and prints; it never posts, applies, pushes or merges
  const bin = readFileSync(join(repo, "peaceai/bin/self-change.ts"), "utf8");
  const s2 = bin.slice(bin.indexOf('mode === "propose2"'), bin.indexOf('} else if (mode === "decide")'));
  assert.ok(s2.length > 0);
  assert.doesNotMatch(s2, /"push"|"merge"|"comment"|--method|-X|"POST"|writeFileSync/);
  const approvers = JSON.parse(readFileSync(join(repo, "peaceai/self/approvers.json"), "utf8"));
  assert.deepEqual(approvers.peace, ["PeaceG03"]);
});
