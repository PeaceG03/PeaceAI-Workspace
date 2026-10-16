// M66 wiring: IMPORT_EDIT v2 (kind IMPORT_EDIT_V2, public-import-edit-v2) in Job A's rule step, admitted only via the
// hash-pinned approved list; the dev path (applyImportEditV2Rule) needs PEACEAI_IMPORT_EDIT_V2 exactly "true".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { applyImportEditV2Rule, IMPORT_EDIT_V2_FLAG, IMPORT_EDIT_V2_TRIGGER } from "../lib/import-edit-v2.ts";
import { applyRule, specFileText, specHash, TRIGGERS, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { isCanonical, parseTask } from "../lib/nlparse.ts";
import { phrasingFor, proposalBody, parseMarker, parseSpecBlock } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC_TEXT = read("peaceai/rules/learned/public-import-edit-v2.json");
const SPEC = JSON.parse(SPEC_TEXT) as RuleSpec;
const SHA = "b3468ea4331af00c37ab0d2ed19cff0f1d351466a5229948d1776bffcf6c4a85";
const HIST = 'import { isTransientHistoryError as _isT, BACKOFF_MS as _B } from "./tenmin-history.ts";\nimport { readFileSync } from "node:fs";\nimport type { Bar } from "./bars";\nexport const k = (b: Bar) => [_isT, _B, readFileSync, b];\n';
const files = [{ path: "src/m.ts", content: HIST }, { path: "src/tenmin-history.ts", content: "export const BACKOFF_MS = 1;\n" }, { path: "src/bars.ts", content: "export type Bar = number;\n" }, { path: "peaceai/lib/gate.ts", content: "" }];
const job = (objective: string, fs = files) => { const w: { reason?: string } = {}; const e = applyRule(SPEC, objective, fs, undefined, undefined, w, () => false); return { e, r: w.reason }; };
const DROP_EXT = 'change import of `./tenmin-history.ts` in `src/m.ts` to: `import { isTransientHistoryError as _isT, BACKOFF_MS as _B } from "./tenmin-history";`';

test("spec file: canonical, valid, the exact hash, IMPORT_EDIT_V2 trigger", () => {
  assert.equal(SPEC_TEXT, specFileText(SPEC));
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.kind, "IMPORT_EDIT_V2");
  assert.equal(SPEC.trigger, TRIGGERS.IMPORT_EDIT_V2);
  assert.equal(SPEC.trigger, IMPORT_EDIT_V2_TRIGGER);
  assert.equal(validateSpec({ ...SPEC, params: { ...SPEC.params, grading: "self" } }), false, "params outside the vocabulary");
  assert.equal(validateSpec({ ...SPEC, minedFrom: "core" }), false, "public-mined only");
  const ev = JSON.parse(read("peaceai/rules/proposals/m56-import-edit-v2-evidence.json"));
  assert.equal(SPEC.evidence.hunks, ev.examples.length);
});

test("Job A: admitted only with the exact hash; builds once admitted with no dev flag", () => {
  const list = (sha: string) => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source: "workspace" }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
  assert.equal(admitRules([SPEC], { ok: true, list: { schema: "peaceai-approved-rules:v1", rules: [] } as never })[0]!.decision, "NOT_APPROVED");
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  const entry = onMain.rules.find((r) => r.id === SPEC.id);
  assert.ok(!entry || entry.sha256 === SHA, "approved only by Peace /approve-rule, and then with this exact hash");
  const saved = process.env[IMPORT_EDIT_V2_FLAG];
  delete process.env[IMPORT_EDIT_V2_FLAG];
  try {
    const { e, r } = job(DROP_EXT);
    assert.ok(e, r);
    assert.equal(e!.path, "src/m.ts");
    assert.equal(e!.content, HIST.replace('"./tenmin-history.ts"', '"./tenmin-history"'), "extension-only fix (builder-log seq 6 shape); every other byte the same");
    assert.equal(e!.extra, undefined, "no new test file");
    assert.equal(e!.selfGrade, undefined, "graded by the target's own checks");
  } finally {
    if (saved !== undefined) process.env[IMPORT_EDIT_V2_FLAG] = saved;
  }
});

test("Job A: names, type flips and node: toggles build; everything else is refused by name", () => {
  const F2 = [{ ...files[0]!, content: HIST.replace("(b: Bar)", "(b: Bar, c?: Baz)") }, ...files.slice(1)];
  assert.ok(job('change import of `./bars` in `src/m.ts` to: `import type { Bar, Baz } from "./bars";`', F2).e, "add a used name");
  assert.ok(job('change import of node:fs in src/m.ts to: import { readFileSync } from "fs";').e, "node: toggle");
  assert.ok(job('change import of `./bars` in `src/m.ts` to: `import { type Bar } from "./bars";`').e, "type modifier moves into the braces");
  const refusals: [string, RegExp, typeof files?][] = [
    ['change import of `node:fs` in `src/m.ts` to: `import { readFileSync } from "fs-extra";`', /^import_edit_bare_package$/],
    ['change import of `./bars` in `src/m.ts` to: `import type { Bar } from "lodash";`', /^import_edit_relative_bare_swap$/],
    ['change import of `./bars` in `src/m.ts` to: `import type { Bar } from "./nope";`', /^import_edit_module_changed$/],
    ['change import of `./bars` in `src/m.ts` to: `import type { Bar, Baz } from "./bars";`', /^import_edit_added_unused: Baz$/],
    ['change import of `./bars` in `src/m.ts` to: `import type {Bar} from "./bars";`', /^import_edit_formatting_only$/],
    ['change import of `node:fs` in `src/m.ts` to: `import { readFileSync, statSync } from "node:fs";`', /^import_edit_specifier_not_plain$/], // engine (M56): a kept `node:` specifier is not a plain bare name
    ['change import of `node:path` in `src/m.ts` to: `import { join } from "node:path";`', /^import_not_found$/],
    ['change import of `node:fs` in `src/m.ts` to: `import { readFileSync } from "node:fs"; export const z = 1;`', /^new_import_unparsed$/],
    ['change import of `./bars` in `src/m.ts` to: `import type { Bar } from "./bars" with { type: "json" };`', /^(new_import_unparsed|import_edit_attributes)$/],
    ['change import of `node:fs` in `src/missing.ts` to: `import { readFileSync } from "fs";`', /^target_missing$/],
    ['change import of `node:fs` in `peaceai/lib/gate.ts` to: `import { readFileSync } from "fs";`', /^protected_path$/],
    ['change import of `node:fs` in `src/../m.ts` to: `import { readFileSync } from "fs";`', /^path_not_plain$/],
    ["add a helper", /^task_unparsed$/],
  ];
  for (const [t, re] of refusals) { const { e, r } = job(t); assert.equal(e, null, t); assert.match(r ?? "", re, t); }
  const twice = [{ path: "src/m.ts", content: 'import type { A } from "./x";\nimport type { B } from "./x";\nexport const k = (c: C) => c;\n' }, { path: "src/x.ts", content: "" }];
  assert.equal(job('change import of `./x` in `src/m.ts` to: `import type { C } from "./x.ts";`', twice).r, "import_not_unique", "both imports would give a valid edit: ambiguous");
  const pair = [{ path: "src/m.ts", content: 'import type { A } from "./x";\nimport { b } from "./x";\nexport const k = (a: A) => [a, b, c];\n' }, { path: "src/x.ts", content: "" }];
  const one = job('change import of `./x` in `src/m.ts` to: `import { b, c } from "./x";`', pair);
  assert.ok(one.e, one.r);
  assert.match(one.e!.content, /^import type \{ A \} from "\.\/x";\nimport \{ b, c \} from "\.\/x";\n/, "exactly one of two same-specifier imports gives a valid edit");
});

test("Auditor #226: an added name may not shadow a local declaration or a global; a directory move may not switch modules", () => {
  const base = (body: string) => [{ path: "src/m.ts", content: `import { a } from "./x";\n${body}\n` }, { path: "src/x.ts", content: "" }, { path: "src/evil/x.ts", content: "" }];
  const cases: [string, string, RegExp][] = [
    ["export const k = a + setTimeout(() => 0, 1);", "import { a, setTimeout } from \"./x\";", /^import_edit_shadows_global: setTimeout$/],
    ["export const k = a + Number(fetch);", "import { a, fetch } from \"./x\";", /^import_edit_shadows_global: fetch$/],
    ["const b = 1;\nexport const k = a + b;", "import { a, b } from \"./x\";", /^import_edit_shadows_local: b$/],
    ["export function f(b: number) { return a + b; }", "import { a, b } from \"./x\";", /^import_edit_shadows_local: b$/],
    ["export function f() { const { b } = { b: 1 }; return a + b; }", "import { a, b } from \"./x\";", /^import_edit_shadows_local: b$/],
    ["export function b() { return a; }", "import { a, b } from \"./x\";", /^import_edit_shadows_local: b$/],
    ["type B = number;\nexport const k: B = a;", "import { a, type B } from \"./x\";", /^import_edit_shadows_local: B$/],
    ["try { a(); } catch (b) { void b; }", "import { a, b } from \"./x\";", /^import_edit_shadows_local: b$/],
    ["export const k = a;", "import { a } from \"./evil/x\";", /^import_edit_different_target$/],
  ];
  for (const [body, to, re] of cases) {
    const { e, r } = job(`change import of \`./x\` in \`src/m.ts\` to: \`${to}\``, base(body));
    assert.equal(e, null, to); assert.match(r ?? "", re, `${body} | ${to}: ${r}`);
  }
  const moved = [{ path: "src/m.ts", content: 'import { a } from "./x";\nexport const k = a;\n' }, { path: "src/evil/x.ts", content: "" }];
  assert.ok(job('change import of `./x` in `src/m.ts` to: `import { a } from "./evil/x";`', moved).e, "allowed once ./x no longer resolves");
  const ok = job('change import of `./x` in `src/m.ts` to: `import { a, b } from "./x";`', base("export const k = a + b;"));
  assert.ok(ok.e, ok.r);
});

test("Auditor #226: an extension-only change may not switch to a different file; DOM type globals are not shadowed", () => {
  const run = (spec: string, to: string, tree: string[], use = "a") => job(`change import of \`${spec}\` in \`src/m.ts\` to: \`import { ${use} } from "${to}";\``, [{ path: "src/m.ts", content: `import { a } from "${spec}";\nexport const k = ${use === "a" ? "a" : `[a, ${use.split(", ")[1]}]`};\n` }, ...tree.map((p) => ({ path: p, content: "" }))]);
  const bad: [string, string, string[]][] = [
    ["./x", "./x.tsx", ["src/x.ts", "src/x.tsx"]],
    ["./x.ts", "./x.js", ["src/x.ts", "src/x.js"]],
    ["./x", "./x.js", ["src/x/index.ts", "src/x.js"]],
  ];
  for (const [from, to, tree] of bad) assert.equal(run(from, to, tree).r, "import_edit_different_target", `${from} -> ${to} with ${tree}`);
  const good: [string, string, string[]][] = [
    ["./x", "./x.ts", ["src/x.ts", "src/x.tsx"]],
    ["./x.ts", "./x", ["src/x.ts", "src/x.js"]],
    ["./x.tsx", "./x", ["src/x.tsx"]],
    ["./x.js", "./x", ["src/x.ts"]],
    ["./x.ts", "./x.js", ["src/x.ts"]],
    ["./old/x", "./x", ["src/x.ts"]],
  ];
  for (const [from, to, tree] of good) { const { e, r } = run(from, to, tree); assert.ok(e, `${from} -> ${to} with ${tree}: ${r}`); }
  for (const g of ["HTMLElement", "HTMLInputElement", "SVGPathElement", "Element", "KeyboardEvent", "MutationObserver", "localStorage"])
    assert.match(run("./x", "./x", ["src/x.ts"], `a, ${g}`).r ?? "", new RegExp(`^import_edit_shadows_global: ${g}$`), g);
});

test("evidence: every single-line m56 example rebuilds through the task phrase to its real after-file", () => {
  const ev = JSON.parse(read("peaceai/rules/proposals/m56-import-edit-v2-evidence.json"));
  let n = 0;
  for (const x of ev.examples as { shape: string; path: string; before?: string; after?: string; beforeFixture: string; afterFixture: string; repoFiles: string[] }[]) {
    if (x.shape !== "single-line" || !x.before || !x.after) continue;
    const spec = /from\s+['"]([^'"]+)['"]/.exec(x.before)?.[1];
    if (!spec) continue;
    const before = readFileSync(join(root, "peaceai/test/fixtures/m56", x.beforeFixture), "utf8");
    const after = readFileSync(join(root, "peaceai/test/fixtures/m56", x.afterFixture), "utf8");
    const fs = [{ path: x.path, content: before }, ...x.repoFiles.filter((p) => p !== x.path).map((p) => ({ path: p, content: "" }))];
    const to = x.after.trim().replace(/;$/, "");
    const { e, r } = job(`change import of \`${spec}\` in \`${x.path}\` to: \`${to}\``, fs);
    if (!/\.(ts|mts|tsx)$/.test(x.path)) continue;
    assert.ok(e, `${x.path}: ${r}`);
    assert.equal(e!.content, after, x.path);
    n++;
  }
  assert.ok(n >= 10, `at least the 10-example bar rebuilds through the phrase (got ${n})`);
});

test("dev path: needs PEACEAI_IMPORT_EDIT_V2 exactly \"true\"", () => {
  const p = SPEC.params as Record<string, string | string[]>;
  assert.equal(applyImportEditV2Rule(SPEC.trigger, p, DROP_EXT, files, {}), null);
  assert.equal(applyImportEditV2Rule(SPEC.trigger, p, DROP_EXT, files, { [IMPORT_EDIT_V2_FLAG]: "1" }), null);
  assert.ok(applyImportEditV2Rule(SPEC.trigger, p, DROP_EXT, files, { [IMPORT_EDIT_V2_FLAG]: "true" }));
});

test("nlparse: the phrase is canonical and maps to IMPORT_EDIT_V2", () => {
  assert.ok(isCanonical(DROP_EXT));
  const r = parseTask({ title: "", body: DROP_EXT }, { model: null, approvedKinds: new Set(["IMPORT_EDIT_V2"]) });
  assert.ok(r.status === "parsed" || r.status === "canonical", r.status);
});

test("proposal: phrasing, description, marker and spec block carry the exact hash", () => {
  assert.match(phrasingFor(SPEC), /^change import of/);
  const body = proposalBody({ spec: SPEC, sha256: SHA, stats: { shape: "IMPORT_EDIT" as never, covered: null, hunks: 25, commits: 25, files: 23, examples: [], styles: {} } }, []);
  assert.deepEqual(parseMarker(body), { id: SPEC.id, sha256: SHA, source: "public" });
  assert.equal(specHash(parseSpecBlock(body) as RuleSpec), SHA);
  assert.match(body, /never introduced or swapped/);
});

test("wiring proofs and the learned spec are protected", () => {
  for (const p of ["peaceai/test/m66-import-edit-v2-wiring.test.ts", "peaceai/rules/learned/public-import-edit-v2.json", "peaceai/lib/import-edit-v2.ts"])
    assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});

test("Architect (#239): every v2 refusal maps to a sanitizer-safe short code that survives the refusal line", async () => {
  const { importEditV2Code } = await import("../lib/import-edit-v2.ts");
  const { formatRefusals } = await import("../lib/refusal-reason.ts");
  const cases: [string, string][] = [
    ["a bare package may not be introduced or swapped", "import_edit_bare_package"],
    ["specifier resolves to a different file than before", "import_edit_different_target"],
    ["added binding shadows a global: setTimeout", "import_edit_shadows_global: setTimeout"],
    ["added binding shadows a local declaration: b", "import_edit_shadows_local: b"],
    ["added binding already bound: b", "import_edit_already_bound: b"],
    ["removed binding still used: readFileSync", "import_edit_removed_still_used: readFileSync"],
    ["specifier must keep its module (extension or directory move only)", "import_edit_module_changed"],
    ["something new", "import_edit_refused"],
  ];
  for (const [problem, code] of cases) {
    assert.equal(importEditV2Code(problem), code, problem);
    assert.equal(formatRefusals([{ id: "public-import-edit-v2", reason: code }]), `public-import-edit-v2=${code}`, `${code} survives sanitizing`);
  }
});
