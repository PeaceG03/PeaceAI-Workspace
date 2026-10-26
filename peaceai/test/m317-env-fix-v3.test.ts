// M317 public-env-fix-v3 (helper-name extraction): the change adds a NAMED exported helper the landed tests import.
// The name comes from the task (`... via \`name\``) or, failing that, from the file's own env-parsing siblings
// (lib/env-fix.ts siblingHelperName); otherwise strictNAME as before. v1/v2 are unchanged (no `name` param).
// All fixtures are SYNTHETIC with neutral names: no measurement row id, helper name or file path appears here or in
// the engine (Auditor condition 1). The HELD-OUT cases were written before the engine
// ran on them; the held-out NEGATIVE is a similar-shaped case that must not be credited (Auditor condition 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { ENV_FIX_TRIGGER, ENV_FIX_TRIGGER_V3, parseEnvFixTask, siblingHelperName } from "../lib/env-fix.ts";

const dir = join(import.meta.dirname, "..", "rules");
const spec = (id: string) => JSON.parse(readFileSync(join(dir, "learned", `${id}.json`), "utf8")) as RuleSpec;
const V3 = spec("public-env-fix-v3"), V2 = spec("public-env-fix-v2"), V1 = spec("public-env-fix-v1");
const run = (s: RuleSpec, task: string, content: string, path = "src/a.ts") => { const why: { reason?: string } = {}; const e = applyRule(s, task, [{ path, content }], undefined, undefined, why, () => false); return { e, r: why.reason }; };
const flag = (name: string, file = "src/a.ts", via = "") => `make env \`${name}\` strict in \`${file}\` as a flag${via ? ` via \`${via}\`` : ""}`;
const int = (name: string, max: number, file = "src/a.ts", via = "") => `make env \`${name}\` strict in \`${file}\` as an integer 1..${max}${via ? ` via \`${via}\`` : ""}`;
/** Load the edited module (TypeScript -> JS) and return its exports, so the helper is checked by behaviour. */
const load = async (src: string) => import(`data:text/javascript,${encodeURIComponent(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)}`);

test("v3 spec validates with the new `name` param; v1/v2 keep their params (and hashes) and reject unknown names", () => {
  assert.ok(validateSpec(V3));
  assert.equal((V3.params as Record<string, string>).name, "task-or-sibling-convention");
  assert.equal(V3.trigger, ENV_FIX_TRIGGER_V3);
  for (const s of [V1, V2]) { assert.ok(validateSpec(s)); assert.equal("name" in (s.params as object), false); }
  assert.ok(!validateSpec({ ...V3, params: { ...(V3.params as object), name: "anything" } }));
  assert.ok(!validateSpec({ ...V3, params: { ...(V3.params as object), name: ["task-or-sibling-convention"] } }));
  assert.notEqual(specHash(V3), specHash(V2));
});

test("v3 trigger is a superset of v2: the v2 phrases parse the same; `via` names the helper", () => {
  for (const t of [flag("A_B"), int("A_B", 5), "make the environment variable A_B strict in src/x/y.ts as integer 1..9."]) {
    assert.deepEqual(parseEnvFixTask(ENV_FIX_TRIGGER_V3, t), parseEnvFixTask(ENV_FIX_TRIGGER, t), t);
  }
  assert.equal(parseEnvFixTask(ENV_FIX_TRIGGER_V3, flag("A_B", "src/a.ts", "fooBar"))!.helper, "fooBar");
  assert.equal(parseEnvFixTask(ENV_FIX_TRIGGER_V3, "make env A_B strict in src/a.ts as a flag via helper fooBar.")!.helper, "fooBar");
  assert.equal(parseEnvFixTask(ENV_FIX_TRIGGER, flag("A_B", "src/a.ts", "fooBar")), null, "v1/v2 do not accept `via`");
});

// Tie-break: two siblings, one keeps the MYAPP_ namespace, one drops it (1-1); fewer dropped tokens wins.
const T1 = [
  "export const MYAPP_DEFAULT_WINDOW_MS = 90000;",
  "export function parseMyAppRegion(input: string | undefined): string { return input?.trim() || \"eu\"; }",
  "export function parseShardCount(input: string | undefined): number { return Number(input ?? \"1\"); }",
  "export function main(): number {",
  "  const region = parseMyAppRegion(process.env.MYAPP_REGION);",
  "  const shards = parseShardCount(process.env.MYAPP_SHARD_COUNT);",
  "  const windowMs = Number(process.env.MYAPP_WINDOW_MS) > 0 ? Number(process.env.MYAPP_WINDOW_MS) : MYAPP_DEFAULT_WINDOW_MS;",
  "  return windowMs + shards + region.length;",
  "}",
  "",
].join("\n");

test("int: sibling convention names the exported helper (parseMyAppWindowMs); value table holds; v2 unchanged", async () => {
  const { e, r } = run(V3, int("MYAPP_WINDOW_MS", 3600000), T1);
  assert.ok(e, r);
  assert.ok(e!.content.includes("const windowMs = parseMyAppWindowMs(process.env.MYAPP_WINDOW_MS);"));
  assert.match(e!.content, /export function parseMyAppWindowMs\(value: string \| undefined\): number/);
  const m = await load(e!.content);
  assert.equal(m.parseMyAppWindowMs(undefined), 90000);
  assert.equal(m.parseMyAppWindowMs("  "), 90000);
  assert.equal(m.parseMyAppWindowMs(" 60000 "), 60000);
  assert.equal(m.parseMyAppWindowMs("3600000"), 3600000);
  for (const bad of ["Infinity", "1e12", "0x10", "0", "-5", "1.5", "3600001", "abc"]) assert.throws(() => m.parseMyAppWindowMs(bad), /MYAPP_WINDOW_MS_INVALID/, bad);
  assert.ok(run(V2, int("MYAPP_WINDOW_MS", 3600000), T1).e!.content.includes("strictMyappWindowMs(process.env.MYAPP_WINDOW_MS)"));
});

// No declared env sibling: v3 abstains -> strictNAME; the task can name the helper instead.
const F1 = "export function a(): boolean {\n  if (process.env.JOB_SKIP_UPLOAD === \"1\") return true;\n  return false;\n}\nexport function c(env: NodeJS.ProcessEnv, s: number): boolean {\n  return s > 0 && env.JOB_SKIP_UPLOAD !== \"1\";\n}\n";
test("flag: no sibling -> strictNAME (abstain); `via \\`skipUpload\\`` in the task names the exported helper", async () => {
  assert.ok(run(V3, flag("JOB_SKIP_UPLOAD"), F1).e!.content.includes("strictJobSkipUpload(process.env.JOB_SKIP_UPLOAD)"));
  const { e, r } = run(V3, flag("JOB_SKIP_UPLOAD", "src/a.ts", "skipUpload"), F1);
  assert.ok(e, r);
  assert.ok(e!.content.includes("!skipUpload(env.JOB_SKIP_UPLOAD)"));
  assert.match(e!.extra![0]!.content, /import \{ skipUpload \} from "\.\/a";/);
  const m = await load(e!.content);
  assert.equal(m.skipUpload(" 1 "), true);
  for (const bad of ["true", "yes", "TRUE", "2", "on"]) assert.throws(() => m.skipUpload(bad), /JOB_SKIP_UPLOAD_INVALID/, bad);
});

// ---------------- HELD-OUT (not tuned on; written before the engine ran on them) ----------------
test("held-out A: `read` prefix keeping the APP_ namespace -> readAppRetryLimit (int, Number(X) || D)", async () => {
  const src = "function readAppWorkerCount(v: string | undefined): number { return Number(v ?? \"4\"); }\nexport const workers = readAppWorkerCount(process.env.APP_WORKER_COUNT);\nexport const retries = Number(process.env.APP_RETRY_LIMIT) || 3;\n";
  const { e, r } = run(V3, int("APP_RETRY_LIMIT", 50), src);
  assert.ok(e, r);
  assert.ok(e!.content.includes("export const retries = readAppRetryLimit(process.env.APP_RETRY_LIMIT);"));
  const m = await load(e!.content);
  assert.equal(m.readAppRetryLimit(undefined), 3);
  assert.throws(() => m.readAppRetryLimit("51"), /APP_RETRY_LIMIT_INVALID/);
});
test("held-out B: two `load` siblings that drop SVC_ -> loadDebugLog (flag, env[\"X\"] reads)", () => {
  const src = "function loadTimeoutMs(v?: string) { return Number(v); }\nfunction loadPort(v?: string) { return Number(v); }\nexport function cfg(env: NodeJS.ProcessEnv) {\n  return { t: loadTimeoutMs(env.SVC_TIMEOUT_MS), p: loadPort(env[\"SVC_PORT\"]), d: env[\"SVC_DEBUG_LOG\"] === \"1\" };\n}\n";
  const { e, r } = run(V3, flag("SVC_DEBUG_LOG"), src);
  assert.ok(e, r);
  assert.ok(e!.content.includes("d: loadDebugLog(env[\"SVC_DEBUG_LOG\"])"));
});
test("held-out C: empty prefix sibling (queueDepth <- WORKER_QUEUE_DEPTH) -> dryRun for WORKER_DRY_RUN", () => {
  assert.equal(siblingHelperName("WORKER_DRY_RUN", "function queueDepth(v: string | undefined) { return Number(v); }\nexport const q = queueDepth(process.env.WORKER_QUEUE_DEPTH);\n"), "dryRun");
});

// ---------------- negatives ----------------
test("siblingHelperName abstains: no sibling, imported sibling, other namespace, tie, sibling on NAME itself, non-env arg", () => {
  assert.equal(siblingHelperName("A_B", "export const x = process.env.A_B === \"1\";\n"), null);
  assert.equal(siblingHelperName("APP_X", "import { parseAppY } from \"./p\";\nexport const y = parseAppY(process.env.APP_Y);\n"), null, "imported, not declared here");
  assert.equal(siblingHelperName("APP_X", "function parseY(v?: string) { return v; }\nexport const y = parseY(process.env.OTHER_Y);\n"), null, "dropped namespace OTHER_ != APP_");
  assert.equal(siblingHelperName("APP_X", "function parseAppY(v?: string) { return v; }\nfunction readAppZ(v?: string) { return v; }\nexport const y = [parseAppY(process.env.APP_Y), readAppZ(process.env.APP_Z)];\n"), null, "tie between prefixes");
  assert.equal(siblingHelperName("APP_X", "function parseAppX(v?: string) { return v; }\nexport const y = parseAppX(process.env.APP_X);\n"), null, "a call on NAME itself is not a sibling");
  assert.equal(siblingHelperName("APP_X", "function parseAppY(v?: string) { return v; }\nexport const y = parseAppY(\"1\");\n"), null);
  assert.equal(siblingHelperName("APP_X", "function weird(v?: string) { return v; }\nexport const y = weird(process.env.APP_Y);\n"), null, "name does not spell Y");
});
test("majority beats the tie-break: two siblings dropping APP_ outvote one keeping it", () => {
  const src = "function parseAppA(v?: string) { return v; }\nfunction parseB(v?: string) { return v; }\nfunction parseC(v?: string) { return v; }\nexport const y = [parseAppA(process.env.APP_A), parseB(process.env.APP_B), parseC(process.env.APP_C)];\n";
  assert.equal(siblingHelperName("APP_MAX_N", src), "parseMaxN");
});
const bad: [string, string, string, string][] = [
  ["task helper upper-case", flag("FOO", "src/a.ts", "FooBar"), "export const a = process.env.FOO === \"1\";\n", "env_fix_bad_helper"],
  ["task helper reserved", flag("FOO", "src/a.ts", "default"), "export const a = process.env.FOO === \"1\";\n", "env_fix_bad_helper"],
  ["task helper taken", flag("FOO", "src/a.ts", "isFoo"), "export const a = process.env.FOO === \"1\";\nexport const isFoo = 1;\n", "env_fix_helper_taken"],
  ["derived helper taken", flag("APP_X"), "function parseAppY(v?: string) { return v; }\nexport const y = parseAppY(process.env.APP_Y);\nexport const z = process.env.APP_X === \"1\";\nconst parseAppX = 0;\n", "env_fix_helper_taken"],
  ["named helper does not rescue a mixed read", flag("FOO", "src/a.ts", "isFoo"), "export const a = process.env.FOO === \"1\";\nexport const b = process.env.FOO;\n", "env_fix_mixed_reads"],
  ["two trigger lines (multi-step stays out of scope)", `${flag("FOO")}\n${flag("BAR")}`, "export const a = process.env.FOO === \"1\";\n", "task_unparsed"],
];
for (const [name, task, src, code] of bad) test(`v3 refused (${code}): ${name}`, () => {
  const { e, r } = run(V3, task, src);
  assert.equal(e, null);
  assert.equal(r, code);
});
test("v2 refuses the `via` phrase (task_unparsed): the new phrase is v3-only", () => {
  assert.equal(run(V2, flag("FOO", "src/a.ts", "isFoo"), "export const a = process.env.FOO === \"1\";\n").r, "task_unparsed");
});

// HELD-OUT NEGATIVE (Auditor condition 2): same shape as a credited case (one ternary int read, an env-parsing
// sibling in the file) but the sibling's dropped namespace differs from NAME's, so no convention applies. The
// change must fall back to strictNAME and must NOT be credited by a landed-style test that imports a guessed name.
test("held-out negative: similar shape, foreign-namespace sibling -> strictNAME; a landed-style import of readCacheTtlMs is not credited", async () => {
  const src = "export const DEF_TTL = 60000;\nfunction readPoolSize(v: string | undefined): number { return Number(v ?? \"2\"); }\nexport const pool = readPoolSize(process.env.DB_POOL_SIZE);\nexport const ttl = () => Number(process.env.CACHE_TTL_MS) > 0 ? Number(process.env.CACHE_TTL_MS) : DEF_TTL;\n";
  assert.equal(siblingHelperName("CACHE_TTL_MS", src), null);
  const { e, r } = run(V3, int("CACHE_TTL_MS", 86400000), src);
  assert.ok(e, r);
  assert.ok(e!.content.includes("strictCacheTtlMs(process.env.CACHE_TTL_MS)"));
  const m = await load(e!.content);
  assert.equal(typeof m.readCacheTtlMs, "undefined", "a test importing readCacheTtlMs would fail: not credited");
  assert.equal(typeof m.strictCacheTtlMs, "function");
});
