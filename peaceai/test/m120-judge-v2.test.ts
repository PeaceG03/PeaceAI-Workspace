// Judge set v2 (Auditor, after #549): the v1 judge items are re-labelled on wider held-out grids from each upstream
// function's own behaviour (peaceai/lib/judge-grid.ts), identity-indistinguishable items are dropped, and
// peace-lm-judge-v2.yml lands the result under a NEW Results path only. Synthetic, self-written functions only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { build, SOURCES_SCHEMA } from "../bin/judge-v2-build.ts";
import { cartesian, describedNumbers, exprRunner, functionText, literalsOf, minerGrid, paramsOfContext, rebuildItem, runner, trainSlice, validOut, wideDomains, type JParam, type JType, type JV } from "../lib/judge-grid.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const H = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const WF = read(".github/workflows/peace-lm-judge-v2.yml");
const PIN = JSON.parse(read("peaceai/model/judge-v2.json"));
const SRC = JSON.parse(read("peaceai/model/judge-v2-sources.json"));
const CFG = JSON.parse(read("peaceai/model/lm-retrain.json"));

/** The v1 held-out counts the miner would have recorded for this function and derived program. */
function v1Counts(params: JParam[], ret: JType, described: number[], up: (a: readonly JV[]) => unknown, d: (a: readonly JV[]) => unknown) {
  const rows = minerGrid(params, described).map((a) => ({ args: a, out: up(a) }));
  assert.ok(rows.every((r) => validOut(r.out, ret)));
  const tk = new Set(trainSlice(rows).map((r) => JSON.stringify(r.args)));
  const held = rows.filter((r) => !tk.has(JSON.stringify(r.args)));
  const right = held.filter((r) => d(r.args) === r.out).length;
  return { heldRight: right, heldWrong: held.length - right };
}
const S = (name: string): JParam => ({ name, type: "string" });
const N = (name: string): JParam => ({ name, type: "number" });

test("judge v2: the miner's grid rules are kept (described constants, domains, thinning, training slice)", () => {
  assert.deepEqual(describedNumbers("pads to 8 chars, max 255; v1.5 and x2 are not counts"), [8, 255]);
  assert.deepEqual(minerGrid([N("n")], [8]).map((r) => r[0]), [-1, 0, 1, 2, 3, 5, 7, 8, 9, 10, 100]);
  assert.equal(minerGrid([S("a"), S("b")], []).length, 121);
  assert.ok(cartesian([[...Array(100).keys()], [...Array(100).keys()]]).length <= 3000);
  assert.deepEqual(trainSlice([...Array(60).keys()]), [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39]);
  assert.equal(validOut('a"b', "string"), false);
  assert.equal(validOut(2 ** 60, "number"), false);
  assert.equal(validOut("1", "number"), false);
});

test("judge v2: the wide grid adds the function's own literals and text around them", () => {
  const lit = literalsOf('function f(s: string): string { return s.startsWith("0x") ? s.slice(2) : s.length > 64 ? `big` : s; }');
  assert.deepEqual(lit, { numbers: [2, 64], strings: ["0x", "big"] });
  const [strs] = wideDomains([S("s")], [], 'function f(s: string): string { return s.startsWith("0x") ? s.slice(2) : s; }');
  for (const v of ["0x", "0xabc", "abc0x", "x0xy", "0X", "2", "Hello"]) assert.ok(strs!.includes(v), v);
  const [nums] = wideDomains([N("n")], [], "function f(n: number): number { return Math.min(n, 300); }");
  for (const v of [299, 300, 301, 1000, -1000, 100000]) assert.ok(nums!.includes(v), String(v));
});

test("judge v2: an identity program that v1 called right is relabelled wrong once the grid reaches the prefix", () => {
  const text = 'function strip0x(s: string): string { return s.startsWith("0x") ? s.slice(2) : s; }';
  const up = runner(text, "strip0x"), d = exprRunner("s", [S("s")]);
  const v1 = v1Counts([S("s")], "string", [], up, d);
  assert.equal(v1.heldWrong, 0, "v1 grid never had a 0x input");
  const r = rebuildItem({ params: [S("s")], ret: "string" }, [], text, v1, up, d);
  assert.ok(r.kept);
  assert.equal(r.label, "wrong");
  assert.ok(r.heldWrong > 0 && r.identityWitnesses.s! > 0);
  assert.equal(String(r.firstWrong!.args[0]).includes("0x"), true);
});

test("judge v2: a correct program stays right; an item whose grid never moves the parameter is dropped", () => {
  const dbl = "function dbl(n: number): number { return n * 2; }";
  const v1d = v1Counts([N("n")], "number", [], runner(dbl, "dbl"), exprRunner("n * 2", [N("n")]));
  const kept = rebuildItem({ params: [N("n")], ret: "number" }, [], dbl, v1d, runner(dbl, "dbl"), exprRunner("n * 2", [N("n")]));
  assert.ok(kept.kept && kept.label === "right" && kept.heldWrong === 0);
  // Only a backslash changes the input, and no row may carry a backslash: identity cannot be told apart.
  const esc = "function unslash(s: string): string { return s.split(String.fromCharCode(92)).join(String.fromCharCode(47)); }";
  const up = runner(esc, "unslash"), id = exprRunner("s", [S("s")]);
  const r = rebuildItem({ params: [S("s")], ret: "string" }, [], esc, v1Counts([S("s")], "string", [], up, id), up, id);
  assert.equal(r.kept, false);
  assert.equal(!r.kept && r.reason, "identity_indistinguishable");
  // Two parameters of the return type: each one must be moved by some held-out row.
  const pick = "function pick(a: string, b: string): string { return a; }";
  const r2 = rebuildItem({ params: [S("a"), S("b")], ret: "string" }, [], pick, v1Counts([S("a"), S("b")], "string", [], runner(pick, "pick"), exprRunner("a", [S("a"), S("b")])), runner(pick, "pick"), exprRunner("a", [S("a"), S("b")]));
  assert.equal(!r2.kept && r2.reason, "identity_indistinguishable");
});

test("judge v2: an upstream text that does not reproduce the v1 counts is dropped, never relabelled", () => {
  const text = "function inc(n: number): number { return n + 1; }";
  const r = rebuildItem({ params: [N("n")], ret: "number" }, [], text, { heldRight: 3, heldWrong: 4 }, runner(text, "inc"), exprRunner("n + 1", [N("n")]));
  assert.equal(!r.kept && r.reason, "upstream_not_reproduced");
  const nan = "function bad(n: number): number { return n / 0; }";
  const r2 = rebuildItem({ params: [N("n")], ret: "number" }, [], nan, { heldRight: 0, heldWrong: 0 }, runner(nan, "bad"), exprRunner("n", [N("n")]));
  assert.equal(!r2.kept && r2.reason, "upstream_not_reproduced");
});

test("judge v2: the runner is sandboxed and bounded; signatures and function texts are read exactly", () => {
  assert.equal(runner("function f(n: number): number { while (true) {} }", "f")([1]), undefined);
  assert.equal(runner("function f(s: string): string { return typeof process; }", "f")(["a"]), "undefined");
  assert.deepEqual(paramsOfContext("// a/b.ts\nexport function f(a: string, n: number): boolean {\n"), { fn: "f", params: [S("a"), N("n")], ret: "boolean" });
  assert.equal(paramsOfContext("// a/b.ts\nexport function f(a?: string): string {\n"), null);
  const src = "import x from 'y';\nexport function g(s: string): string { return s; }\nexport const h = (n: number): number => n + 1;\n";
  assert.equal(functionText(src, "m.ts", "g"), "function g(s: string): string { return s; }");
  assert.equal(functionText(src, "m.ts", "h"), "const h = (n: number): number => n + 1;");
  assert.equal(runner(functionText(src, "m.ts", "h")!, "h")([1]), 2);
  assert.equal(functionText(src, "m.ts", "nope"), null);
});

test("judge v2: build() keeps keys and texts, records labelV1 and each drop, and fails closed on pin mismatches", () => {
  const d = mkdtempSync(join(tmpdir(), "m120-"));
  try {
    const r = join(d, "repos", "o__r"); mkdirSync(r, { recursive: true });
    const git = (...a: string[]) => execFileSync("git", ["-C", r, ...a], { encoding: "utf8" }).trim();
    git("init", "-q");
    writeFileSync(join(r, "m.ts"), 'export function strip0x(s: string): string { return s.startsWith("0x") ? s.slice(2) : s; }\nexport function unslash(s: string): string { return s.split(String.fromCharCode(92)).join(""); }\nexport function dbl(n: number): number { return n * 2; }\n');
    git("add", "m.ts"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x");
    const head = git("rev-parse", "HEAD");
    const item = (key: string, fn: string, p: JParam, ret: JType, expr: string, text: string) => {
      const c = v1Counts([p], ret, [], runner(text, fn), exprRunner(expr, [p]));
      return { key, repo: "o/r", file: "m.ts", fn, ret, label: c.heldWrong ? "wrong" : "right", ...c, expr, context: `// m.ts\nexport function ${fn}(${p.name}: ${p.type}): ${ret} {\n`, derived: `  return ${expr};\n}\n`, reference: "r" };
    };
    const items = [
      item("f000", "strip0x", S("s"), "string", "s", 'function strip0x(s: string): string { return s.startsWith("0x") ? s.slice(2) : s; }'),
      item("f001", "unslash", S("s"), "string", "s", 'function unslash(s: string): string { return s.split(String.fromCharCode(92)).join(""); }'),
      item("f002", "dbl", N("n"), "number", "n * 2", "function dbl(n: number): number { return n * 2; }"),
    ];
    const text = JSON.stringify(items);
    const sources = { schema: SOURCES_SCHEMA, v1: { items: "lm-judge/items.json", itemsSha256: H(text), count: 3 }, items: items.map((i) => ({ key: i.key, head, described: [] })) };
    const out = build(text, sources, [join(d, "nowhere"), join(d, "repos")]);
    assert.deepEqual(out.summary.v1, { n: 3, right: 3, wrong: 0 });
    assert.deepEqual(out.summary.v2, { n: 2, right: 1, wrong: 1 });
    assert.deepEqual(out.summary.relabelled, { rightToWrong: 1, wrongToRight: 0 });
    assert.deepEqual(out.summary.dropped, { n: 1, reasons: { identity_indistinguishable: 1 }, identityIndistinguishable: 1, identityIndistinguishableWithIdentityProgram: 1 });
    const kept = JSON.parse(out.itemsOut);
    assert.deepEqual(kept.map((k: { key: string }) => k.key), ["f000", "f002"]);
    assert.equal(kept[0].labelV1, "right"); assert.equal(kept[0].label, "wrong");
    for (const k of kept) for (const f of ["context", "derived", "reference", "expr", "key"]) assert.equal(k[f], items.find((i) => i.key === k.key)![f as "key"]);
    assert.equal(out.build.itemsSha256, H(out.itemsOut));
    assert.throws(() => build(text + " ", sources, [join(d, "repos")]), /sha256/);
    assert.throws(() => build(text, { ...sources, items: sources.items.slice(1) }, [join(d, "repos")]), /line up/);
    assert.throws(() => build(text, { ...sources, schema: "x" }, [join(d, "repos")]), /schema/);
    const missing = build(text, { ...sources, items: sources.items.map((s) => ({ ...s, head: "0".repeat(40) })) }, [join(d, "repos")]);
    assert.deepEqual(missing.summary.dropped.reasons, { upstream_not_reproduced: 3 });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("judge v2: the sources file holds commit ids and integers only, keyed to the pinned v1 judge commit", () => {
  assert.equal(SRC.schema, SOURCES_SCHEMA);
  assert.equal(SRC.v1.commit, CFG.eval.judgeCommit);
  assert.equal(SRC.v1.items, CFG.eval.judgeItems);
  assert.equal(SRC.v1.count, CFG.eval.judgeItemCount);
  assert.equal(SRC.items.length, SRC.v1.count);
  for (const [i, it] of SRC.items.entries()) {
    assert.deepEqual(Object.keys(it), ["key", "head", "described"]);
    assert.equal(it.key, `f${String(i).padStart(3, "0")}`);
    assert.match(it.head, /^[0-9a-f]{40}$/);
    assert.ok(Array.isArray(it.described) && it.described.every((n: unknown) => Number.isSafeInteger(n)));
  }
  assert.equal(H(readFileSync(join(repo, PIN.sources))), PIN.sourcesSha256);
  assert.equal(PIN.items.n, PIN.items.right + PIN.items.wrong);
  assert.equal(PIN.items.n + Object.values(PIN.dropped as Record<string, number>).reduce((a, b) => a + b, 0), SRC.v1.count);
  assert.equal(PIN.live.version, CFG.live.version);
  assert.match(PIN.items.sha256, /^[0-9a-f]{64}$/);
});

test("judge v2 workflow: dispatch only, free runner, pinned key scripts, new Results path only, no retrain or promotion", () => {
  assert.match(WF, /^on:\n  workflow_dispatch:\n\npermissions: \{\}$/m);
  assert.doesNotMatch(WF, /^\s+(push|schedule|pull_request|workflow_run):/m);
  assert.match(WF, /runs-on: ubuntu-24\.04/);
  assert.doesNotMatch(WF, /self-hosted|upload-artifact|actions\/cache|latest\.json"? *>|finetune|lm-retrain-corpus|gh workflow run/);
  for (const m of WF.matchAll(/^ {4}([0-9a-f]{64}) {2}(\S+)$/gm)) assert.equal(H(readFileSync(join(repo, m[2]!))), m[1], m[2]);
  assert.match(WF, /RESULTS_SHA256: \|-\n {4}[0-9a-f]{64} {2}peaceai\/bin\/with-deploy-key\.sh\n {4}[0-9a-f]{64} {2}peaceai\/bin\/results-write\.sh\n/);
  // Every key use is preceded by the checkout / script-hash verification.
  const steps = WF.split(/\n {6}- /);
  for (const [i, s] of steps.entries()) if (/secrets\.PEACEAI_RESULTS_(READ|DEPLOY)_KEY/.test(s)) assert.match(steps[i - 1]!, /sha256sum -c --quiet -/, s.split("\n")[0]);
  // The landing writes lm-judge-v2/ only, new files only, and refuses an existing directory.
  assert.match(WF, /test ! -e "\$d" \|\| \{ echo "lm-judge-v2\/ already exists/);
  assert.match(WF, /case "\$name" in lm-judge-v2\/items\.json\|lm-judge-v2\/build\.json\|lm-judge-v2\/README\.md\|"lm-judge-v2\/scores-\$live\.json"\) ;; \*\)/);
  assert.match(WF, /--diff-filter=DMRT/);
  assert.doesNotMatch(WF, /\b(cp|rm|mv|git rm)\b[^\n]*lm-judge\/|git push|--force/);
  // The build and the score are checked against the pins before any write.
  for (const s of ["items.sha256", ".summary.v2", ".summary.dropped.reasons", "aggregates differ from the recorded v1 aggregates", "live AUC on v2 differs from the pin"]) assert.ok(WF.includes(s), s);
  assert.ok(WF.indexOf("live AUC on v2 differs") < WF.indexOf("PEACEAI_RESULTS_DEPLOY_KEY"));
  assert.match(WF, /environment: peaceai-results/);
});

test("judge v2: the builder and its library are protected", () => {
  for (const p of ["peaceai/lib/judge-grid.ts", "peaceai/bin/judge-v2-build.ts", "peaceai/model/judge-v2.json", "peaceai/model/judge-v2-sources.json", ".github/workflows/peace-lm-judge-v2.yml"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});
