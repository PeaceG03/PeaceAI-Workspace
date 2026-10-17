// M74 DATE_FUNCTION (public-date-function-v1, batch v4 B): the COMPLEX_FUNCTION engine with types "primitive+date"
// (loops ["none"] only). `Date` may be a parameter, local or return type; expressions may use only the timezone-free
// Date API (getUTC* getters, getTime, toISOString, Date.UTC, new Date(EXPR) with one argument), rewritten to reserved
// `__peaceaiDate` / `__peaceaiDateUTC` calls for the vetted vocabulary. Local-time reads, the clock and setters are
// refused by name (date_local_time, date_now, date_setter). Off on the dev path unless PEACEAI_COMPLEX_FUNCTION and
// PEACEAI_DATE_FUNCTION are both exactly "true"; Job A only via the hash-pinned approved list.
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { applyComplexRule, COMPLEX_TRIGGER, DATE_FUNCTION_FLAG, DATE_LOCAL_TIME, DATE_NOW, DATE_SETTER, DATE_TRIGGER, dateRefusal, LOOP_TRIGGER, NAMED_REFUSALS, stubComplexBody } from "../lib/learned-complex.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { isDateSpec, parseMarker, parseSpecBlock, phrasingFor, proposalBody } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-date-function-v1.json")) as RuleSpec;
const SHA = "0b48c156542e1d0cdfe06b46e31d5a170cb214264c2517977d52442ffd298ae6";
const COMPLEX = JSON.parse(read("peaceai/rules/learned/public-complex-function-v1.json")) as RuleSpec;
const LOOP = JSON.parse(read("peaceai/rules/learned/public-loop-function-v1.json")) as RuleSpec;
const files = [{ path: "src/a.ts", content: "export const x = 1;\n" }];
const task = (sig: string, body: string, checks: string, head = "add date function") => `${head} ${sig} to src/a.ts with body:\n${body}\n${checks}`;
const run = (sig: string, body: string, checks: string, spec: RuleSpec = SPEC, head?: string) => {
  const w: { reason?: string } = {};
  const e = applyRule(spec, task(sig, body, checks, head), files, undefined, undefined, w, () => false);
  return { e, r: w.reason };
};

// ---- wiring ----
test("spec: valid, hash pinned, own trigger, types primitive+date only with loops none; approval only with the exact hash", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.kind, "COMPLEX_FUNCTION");
  assert.equal(SPEC.minedFrom, "public");
  assert.equal(SPEC.trigger, DATE_TRIGGER);
  for (const t of [COMPLEX_TRIGGER, LOOP_TRIGGER]) assert.notEqual(DATE_TRIGGER, t);
  assert.equal(SPEC.params.types, "primitive+date");
  assert.deepEqual(SPEC.params.loops, ["none"]);
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, loops: ["for-of-param"] } }), "Date types with loops refused");
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, types: "primitive+object" } }), "unknown types value refused");
  assert.ok(read("peaceai/lib/nlparse.ts").includes("DATE_TRIGGER"));
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string; approval?: { author?: string } }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id)) { assert.equal(r.sha256, SHA); assert.equal(r.approval?.author, "PeaceG03"); }
  const rec = JSON.parse(read("peaceai/rules/proposals/public-date-function-v1.json")) as { status: string; learned: string; evidence: { examples: number; bar: number; repos: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.learned, "peaceai/rules/learned/public-date-function-v1.json");
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.ok(rec.evidence.examples >= rec.evidence.bar && rec.evidence.qualifies);
  assert.equal(rec.evidence.repos, new Set(EV.examples.map((e) => e.repo)).size);
  for (const p of ["peaceai/rules/learned/public-date-function-v1.json", "peaceai/rules/proposals/public-date-function-v1.json", "peaceai/rules/proposals/m74-date-function-evidence.json", "peaceai/test/m74-date-function.test.ts", "peaceai/test/fixtures/m74/x.txt", "peaceai/lib/learned-complex.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});

test("Job A: admitted only with the exact hash; builds once admitted with no dev flag", () => {
  const list = (sha: string, source = "workspace") => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
  assert.equal(admitRules([SPEC], list(SHA, "results"))[0]!.decision, "NOT_APPROVED", "a public spec is never admitted from a Results entry");
  assert.equal(admitRules([SPEC], { ok: true, list: { schema: "peaceai-approved-rules:v1", rules: [] } as never })[0]!.decision, "NOT_APPROVED");
  assert.equal(admitRules([{ ...SPEC, params: { ...SPEC.params, types: "anything" } }], list(SHA))[0]!.decision, "SPEC_INVALID");
  const saved = { c: process.env.PEACEAI_COMPLEX_FUNCTION, d: process.env[DATE_FUNCTION_FLAG] };
  delete process.env.PEACEAI_COMPLEX_FUNCTION; delete process.env[DATE_FUNCTION_FLAG];
  try {
    const { e, r } = run("minutesSinceMidnight(d: Date): number", MSM, '- minutesSinceMidnight(new Date("2026-10-16T05:30:00Z")) is 330');
    assert.ok(e, r);
    assert.match(e!.content, /export function minutesSinceMidnight\(d: Date\): number/);
  } finally {
    if (saved.c !== undefined) process.env.PEACEAI_COMPLEX_FUNCTION = saved.c;
    if (saved.d !== undefined) process.env[DATE_FUNCTION_FLAG] = saved.d;
  }
});

test("dev path: Date types need both PEACEAI_COMPLEX_FUNCTION and PEACEAI_DATE_FUNCTION exactly \"true\"", () => {
  const p = SPEC.params as Record<string, string | string[]>;
  const obj = task("minutesSinceMidnight(d: Date): number", MSM, '- minutesSinceMidnight(new Date("2026-10-16T05:30:00Z")) is 330');
  assert.equal(applyComplexRule(DATE_TRIGGER, p, obj, files, undefined, {}), null);
  assert.equal(applyComplexRule(DATE_TRIGGER, p, obj, files, undefined, { PEACEAI_COMPLEX_FUNCTION: "true" }), null);
  assert.equal(applyComplexRule(DATE_TRIGGER, p, obj, files, undefined, { PEACEAI_COMPLEX_FUNCTION: "true", [DATE_FUNCTION_FLAG]: "1" }), null);
  assert.equal(applyComplexRule(DATE_TRIGGER, p, obj, files, undefined, { [DATE_FUNCTION_FLAG]: "true" }), null);
  assert.ok(applyComplexRule(DATE_TRIGGER, p, obj, files, undefined, { PEACEAI_COMPLEX_FUNCTION: "true", [DATE_FUNCTION_FLAG]: "true" }));
});

// ---- positives (shapes of the real evidence functions) ----
const MSM = "const m = d.getUTCHours() * 60;\nreturn m + d.getUTCMinutes();";
const SOD = "const t = Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());\nreturn new Date(t);";
const ok: [string, string, string, string][] = [
  ["minutesSinceMidnight (amarbayar/event-os)", "minutesSinceMidnight(d: Date): number", MSM, '- minutesSinceMidnight(new Date("2026-10-16T05:30:00Z")) is 330'],
  ["startOfUtcDay (pnp/spfx-copilot-components)", "startOfUtcDay(value: Date): Date", SOD, '- startOfUtcDay(new Date("2026-10-16T05:30:00Z")).toISOString() is "2026-10-16T00:00:00.000Z"'],
  ["utcDate (tradeblocks)", "utcDate(year: number, monthIndex: number, day: number): Date", "const t = Date.UTC(year, monthIndex, day);\nreturn new Date(t);", '- utcDate(2026, 9, 16).toISOString() is "2026-10-16T00:00:00.000Z"'],
  ["isoDate (tradeblocks)", "isoDate(d: Date): string", "const s = d.toISOString();\nreturn s.slice(0, 10);", '- isoDate(new Date("2026-10-16T05:30:00Z")) is "2026-10-16"'],
  ["julianCenturies (ifc-viewx)", "julianCenturies(d: Date): number", "const days = d.getTime() / 86400000 - 10957.5;\nreturn days / 36525;", '- julianCenturies(new Date("2000-01-01T12:00:00Z")) is 0'],
  ["isWeekendUTC (DzenAnalytics, string -> Date local)", "isWeekendUTC(iso: string): boolean", "const d: Date = new Date(iso);\nconst w = d.getUTCDay();\nreturn w === 0 || w === 6;", '- isWeekendUTC("2026-10-17T12:00:00Z") is true\n- isWeekendUTC("2026-10-16T12:00:00Z") is false'],
  ["guard window (if/else)", "inWindow(d: Date): boolean", "const m = d.getUTCHours() * 60 + d.getUTCMinutes();\nif (m >= 312 && m < 375) {\nreturn true;\n}\nreturn m >= 552 && m < 615;", '- inWindow(new Date("2026-10-16T05:30:00Z")) is true'],
];
for (const [name, sig, body, checks] of ok) test(`builds: ${name}`, () => {
  const { e, r } = run(sig, body, checks);
  assert.ok(e, `${name}: ${r}`);
  assert.equal(e!.extra!.length, 1);
  assert.doesNotMatch(e!.content, /__peaceai/, "the reserved rewrite never reaches the written code");
});

// ---- refusals by name ----
const D = "f(d: Date): number";
const C = '- f(new Date("2026-10-16T05:30:00Z")) is 0';
const bad: [string, string, string, string][] = [
  ["getHours (local)", D, "const h = d.getHours();\nreturn h;", DATE_LOCAL_TIME],
  ["getDay (local)", D, "const w = d.getDay();\nreturn w;", DATE_LOCAL_TIME],
  ["getTimezoneOffset", D, "const o = d.getTimezoneOffset();\nreturn o;", DATE_LOCAL_TIME],
  ["toLocaleDateString", "f(d: Date): string", "const s = d.toLocaleDateString();\nreturn s;", DATE_LOCAL_TIME],
  ["toDateString", "f(d: Date): string", "const s = d.toDateString();\nreturn s;", DATE_LOCAL_TIME],
  ["toUTCString", "f(d: Date): string", "const s = d.toUTCString();\nreturn s;", DATE_LOCAL_TIME],
  ["Date.parse", "f(s: string): number", "const t = Date.parse(s);\nreturn t;", DATE_LOCAL_TIME],
  ["new Date(y, m, d) (local fields)", "f(y: number, m: number): Date", "const d = new Date(y, m, 1);\nreturn d;", DATE_LOCAL_TIME],
  ["Date.now", D, "const n = Date.now();\nreturn n - d.getTime();", DATE_NOW],
  ["new Date() (clock)", D, "const n = new Date();\nreturn n.getTime() - d.getTime();", DATE_NOW],
  ["clock wins over local", D, "const h = d.getHours();\nreturn Date.now() + h;", DATE_NOW],
  ["setUTCHours", D, "const t = d.setUTCHours(0);\nreturn t;", DATE_SETTER],
  ["setTime", D, "const t = d.setTime(0);\nreturn t;", DATE_SETTER],
  ["other new", D, "const x = new Map();\nreturn d.getTime();", "body_refused"],
  ["reserved __peaceaiDate", D, "const x = __peaceaiDate(1);\nreturn d.getTime();", "body_refused"],
  ["reserved __peaceaiDateUTC", D, "const x = __peaceaiDateUTC(2026, 0);\nreturn d.getTime();", "body_refused"],
  ["shadowed Date", D, "const Date = 1;\nreturn Date + d.getTime();", "body_refused"],
  ["parameter named Date", "f(Date: number): number", "const x = Date;\nreturn x + 1;", "body_refused"],
  ["Date method not in vocab (valueOf)", D, "const t = d.valueOf();\nreturn t;", "body_refused"],
  ["Date.UTC too many args", D, "const t = Date.UTC(1, 2, 3, 4, 5, 6, 7, 8);\nreturn t + d.getTime();", "body_refused"],
];
for (const [name, sig, body, code] of bad) test(`refused (${code}): ${name}`, () => {
  const { e, r } = run(sig, body, C.replace("f(new Date(\"2026-10-16T05:30:00Z\"))", sig.includes("Date)") ? "f(new Date(\"2026-10-16T05:30:00Z\"))" : sig.startsWith("f(s") ? "f(\"x\")" : "f(1, 2)"));
  assert.equal(e, null, name);
  assert.equal(r, code, name);
});
test("the three date refusals are named refusals (M59 lines)", () => { for (const c of [DATE_LOCAL_TIME, DATE_NOW, DATE_SETTER]) assert.ok(NAMED_REFUSALS.has(c)); });

// ---- isolation ----
test("v1 complex and loop specs keep refusing Date types; the date phrase reaches only the date spec", () => {
  assert.equal(run("minutesSinceMidnight(d: Date): number", MSM, '- minutesSinceMidnight(new Date("2026-10-16T05:30:00Z")) is 330', COMPLEX, "add complex function").e, null);
  assert.equal(run("minutesSinceMidnight(d: Date): number", MSM, '- minutesSinceMidnight(new Date("2026-10-16T05:30:00Z")) is 330', LOOP, "add loop function").e, null);
  assert.equal(run("minutesSinceMidnight(d: Date): number", MSM, '- minutesSinceMidnight(new Date("2026-10-16T05:30:00Z")) is 330', COMPLEX, "add date function").e, null);
  assert.equal(run("twice(n: number): number", "const m = n * 2;\nreturn m;", "- twice(2) is 4", SPEC, "add complex function").e, null, "complex phrase does not reach the date spec");
  assert.ok(run("twice(n: number): number", "const m = n * 2;\nreturn m;", "- twice(2) is 4", COMPLEX, "add complex function").e, "v1 still builds its own tasks");
  assert.equal(run("loopy(d: Date): number", "let t = 0;\nfor (let i = 0; i < 3; i++) {\nt += d.getTime();\n}\nreturn t;", C.replace("f(", "loopy(")).r, "loop_unsupported", "date spec allows no loops");
});

// ---- end to end: real passes, stub and base fail ----
test("e2e: the generated test passes on the function and fails on the stub and on the base", () => {
  const { e, r } = run("startOfUtcDay(value: Date): Date", SOD, '- startOfUtcDay(new Date("2026-10-16T05:30:00Z")).toISOString() is "2026-10-16T00:00:00.000Z"\n- startOfUtcDay(new Date("2026-10-16T23:59:59Z")).getTime() is 1792108800000');
  assert.ok(e, r);
  const dir = mkdtempSync(join(tmpdir(), "m74-")); mkdirSync(join(dir, "src"));
  const testPath = join(dir, e!.extra![0]!.path);
  const tsx = resolve(root, "node_modules/.bin/tsx");
  const passes = (content: string) => { writeFileSync(join(dir, e!.path), content); writeFileSync(testPath, e!.extra![0]!.content); try { execFileSync(tsx, ["--test", testPath], { stdio: "pipe", env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT")), TZ: "Pacific/Kiritimati" } }); return true; } catch { return false; } };
  assert.equal(passes(e!.content), true, "real");
  assert.equal(passes(stubComplexBody(e!.content, "startOfUtcDay")!), false, "stub (epoch)");
  assert.equal(passes(files[0]!.content), false, "base");
});

// ---- evidence replay ----
type Ex = { repo: string; commit: string; path: string; fn: string; line: number; exported: boolean; sha256: string; license: string; licenseSha256: string; fileBlob: string; fixture: string; dateApi: string[]; signature: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m74-date-function-evidence.json")) as { bar: number; manifestSha256: string; examples: Ex[]; pins: { name: string; commit: string; spdx: string; classified: string; licenseFile: string }[] };
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const DATE_API = /^(?:getUTC\w+|getTime|toISOString)$/;
const apiOf = (fn: ts.FunctionDeclaration): string[] => {
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date") out.add(`new Date(${n.arguments?.length ?? 0})`);
    if (ts.isPropertyAccessExpression(n)) {
      if (ts.isIdentifier(n.expression) && n.expression.text === "Date") out.add(`Date.${n.name.text}`);
      else if (DATE_API.test(n.name.text)) out.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(fn.body!);
  return [...out].sort();
};
test("evidence: bar met, every example blob-pinned, Date API replays and stays inside the vocabulary (dateRefusal null)", () => {
  assert.ok(EV.examples.length >= EV.bar);
  assert.equal(new Set(EV.examples.map((e) => `${e.repo}:${e.fn}`)).size, EV.examples.length);
  for (const e of EV.examples) {
    const b = readFileSync(resolve(root, e.fixture));
    assert.ok(b.length <= 65536, e.fixture);
    assert.equal(gitBlob(b), e.fileBlob, e.fixture);
    assert.equal(createHash("sha256").update(b).digest("hex"), e.sha256);
    assert.ok(e.fixture.endsWith(`${e.repo.replace("/", "__")}-${e.fileBlob.slice(0, 12)}.txt`));
    assert.match(e.commit, /^[0-9a-f]{40}$/);
    const sf = ts.createSourceFile("f.ts", b.toString("utf8"), ts.ScriptTarget.Latest, true);
    const fn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === e.fn && sf.getLineAndCharacterOfPosition(s.getStart(sf)).line + 1 === e.line);
    assert.ok(fn?.body, `${e.fn} in ${e.fixture}`);
    assert.equal((ts.getModifiers(fn!) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword), e.exported, e.fn);
    assert.ok(!(ts.getModifiers(fn!) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) && !fn!.asteriskToken, e.fn);
    assert.deepEqual(apiOf(fn!), [...e.dateApi].sort(), e.fn);
    assert.ok(e.dateApi.every((x) => x === "new Date(1)" || x === "Date.UTC" || DATE_API.test(x)), e.fn);
    assert.equal(dateRefusal(fn!.body!), null, e.fn);
    const sig = `(${fn!.parameters.map((p) => p.type!.getText(sf)).join(", ")}): ${fn!.type!.getText(sf)}`;
    assert.equal(sig, e.signature, e.fn);
    assert.ok(sig.includes("Date") || e.dateApi.includes("new Date(1)"), `${e.fn} uses Date`);
  }
});
test("evidence: permissive licenses by hash only; no LICENSE text committed; fixtures dir holds exactly the evidence fixtures", () => {
  for (const e of EV.examples) {
    const pin = EV.pins.find((p) => p.name === e.repo)!;
    assert.ok(pin, e.repo); assert.equal(pin.commit, e.commit);
    assert.ok(["MIT", "Apache-2.0"].includes(pin.classified), `${e.repo}: ${pin.classified}`);
    assert.equal(e.license, pin.spdx === "NOASSERTION" ? e.license : pin.spdx);
    assert.match(e.licenseSha256, /^[0-9a-f]{64}$/);
  }
  const listed = new Set(EV.examples.map((e) => e.fixture.split("/").pop()));
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m74"));
  for (const f of have) { assert.ok(listed.has(f), f); assert.ok(!/licen[cs]e/i.test(f)); }
  assert.equal(have.length, listed.size);
});
test("evidence: no overlap with the training corpus or the current ext-manifest; none from Peace's repos", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  assert.ok(repos.has("PeaceG03/PeaceSTOCKS"));
  for (const e of EV.examples) { assert.ok(!repos.has(e.repo), e.repo); assert.ok(!shas.has(e.sha256), e.path); assert.ok(!e.repo.startsWith("PeaceG03/")); }
});

// ---- proposal ----
test("phrasing and proposal body: date branch, marker and spec block pin the exact hash", () => {
  assert.ok(isDateSpec(SPEC)); assert.ok(!isDateSpec(COMPLEX)); assert.ok(!isDateSpec(LOOP));
  assert.match(phrasingFor(SPEC), /^add date function/);
  assert.doesNotMatch(phrasingFor(COMPLEX), /date function/);
  const body = proposalBody({ spec: SPEC, sha256: SHA, stats: { shape: "COMPLEX_FUNCTION" as never, covered: null, hunks: 10, commits: 8, files: 8, examples: [], styles: {} } }, []);
  assert.deepEqual(parseMarker(body), { id: SPEC.id, sha256: SHA, source: "public" });
  assert.equal(specHash(parseSpecBlock(body) as RuleSpec), SHA);
  for (const c of [DATE_LOCAL_TIME, DATE_NOW, DATE_SETTER]) assert.ok(body.includes(c), c);
  assert.doesNotMatch(body, /Every loop form is refused/);
});
