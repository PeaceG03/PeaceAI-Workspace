// G19+ (public-derive-wire-sizes-v1, kind EXISTING_EDIT, proposal-off-wired): scanner wiring task w05, measuring storage
// from the listing's sizes without a download per object, split in two asks with their own closed templates:
// "list the sizes too" on a paging key listing adds a sibling sized listing (the listing's own body rebuilt with a
// closed collect step; a missing size fails the call, never 0) plus an OPTIONAL interface member; "use the list sizes"
// on a method that lists keys and reads every key whole takes keys and sizes from that member when the receiver has it
// and keeps the old reads otherwise. A failing listing always fails the call (G26): "a measuring failure does not fail
// the run" is refused by name (sizes_swallow). No catch, no error text is read or recorded.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { auditorPolicyProblem, teamPickedProblem } from "../lib/approval.ts";
import { admitRules, APPROVED_SCHEMA, loadApprovedList } from "../lib/approved.ts";
import { DERIVE_WIRE_SIZES_TRIGGER, deriveWireSizesDetail } from "../lib/derive-wire-sizes.ts";
import { DERIVE_WIRE_V2_RETHROW_TRIGGER, DERIVE_WIRE_V2_TRIGGER, deriveWireV2Detail } from "../lib/derive-wire-v2.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { gradeExistingEditProblem, gradeSizesProblem, isWire2Params, isWire2RethrowParams, isWireParams, isWireSizesParams, sizesListEditShape, sizesUseEditShape } from "../lib/learned-edit-existing.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { LEARNED_CANONICAL, parseTask } from "../lib/nlparse.ts";
import { DERIVE_WIRE_SIZES_PHRASING, phrasingFor } from "../lib/propose.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-derive-wire-sizes-v1.json")) as RuleSpec;
const WIRE2 = JSON.parse(read("peaceai/rules/learned/public-derive-wire-v2.json")) as RuleSpec;
const RETHROW = JSON.parse(read("peaceai/rules/learned/public-derive-wire-rethrow-v1.json")) as RuleSpec;
const isTest = (p: string) => /\.test\.ts$/.test(p);
const issue = (head: string, behavior: string, examples: string[]) => [head, "", `Behavior: ${behavior}`, "", "Examples:", ...examples.map((e) => `- ${e}`), ""].join("\n");
const objective = (body: string) => cleanIssueText({ title: "wire task", body } as never);
const derive = (body: string, files: { path: string; content: string }[]) => deriveWireSizesDetail(SPEC.trigger, SPEC.params, objective(body), files, isTest, body);

// --- the fixture: a PeaceSTOCKS-like object client (its key listing pages through ListObjectsV2-style XML) and a
// meter that lists every key and then downloads each object only to read its length (w05's measureStorage)
const STORE = `export interface ObjectClient {
  get(key: string): Promise<Uint8Array | undefined>;
  /** Every key under the prefix (all pages), sorted. */
  list(prefix: string): Promise<string[]>;
}

export interface StoreConfig {
  bucket: string;
  fetchImpl?: (url: string, init: { method: string; stamp: string }) => Promise<Response>;
  now?: () => string;
}

function xmlText(value: string): string {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

export class StoreClient implements ObjectClient {
  private readonly fetchImpl: (url: string, init: { method: string; stamp: string }) => Promise<Response>;
  private readonly now: () => string;

  constructor(private readonly config: StoreConfig) {
    if (!config.bucket) throw new Error("STORE_CONFIG_REQUIRED");
    this.fetchImpl = config.fetchImpl ?? (async () => new Response(null, { status: 599 }));
    this.now = config.now ?? (() => "1970-01-01");
  }

  private async request(method: string, url: string): Promise<Response> {
    const stamp = method + ":" + this.now();
    return this.fetchImpl("/" + this.config.bucket + url, { method, stamp });
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const response = await this.request("GET", "/" + key);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(\`STORE_GET_\${response.status}\`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    for (let page = 0; page < 1000; page += 1) {
      const response = await this.request("GET", "/?prefix=" + prefix + (token ? "&token=" + token : ""));
      if (!response.ok) throw new Error(\`STORE_LIST_\${response.status}\`);
      const xml = await response.text();
      keys.push(
        ...[...xml.matchAll(/<Key>([^<]+)<\\/Key>/gu)].map((match) => xmlText(match[1] ?? "")).filter(Boolean),
      );
      const truncated = /<IsTruncated>true<\\/IsTruncated>/u.test(xml);
      token = /<NextToken>([^<]+)<\\/NextToken>/u.exec(xml)?.[1];
      if (!truncated) return keys.sort();
      if (!token) throw new Error("STORE_LIST_TRUNCATED_WITHOUT_TOKEN");
    }
    throw new Error("STORE_LIST_TOO_MANY_PAGES");
  }
}
`;
const METER = `import type { ObjectClient } from "./store.ts";

export class Meter {
  constructor(private readonly client: ObjectClient) {}

  async measure(): Promise<{ bytes: number; cache: number }> {
    const keys = await this.client.list("");
    let bytes = 0;
    let cache = 0;
    for (const key of keys) {
      const size = (await this.client.get(key))?.byteLength ?? 0;
      bytes += size;
      if (key.startsWith("cache/")) cache += size;
    }
    return { bytes, cache };
  }
}
`;
const STORE_TEST = `import assert from "node:assert/strict";
import test from "node:test";
import { StoreClient } from "./store.ts";

test("list pages to the end", async () => {
  const pages = ["<R><IsTruncated>true</IsTruncated><NextToken>t</NextToken><Key>b</Key></R>", "<R><Key>a</Key></R>"];
  const c = new StoreClient({ bucket: "x", fetchImpl: async () => new Response(pages.shift() ?? "", { status: 200 }), now: () => "t" });
  assert.deepEqual(await c.list(""), ["a", "b"]);
});
`;
const BASE = [{ path: "src/store.ts", content: STORE }, { path: "src/meter.ts", content: METER }, { path: "src/store.test.ts", content: STORE_TEST }];

const HEAD_A = "In the existing method list of class StoreClient in src/store.ts, list the sizes too.";
const BEHAVIOR_A = "add a sized listing that pages through the store like the key listing and gives every key with its size in bytes from the Size the same pages carry, sorted by key. Nothing is downloaded. An entry without a size fails the call and is never counted as zero.";
const PAGE1 = "<R><IsTruncated>true</IsTruncated><NextToken>t2</NextToken><Item><Key>perm/a</Key><Size>100</Size></Item></R>";
const PAGE2 = "<R><Item><Key>tmp/c</Key><Size>5</Size></Item><Item><Key></Key><Size>3</Size></Item><Item><Key>cache/b</Key><Size>10</Size></Item></R>";
const NOSIZE = "<R><Item><Key>cache/b</Key></Item></R>";
const C = (f: string) => `new StoreClient({ bucket: "x", fetchImpl: ${f}, now: nowA })`;
const PAGES = `sequence(resolves(response(200, ${JSON.stringify(PAGE1)})), resolves(response(200, ${JSON.stringify(PAGE2)})))`;
const LISTED = '[{ key: "cache/b", size: 10 }, { key: "perm/a", size: 100 }, { key: "tmp/c", size: 5 }]';
const EX_A = [`fake fetchA = ${PAGES}`, `fake fetchB = resolves(response(200, ${JSON.stringify(NOSIZE)}))`, 'fake nowA = returns("t")', `expect ${C("fetchA")}.listSizes("") resolves to ${LISTED}`, `expect ${C("fetchB")}.listSizes("") rejects with "STORE_LIST_SIZE_MISSING"`, "expect fetchA is called 2 times", "expect fetchB is called 1 times"];
const TASK_A = issue(HEAD_A, BEHAVIOR_A, EX_A);

const HEAD_B = "In the existing method measure of class Meter in src/meter.ts, use the list sizes.";
const BEHAVIOR_B = "when the client offers the sized listing, take every key and its size from that one listing and download nothing. A client without it is measured as today. A failure of the sized listing still fails the measurement.";
const SIZED = '[{ key: "cache/b", size: 10 }, { key: "perm/a", size: 100 }]';
const M = (n: string) => `new Meter({ listSizes: listSizes${n}, get: getA, list: listA })`;
const PLAIN = "expect new Meter({ get: getC, list: listC }).measure() resolves to { bytes: 0, cache: 0 }";
const EX_B = [`fake listSizesA = resolves(${SIZED})`, 'fake listSizesB = rejects("STORE_LIST_503")', "fake getA = resolves(null)", 'fake listA = resolves(["cache/b", "perm/a"])', "fake getC = resolves(null)", 'fake listC = resolves(["cache/b"])', `expect ${M("A")}.measure() resolves to { bytes: 110, cache: 10 }`, `expect ${M("B")}.measure() rejects with "STORE_LIST_503"`, PLAIN, 'expect listSizesA is called with [""]', "expect getA is called 0 times", "expect listA is called 0 times", "expect getC is called 1 times", "expect listC is called 1 times"];
const TASK_B = issue(HEAD_B, BEHAVIOR_B, EX_B);

const deriveA = () => { const r = derive(TASK_A, BASE); assert.ok(r.edit, r.reason ?? ""); return r.edit; };
const AFTER_A = () => { const e = deriveA(); return BASE.map((f) => (f.path === e.path ? { ...f, content: e.content } : f)); };
const reader = (files: { path: string; content: string }[], over?: { path: string; content: string }) => (rel: string) => (over && rel === over.path ? over.content : (files.find((f) => f.path === rel && !isTest(rel))?.content ?? null));

async function load<T>(files: { path: string; content: string }[], path: string): Promise<{ mod: T; done: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "m143-run-"));
  for (const f of files) { mkdirSync(join(dir, f.path, ".."), { recursive: true }); writeFileSync(join(dir, f.path), f.content); }
  const mod = (await import(pathToFileURL(join(dir, path)).href)) as T;
  return { mod, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the spec: its own id, vocabulary and trigger; v2's and rethrow-v1's specs untouched; delegable, team-picked, no credit", () => {
  assert.equal(SPEC.id, "public-derive-wire-sizes-v1");
  assert.equal(SPEC.kind, "EXISTING_EDIT");
  assert.equal(SPEC.trigger, DERIVE_WIRE_SIZES_TRIGGER);
  assert.equal(validateSpec(SPEC), true);
  assert.ok(isWireSizesParams(SPEC.params) && !isWire2Params(SPEC.params) && !isWire2RethrowParams(SPEC.params) && !isWireParams(SPEC.params));
  assert.ok(!isWireSizesParams(WIRE2.params) && !isWireSizesParams(RETHROW.params));
  assert.equal(specHash(WIRE2), "e9e6d7e10e0195850f6e29f13e92c803424fafc94c280e4fe7ea10ace311bc28", "v2 keeps the sha Peace approved on #613");
  assert.equal(specHash(RETHROW), "24755d1d4c5d9e5c0dcf21f7fd38be9f3759d0ac04613ec3e6b5b7b5ce4f809b", "rethrow-v1 keeps its approved sha (#628)");
  // not approved by this change: it waits for /auditor-approve-rule (or /approve-rule) on its own proposal issue
  const approvedText = read("peaceai/rules/approved.json");
  const listed = (JSON.parse(approvedText) as { rules: { id: string; sha256: string }[] }).rules.filter((r) => r.id === SPEC.id);
  if (listed.length === 0) {
    assert.ok(!approvedText.includes(specHash(SPEC)));
    assert.ok(!admitRules([SPEC], loadApprovedList(join(repo, "peaceai/rules/approved.json"))).some((a) => a.spec?.id === SPEC.id && a.decision === "APPROVED"));
  } else assert.equal(listed[0]!.sha256, specHash(SPEC));
  assert.equal(auditorPolicyProblem(SPEC), null, "an EXISTING_EDIT spec Auditor may approve");
  const prop = JSON.parse(read("peaceai/rules/proposals/public-derive-wire-sizes-v1.json"));
  assert.equal(prop.teamPicked, true);
  assert.equal(prop.credit, 0);
  assert.equal(prop.evidence.qualifies, false);
  assert.equal(prop.status, "proposal-off-wired");
  assert.equal(teamPickedProblem(SPEC.id, prop), false, "team-picked, 0 credit");
  assert.equal(phrasingFor(SPEC), DERIVE_WIRE_SIZES_PHRASING);
  for (const r of ["sizes_swallow", "sizes_silent_zero", "sizes_download", "sizes_calls_unpinned", "sizes_no_listing", "sizes_clause_unpinned"]) assert.ok(DERIVE_WIRE_SIZES_PHRASING.includes(r), r);
});

test("the asks stay apart: v2 and rethrow-v1 refuse the sizes headers, the sizes spec refuses their headers", () => {
  for (const body of [TASK_A, TASK_B]) {
    assert.equal(deriveWireV2Detail(WIRE2.trigger, WIRE2.params, objective(body), BASE, isTest, body).reason, "wire_trigger");
    assert.equal(deriveWireV2Detail(RETHROW.trigger, RETHROW.params, objective(body), BASE, isTest, body).reason, "wire_trigger");
  }
  assert.notEqual(DERIVE_WIRE_SIZES_TRIGGER, DERIVE_WIRE_V2_TRIGGER);
  assert.notEqual(DERIVE_WIRE_SIZES_TRIGGER, DERIVE_WIRE_V2_RETHROW_TRIGGER);
  for (const head of ["In the existing method list of class StoreClient in src/store.ts, retry a failing call.", "In the existing method list of class StoreClient in src/store.ts, handle a failing call."]) assert.equal(derive(issue(head, BEHAVIOR_A, EX_A), BASE).reason, "wire_trigger");
  // the sizes vocabulary is all or none, and only through its own trigger
  assert.equal(deriveWireSizesDetail(WIRE2.trigger, SPEC.params, objective(TASK_A), BASE, isTest, TASK_A).reason, "wire_params");
  assert.equal(deriveWireSizesDetail(SPEC.trigger, { ...SPEC.params, statements: "derived-rethrow-at-retry-limit-v2" }, objective(TASK_A), BASE, isTest, TASK_A).reason, "wire_params");
});

test("list the sizes too: one fit (element Item, size tag Size, fields key / size); the listing itself is unchanged", async () => {
  const r = derive(TASK_A, BASE);
  assert.ok(r.edit, r.reason ?? "");
  assert.deepEqual(r.derivation, { kind: "list", holes: { target: "StoreClient.list", method: "listSizes", container: "Item", size: "Size", keyField: "key", sizeField: "size" } });
  const out = r.edit.content;
  // the base listing and every other line stay byte for byte: only the sibling and the optional member are added
  const added = out.split("\n").length - STORE.split("\n").length;
  assert.ok(out.includes(STORE.slice(STORE.indexOf("  async list("), STORE.indexOf('    throw new Error("STORE_LIST_TOO_MANY_PAGES");'))));
  assert.ok(out.includes("  listSizes?(prefix: string): Promise<{ key: string; size: number }[]>;\n"));
  assert.ok(out.includes('if (entries.some((entry) => !Number.isSafeInteger(entry.size))) throw new Error("STORE_LIST_SIZE_MISSING");'));
  assert.ok(added > 20 && added < 40, String(added));
  // no catch anywhere, no error text read (G26 / RETHROW_ARG_IDS: the sibling rethrows nothing, it never catches)
  for (const bad of ["catch", ".message", "?? 0", "continue"]) assert.ok(!out.slice(out.indexOf("async listSizes")).includes(bad), bad);
  assert.equal(r.edit.extra.length, 1);
  assert.match(r.edit.extra[0]!.path, /^src\/store\.store-client-list-sizes-[0-9a-f]{7}\.test\.ts$/);
  const { mod, done } = await load<{ StoreClient: new (c: unknown) => { listSizes(p: string): Promise<unknown>; list(p: string): Promise<string[]> } }>(AFTER_A(), "src/store.ts");
  try {
    const pages = [PAGE1, PAGE2];
    const urls: string[] = [];
    const c = new mod.StoreClient({ bucket: "x", now: () => "t", fetchImpl: async (u: string) => { urls.push(u); return new Response(pages.shift() ?? "", { status: 200 }); } });
    assert.deepEqual(await c.listSizes("p/"), [{ key: "cache/b", size: 10 }, { key: "perm/a", size: 100 }, { key: "tmp/c", size: 5 }]);
    assert.deepEqual(urls, ["/x/?prefix=p/", "/x/?prefix=p/&token=t2"], "the same requests as the key listing");
    const bad = new mod.StoreClient({ bucket: "x", now: () => "t", fetchImpl: async () => new Response("", { status: 503 }) });
    await assert.rejects(bad.listSizes(""), { message: "STORE_LIST_503" });
    const huge = new mod.StoreClient({ bucket: "x", now: () => "t", fetchImpl: async () => new Response("<R><Item><Key>k</Key><Size>1234567890123456</Size></Item></R>", { status: 200 }) });
    await assert.rejects(huge.listSizes(""), { message: "STORE_LIST_SIZE_MISSING" }, "more than 15 digits is not read as a size");
  } finally { done(); }
});

test("use the list sizes: one fit (the optional listSizes of ObjectClient); a client without it is read as before", async () => {
  assert.equal(derive(TASK_B, BASE).reason, "sizes_no_listing", "the sized listing lands first");
  const files = AFTER_A();
  const r = derive(TASK_B, files);
  assert.ok(r.edit, r.reason ?? "");
  assert.deepEqual(r.derivation, { kind: "use", holes: { target: "Meter.measure", sized: "listSizes", keyField: "key", sizeField: "size" } });
  const out = r.edit.content;
  assert.ok(out.includes('    const sized = this.client.listSizes ? await this.client.listSizes("") : undefined;\n'));
  assert.ok(out.includes('    const keys = sized ? sized.map((entry) => entry.key) : await this.client.list("");\n'));
  assert.ok(out.includes("      const size = sized ? Number(sizeOf.get(key)) : ((await this.client.get(key))?.byteLength ?? 0);\n"));
  assert.ok(!out.includes("catch") && !out.includes(".message"));
  const { mod, done } = await load<{ Meter: new (c: unknown) => { measure(): Promise<unknown> } }>([...files.filter((f) => f.path !== r.edit!.path), { path: r.edit.path, content: out }], "src/meter.ts");
  try {
    let gets = 0;
    const get = async (k: string) => { gets += 1; return new Uint8Array(k.length); };
    assert.deepEqual(await new mod.Meter({ list: async () => ["cache/bb", "x"], get }).measure(), { bytes: 9, cache: 8 }, "no sized listing: read as before");
    assert.equal(gets, 2);
    assert.deepEqual(await new mod.Meter({ list: async () => [], get, listSizes: async () => [{ key: "cache/b", size: 7 }, { key: "z", size: 3 }] }).measure(), { bytes: 10, cache: 7 });
    assert.equal(gets, 2, "nothing downloaded");
    await assert.rejects(new mod.Meter({ list: async () => [], get, listSizes: async () => { throw new Error("STORE_LIST_503"); } }).measure(), { message: "STORE_LIST_503" }, "a failing listing fails the measurement (G26)");
  } finally { done(); }
});

test("refusals, list the sizes too", () => {
  const ex = (drop: string[], add: string[] = []) => issue(HEAD_A, BEHAVIOR_A, [...EX_A.filter((e) => !drop.some((d) => e.startsWith(d))), ...add]);
  // the page requests are not counted: a request per key would fit too
  assert.equal(derive(ex(["expect fetchA is called"]), BASE).reason, "sizes_calls_unpinned");
  // an element without its size would only fit as 0
  const zero = issue(HEAD_A, BEHAVIOR_A, [`fake fetchA = resolves(response(200, ${JSON.stringify("<R><Item><Key>a</Key><Size>4</Size></Item><Item><Key>b</Key></Item></R>")}))`, 'fake nowA = returns("t")', `expect ${C("fetchA")}.listSizes("") resolves to [{ key: "a", size: 4 }, { key: "b", size: 0 }]`, "expect fetchA is called 1 times"]);
  assert.equal(derive(zero, BASE).reason, "sizes_silent_zero");
  // a failing page answered with a list: a listing failure is never hidden (G26)
  assert.equal(derive(issue(HEAD_A, BEHAVIOR_A, ['fake fetchA = sequence(resolves(response(200, "<R><IsTruncated>true</IsTruncated><NextToken>t</NextToken><Item><Key>a</Key><Size>1</Size></Item></R>")), resolves(response(503, "")))', 'fake nowA = returns("t")', `expect ${C("fetchA")}.listSizes("") resolves to [{ key: "a", size: 1 }]`, "expect fetchA is called 2 times"]), BASE).reason, "sizes_swallow");
  assert.equal(derive(issue(HEAD_A, BEHAVIOR_A, ['fake fetchA = rejects("fetch failed")', 'fake nowA = returns("t")', `expect ${C("fetchA")}.listSizes("") resolves to []`, "expect fetchA is called 1 times"]), BASE).reason, "sizes_pages_unpinned");
  // one element per page: the page element fits as well as the item element
  const one = issue(HEAD_A, BEHAVIOR_A, [`fake fetchA = resolves(response(200, ${JSON.stringify("<R><Item><Key>a</Key><Size>4</Size></Item></R>")}))`, 'fake nowA = returns("t")', `expect ${C("fetchA")}.listSizes("") resolves to [{ key: "a", size: 4 }]`, "expect fetchA is called 1 times"]);
  assert.equal(derive(one, BASE).reason, "sizes_ambiguous");
  assert.equal(derive(issue(HEAD_A, BEHAVIOR_A, EX_A.map((e) => e.replace('{ key: "cache/b", size: 10 }', '{ key: "cache/b", size: 11 }'))), BASE).reason, "sizes_no_fit");
  assert.equal(derive(issue(HEAD_A, BEHAVIOR_A, EX_A.map((e) => e.replace('{ key: "cache/b", size: 10 }', '{ key: "cache/b", size: 10, at: 1 }'))), BASE).reason, "sizes_fields");
  assert.equal(derive(issue(HEAD_A, BEHAVIOR_A, EX_A.map((e) => e.replaceAll(".listSizes(", ".get("))), BASE).reason, "sizes_exists");
  assert.equal(derive(issue(HEAD_A, BEHAVIOR_A, EX_A.map((e) => e.replace(').listSizes("") rejects', ').listAll("") rejects'))), BASE).reason, "sizes_entry");
  assert.equal(derive(issue(HEAD_A, BEHAVIOR_A, EX_A.map((e) => e.replaceAll("perm/a", "perm&amp;a"))), BASE).reason, "sizes_examples");
  assert.equal(derive(ex([`expect ${C("fetchA")}`]), BASE).reason, "sizes_unpinned");
  assert.equal(derive(issue("In the existing method get of class StoreClient in src/store.ts, list the sizes too.", BEHAVIOR_A, EX_A), BASE).reason, "sizes_list_site");
  // a listing that is not the paging template (it sorts with a comparator) is not a site
  assert.equal(derive(TASK_A, BASE.map((f) => (f.path === "src/store.ts" ? { ...f, content: STORE.replace("return keys.sort();", "return keys.sort((a, b) => a.localeCompare(b));") } : f))).reason, "sizes_list_site");
  // no code in the issue
  assert.equal(derive(issue(HEAD_A, "add a sized listing; it pages through the store like the key listing and never counts a missing size as zero.", EX_A), BASE).reason, "wire_behavior_code");
});

test("refusals, use the list sizes", () => {
  const files = AFTER_A();
  const ex = (map: (e: string) => string | null) => issue(HEAD_B, BEHAVIOR_B, EX_B.map(map).filter((e): e is string => e !== null));
  // "a measuring failure does not fail the run": a failing listing answered with a report is refused (G26)
  assert.equal(derive(ex((e) => (e.includes(`${M("B")}.measure() rejects`) ? `expect ${M("B")}.measure() resolves to { bytes: 0, cache: 0 }` : e)), files).reason, "sizes_swallow");
  assert.equal(derive(ex((e) => (e === "expect getA is called 0 times" ? "expect getA is called 2 times" : e)), files).reason, "sizes_download");
  assert.equal(derive(ex((e) => (e === "expect getA is called 0 times" ? null : e)), files).reason, "sizes_unpinned");
  assert.equal(derive(ex((e) => (e.startsWith("expect listSizesA is called with") ? null : e)), files).reason, "sizes_unpinned");
  assert.equal(derive(ex((e) => (e.startsWith("expect listSizesA is called with") ? 'expect listSizesA is called with ["cache/"]' : e)), files).reason, "sizes_no_fit");
  assert.equal(derive(ex((e) => (e === "expect listA is called 0 times" ? "expect listA is called 1 times" : e)), files).reason, "sizes_no_fit");
  // two optional sized members: which one is meant is not decided here
  const two = files.map((f) => (f.path === "src/store.ts" ? { ...f, content: f.content.replace("  listSizes?(prefix: string)", "  listSizesFast?(prefix: string): Promise<{ key: string; size: number }[]>;\n  listSizes?(prefix: string)") } : f));
  assert.equal(derive(TASK_B, two).reason, "sizes_ambiguous");
  // a required (not optional) member would break every other client: not a sized listing for this ask
  const req = files.map((f) => (f.path === "src/store.ts" ? { ...f, content: f.content.replace("  listSizes?(prefix: string)", "  listSizes(prefix: string)") } : f));
  assert.equal(derive(TASK_B, req).reason, "sizes_no_listing");
  // a method that does not list and then read every key whole is not a site
  assert.equal(derive(TASK_B, files.map((f) => (f.path === "src/meter.ts" ? { ...f, content: METER.replace("(await this.client.get(key))?.byteLength ?? 0", "key.length") } : f))).reason, "sizes_use_site");
});

test("Job B's own recognizer: the derived edits grade; a silent zero, a catch, or a changed listing is not the template", () => {
  const a = deriveA();
  const ta = a.extra[0]!;
  assert.equal(gradeExistingEditProblem("src/store.ts", STORE, a.content, ta.path, ta.content, reader(BASE, a)), null);
  assert.equal(gradeSizesProblem("src/store.ts", STORE, a.content, ta.path, ta.content, reader(BASE, a)), "ok");
  assert.ok(sizesListEditShape("src/store.ts", STORE, a.content));
  // hand-made deviations: never the template, so never graded by the sizes branch
  const zero = a.content.replace('?.[1] ?? "NaN"),', '?.[1] ?? "0"),');
  const caught = a.content.replace('throw new Error("STORE_LIST_SIZE_MISSING");', "return [];");
  const other = a.content.replace(/(async listSizes[\s\S]*?)page < 1000/, "$1page < 1");
  for (const bad of [zero, caught, other]) {
    assert.notEqual(bad, a.content);
    assert.equal(sizesListEditShape("src/store.ts", STORE, bad), null);
    assert.equal(gradeSizesProblem("src/store.ts", STORE, bad, ta.path, ta.content, reader(BASE, { path: "src/store.ts", content: bad })), null);
  }
  const files = AFTER_A();
  const b = derive(TASK_B, files).edit!;
  const tb = b.extra[0]!;
  assert.equal(gradeExistingEditProblem("src/meter.ts", files[1]!.content, b.content, tb.path, tb.content, reader(files, b)), null);
  assert.ok(sizesUseEditShape("src/meter.ts", files[1]!.content, b.content));
  const swallow = b.content.replace('await this.client.listSizes("")', 'await this.client.listSizes("").catch(() => [])');
  assert.notEqual(swallow, b.content);
  assert.equal(sizesUseEditShape("src/meter.ts", files[1]!.content, swallow), null);
  assert.equal(gradeSizesProblem("src/meter.ts", files[1]!.content, swallow, tb.path, tb.content, reader(files, { path: "src/meter.ts", content: swallow })), null);
});

function jobB(files: { path: string; content: string }[], body: string) {
  const dir = mkdtempSync(join(tmpdir(), "m143-"));
  try {
    const ws = join(dir, "ws");
    for (const f of files) { mkdirSync(join(ws, f.path, ".."), { recursive: true }); writeFileSync(join(ws, f.path), f.content); }
    writeFileSync(join(ws, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true, lib: ["ES2022", "DOM"] }, include: ["src"] }));
    writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "m143", private: true, type: "module" }));
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

for (const [name, files, body] of [["list the sizes too", () => BASE, TASK_A], ["use the list sizes", AFTER_A, TASK_B]] as const) {
  test(`Job B grades ${name} end to end: the new fake test fails on the base, passes on the edit; the original suite passes`, { skip: Number(process.versions.node.split(".")[0]) < 22 && "needs Node >= 22" }, () => {
    const { res, log } = jobB(files(), body);
    assert.equal(res.applied, true, log);
    assert.equal(res.originalSuitePassed, true, log);
    assert.equal(res.testGrading.beforeFix, false, log);
    assert.equal(res.testGrading.afterFix, true, log);
    assert.equal(res.testGrading.verdict, "COUNTS", log);
    assert.equal(res.newTestsPassed, true, log);
    assert.equal(res.typecheckPassed, true, log);
  });
}

// Auditor #629 ruling: every clause the template emits is exercised by an example, else it is refused by name
test("no clause unpinned: list the sizes too refuses an unexercised missing-size throw, empty-key drop or sort", () => {
  // no rejecting example with a sizeless element: the P_SIZE_MISSING throw is unpinned
  const noMissing = issue(HEAD_A, BEHAVIOR_A, EX_A.filter((e) => !e.includes("fetchB")));
  assert.deepEqual([derive(noMissing, BASE).reason, derive(noMissing, BASE).detail], ["sizes_clause_unpinned", "size-missing"]);
  // no element without a key: the key listing's own filter is unpinned
  const keyed = issue(HEAD_A, BEHAVIOR_A, EX_A.map((e) => e.replace("<Item><Key></Key><Size>3</Size></Item>", "")));
  assert.deepEqual([derive(keyed, BASE).reason, derive(keyed, BASE).detail], ["sizes_clause_unpinned", "empty-key"]);
  // elements already in key order: the sort is unpinned
  const P2 = "<R><Item><Key></Key><Size>3</Size></Item><Item><Key>tmp/c</Key><Size>5</Size></Item></R>";
  const ordered = issue(HEAD_A, BEHAVIOR_A, [`fake fetchA = sequence(resolves(response(200, ${JSON.stringify(PAGE1)})), resolves(response(200, ${JSON.stringify(P2)})))`, ...EX_A.slice(1).map((e) => e.replace(LISTED, '[{ key: "perm/a", size: 100 }, { key: "tmp/c", size: 5 }]'))]);
  assert.deepEqual([derive(ordered, BASE).reason, derive(ordered, BASE).detail], ["sizes_clause_unpinned", "sort"]);
  // the task as written pins all three
  assert.equal(derive(TASK_A, BASE).reason, null);
});

test("no clause unpinned: use the list sizes refuses an unexercised fallback (a client without the sized listing)", () => {
  const files = AFTER_A();
  const noPlain = issue(HEAD_B, BEHAVIOR_B, EX_B.filter((e) => e !== PLAIN && !e.includes("getC") && !e.includes("listC")));
  assert.deepEqual([derive(noPlain, files).reason, derive(noPlain, files).detail], ["sizes_clause_unpinned", "no-sized-listing"]);
  // the fallback's reads are not counted: not pinned either
  const uncounted = issue(HEAD_B, BEHAVIOR_B, EX_B.filter((e) => e !== "expect getC is called 1 times"));
  assert.deepEqual([derive(uncounted, files).reason, derive(uncounted, files).detail], ["sizes_clause_unpinned", "no-sized-listing"]);
  // the derived read has no fallback branch on the sized arm (the keys are the listing's own keys)
  assert.ok(!derive(TASK_B, files).edit!.content.includes("sizeOf.get(key) ?? 0"));
});

test("every other named refusal is reached", () => {
  // sizes_target: the named method does not exist
  assert.equal(derive(issue("In the existing method nope of class StoreClient in src/store.ts, list the sizes too.", BEHAVIOR_A, EX_A), BASE).reason, "sizes_target");
  assert.equal(derive(issue("In the existing method nope of class Meter in src/meter.ts, use the list sizes.", BEHAVIOR_B, EX_B), AFTER_A()).reason, "sizes_target");
  // sizes_fake_ambiguous: two response fakes in one call (list), two sized-listing fakes in one call (use)
  const twoPages = issue(HEAD_A, BEHAVIOR_A, [...EX_A.slice(0, 3).map((e) => e), `expect new StoreClient({ bucket: "x", fetchImpl: fetchA, now: fetchB }).listSizes("") resolves to ${LISTED}`, ...EX_A.slice(4)]);
  assert.equal(derive(twoPages, BASE).reason, "sizes_fake_ambiguous");
  const twoSized = issue(HEAD_B, BEHAVIOR_B, EX_B.map((e) => e.replace(`${M("A")}.measure()`, "new Meter({ listSizes: listSizesA, get: getA, list: listA, inner: { listSizes: listSizesA } }).measure()")));
  assert.equal(derive(twoSized, AFTER_A()).reason, "sizes_fake_ambiguous");
  // sizes_search_too_large: more than 24 candidate tags in the pages
  const many = Array.from({ length: 25 }, (_, i) => `<T${i}>1</T${i}>`).join("");
  const wide = issue(HEAD_A, BEHAVIOR_A, EX_A.map((e) => e.replace("<R><Item><Key>tmp/c</Key>", `<R>${many}<Item><Key>tmp/c</Key>`)));
  assert.equal(derive(wide, BASE).reason, "sizes_search_too_large");
  // sizes_receiver: the meter's client is not declared with a named interface
  const inline = AFTER_A().map((f) => (f.path === "src/meter.ts" ? { ...f, content: f.content.replace("private readonly client: ObjectClient", "private readonly client: { list(p: string): Promise<string[]>; get(k: string): Promise<Uint8Array | undefined> }") } : f));
  assert.equal(derive(TASK_B, inline).reason, "sizes_receiver");
  // sizes_shape: a template name is already bound in the listing, so the closed template cannot be written as is
  const bound = BASE.map((f) => (f.path === "src/store.ts" ? { ...f, content: STORE.replace("    let token: string | undefined;\n", "    let token: string | undefined;\n    const entries = 0;\n").replace("for (let page = 0; page < 1000; page += 1) {", "for (let page = entries; page < 1000; page += 1) {") } : f));
  assert.equal(derive(TASK_A, bound).reason, "sizes_shape");
  // wire_task_truncated: the issue reaches the 2000-char objective cut
  assert.equal(derive(issue(HEAD_A, `${BEHAVIOR_A} ${"Nothing else changes. ".repeat(90)}`, EX_A), BASE).reason, "wire_task_truncated");
  // new_test_path_exists: the derived test's path is already a file
  const at = deriveA().extra[0]!.path;
  assert.equal(derive(TASK_A, [...BASE, { path: at, content: "export {};\n" }]).reason, "new_test_path_exists");
  // wire_sections (v2's parse: no Behavior paragraph) and edit_test_grammar (a fake named like a harness helper)
  assert.equal(derive([HEAD_A, "", "Examples:", ...EX_A.map((e) => `- ${e}`), ""].join("\n"), BASE).reason, "wire_sections");
  assert.equal(derive(issue(HEAD_A, BEHAVIOR_A, EX_A.map((e) => e.replaceAll("nowA", "settle"))), BASE).reason, "edit_test_grammar");
  // sizes_test_entry (Job B): a graded test that calls the old listing, not the new sibling
  const a = deriveA();
  const t = a.extra[0]!;
  const old = t.content.replaceAll(".listSizes(", ".list(");
  assert.notEqual(old, t.content);
  assert.equal(gradeSizesProblem("src/store.ts", STORE, a.content, t.path, old, reader(BASE, a)), "sizes_test_entry");
});

// G19+ Job A front door: with the NL parse on, both asks are canonical text (the rule's own trigger, keyed by name, M75)
// once the kind EXISTING_EDIT is approved, and RULE_NOT_APPROVED before; the rule itself still needs its own approval.
test("nlparse: both sizes asks are canonical once EXISTING_EDIT is approved, RULE_NOT_APPROVED before", () => {
  assert.equal(LEARNED_CANONICAL.deriveWireSizes.kind, "EXISTING_EDIT");
  assert.equal(LEARNED_CANONICAL.deriveWireSizes.re.source, new RegExp(DERIVE_WIRE_SIZES_TRIGGER, "imu").source);
  for (const body of [issue(HEAD_A, BEHAVIOR_A, EX_A), issue(HEAD_B, BEHAVIOR_B, EX_B)]) {
    const parse = (kinds: string[]) => parseTask({ title: cleanIssueText({ title: "wire task", body: "" } as never), body: cleanIssueText({ title: "", body } as never) }, { model: null, approvedKinds: new Set(kinds) });
    assert.equal(parse(["EXISTING_EDIT"]).status, "canonical");
    const off = parse([]);
    assert.equal(off.status, "unsure");
    if (off.status === "unsure") assert.equal(off.reason, "RULE_NOT_APPROVED");
  }
});
