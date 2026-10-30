// G18 v2 (public-derive-wire-v2, kind EXISTING_EDIT, proposal-off-wired): PeaceAI DERIVES the two scanner wiring
// changes v1 cannot, from plain-words Behavior plus data-only fake examples (peaceai/spec/derive-wire-v2.md):
//   - a bounded retry of a method's final `return this.F(..)`: each attempt signs again and has its own timeout
//     signal; only a rejected call or a status the existing predicate accepts is retried, while the existing limit
//     predicate allows, waiting the existing delay through an injected sleep;
//   - a filtered, recorded skip of one awaited call in a loop: a matching failure is recorded in an existing list and
//     the loop goes on (the item is not marked done); every other failure (a TypeError) propagates. v1's bare
//     `catch { continue; }` is never emitted (G26).
// The derived code is RUN here against fakes (limits, non-retryable statuses, per-attempt signing and signals, the
// propagating TypeError, the recorded skip), and Job B grades both edits end to end.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { admitRules, APPROVED_SCHEMA, loadApprovedList } from "../lib/approved.ts";
import { DERIVE_WIRE_TRIGGER, deriveWireDetail } from "../lib/derive-wire.ts";
import { DERIVE_WIRE_V2_TRIGGER, deriveWireV2Detail } from "../lib/derive-wire-v2.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { isWire2Params, isWireParams } from "../lib/learned-edit-existing.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { nlDecision } from "../lib/nlparse.ts";
import { DERIVE_WIRE2_PHRASING, DERIVE_WIRE_PHRASING, phrasingFor } from "../lib/propose.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const WIRE2 = JSON.parse(read("peaceai/rules/learned/public-derive-wire-v2.json")) as RuleSpec;
const WIRE1 = JSON.parse(read("peaceai/rules/learned/public-derive-wire-v1.json")) as RuleSpec;
const isTest = (p: string) => /\.test\.ts$/.test(p);
const issue = (head: string, behavior: string, examples: string[]) => [head, "", `Behavior: ${behavior}`, "", "Examples:", ...examples.map((e) => `- ${e}`), ""].join("\n");
const objective = (body: string) => cleanIssueText({ title: "wire task", body } as never);
const derive = (body: string, files: { path: string; content: string }[]) => deriveWireV2Detail(WIRE2.trigger, WIRE2.params, objective(body), files, isTest, body);

// --- fixture 1: a client shaped like PeaceSTOCKS R2ObjectClient (config seam, clock-stamped request, unbounded call)
const RETRY_HELPERS = `export function isRetryable(status: number): boolean {
  return status === 429 || (500 <= status && status <= 599);
}

export function isClientError(status: number): boolean {
  return 400 <= status && status <= 499;
}

export function retryAllowed(failedTries: number): boolean {
  return failedTries <= 2;
}

export function retryDelay(attempt: number, baseMs: number): number {
  return baseMs * (attempt + 1) * (attempt + 1) <= 30000 ? baseMs * (attempt + 1) * (attempt + 1) : 30000;
}

export function linearDelay(attempt: number, baseMs: number): number {
  return baseMs * (attempt + 1);
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
const CLIENT_TEST = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { retryAllowed } from "./retry.ts";\ntest("retryAllowed", () => {\n  assert.equal(retryAllowed(3), false);\n});\n`;
const CLIENT_FILES = [{ path: "src/retry.ts", content: RETRY_HELPERS }, { path: "src/client.ts", content: CLIENT }, { path: "src/retry.test.ts", content: CLIENT_TEST }];
const RETRY_HEAD = "In the existing method `request` of class `Client` in `src/client.ts`, retry a failing call.";
const RETRY_BEHAVIOR = "every try is stamped again and times out after 30 seconds on its own. A try that fails with no answer, or gets back a status that isRetryable says is worth retrying, is tried again while retryAllowed allows that many failed tries, after waiting retryDelay with a base wait of 500 ms through the injected sleep. Any other answer is returned as it is.";
const C = (n: string) => `new Client({ bucket: "bars", fetchImpl: fetch${n}, now: clock${n}, sleep: sleep${n} })`;
const RETRY_EXAMPLES = [
  'fake fetchA = sequence(rejects("fetch failed"), resolves(response(200)))',
  'fake clockA = returns("t")',
  "fake sleepA = resolves(null)",
  `expect ${C("A")}.get("day") resolves to 200`,
  "expect fetchA is called 2 times",
  "expect clockA is called 2 times",
  "expect sleepA is called with [500]",
  'fake fetchB = resolves(response(503))',
  'fake clockB = returns("t")',
  "fake sleepB = resolves(null)",
  `expect ${C("B")}.get("day") rejects with "GET_503"`,
  "expect fetchB is called 3 times",
  "expect clockB is called 3 times",
  "expect sleepB is called with [500], [2000]",
  'fake fetchC = resolves(response(404))',
  'fake clockC = returns("t")',
  "fake sleepC = resolves(null)",
  `expect ${C("C")}.get("day") resolves to 0`,
  "expect fetchC is called 1 time",
  "expect sleepC is called 0 times",
  'fake fetchD = rejects("fetch failed")',
  'fake clockD = returns("t")',
  "fake sleepD = resolves(null)",
  `expect ${C("D")}.get("day") rejects with "fetch failed"`,
  "expect fetchD is called 3 times",
  "expect sleepD is called with [500], [2000]",
];
const RETRY = issue(RETRY_HEAD, RETRY_BEHAVIOR, RETRY_EXAMPLES);

// --- fixture 2: a catch-up loop over days with an existing errors list (the extracted form of host.ts's loop)
const CATCHUP = `export interface DayScanner {
  run(day: string): Promise<{ stored: number }>;
}

export async function catchUp(days: string[], scanner: DayScanner): Promise<{ done: string[]; errors: { day: string; error: string }[] }> {
  const done: string[] = [];
  const errors: { day: string; error: string }[] = [];
  for (const day of days) {
    const report = await scanner.run(day);
    done.push(day + ":" + report.stored);
  }
  return { done, errors };
}
`;
const CATCHUP_TEST = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { catchUp } from "./catch-up.ts";\ntest("all stored", async () => {\n  assert.deepEqual(await catchUp(["a"], { run: async () => ({ stored: 1 }) }), { done: ["a:1"], errors: [] });\n});\n`;
const CATCHUP_FILES = [{ path: "src/catch-up.ts", content: CATCHUP }];
const SKIP_HEAD = "In the existing function `catchUp` in `src/catch-up.ts`, record a failing call and go on.";
const SKIP_BEHAVIOR = "when the scan of one day fails with an error whose message starts with R2 the day and the error message are recorded in the run's errors and catch-up moves on to the next day, and that day is not marked done. Any other failure, such as a TypeError, is not swallowed: it stops the run.";
const SKIP_OK = [
  'fake scannerA = { run: sequence(rejects("R2_GET_503"), resolves({ stored: 5 })) }',
  'expect catchUp(["2026-10-01", "2026-10-02"], scannerA) resolves to { done: ["2026-10-02:5"], errors: [{ day: "2026-10-01", error: "R2_GET_503" }] }',
  "expect scannerA.run is called 2 times",
];
const SKIP_TYPEERROR = [
  'fake scannerB = { run: rejects("boom", { name: "TypeError" }) }',
  'expect catchUp(["2026-10-01", "2026-10-02"], scannerB) rejects with "boom"',
  "expect scannerB.run is called 1 time",
];
const SKIP = issue(SKIP_HEAD, SKIP_BEHAVIOR, [...SKIP_OK, ...SKIP_TYPEERROR]);

/** Write the derived tree to a temp dir and import the edited module (the derived code is run, not only read). */
async function load<T>(files: { path: string; content: string }[], edit: { path: string; content: string }): Promise<{ mod: T; done: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "m138-run-"));
  for (const f of files) { mkdirSync(join(dir, f.path, ".."), { recursive: true }); writeFileSync(join(dir, f.path), f.path === edit.path ? edit.content : f.content); }
  const mod = (await import(pathToFileURL(join(dir, edit.path)).href)) as T;
  return { mod, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the spec: EXISTING_EDIT with the v2 vocabulary, its own trigger, valid, approved only as #613's exact sha, no credit; phrasing", () => {
  assert.equal(WIRE2.id, "public-derive-wire-v2");
  assert.equal(WIRE2.kind, "EXISTING_EDIT");
  assert.equal(WIRE2.trigger, DERIVE_WIRE_V2_TRIGGER);
  assert.equal(validateSpec(WIRE2), true);
  assert.ok(isWire2Params(WIRE2.params) && !isWireParams(WIRE2.params));
  assert.ok(isWireParams(WIRE1.params) && !isWire2Params(WIRE1.params), "v1 keeps its own vocabulary");
  // #614: holds before and after the /approve-rule landing. Not listed: the id and sha appear nowhere in approved.json.
  // Listed: exactly one entry, with this spec's exact sha and Peace's #613 approval, and it admits as APPROVED.
  const approvedText = read("peaceai/rules/approved.json");
  const listed = (JSON.parse(approvedText) as { rules: { id: string; sha256: string; approval: { issue: number; author: string; repo: string } }[] }).rules.filter((r) => r.id === WIRE2.id);
  const wireDecisions = admitRules([WIRE2], loadApprovedList(join(repo, "peaceai/rules/approved.json"))).filter((a) => a.spec?.id === WIRE2.id).map((a) => a.decision);
  if (listed.length === 0) {
    assert.ok(!approvedText.includes(WIRE2.id) && !approvedText.includes(specHash(WIRE2)), "derive-wire v2 waits for /approve-rule");
    assert.ok(!wireDecisions.includes("APPROVED"), "not listed: never APPROVED");
  } else {
    assert.equal(listed.length, 1, "listed once");
    assert.equal(listed[0]!.sha256, specHash(WIRE2), "approved as the exact spec sha");
    assert.equal(listed[0]!.sha256, "e9e6d7e10e0195850f6e29f13e92c803424fafc94c280e4fe7ea10ace311bc28", "the sha Peace approved on #613");
    assert.deepEqual([listed[0]!.approval.issue, listed[0]!.approval.author, listed[0]!.approval.repo], [613, "PeaceG03", "PeaceG03/PeaceAI-Workspace"]);
    assert.deepEqual(wireDecisions, ["APPROVED"], "a listed wire-v2 entry must admit (exact sha)");
  }
  const prop = JSON.parse(read("peaceai/rules/proposals/public-derive-wire-v2.json")) as { status: string; evidence: { qualifies: boolean } };
  assert.equal(prop.status, "proposal-off-wired");
  assert.equal(prop.evidence.qualifies, false);
  assert.equal(phrasingFor(WIRE2), DERIVE_WIRE2_PHRASING);
  assert.equal(phrasingFor(WIRE1), DERIVE_WIRE_PHRASING);
  assert.equal(nlDecision({ title: "", body: RETRY }, undefined, new Set(["EXISTING_EDIT"]), null).status, "canonical");
  const off = nlDecision({ title: "", body: SKIP }, undefined, new Set(), null);
  assert.ok(off.status === "unsure" && off.reason === "RULE_NOT_APPROVED");
  // the docs state the G26 condition
  assert.match(read("peaceai/spec/derive-wire-v2.md"), /v1 continue form is not allowed/);
  assert.match(read("peaceai/spec/derive-wire-v1.md"), /not\s+allowed for scanner per-day \/ per-session wiring/);
});

test("v1 and v2 do not overlap: each refuses the other's header; v1 output is unchanged", () => {
  assert.equal(deriveWireDetail(WIRE1.trigger, WIRE1.params, objective(RETRY), CLIENT_FILES, isTest, RETRY).reason, "wire_trigger");
  const v1 = issue("In the existing function `catchUp` in `src/catch-up.ts`, handle a failing call.", SKIP_BEHAVIOR, SKIP_OK);
  assert.equal(derive(v1, CATCHUP_FILES).reason, "wire_trigger");
  assert.equal(deriveWireV2Detail(WIRE1.trigger, WIRE1.params, objective(RETRY), CLIENT_FILES, isTest, RETRY).reason, "wire_params");
});

test("retry: one fit from the repo's helpers; the template signs and times out each attempt and waits through the injected sleep", async () => {
  const r = derive(RETRY, CLIENT_FILES);
  assert.ok(r.edit, `${r.reason} ${r.detail ?? ""}`);
  assert.deepEqual(r.derivation, { kind: "retry", holes: { target: "Client.request", site: "fetchImpl", status: "isRetryable", allowed: "retryAllowed", delay: "retryDelay", timeoutMs: 30000, baseMs: 500, imports: [{ name: "isRetryable", from: "./retry.ts" }, { name: "retryAllowed", from: "./retry.ts" }, { name: "retryDelay", from: "./retry.ts" }] } });
  const c = r.edit.content;
  assert.match(c, /^import \{ isRetryable \} from "\.\/retry\.ts";$/m);
  assert.match(c, /sleep\?: \(ms: number\) => Promise<void>;/);
  assert.match(c, /this\.sleep = config\.sleep \?\? /);
  assert.match(c, /for \(let attempt = 0; ; attempt \+= 1\) \{\n\s+const stamp = method \+ ":" \+ this\.now\(\);/, "the signing statements run inside the loop");
  assert.match(c, /await this\.fetchImpl\("\/" \+ this\.config\.bucket \+ url, \{ \.\.\.init, signal: AbortSignal\.timeout\(30000\) \}\)/);
  assert.equal(r.edit.extra.length, 1);
  // run it
  type Res = { status: number };
  type Init = { method: string; stamp: string; signal?: AbortSignal };
  const { mod, done } = await load<{ Client: new (c: Record<string, unknown>) => { get(k: string): Promise<number> } }>(CLIENT_FILES, r.edit);
  try {
    const rig = (answers: (Res | Error)[]) => {
      const calls: Init[] = [], sleeps: number[] = [];
      let ticks = 0;
      const client = new mod.Client({
        bucket: "bars",
        now: () => `t${++ticks}`,
        sleep: async (ms: number) => { sleeps.push(ms); },
        fetchImpl: async (_url: string, init: Init) => { calls.push(init); const a = answers[Math.min(calls.length, answers.length) - 1]!; if (a instanceof Error) throw a; return a; },
      });
      return { client, calls, sleeps };
    };
    // retries stop at the limit (always 503: 3 tries, the last answer is returned and get throws on it)
    const a = rig([{ status: 503 }]);
    await assert.rejects(a.client.get("k"), /GET_503/);
    assert.equal(a.calls.length, 3);
    assert.deepEqual(a.sleeps, [500, 2000]);
    // each attempt is signed afresh and carries its own timeout signal
    assert.deepEqual(a.calls.map((x) => x.stamp), ["GET:t1", "GET:t2", "GET:t3"]);
    assert.ok(a.calls.every((x) => x.signal instanceof AbortSignal && !x.signal.aborted));
    assert.equal(new Set(a.calls.map((x) => x.signal)).size, 3, "a fresh signal per attempt");
    // a non-retryable status is not retried
    const b = rig([{ status: 404 }]);
    assert.equal(await b.client.get("k"), 0);
    assert.equal(b.calls.length, 1);
    assert.deepEqual(b.sleeps, []);
    const b2 = rig([{ status: 403 }]);
    await assert.rejects(b2.client.get("k"), /GET_403/);
    assert.equal(b2.calls.length, 1);
    // a network error is retried up to the limit, then the original error is what the caller gets
    const boom = new TypeError("fetch failed");
    const d = rig([boom]);
    await assert.rejects(d.client.get("k"), (e) => e === boom);
    assert.equal(d.calls.length, 3);
    // a transient failure then success
    const e = rig([new Error("fetch failed"), { status: 429 }, { status: 200 }]);
    assert.equal(await e.client.get("k"), 200);
    assert.equal(e.calls.length, 3);
    assert.deepEqual(e.sleeps, [500, 2000]);
  } finally { done(); }
});

test("retry twins: a no-op, retry-every-response or no-limit program that fits the examples refuses the task", () => {
  const only = (ex: string[]) => issue(RETRY_HEAD, RETRY_BEHAVIOR, ex);
  // a 503 then 404, 2 calls (one delay helper in the repo): the no-limit twin fits as well
  const oneDelay = CLIENT_FILES.map((f) => (f.path === "src/retry.ts" ? { ...f, content: f.content.slice(0, f.content.indexOf("export function linearDelay")) } : f));
  assert.deepEqual(((r) => [r.reason, r.detail])(derive(only(['fake fetchA = sequence(resolves(response(503)), resolves(response(404)))', 'fake clockA = returns("t")', 'fake sleepA = resolves(null)', `expect ${C("A")}.get("d") resolves to 0`, "expect fetchA is called 2 times", "expect sleepA is called with [500]"]), oneDelay)), ["wire_twin_fits", "no-limit"]);
  // 503, 503 then 200, 3 calls: retrying every response fits as well
  assert.deepEqual(((r) => [r.reason, r.detail])(derive(only(['fake fetchA = sequence(resolves(response(503)), resolves(response(503)), resolves(response(200)))', 'fake clockA = returns("t")', 'fake sleepA = resolves(null)', `expect ${C("A")}.get("d") resolves to 200`, "expect fetchA is called 3 times", "expect sleepA is called with [500], [2000]"]), CLIENT_FILES)), ["wire_twin_fits", "retry-every-response"]);
  // only a 404, 1 call: not retrying at all fits as well (or nothing pins the helpers)
  assert.ok(["wire_twin_fits", "wire_ambiguous"].includes(derive(only(RETRY_EXAMPLES.slice(14, 20)), CLIENT_FILES).reason ?? ""));
  // always 503, 3 calls: retrying every response fits as well
  assert.deepEqual(((r) => [r.reason, r.detail])(derive(only(RETRY_EXAMPLES.slice(7, 14)), CLIENT_FILES)), ["wire_twin_fits", "retry-every-response"]);
  // no count of the site fake: unpinned
  assert.equal(derive(only(RETRY_EXAMPLES.filter((b) => !/^expect fetch\w is called/.test(b))), CLIENT_FILES).reason, "wire_retry_unpinned");
  // a delay the repo's helpers cannot give: no fit
  assert.equal(derive(only(RETRY_EXAMPLES.map((b) => b.replace("[500], [2000]", "[500], [700]"))), CLIENT_FILES).reason, "wire_no_fit");
  // the timeout and the base wait must be stated once in the prose
  assert.equal(derive(issue(RETRY_HEAD, RETRY_BEHAVIOR.replace(" and times out after 30 seconds on its own", ""), RETRY_EXAMPLES), CLIENT_FILES).reason, "wire_retry_timeout_unstated");
  assert.equal(derive(issue(RETRY_HEAD, RETRY_BEHAVIOR.replace(" with a base wait of 500 ms", ""), RETRY_EXAMPLES), CLIENT_FILES).reason, "wire_retry_base_unstated");
  // code in the issue is refused (anti-copy guard stays on)
  assert.equal(derive(issue(RETRY_HEAD, RETRY_BEHAVIOR, [...RETRY_EXAMPLES, "note: for (let attempt = 0; ; attempt += 1)"]), CLIENT_FILES).reason, "wire_examples");
  // an issue long enough to reach the objective cut is refused, never derived from the bullets that survived
  const long = issue(RETRY_HEAD, RETRY_BEHAVIOR + " The wait between tries keeps the bucket calm.".repeat(40), RETRY_EXAMPLES);
  assert.equal(derive(long, CLIENT_FILES).reason, "wire_task_truncated");
  assert.equal(derive(issue(RETRY_HEAD, RETRY_BEHAVIOR + " Use AbortSignal.timeout(30000).", RETRY_EXAMPLES), CLIENT_FILES).reason, "wire_behavior_code");
  assert.equal(derive(RETRY + "\n```ts\nawait this.sleep(1);\n```\n", CLIENT_FILES).reason, "wire_behavior_code");
});

test("recorded skip: a matching failure is recorded and the day is not marked done; a TypeError propagates (no v1 continue form)", async () => {
  const r = derive(SKIP, CATCHUP_FILES);
  assert.ok(r.edit, `${r.reason} ${r.detail ?? ""}`);
  assert.deepEqual(r.derivation, { kind: "record", holes: { target: "catchUp", site: "const report = await scanner.run(day);", filter: { read: "message", op: "prefix", lit: "R2" }, list: "errors", record: { kind: "object", fields: [["day", "item"], ["error", "message"]] } } });
  // G26: every catch v2 writes re-throws what it does not match and records what it skips
  const c = r.edit.content;
  assert.match(c, /catch \(error\) \{\n\s+if \(!\(\(error instanceof Error \? error\.message : String\(error\)\)\.startsWith\("R2"\)\)\) throw error;\n\s+errors\.push\(\{ day: day, error: error instanceof Error \? error\.message : String\(error\) \}\);\n\s+continue;\n\s+\}/);
  assert.doesNotMatch(c, /catch\s*\{\s*continue;\s*\}/);
  type Out = { done: string[]; errors: { day: string; error: string }[] };
  const { mod, done } = await load<{ catchUp(days: string[], s: { run(d: string): Promise<{ stored: number }> }): Promise<Out> }>(CATCHUP_FILES, r.edit);
  try {
    const seen: string[] = [];
    const scanner = (fail: Record<string, Error>) => ({ run: async (d: string) => { seen.push(d); if (fail[d]) throw fail[d]; return { stored: 7 }; } });
    // a skipped day leaves its recorded error and is not marked done; the next days still run
    const out = await mod.catchUp(["d1", "d2", "d3"], scanner({ d1: new Error("R2_GET_503"), d3: new Error("R2_PUT_500", { cause: new Error("fetch failed") }) }));
    assert.deepEqual(out, { done: ["d2:7"], errors: [{ day: "d1", error: "R2_GET_503" }, { day: "d3", error: "R2_PUT_500" }] });
    assert.deepEqual(seen, ["d1", "d2", "d3"]);
    // a non-matching error (a TypeError from a bug) propagates unchanged and is not swallowed
    const bug = new TypeError("Cannot read properties of undefined");
    seen.length = 0;
    await assert.rejects(mod.catchUp(["d1", "d2"], scanner({ d1: bug })), (e) => e === bug);
    assert.deepEqual(seen, ["d1"], "no later day runs after a non-matching error");
    // a thrown non-Error value is read as a string; it does not match, so it propagates
    // an error outside the filter's word is not recorded either: it propagates
    const other = new Error("MASSIVE_429");
    await assert.rejects(mod.catchUp(["d1", "d2"], scanner({ d1: other })), (e) => e === other);
  } finally { done(); }
});

test("recorded skip refusals: unpinned filter or skip, no seam, a site without its own list", () => {
  assert.equal(derive(issue(SKIP_HEAD, SKIP_BEHAVIOR, SKIP_OK), CATCHUP_FILES).reason, "wire_filter_unpinned");
  // only a propagating error, no skipped day: the skip is unpinned
  assert.equal(derive(issue(SKIP_HEAD, SKIP_BEHAVIOR, SKIP_TYPEERROR), CATCHUP_FILES).reason, "wire_skip_unpinned");
  assert.equal(derive(issue(SKIP_HEAD, SKIP_BEHAVIOR, [
    'fake scannerA = { run: sequence(resolves({ stored: 5 }), rejects("R2_GET_503")) }',
    'expect catchUp(["2026-10-01", "2026-10-02"], scannerA) resolves to { done: ["2026-10-01:5"], errors: [{ day: "2026-10-02", error: "R2_GET_503" }] }',
    ...SKIP_TYPEERROR,
  ]), CATCHUP_FILES).reason, "wire_skip_unpinned");
  // the filter word must be in the Behavior paragraph
  assert.equal(derive(issue(SKIP_HEAD, SKIP_BEHAVIOR.replace(" whose message starts with R2", " from storage"), [...SKIP_OK, ...SKIP_TYPEERROR]), CATCHUP_FILES).reason, "wire_no_fit");
  // a collaborator the target builds itself has no seam (src/host.ts runScannerHost's `new MarketsScanner`)
  const built = CATCHUP.replace("days: string[], scanner: DayScanner", "days: string[], bucket: string").replace("  const done: string[] = [];", "  const scanner = new Scanner(bucket);\n  const done: string[] = [];") + "\nclass Scanner implements DayScanner {\n  constructor(private readonly bucket: string) {}\n  async run(day: string): Promise<{ stored: number }> {\n    return { stored: this.bucket.length + day.length };\n  }\n}\n";
  const builtOpts = built.replace("days: string[], bucket: string", "days: string[], options: { bucket: string }").replace("new Scanner(bucket)", "new Scanner(options.bucket)");
  assert.equal(derive(SKIP.replaceAll(", scannerA)", ', { bucket: "b", scanner: scannerA })').replaceAll(", scannerB)", ', { bucket: "b", scanner: scannerB })'), [{ path: "src/catch-up.ts", content: builtOpts }]).reason, "wire_no_seam");
  // no existing list of the target to record into: no fit (v2 never adds a list or drops the record)
  const noList = CATCHUP.replace("  const errors: { day: string; error: string }[] = [];\n", "").replace("return { done, errors };", "return { done, errors: [] };");
  assert.equal(derive(SKIP, [{ path: "src/catch-up.ts", content: noList }]).reason, "wire_no_fit");
  // code in the issue
  assert.equal(derive(issue(SKIP_HEAD, SKIP_BEHAVIOR + " Wrap it in try { } catch.", [...SKIP_OK, ...SKIP_TYPEERROR]), CATCHUP_FILES).reason, "wire_behavior_code");
});

/** Run Job B (bin/test-candidates.ts) on a fixture repo with the derived candidate, under a fixture-local approval list. */
function jobB(files: { path: string; content: string }[], body: string) {
  const dir = mkdtempSync(join(tmpdir(), "m138-"));
  try {
    const ws = join(dir, "ws");
    for (const f of files) { mkdirSync(join(ws, f.path, ".."), { recursive: true }); writeFileSync(join(ws, f.path), f.content); }
    writeFileSync(join(ws, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ["src"] }));
    writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "m138", private: true, type: "module" }));
    writeFileSync(join(ws, ".gitignore"), "node_modules\n");
    symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd: ws, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "base");
    const baseSha = git("rev-parse", "HEAD").trim();
    const why: { reason?: string } = {};
    const e = applyRule(WIRE2, objective(body), files, isTest, undefined, why, () => false, undefined, body);
    assert.ok(e, why.reason);
    writeFileSync(join(ws, e.path), e.content);
    for (const x of e.extra ?? []) writeFileSync(join(ws, x.path), x.content);
    git("add", "-N", "--", ...(e.extra ?? []).map((x) => x.path));
    const diff = git("diff", "--no-color", "--full-index", "--no-renames");
    git("reset", "-q", "--hard"); git("clean", "-fdq");
    const inDir = join(dir, "in");
    mkdirSync(join(inDir, "candidates"), { recursive: true });
    writeFileSync(join(inDir, "candidates/candidate-1.diff"), diff);
    writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha, candidates: [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["LEARNED_EXISTING_EDIT"], operationId: `learned:${WIRE2.id}@${specHash(WIRE2)}`, diffBytes: diff.length, diffLines: diff.split("\n").length, selfGrade: true }] }));
    // a fixture-local approval list (the repo's approved.json is never read or written here)
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [{ id: WIRE2.id, sha256: specHash(WIRE2), source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-11T00:00:00Z" } }] }));
    const resultsFile = join(dir, "out/results.json");
    mkdirSync(join(dir, "out"), { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
    const p = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], { cwd: repo, encoding: "utf8", env: { ...env, PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: resultsFile, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list } });
    assert.equal(p.status, 0, p.stderr);
    return { res: JSON.parse(readFileSync(resultsFile, "utf8")).results[0], log: p.stdout };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("Job B grades both derived edits end to end: the new fake test fails on the base, passes on the edit; the original suite passes", { skip: Number(process.versions.node.split(".")[0]) < 22 && "needs Node >= 22" }, () => {
  for (const [files, body] of [[CLIENT_FILES, RETRY], [[...CATCHUP_FILES, { path: "src/catch-up.test.ts", content: CATCHUP_TEST }], SKIP]] as const) {
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
