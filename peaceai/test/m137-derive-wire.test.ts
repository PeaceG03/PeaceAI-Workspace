// G18 (public-derive-wire-v1, kind EXISTING_EDIT, proposal-off-wired): PeaceAI DERIVES one try / catch wrap around an
// existing awaited / returned call in an existing function or class method, from an issue that holds only a header,
// a Behavior paragraph and data-described fakes / expects (no code: the anti-copy guards stay on). The catch is one of
// a closed set: `continue;` inside a loop of the target, or a rethrow whose message is an existing exported string-line
// helper of the module called on fixed reads of the failure (message, name, code, cause.code / .name / .message) or
// the target's own string parameters, with the failure kept as the cause. Exactly one candidate must fit every
// failing example. Retry is NOT in v1 (see peaceai/spec/derive-wire-v1.md). Job B grades the derived edit with the
// generated fake test; the M98 hand-written splice path stays refused (edit_splice_disabled).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { DERIVE_WIRE_TRIGGER, deriveWireDetail, WIRE_MAX_CANDIDATES } from "../lib/derive-wire.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { gradeExistingEditProblem, isWireParams, wireEditShape } from "../lib/learned-edit-existing.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { nlDecision } from "../lib/nlparse.ts";
import { DERIVE_WIRE_PHRASING, phrasingFor } from "../lib/propose.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const WIRE = JSON.parse(read("peaceai/rules/learned/public-derive-wire-v1.json")) as RuleSpec;
const M98 = JSON.parse(read("peaceai/rules/learned/public-existing-function-edit-v1.json")) as RuleSpec;
const isTest = (p: string) => /\.test\.ts$/.test(p);
const issue = (head: string, behavior: string, examples: string[]) => [head, "", `Behavior: ${behavior}`, "", "Examples:", ...examples.map((e) => `- ${e}`), ""].join("\n");
const objective = (body: string) => cleanIssueText({ title: "wire task", body } as never);
const derive = (body: string, files: { path: string; content: string }[]) => deriveWireDetail(WIRE.trigger, WIRE.params, objective(body), files, isTest, body);

// --- fixture 1: a client whose request passes a failing network call through unnamed (shaped like PeaceSTOCKS R2ObjectClient.request)
const CLIENT = `export function failureLine(method: string, message: string, causeCode: string): string {
  return "REQUEST_FAILED:" + method + ":" + message + ":cause=" + causeCode;
}

export class Client {
  private readonly fetchImpl: (url: string) => Promise<string>;

  constructor(options: { fetchImpl: (url: string) => Promise<string> }) {
    this.fetchImpl = options.fetchImpl;
  }

  private async request(method: string, url: string): Promise<string> {
    const target = method + " " + url;
    return this.fetchImpl(target);
  }

  async get(key: string): Promise<string> {
    return this.request("GET", "/" + key);
  }

  async put(key: string): Promise<string> {
    return this.request("PUT", "/" + key);
  }
}
`;
const CLIENT_TEST = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { failureLine } from "./client.ts";\ntest("failureLine", () => {\n  assert.equal(failureLine("GET", "x", ""), "REQUEST_FAILED:GET:x:cause=");\n});\n`;
const RETHROW = issue("In the existing method `request` of class `Client` in `src/client.ts`, handle a failing call.",
  "When the network call fails, the request fails with the one-line reason from the failure line helper of this module, naming the request method, the failure message and the code of the failure's cause, and keeps the original failure as its cause. Nothing is retried.", [
    'fake fetchA = rejects("fetch failed", { cause: { code: "ECONNRESET" } })',
    'fake fetchB = rejects("socket hang up")',
    'fake fetchC = resolves("ok")',
    'expect new Client({ fetchImpl: fetchA }).get("x") rejects with "REQUEST_FAILED:GET:fetch failed:cause=ECONNRESET"',
    'expect new Client({ fetchImpl: fetchB }).put("y") rejects with "REQUEST_FAILED:PUT:socket hang up:cause="',
    'expect new Client({ fetchImpl: fetchC }).get("z") resolves to "ok"',
    "expect fetchA is called 1 time",
    "expect fetchB is called 1 time",
  ]);
const CLIENT_FILES = [{ path: "src/client.ts", content: CLIENT }];
const WRAPPED = `    try {
      return await this.fetchImpl(target);
    } catch (error) {
      throw new Error(
        failureLine(
          method,
          error instanceof Error ? error.message : String(error),
          String((error as { cause?: { code?: unknown } } | null)?.cause?.code ?? "")
        ),
        { cause: error }
      );
    }
`;

// --- fixture 2: a per-day loop that marks a day done only after its save
const DAYS = `export interface DayStore {
  save(day: string): Promise<void>;
}

export async function storeDays(days: readonly string[], store: DayStore): Promise<string[]> {
  const done: string[] = [];
  for (const day of days) {
    await store.save(day);
    done.push(day);
  }
  return done;
}
`;
const DAYS_TEST = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { storeDays } from "./days.ts";\ntest("all saved", async () => {\n  assert.deepEqual(await storeDays(["a"], { save: async () => {} }), ["a"]);\n});\n`;
const CONTINUE = issue("In the existing function `storeDays` in `src/days.ts`, handle a failing call.",
  "When saving one day fails, that day is skipped and is not counted as done, and the remaining days are still saved.", [
    'fake store = { save: sequence(rejects("disk full"), resolves(null), resolves(null)) }',
    'expect storeDays(["2026-10-01", "2026-10-02", "2026-10-05"], store) resolves to ["2026-10-02", "2026-10-05"]',
    "expect store.save is called 3 times",
  ]);
const DAYS_FILES = [{ path: "src/days.ts", content: DAYS }];

/** Run Job B (bin/test-candidates.ts) on a fixture repo with the derived candidate, under a fixture-local approval list. */
function jobB(files: { path: string; content: string }[], body: string) {
  const dir = mkdtempSync(join(tmpdir(), "m137-"));
  try {
    const ws = join(dir, "ws");
    for (const f of files) { mkdirSync(join(ws, f.path, ".."), { recursive: true }); writeFileSync(join(ws, f.path), f.content); }
    writeFileSync(join(ws, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ["src"] }));
    writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "m137", private: true, type: "module" }));
    writeFileSync(join(ws, ".gitignore"), "node_modules\n");
    symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd: ws, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "base");
    const baseSha = git("rev-parse", "HEAD").trim();
    const why: { reason?: string } = {};
    const e = applyRule(WIRE, objective(body), files, isTest, undefined, why, () => false, undefined, body);
    assert.ok(e, why.reason);
    writeFileSync(join(ws, e.path), e.content);
    for (const x of e.extra ?? []) writeFileSync(join(ws, x.path), x.content);
    git("add", "-N", "--", ...(e.extra ?? []).map((x) => x.path));
    const diff = git("diff", "--no-color", "--full-index", "--no-renames");
    git("reset", "-q", "--hard"); git("clean", "-fdq");
    const inDir = join(dir, "in");
    mkdirSync(join(inDir, "candidates"), { recursive: true });
    writeFileSync(join(inDir, "candidates/candidate-1.diff"), diff);
    writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha, candidates: [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["LEARNED_EXISTING_EDIT"], operationId: `learned:${WIRE.id}@${specHash(WIRE)}`, diffBytes: diff.length, diffLines: diff.split("\n").length, selfGrade: true }] }));
    // a fixture-local approval list (the repo's approved.json is never read or written here)
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [{ id: WIRE.id, sha256: specHash(WIRE), source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-11T00:00:00Z" } }] }));
    const resultsFile = join(dir, "out/results.json");
    mkdirSync(join(dir, "out"), { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
    const p = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], { cwd: repo, encoding: "utf8", env: { ...env, PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: resultsFile, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list } });
    assert.equal(p.status, 0, p.stderr);
    return { res: JSON.parse(readFileSync(resultsFile, "utf8")).results[0], log: p.stdout, edit: e };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the spec: EXISTING_EDIT with the wire vocabulary, its own trigger, valid, hash-pinned, NOT in approved.json; phrasing", () => {
  assert.equal(WIRE.id, "public-derive-wire-v1");
  assert.equal(WIRE.kind, "EXISTING_EDIT");
  assert.equal(WIRE.trigger, DERIVE_WIRE_TRIGGER);
  assert.equal(validateSpec(WIRE), true);
  assert.ok(isWireParams(WIRE.params));
  assert.ok(!isWireParams(M98.params), "the M98 spec keeps its own vocabulary");
  assert.equal(specHash(WIRE), "895f69fde28cad895ea3bf1e54c49e88b43e7f9f0a3e33c9a08d81ea9792cf1e");
  const approved = read("peaceai/rules/approved.json");
  assert.ok(!approved.includes(WIRE.id) && !approved.includes(specHash(WIRE)), "derive-wire waits for /approve-rule");
  const prop = JSON.parse(read("peaceai/rules/proposals/public-derive-wire-v1.json")) as { status: string; evidence: { qualifies: boolean } };
  assert.equal(prop.status, "proposal-off-wired");
  assert.equal(prop.evidence.qualifies, false);
  assert.equal(phrasingFor(WIRE), DERIVE_WIRE_PHRASING);
  assert.notEqual(phrasingFor(M98), DERIVE_WIRE_PHRASING);
  // the header is canonical wording only when its kind is approved (it then still needs this spec's own hash approved)
  assert.equal(nlDecision({ title: "", body: RETHROW }, undefined, new Set(["EXISTING_EDIT"]), null).status, "canonical");
  const off = nlDecision({ title: "", body: RETHROW }, undefined, new Set(), null);
  assert.ok(off.status === "unsure" && off.reason === "RULE_NOT_APPROVED");
});

test("rethrow: PeaceAI picks the site, the helper and its arguments (error.message, error.cause.code, the method param)", () => {
  const r = derive(RETHROW, CLIENT_FILES);
  assert.ok(r.edit, r.reason ?? "");
  assert.deepEqual(r.derivation && "candidate" in r.derivation ? r.derivation.candidate : null, { kind: "rethrow", helper: "failureLine", args: ["param:method", "message", "cause.code"] });
  assert.equal(r.edit.content, CLIENT.replace("    return this.fetchImpl(target);\n", WRAPPED));
  const t = r.edit.extra[0]!;
  assert.match(t.content, /error: \(\) => \(\{ cause: \{ code: "ECONNRESET" \} \}\)/);
  assert.match(t.content, /assert\.equal\(fetchA\.calls\.length, 1\);/, "a failure that is not retried: one call");
  assert.ok(wireEditShape("src/client.ts", CLIENT, r.edit.content, "Client.request"));
  assert.equal(gradeExistingEditProblem("src/client.ts", CLIENT, r.edit.content, t.path, t.content, (p) => (p === "src/client.ts" ? r.edit!.content : null)), null);
});

test("error.code and error.name are read too (G21), with the failure's fields set by the fake", () => {
  const mod = CLIENT.replace("export function failureLine(method: string, message: string, causeCode: string): string {\n  return \"REQUEST_FAILED:\" + method + \":\" + message + \":cause=\" + causeCode;\n}", "export function codeLine(code: string, name: string): string {\n  return \"FAILED \" + code + \" \" + name;\n}");
  const body = issue("In the existing method `request` of class `Client` in `src/client.ts`, handle a failing call.", "When the network call fails, the request fails with the code line of this module for the failure's code and name, keeping the failure as its cause.", [
    'fake fetchA = rejects("boom", { code: "E_ONE", name: "AbortError" })',
    'fake fetchB = rejects("bang", { code: "E_TWO" })',
    'expect new Client({ fetchImpl: fetchA }).get("x") rejects with "FAILED E_ONE AbortError"',
    'expect new Client({ fetchImpl: fetchB }).get("x") rejects with "FAILED E_TWO Error"',
  ]);
  const r = derive(body, [{ path: "src/client.ts", content: mod }]);
  assert.ok(r.edit, r.reason ?? "");
  assert.deepEqual(r.derivation && "candidate" in r.derivation ? r.derivation.candidate : null, { kind: "rethrow", helper: "codeLine", args: ["code", "name"] });
});

test("continue: the per-day loop moves on and does NOT mark the failed day done", () => {
  const r = derive(CONTINUE, DAYS_FILES);
  assert.ok(r.edit, r.reason ?? "");
  assert.equal(r.edit.content, DAYS.replace("    await store.save(day);\n", "    try {\n      await store.save(day);\n    } catch {\n      continue;\n    }\n"));
  const t = r.edit.extra[0]!.content;
  assert.ok(t.includes(`{ ok: true, value: ["2026-10-02", "2026-10-05"] }`), t);
  assert.match(t, /assert\.equal\(store\.save\.calls\.length, 3\);/);
  // a continue outside a loop is never derived: the same wish on a non-loop site has no fitting catch
  const flat = DAYS.replace("  for (const day of days) {\n    await store.save(day);\n    done.push(day);\n  }\n", "  await store.save(days[0] ?? \"\");\n  done.push(days[0] ?? \"\");\n");
  const flatFiles = [{ path: "src/days.ts", content: flat }];
  const once = CONTINUE.replace('sequence(rejects("disk full"), resolves(null), resolves(null))', 'rejects("disk full")').replace("- expect store.save is called 3 times\n", "");
  assert.notEqual(once, CONTINUE);
  assert.equal(derive(once, flatFiles).reason, "wire_no_fit");
  // outside a loop, a fake that fails then answers while the example expects to settle asks for a retry: refused by name
  assert.equal(derive(CONTINUE.replace("- expect store.save is called 3 times\n", ""), flatFiles).reason, "wire_retry_not_in_v1");
});

test("Job B grades both derived edits end to end: the generated fake test fails on the base, passes on the edit; the original suite passes", { skip: Number(process.versions.node.split(".")[0]) < 22 && "needs Node >= 22" }, () => {
  for (const [files, body] of [[[...CLIENT_FILES, { path: "src/client.test.ts", content: CLIENT_TEST }], RETHROW], [[...DAYS_FILES, { path: "src/days.test.ts", content: DAYS_TEST }], CONTINUE]] as const) {
    const { res, log } = jobB([...files], body);
    assert.equal(res.applied, true, log);
    assert.equal(res.originalSuitePassed, true, log);
    assert.equal(res.testGrading.beforeFix, false, log);
    assert.equal(res.testGrading.afterFix, true, log);
    assert.equal(res.testGrading.verdict, "COUNTS", log);
    assert.equal(res.newTestsPassed, true, log);
    assert.equal(res.typecheckPassed, true, log);
  }
});

test("anti-copy: code in the issue is refused; PeaceAI writes every inserted token", () => {
  const H = "In the existing method `request` of class `Client` in `src/client.ts`, handle a failing call.";
  const cases: [string, string][] = [
    [RETHROW.replace("Nothing is retried.", "Wrap it in try { } catch (error) { throw new Error(x) }."), "wire_behavior_code"],
    [RETHROW.replace("Nothing is retried.", "Use failureLine(method, e.message)."), "wire_behavior_code"],
    [RETHROW.replace("- expect fetchA is called 1 time", "- expect fetchA is called 1 time\n- note: throw new Error(failureLine(method), { cause: error })"), "wire_examples"],
    [RETHROW + "\n```ts\ntry { return await this.fetchImpl(target); } catch (error) { throw error; }\n```\n", "wire_behavior_code"],
    [RETHROW.replace(H, `${H}\n\n    try { await x(); } catch { continue; }`), "wire_behavior_code"],
  ];
  for (const [body, reason] of cases) assert.equal(derive(body, CLIENT_FILES).reason, reason, body);
});

test("refusals by name: no fit, ambiguous, not needed, no site, shared fake, wrong params, M98 path unchanged", () => {
  assert.equal(derive(RETHROW.replace("REQUEST_FAILED:PUT:socket hang up:cause=", "REQUEST_FAILED:PUT:socket hang up"), CLIENT_FILES).reason, "wire_no_fit");
  const twin = CLIENT + "\nexport function otherLine(method: string, message: string, causeCode: string): string {\n  return \"REQUEST_FAILED:\" + method + \":\" + message + \":cause=\" + causeCode;\n}\n";
  assert.equal(derive(RETHROW, [{ path: "src/client.ts", content: twin }]).reason, "wire_ambiguous");
  const passThrough = RETHROW.replace('rejects with "REQUEST_FAILED:GET:fetch failed:cause=ECONNRESET"', 'rejects with "fetch failed"').replace('rejects with "REQUEST_FAILED:PUT:socket hang up:cause="', 'rejects with "socket hang up"');
  assert.equal(derive(passThrough, CLIENT_FILES).reason, "wire_not_needed");
  assert.equal(derive(RETHROW.replaceAll("fetchImpl: fetchA", "otherImpl: fetchA").replaceAll("fetchImpl: fetchB", "otherImpl: fetchB"), CLIENT_FILES).reason, "wire_site_none");
  assert.equal(derive(RETHROW.replace("new Client({ fetchImpl: fetchB }).put", "new Client({ fetchImpl: fetchA }).put"), CLIENT_FILES).reason, "wire_fake_shared");
  // a failing call expected more than once asks for a retry: v1 refuses it by name instead of faking one
  assert.equal(derive(RETHROW.replace("expect fetchA is called 1 time", "expect fetchA is called 3 times"), CLIENT_FILES).reason, "wire_retry_not_in_v1");
  // ... and so is a fake that fails, then answers, where the example expects the answer (a retry, not a catch)
  const failThenOk = RETHROW.replace('fake fetchA = rejects("fetch failed", { cause: { code: "ECONNRESET" } })', 'fake fetchA = sequence(rejects("fetch failed"), resolves("ok"))').replace('get("x") rejects with "REQUEST_FAILED:GET:fetch failed:cause=ECONNRESET"', 'get("x") resolves to "ok"').replace("- expect fetchA is called 1 time\n", "");
  assert.notEqual(failThenOk, RETHROW);
  assert.equal(derive(failThenOk, CLIENT_FILES).reason, "wire_retry_not_in_v1");
  assert.equal(deriveWireDetail(M98.trigger, M98.params, objective(RETHROW), CLIENT_FILES, isTest, RETHROW).reason, "wire_params");
  assert.equal(deriveWireDetail(WIRE.trigger, M98.params, objective(RETHROW), CLIENT_FILES, isTest, RETHROW).reason, "wire_params");
  // the M98 spec still refuses every task (the issue would supply the code)
  const why: { reason?: string } = {};
  assert.equal(applyRule(M98, objective("in request in src/client.ts: replace statement return this.fetchImpl(target); with return null;\n- expect new Client({ fetchImpl: fetchC }).get(\"z\") resolves to null"), CLIENT_FILES, isTest, undefined, why, () => false), null);
  assert.equal(why.reason, "edit_splice_disabled");
  assert.ok(WIRE_MAX_CANDIDATES >= 1000);
});

test("Job B's structural check: a hand-made catch outside the closed grammar is graded as a plain M98 edit and refused", () => {
  const r = derive(RETHROW, CLIENT_FILES);
  const t = r.edit!.extra[0]!;
  const readFor = (c: string) => (p: string) => (p === "src/client.ts" ? c : null);
  // a raw message (no helper) or an inline string: not the wire grammar, so the 2-arg Error is a new capability
  for (const bad of ["throw new Error(String(error), { cause: error });", "throw new Error(\"x\" + method, { cause: error });"]) {
    const c = r.edit!.content.replace(/throw new Error\([\s\S]*?\{ cause: error \}\n {6}\);/, bad);
    assert.notEqual(c, r.edit!.content);
    assert.equal(wireEditShape("src/client.ts", CLIENT, c, "Client.request"), null);
    assert.notEqual(gradeExistingEditProblem("src/client.ts", CLIENT, c, t.path, t.content, readFor(c)), null, bad);
  }
  // the wire harness (fake failure fields) is refused for an edit that is not a wire edit
  const plain = CLIENT.replace("    return this.fetchImpl(target);\n", "    return this.fetchImpl(target + \"!\");\n");
  assert.notEqual(gradeExistingEditProblem("src/client.ts", CLIENT, plain, t.path, t.content, readFor(plain)), null);
});
