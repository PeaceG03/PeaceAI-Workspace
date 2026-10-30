// G29 (public-derive-wire-rethrow-v1, kind EXISTING_EDIT, proposal-off-wired): "handle a failing call" on a method
// that is ALREADY the v2 retry template. PeaceAI derives ONE change: the template's final `throw error;` (the failure
// left after the last allowed try) becomes v1's closed rethrow `throw new Error(H(args), { cause: error })`, H an
// existing string-line helper of the repo (imported from its module), args closed error reads that never include the
// cause's message (Auditor #601) or string parameters of the method. A status answer and a failure a later try
// recovers from are unchanged; no catch ever goes on without a throw (G26). public-derive-wire-v2 stays byte for byte.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { auditorPolicyProblem, teamPickedProblem } from "../lib/approval.ts";
import { admitRules, APPROVED_SCHEMA, loadApprovedList } from "../lib/approved.ts";
import { DERIVE_WIRE_TRIGGER } from "../lib/derive-wire.ts";
import { DERIVE_WIRE_V2_RETHROW_TRIGGER, DERIVE_WIRE_V2_TRIGGER, deriveWireV2Detail } from "../lib/derive-wire-v2.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { gradeExistingEditProblem, isWire2Params, isWire2RethrowParams, isWireParams, RETHROW_ARG_IDS, RETHROW_NETWORK_MESSAGE, rethrowEditShape } from "../lib/learned-edit-existing.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { DERIVE_WIRE_RETHROW_PHRASING, phrasingFor } from "../lib/propose.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-derive-wire-rethrow-v1.json")) as RuleSpec;
const WIRE2 = JSON.parse(read("peaceai/rules/learned/public-derive-wire-v2.json")) as RuleSpec;
const isTest = (p: string) => /\.test\.ts$/.test(p);
const issue = (head: string, behavior: string, examples: string[]) => [head, "", `Behavior: ${behavior}`, "", "Examples:", ...examples.map((e) => `- ${e}`), ""].join("\n");
const objective = (body: string) => cleanIssueText({ title: "wire task", body } as never);
const derive = (body: string, files: { path: string; content: string }[]) => deriveWireV2Detail(SPEC.trigger, SPEC.params, objective(body), files, isTest, body);

// --- the fixture: m138's client AFTER its v2 retry (derived here with public-derive-wire-v2, so the base is exactly
// the template), the repo's retry helpers, and a string-line helper module that is not yet used
const RETRY_HELPERS = `export function isRetryable(status: number): boolean {
  return status === 429 || (500 <= status && status <= 599);
}

export function retryAllowed(failedTries: number): boolean {
  return failedTries <= 2;
}

export function retryDelay(attempt: number, baseMs: number): number {
  return baseMs * (attempt + 1) * (attempt + 1) <= 30000 ? baseMs * (attempt + 1) * (attempt + 1) : 30000;
}
`;
const CLIENT = `export interface ClientConfig {
  bucket: string;
  fetchImpl?: (url: string, init: { method: string; stamp: string; signal?: AbortSignal }) => Promise<{ status: number }>;
  now?: () => string;
}

export class Client {
  private readonly fetchImpl: (url: string, init: { method: string; stamp: string; signal?: AbortSignal }) => Promise<{ status: number }>;
  private readonly now: () => string;

  constructor(private readonly config: ClientConfig) {
    if (!config.bucket) throw new Error("BUCKET_REQUIRED");
    this.fetchImpl = config.fetchImpl ?? (async () => ({ status: 599 }));
    this.now = config.now ?? (() => "1970-01-01");
  }

  private async request(method: string, url: string): Promise<{ status: number }> {
    const stamp = method + ":" + this.now();
    const init = { method, stamp };
    return this.fetchImpl("/" + this.config.bucket + url, init);
  }

  async get(key: string): Promise<number> {
    const response = await this.request("GET", "/" + key);
    if (response.status === 404) return 0;
    if (response.status >= 400) throw new Error("GET_" + response.status);
    return response.status;
  }
}
`;
const FAILURE = `export function requestFailure(method: string, message: string): string {
  return "REQUEST_FAILED:" + method + ":" + message;
}

export function codeLine(code: string): string {
  return "CODE:" + code;
}
`;
const RETRY_TASK = issue("In the existing method `request` of class `Client` in `src/client.ts`, retry a failing call.", "every try is stamped again and times out after 30 seconds on its own. A try that fails with no answer, or gets back a status that isRetryable says is worth retrying, is tried again while retryAllowed allows that many failed tries, after waiting retryDelay with a base wait of 500 ms through the injected sleep. Any other answer is returned as it is.", [
  'fake fetchA = sequence(rejects("fetch failed"), resolves(response(200)))', 'fake clockA = returns("t")', "fake sleepA = resolves(null)",
  'expect new Client({ bucket: "bars", fetchImpl: fetchA, now: clockA, sleep: sleepA }).get("day") resolves to 200', "expect fetchA is called 2 times", "expect sleepA is called with [500]",
  'fake fetchB = resolves(response(404))', 'fake clockB = returns("t")', "fake sleepB = resolves(null)",
  'expect new Client({ bucket: "bars", fetchImpl: fetchB, now: clockB, sleep: sleepB }).get("day") resolves to 0', "expect fetchB is called 1 time",
  'fake fetchC = resolves(response(503))', 'fake clockC = returns("t")', "fake sleepC = resolves(null)",
  'expect new Client({ bucket: "bars", fetchImpl: fetchC, now: clockC, sleep: sleepC }).get("day") rejects with "GET_503"', "expect fetchC is called 3 times", "expect sleepC is called with [500], [2000]",
  'fake fetchD = rejects("fetch failed")', 'fake clockD = returns("t")', "fake sleepD = resolves(null)",
  'expect new Client({ bucket: "bars", fetchImpl: fetchD, now: clockD, sleep: sleepD }).get("day") rejects with "fetch failed"', "expect fetchD is called 3 times", "expect sleepD is called with [500], [2000]",
]);
const SUITE = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { requestFailure } from "./request-failure.ts";\ntest("requestFailure", () => {\n  assert.equal(requestFailure("GET", "x"), "REQUEST_FAILED:GET:x");\n});\n`;
const PRE = [{ path: "src/retry.ts", content: RETRY_HELPERS }, { path: "src/client.ts", content: CLIENT }, { path: "src/request-failure.test.ts", content: SUITE }];
const retried = deriveWireV2Detail(WIRE2.trigger, WIRE2.params, objective(RETRY_TASK), PRE, isTest, RETRY_TASK);
assert.ok(retried.edit, `fixture retry: ${retried.reason}`);
const RETRIED = retried.edit.content;
const FILES = [{ path: "src/retry.ts", content: RETRY_HELPERS }, { path: "src/client.ts", content: RETRIED }, { path: "src/request-failure.ts", content: FAILURE }, { path: "src/request-failure.test.ts", content: SUITE }];

const HEAD = "In the existing method `request` of class `Client` in `src/client.ts`, handle a failing call.";
const BEHAVIOR = "when a request still has no answer after its last try, the caller gets a new error whose message is requestFailure of the request's method and a safe word for the failure, with the original failure kept as its cause. The safe word is the failure's message only when it is fetch failed or the failure is named TimeoutError or AbortError, else the failure's name, so a message that carries a URL never reaches the new message. A request that gets an answer, and a failure that a later try recovers from, are unchanged.";
const C = (n: string) => `new Client({ bucket: "bars", fetchImpl: fetch${n}, now: clock${n}, sleep: sleep${n} })`;
const FAIL_EX = (n: string, fake: string, message: string, calls: number) => [`fake fetch${n} = ${fake}`, `fake clock${n} = returns("t")`, `fake sleep${n} = resolves(null)`, `expect ${C(n)}.get("day") rejects with ${JSON.stringify(message)}`, `expect fetch${n} is called ${calls} times`];
const ANSWER_EX = ['fake fetchB = sequence(rejects("fetch failed"), resolves(response(404)))', 'fake clockB = returns("t")', "fake sleepB = resolves(null)", `expect ${C("B")}.get("day") resolves to 0`, "expect fetchB is called 2 times"];
const URL_EX = FAIL_EX("U", 'rejects("request to https://acct.r2.example.com/bars/day failed", { name: "TypeError" })', "REQUEST_FAILED:GET:TypeError", 3).slice(0, 4);
const EXAMPLES = [...FAIL_EX("A", 'rejects("fetch failed", { cause: { code: "ECONNRESET" } })', "REQUEST_FAILED:GET:fetch failed", 3), ...URL_EX, ...ANSWER_EX];
const TASK = issue(HEAD, BEHAVIOR, EXAMPLES);

async function load<T>(files: { path: string; content: string }[], edit: { path: string; content: string }): Promise<{ mod: T; done: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "m141-run-"));
  for (const f of files) { mkdirSync(join(dir, f.path, ".."), { recursive: true }); writeFileSync(join(dir, f.path), f.path === edit.path ? edit.content : f.content); }
  const mod = (await import(pathToFileURL(join(dir, edit.path)).href)) as T;
  return { mod, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the spec: its own id, vocabulary and trigger; v2's spec and approved sha untouched; delegable, team-picked, no credit", () => {
  assert.equal(SPEC.id, "public-derive-wire-rethrow-v1");
  assert.equal(SPEC.kind, "EXISTING_EDIT");
  assert.equal(SPEC.trigger, DERIVE_WIRE_V2_RETHROW_TRIGGER);
  assert.equal(validateSpec(SPEC), true);
  assert.ok(isWire2RethrowParams(SPEC.params) && !isWire2Params(SPEC.params) && !isWireParams(SPEC.params));
  assert.ok(isWire2Params(WIRE2.params) && !isWire2RethrowParams(WIRE2.params));
  assert.equal(WIRE2.trigger, DERIVE_WIRE_V2_TRIGGER);
  assert.equal(specHash(WIRE2), "e9e6d7e10e0195850f6e29f13e92c803424fafc94c280e4fe7ea10ace311bc28", "v2 keeps the sha Peace approved on #613");
  assert.deepEqual(RETHROW_ARG_IDS, ["message", "name", "code", "cause.code", "cause.name", "message.network"], "never the cause's message (Auditor #601)");
  // not approved by this change: it waits for /auditor-approve-rule (or /approve-rule) on its own proposal issue
  const approvedText = read("peaceai/rules/approved.json");
  const listed = (JSON.parse(approvedText) as { rules: { id: string; sha256: string }[] }).rules.filter((r) => r.id === SPEC.id);
  if (!listed.length) {
    assert.ok(!approvedText.includes(specHash(SPEC)));
    assert.ok(!admitRules([SPEC], loadApprovedList(join(repo, "peaceai/rules/approved.json"))).some((a) => a.spec?.id === SPEC.id && a.decision === "APPROVED"));
  } else assert.deepEqual(listed.map((r) => r.sha256), [specHash(SPEC)], "listed only as its exact sha");
  assert.equal(auditorPolicyProblem(SPEC), null, "an EXISTING_EDIT spec Auditor may approve");
  const prop = JSON.parse(read("peaceai/rules/proposals/public-derive-wire-rethrow-v1.json")) as { status: string; evidence: { qualifies: boolean } };
  assert.equal(teamPickedProblem(SPEC.id, prop), false, "team-picked, 0 credit");
  assert.equal(prop.status, "proposal-off-wired");
  assert.equal(prop.evidence.qualifies, false);
  assert.equal(phrasingFor(SPEC), DERIVE_WIRE_RETHROW_PHRASING);
  // the v1 header form; v1 keeps its own (identical) trigger and vocabulary and never reaches this code
  assert.equal(SPEC.trigger, DERIVE_WIRE_TRIGGER.replace(", handle a failing call", ", (?<ask>handle a failing call)"), "the same header form as v1");
  assert.match(read("peaceai/spec/derive-wire-v2.md"), /G29/);
});

test("the asks stay apart: v2 refuses the rethrow header, the rethrow spec refuses v2's headers and the other vocabulary", () => {
  assert.equal(deriveWireV2Detail(WIRE2.trigger, WIRE2.params, objective(TASK), FILES, isTest, TASK).reason, "wire_trigger");
  assert.equal(deriveWireV2Detail(WIRE2.trigger, SPEC.params, objective(TASK), FILES, isTest, TASK).reason, "wire_params");
  assert.equal(deriveWireV2Detail(SPEC.trigger, WIRE2.params, objective(TASK), FILES, isTest, TASK).reason, "wire_params");
  assert.equal(derive(TASK.replace("handle a failing call", "retry a failing call"), FILES).reason, "wire_trigger");
});

test("derive: one fit (the imported helper, the method and the network-only message filter); only the final throw changes", async () => {
  const r = derive(TASK, FILES);
  assert.ok(r.edit, `${r.reason} ${r.detail ?? ""}`);
  assert.deepEqual(r.derivation, { kind: "rethrow", holes: { target: "Client.request", helper: "requestFailure", args: ["param:method", "message.network"], import: { name: "requestFailure", from: "./request-failure.ts" } } });
  const c = r.edit.content;
  assert.match(c, /^import \{ requestFailure \} from "\.\/request-failure\.ts";$/m);
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(c, new RegExp(String.raw`if \(!retryAllowed\(attempt \+ 1\)\) \{\n\s+throw new Error\(\n\s+requestFailure\(\n\s+method,\n\s+${esc(RETHROW_NETWORK_MESSAGE)}\n\s+\),\n\s+\{ cause: error \}\n\s+\);\n\s+\}\n\s+await this\.sleep\(retryDelay\(attempt, 500\)\);\n\s+continue;`));
  assert.doesNotMatch(c, /cause\?\.message/);
  assert.doesNotMatch(c, /catch\s*\{\s*continue;\s*\}/);
  // nothing else moved: the tail (status answers) and the wait are the base's lines
  const removed = RETRIED.split("\n").filter((l) => !c.split("\n").includes(l));
  assert.deepEqual(removed.map((l) => l.trim()), ["if (!retryAllowed(attempt + 1)) throw error;"]);
  assert.match(c, /if \(!isRetryable\(response\.status\) \|\| !retryAllowed\(attempt \+ 1\)\) return response;/);
  assert.equal(r.edit.extra.length, 1);
  assert.match(r.edit.extra[0]!.path, /^src\/client\.client-request-[0-9a-f]{7}\.test\.ts$/);
  // run the derived code
  type Init = { method: string; stamp: string; signal?: AbortSignal };
  const { mod, done } = await load<{ Client: new (c: Record<string, unknown>) => { get(k: string): Promise<number> } }>(FILES, r.edit);
  try {
    const rig = (answers: ({ status: number } | Error)[]) => {
      const calls: Init[] = [], sleeps: number[] = [];
      const client = new mod.Client({ bucket: "bars", now: () => "t", sleep: async (ms: number) => { sleeps.push(ms); }, fetchImpl: async (_u: string, init: Init) => { calls.push(init); const a = answers[Math.min(calls.length, answers.length) - 1]!; if (a instanceof Error) throw a; return a; } });
      return { client, calls, sleeps };
    };
    // a failure left after the last try: the new message, the original kept as its cause, the count at the limit
    const boom = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    const a = rig([boom]);
    await assert.rejects(a.client.get("k"), (e: unknown) => e instanceof Error && e.message === "REQUEST_FAILED:GET:fetch failed" && e.cause === boom);
    assert.equal(a.calls.length, 3);
    assert.deepEqual(a.sleeps, [500, 2000]);
    // a timeout keeps its own words in the message
    const late = rig([new DOMException("The operation was aborted due to timeout", "TimeoutError") as unknown as Error]);
    await assert.rejects(late.client.get("k"), /^Error: REQUEST_FAILED:GET:The operation was aborted due to timeout$/);
    // an abort keeps its words too; any other failure gives only its name: a URL-bearing message never appears
    const ab = rig([new DOMException("This operation was aborted", "AbortError") as unknown as Error]);
    await assert.rejects(ab.client.get("k"), /^Error: REQUEST_FAILED:GET:This operation was aborted$/);
    const leaky = new TypeError("request to https://acct123.r2.cloudflarestorage.com/bars/k failed");
    const u = rig([leaky]);
    await assert.rejects(u.client.get("k"), (e: unknown) => e instanceof Error && e.message === "REQUEST_FAILED:GET:TypeError" && !e.message.includes("https://") && !e.message.includes("acct123") && e.cause === leaky);
    assert.equal(u.calls.length, 3);
    const odd = rig([Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443 https://acct123.r2.cloudflarestorage.com"), { name: "SystemError" })]);
    await assert.rejects(odd.client.get("k"), /^Error: REQUEST_FAILED:GET:SystemError$/);
    // a status answer is unchanged: retried 503s still return the last answer (get throws its own status error)
    const s = rig([{ status: 503 }]);
    await assert.rejects(s.client.get("k"), (e: unknown) => e instanceof Error && e.message === "GET_503");
    assert.equal(s.calls.length, 3);
    // a 404 is not retried and not wrapped
    const nf = rig([{ status: 404 }]);
    assert.equal(await nf.client.get("k"), 0);
    assert.equal(nf.calls.length, 1);
    // a failure a later try recovers from is unchanged
    const rec = rig([new Error("fetch failed"), { status: 200 }]);
    assert.equal(await rec.client.get("k"), 200);
    assert.equal(rec.calls.length, 2);
  } finally { done(); }
});

test("refusals: a swallow (G26), a cause-message fit (#601), a cause name next to a code, not needed, no retry template, unpinned", () => {
  const only = (ex: string[], behavior = BEHAVIOR) => derive(issue(HEAD, behavior, ex), FILES).reason;
  // every try failed and the example expects an answer: that would swallow the failure; refused, never `continue`
  assert.equal(only(['fake fetchA = rejects("fetch failed")', 'fake clockA = returns("t")', "fake sleepA = resolves(null)", `expect ${C("A")}.get("day") resolves to 0`, "expect fetchA is called 3 times", ...ANSWER_EX]), "wire_rethrow_swallow");
  // only the cause's message gives the expected text: refused by name, the cause message is never passed
  assert.equal(only([...FAIL_EX("A", 'rejects("fetch failed", { cause: { message: "socket hang up" } })', "REQUEST_FAILED:GET:socket hang up", 3), ...ANSWER_EX]), "wire_cause_message");
  // the cause's name only where the cause has no code (Auditor #601)
  assert.equal(only([...FAIL_EX("A", 'rejects("fetch failed", { cause: { code: "ECONNRESET", name: "SystemError" } })', "REQUEST_FAILED:GET:SystemError", 3), ...ANSWER_EX]), "wire_cause_name");
  assert.equal(only([...FAIL_EX("A", 'rejects("fetch failed", { cause: { name: "SystemError" } })', "REQUEST_FAILED:GET:SystemError", 3), ...ANSWER_EX]), null);
  // the cause's code is a closed read it may pass
  assert.equal(only([...FAIL_EX("A", 'rejects("fetch failed", { cause: { code: "ECONNRESET" } })', "CODE:ECONNRESET", 3), ...ANSWER_EX]), null);
  // the original error already gives the message: nothing to derive
  assert.equal(only([...FAIL_EX("A", 'rejects("fetch failed")', "fetch failed", 3), ...ANSWER_EX]), "wire_not_needed");
  // no helper gives the text
  assert.equal(only([...FAIL_EX("A", 'rejects("fetch failed")', "R2:fetch failed", 3), ...ANSWER_EX]), "wire_no_fit");
  // the call count must be pinned, at the template's own limit
  assert.equal(only([...FAIL_EX("A", 'rejects("fetch failed")', "REQUEST_FAILED:GET:fetch failed", 3).slice(0, 4), ...ANSWER_EX]), "wire_rethrow_unpinned");
  assert.deepEqual(((r) => [r.reason, r.detail])(derive(issue(HEAD, BEHAVIOR, [...FAIL_EX("A", 'rejects("fetch failed")', "REQUEST_FAILED:GET:fetch failed", 2), ...ANSWER_EX]), FILES)), ["wire_no_fit", "count"]);
  // an answer the edit leaves alone must be shown
  assert.equal(only(FAIL_EX("A", 'rejects("fetch failed")', "REQUEST_FAILED:GET:fetch failed", 3)), "wire_rethrow_answer_unpinned");
  // a method that is not the v2 retry template (retry it first) is refused
  assert.equal(derive(TASK, [...FILES.filter((f) => f.path !== "src/client.ts"), { path: "src/client.ts", content: CLIENT }]).reason, "wire_rethrow_site");
  // a template whose catch already goes on without a throw is not the template either
  assert.equal(derive(TASK, FILES.map((f) => (f.path === "src/client.ts" ? { ...f, content: f.content.replace("if (!retryAllowed(attempt + 1)) throw error;", "if (!retryAllowed(attempt + 1)) continue;") } : f))).reason, "wire_rethrow_site");
  // without a URL-bearing (or other non-network) failing example the raw message and the filter both fit: refused
  assert.deepEqual(((r) => [r.reason, r.detail])(derive(issue(HEAD, BEHAVIOR, [...FAIL_EX("A", 'rejects("fetch failed")', "REQUEST_FAILED:GET:fetch failed", 3), ...ANSWER_EX]), FILES)), ["wire_ambiguous", "2"]);
  // an example that wants the URL-bearing message itself fits only the raw message read
  assert.equal((derive(issue(HEAD, BEHAVIOR, [...FAIL_EX("A", 'rejects("fetch failed")', "REQUEST_FAILED:GET:fetch failed", 3), ...FAIL_EX("U", 'rejects("bad https://acct.example.com", { name: "TypeError" })', "REQUEST_FAILED:GET:bad https://acct.example.com", 3).slice(0, 4), ...ANSWER_EX]), FILES).derivation as { holes: { args: string[] } } | undefined)?.holes.args[1], "message");
  // v2's guards stay on: code in the issue, the objective cut
  assert.equal(only(EXAMPLES, BEHAVIOR + " Use throw new Error(x, { cause: error })."), "wire_behavior_code");
  assert.equal(only(EXAMPLES, BEHAVIOR + " Every storage failure the scanner sees starts with the same word.".repeat(30)), "wire_task_truncated");
});

test("Job B's own recognizer: the derived edit grades; a bare continue or a cause-message rethrow is refused", () => {
  const r = derive(TASK, FILES);
  assert.ok(r.edit);
  const reader = (content: string) => (rel: string) => (rel === "src/client.ts" ? content : FILES.find((f) => f.path === rel)?.content ?? null);
  const test0 = r.edit.extra[0]!;
  assert.equal(gradeExistingEditProblem("src/client.ts", RETRIED, r.edit.content, test0.path, test0.content, reader(r.edit.content)), null);
  const shape = rethrowEditShape("src/client.ts", RETRIED, r.edit.content, reader(r.edit.content));
  assert.ok(shape && typeof shape === "object" && !shape.stripped.includes("AbortSignal.timeout") && !shape.baseStripped.includes("AbortSignal.timeout"));
  // a hand-made cause-message rethrow is refused by name
  const leak = r.edit.content.replace(RETHROW_NETWORK_MESSAGE, 'String((error as { cause?: { message?: unknown } } | null)?.cause?.message ?? "")');
  assert.notEqual(leak, r.edit.content);
  assert.equal(gradeExistingEditProblem("src/client.ts", RETRIED, leak, test0.path, test0.content, reader(leak)), "wire_cause_message");
  // a bare catch-continue in place of the throw is no rethrow edit: it is not confined to the grammar and is refused
  const swallow = RETRIED.replace("if (!retryAllowed(attempt + 1)) throw error;", "if (!retryAllowed(attempt + 1)) continue;");
  assert.equal(rethrowEditShape("src/client.ts", RETRIED, swallow, reader(swallow)), null);
  assert.notEqual(gradeExistingEditProblem("src/client.ts", RETRIED, swallow, test0.path, test0.content, reader(swallow)), null);
  // an argument outside the closed reads (a literal) is not the template
  const other = r.edit.content.replace("method,\n", '"GET",\n');
  assert.equal(rethrowEditShape("src/client.ts", RETRIED, other, reader(other)), null);
});

function jobB(files: { path: string; content: string }[], body: string) {
  const dir = mkdtempSync(join(tmpdir(), "m141-"));
  try {
    const ws = join(dir, "ws");
    for (const f of files) { mkdirSync(join(ws, f.path, ".."), { recursive: true }); writeFileSync(join(ws, f.path), f.content); }
    writeFileSync(join(ws, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ["src"] }));
    writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "m141", private: true, type: "module" }));
    writeFileSync(join(ws, ".gitignore"), "node_modules\n");
    symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd: ws, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "base");
    const baseSha = git("rev-parse", "HEAD").trim();
    const why: { reason?: string } = {};
    const e = applyRule(SPEC, objective(body), files, isTest, undefined, why, () => false, undefined, body);
    assert.ok(e, why.reason);
    writeFileSync(join(ws, e.path), e.content);
    for (const x of e.extra ?? []) writeFileSync(join(ws, x.path), x.content);
    git("add", "-N", "--", ...(e.extra ?? []).map((x) => x.path));
    const diff = git("diff", "--no-color", "--full-index", "--no-renames");
    git("reset", "-q", "--hard"); git("clean", "-fdq");
    const inDir = join(dir, "in");
    mkdirSync(join(inDir, "candidates"), { recursive: true });
    writeFileSync(join(inDir, "candidates/candidate-1.diff"), diff);
    writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha, candidates: [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["LEARNED_EXISTING_EDIT"], operationId: `learned:${SPEC.id}@${specHash(SPEC)}`, diffBytes: diff.length, diffLines: diff.split("\n").length, selfGrade: true }] }));
    // a fixture-local approval list (the repo's approved.json is never read or written here)
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [{ id: SPEC.id, sha256: specHash(SPEC), source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-11T00:00:00Z" } }] }));
    const resultsFile = join(dir, "out/results.json");
    mkdirSync(join(dir, "out"), { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
    const p = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], { cwd: repo, encoding: "utf8", env: { ...env, PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: resultsFile, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list } });
    assert.equal(p.status, 0, p.stderr);
    return { res: JSON.parse(readFileSync(resultsFile, "utf8")).results[0], log: p.stdout };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("Job B grades the derived rethrow end to end: the new fake test fails on the base, passes on the edit; the original suite passes", { skip: Number(process.versions.node.split(".")[0]) < 22 && "needs Node >= 22" }, () => {
  const { res, log } = jobB(FILES, TASK);
  assert.equal(res.applied, true, log);
  assert.equal(res.originalSuitePassed, true, log);
  assert.equal(res.testGrading.beforeFix, false, log);
  assert.equal(res.testGrading.afterFix, true, log);
  assert.equal(res.testGrading.verdict, "COUNTS", log);
  assert.equal(res.newTestsPassed, true, log);
  assert.equal(res.typecheckPassed, true, log);
});
