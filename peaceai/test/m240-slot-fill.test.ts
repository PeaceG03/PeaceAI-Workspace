// Slot filling from a repository. Self-written modules, plus pinned third-party files
// under peaceai/test/fixtures/m240. No builder-log row is named.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { routeReplay } from "../lib/capabilityjob.ts";
import { applyRule } from "../lib/learned.ts";
import { buildTsconfigScript, tsconfigScriptCandidateReason } from "../lib/tsconfig-script.ts";
import { checkCandidateScope } from "../lib/scope.ts";
import { guessFamily, trainRequestModel, canonicalRequest, type FamilyRow } from "../lib/requestfamily.ts";
import { importLine, readImportDiagnostics, readSlotTree, testLine, tsconfigLine, type SlotRepo } from "../lib/slotfill.ts";

const root = resolve(import.meta.dirname, "../..");
const log = readFileSync(resolve(root, "builder-log/tasks.jsonl"), "utf8");
const rows: FamilyRow[] = log.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as FamilyRow);
const model = trainRequestModel(rows);
const spec = (id: string) => JSON.parse(readFileSync(resolve(root, `peaceai/rules/learned/${id}.json`), "utf8"));

function repo(files: Record<string, string>, diagnostics?: SlotRepo["diagnostics"]): SlotRepo {
  return { files: Object.entries(files).map(([path, content]) => ({ path, content })), diagnostics };
}

const PKG = `{
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "node --test"
  }
}
`;
const TSCONFIG = `{
  "compilerOptions": { "strict": true, "noEmit": true, "module": "esnext", "moduleResolution": "bundler" },
  "include": ["src/**/*.ts"]
}
`;

test("a typecheck:name token is code context, and read-only is not a one-file cue", () => {
  assert.equal(guessFamily(model, "please add a typecheck:tools script for the library").family, "TSCONFIG_SCRIPT");
  assert.equal(guessFamily(model, "please typecheck on page4").family, null);
  const files = {
    "package.json": PKG,
    "tsconfig.json": TSCONFIG,
    "src/helper-lib.ts": "export const helper = 1;\n",
    "src/cart.test.ts": "export {}\n",
  };
  const line = tsconfigLine("Add a read-only typecheck:lib script for the library", repo(files));
  assert.equal(line, "add a typecheck script typecheck:lib with a new tsconfig.lib.json excluding src/**/*.test.ts");
  assert.equal(tsconfigLine("Add a typecheck:lib script", repo({ ...files, "src/other.spec.ts": "export {}\n" })), null);
});

test("over a script name picks the one matching source file, and two files refuse", () => {
  const files = {
    "package.json": PKG,
    "tsconfig.json": TSCONFIG,
    "src/read-worker.ts": "export const port = 1;\n",
    "src/read-worker.test.ts": "export {}\n",
    "src/cart.test.ts": "export {}\n",
  };
  assert.equal(
    tsconfigLine("Add a read-only typecheck:worker script over the reader (new tsconfig.worker.json)", repo(files)),
    "add a typecheck script typecheck:worker with a new tsconfig.worker.json checking only src/read-worker.ts",
  );
  const two = { ...files, "src/worker-extra.ts": "export const extra = 1;\n" };
  assert.equal(tsconfigLine("Add a typecheck:worker script over the reader", repo(two)), null);
  assert.equal(
    tsconfigLine("Add a typecheck:worker script", repo(files)),
    "add a typecheck script typecheck:worker with a new tsconfig.worker.json excluding src/**/*.test.ts",
  );
});

test("the typecheck-script rule emits the filled line, and the scope check accepts it", () => {
  const files = [
    { path: "package.json", content: PKG },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: "src/read-worker.ts", content: "export const port = 1;\n" },
    { path: "src/cart.test.ts", content: "export {}\n" },
  ];
  const line = tsconfigLine("Add a typecheck:worker script over the reader", { files });
  assert.ok(line);
  const why: { reason?: string } = {};
  const edit = buildTsconfigScript({ name: "worker", mode: "files", pattern: "src/read-worker.ts" }, files, why);
  assert.equal(why.reason, undefined);
  assert.ok(edit);
  const scopeFiles = [
    { path: "package.json", isNew: false, addedLines: edit!.content.split("\n").filter((l) => l.includes("typecheck:worker")), removedLines: [] as string[] },
    { path: "tsconfig.worker.json", isNew: true, addedLines: edit!.extra[0]!.content.split("\n"), removedLines: [] as string[] },
  ];
  assert.equal(tsconfigScriptCandidateReason(scopeFiles), null);
  const gate = checkCandidateScope([
    { oldPath: "package.json", newPath: "package.json", isNew: false, isDeleted: false, isRename: false, isBinary: false, modeChange: false, newMode: "100644", addedLines: scopeFiles[0]!.addedLines, removedLines: [], appendOnly: false },
    { oldPath: null, newPath: "tsconfig.worker.json", isNew: true, isDeleted: false, isRename: false, isBinary: false, modeChange: false, newMode: "100644", addedLines: scopeFiles[1]!.addedLines, removedLines: [], appendOnly: false },
  ], new Set(["package.json", "tsconfig.json", "src/read-worker.ts", "src/cart.test.ts"]), {
    isSource: (p) => p.startsWith("src/") || p === "package.json" || p.startsWith("tsconfig"),
    isTest: (p) => p.endsWith(".test.ts"),
    isDenied: () => false,
    tsconfigScript: true,
  });
  assert.deepEqual(gate, []);
});

test("an exported function named in the sentence supplies the file, and two names refuse", () => {
  const email = readFileSync(resolve(root, "peaceai/test/fixtures/m80/brazilian-utils__javascript-eae100a5ddb3.txt"), "utf8");
  const files = { "src/utilities/email/index.ts": email, "src/other.ts": "export function other(n: number): number { return n; }\n" };
  const asked = "add a characterization test for `isValid`\n- isValid(\"a@b.co\") is true\n- isValid(\"\") is false";
  const line = testLine(asked, repo(files));
  assert.equal(line?.split("\n")[0], "add a characterization test for isValid in src/utilities/email/index.ts");
  assert.match(line ?? "", /isValid\(""\) is false/);
  assert.equal(testLine("add a characterization test for `isValid` and `other`", repo(files)), null);
  assert.equal(testLine("add a characterization test for the planner", repo(files)), null);
  const ruled = applyRule(spec("public-test-case-existing-v1"), line!, Object.entries(files).map(([path, content]) => ({ path, content })), (p) => p.endsWith(".test.ts"));
  assert.ok(ruled && ruled.create && ruled.path.endsWith(".test.ts"));
  const dir = mkdtempSync(join(tmpdir(), "peaceai-slot-email-"));
  try {
    mkdirSync(dirname(join(dir, "src/utilities/email/index.ts")), { recursive: true });
    writeFileSync(join(dir, "src/utilities/email/index.ts"), email);
    mkdirSync(dirname(join(dir, ruled!.path)), { recursive: true });
    writeFileSync(join(dir, ruled!.path), ruled!.content);
    const tsxBin = resolve(root, "node_modules/.bin/tsx");
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const pass = spawnSync(tsxBin, ["--test", ruled!.path], { cwd: dir, env, encoding: "utf8" });
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    const stub = mkdtempSync(join(tmpdir(), "peaceai-slot-email-stub-"));
    mkdirSync(dirname(join(stub, ruled!.path)), { recursive: true });
    writeFileSync(join(stub, "src/utilities/email/index.ts"), "export function isValid(email: string): boolean { return false; }\n");
    writeFileSync(join(stub, ruled!.path), ruled!.content);
    const fail = spawnSync(tsxBin, ["--test", ruled!.path], { cwd: stub, env, encoding: "utf8" });
    rmSync(stub, { recursive: true, force: true });
    assert.notEqual(fail.status, 0, fail.stdout + fail.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RoleRadar's parent reports one TS5097, and the import rule removes that extension", () => {
  const src = resolve(root, "peaceai/test/m240-pins/roleradar");
  const dir = mkdtempSync(join(tmpdir(), "peaceai-slot-rr-"));
  try {
    const copy = (rel: string) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      const stored = rel.endsWith(".json") ? rel : `${rel}.txt`;
      writeFileSync(join(dir, rel), readFileSync(join(src, stored)));
    };
    copy("tsconfig.json");
    copy("tests/test_ats_e2e.ts");
    copy("src/lib/ats.ts");
    const before = readImportDiagnostics(dir);
    const ts5097 = before.filter((d) => d.code === 5097);
    assert.deepEqual(ts5097.map((d) => `${d.file} ${d.specifier}`), ["tests/test_ats_e2e.ts ../src/lib/ats.ts"]);
    const tree = readSlotTree(dir);
    const asked = "Fix the typecheck failure in the resume score";
    const line = importLine(asked, { files: tree, diagnostics: before });
    assert.equal(line, 'fix the import of ../src/lib/ats.ts in tests/test_ats_e2e.ts to: import { analyzeAts, extractKeywordGap, calculateWeightedAtsScore, categorizeActionVerbs } from "../src/lib/ats";');
    const why: { reason?: string } = {};
    const edit = applyRule(spec("public-import-edit-v2"), line!, tree, (p) => p.endsWith(".test.ts"), undefined, why);
    assert.equal(why.reason, undefined);
    assert.ok(edit);
    writeFileSync(join(dir, edit!.path), edit!.content);
    const after = readImportDiagnostics(dir).filter((d) => d.code === 5097);
    assert.deepEqual(after, []);
    const route = routeReplay({ model, asked, changed: "Example@abcdef1", issueBody: null, seq: 4, repo: { files: tree, diagnostics: before } });
    assert.deepEqual(route, { run: line });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("semajsx chat allows .ts extensions, so a typecheck-failure sentence finds no import candidate", () => {
  const src = resolve(root, "peaceai/test/m240-pins/semajsx/packages/chat");
  const dir = mkdtempSync(join(tmpdir(), "peaceai-slot-sx-"));
  try {
    const copy = (rel: string) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      const stored = rel.endsWith(".json") ? rel : `${rel}.txt`;
      writeFileSync(join(dir, rel), readFileSync(join(src, stored)));
    };
    copy("tsconfig.json");
    copy("src/components/chat-input.style.ts");
    copy("src/components/error-block.style.ts");
    copy("src/theme/tokens.ts");
    const hits = readImportDiagnostics(dir).filter((d) => d.code === 5097);
    assert.deepEqual(hits, []);
    const line = importLine("Fix the typecheck failure", { files: readSlotTree(dir), diagnostics: readImportDiagnostics(dir) });
    assert.equal(line, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two relative extension diagnostics refuse, and a specifier that does not resolve is not a candidate", () => {
  const a = 'import { n } from "./n.ts";\nexport const a = n;\n';
  const b = 'import { n } from "./n.ts";\nexport const b = n;\n';
  const n = "export const n = 1;\n";
  const files = { "a.ts": a, "b.ts": b, "n.ts": n };
  const diagnostics = [
    { code: 5097 as const, file: "a.ts", specifier: "./n.ts" },
    { code: 5097 as const, file: "b.ts", specifier: "./n.ts" },
  ];
  assert.equal(importLine("Fix the typecheck failure", repo(files, diagnostics)), null);
  const missing = [{ code: 5097 as const, file: "a.ts", specifier: "./gone.ts" }];
  assert.equal(importLine("Fix the typecheck failure", repo({ "a.ts": 'import { n } from "./gone.ts";\nexport const a = 1;\n' }, missing)), null);
  assert.equal(canonicalRequest("IMPORT_EDIT", "Fix the typecheck failure", null), null);
});

test("a real package.json anchor, a real tsconfig, and a real source file typecheck after the script rule", () => {
  const jestPkg = readFileSync(resolve(root, "peaceai/test/m240-pins/jest/package.json"), "utf8");
  const rr = resolve(root, "peaceai/test/m240-pins/roleradar");
  const files = [
    { path: "package.json", content: jestPkg },
    { path: "tsconfig.json", content: readFileSync(join(rr, "tsconfig.json"), "utf8") },
    { path: "src/lib/ats.ts", content: readFileSync(join(rr, "src/lib/ats.ts.txt"), "utf8") },
    { path: "src/lib/types.ts", content: readFileSync(join(rr, "src/lib/types.ts.txt"), "utf8") },
  ];
  const line = tsconfigLine("add a typecheck:ats script over the score", { files });
  assert.equal(line, "add a typecheck script typecheck:ats with a new tsconfig.ats.json checking only src/lib/ats.ts");
  const why: { reason?: string } = {};
  const edit = buildTsconfigScript({ name: "ats", mode: "files", pattern: "src/lib/ats.ts" }, files, why);
  assert.equal(why.reason, undefined, why.reason);
  assert.ok(edit);
  const dir = mkdtempSync(join(tmpdir(), "peaceai-slot-ats-"));
  try {
    mkdirSync(join(dir, "src/lib"), { recursive: true });
    writeFileSync(join(dir, "package.json"), edit!.content);
    writeFileSync(join(dir, "tsconfig.json"), files[1]!.content);
    writeFileSync(join(dir, "src/lib/ats.ts"), files[2]!.content);
    writeFileSync(join(dir, edit!.extra[0]!.path), edit!.extra[0]!.content);
    const tsc = spawnSync(resolve(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.ats.json", "--noEmit", "--pretty", "false"], { cwd: dir, encoding: "utf8" });
    assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const base = resolve(root, "peaceai/test/.slot-mutants");
mkdirSync(base, { recursive: true });
let n = 0;
async function mutant(guard: string) {
  const text = readFileSync(resolve(root, "peaceai/lib/slotfill.ts"), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((l, i) => (l.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(resolve(root, "peaceai/lib", f)).href)}`);
  const file = join(base, `mutant-${n++}.ts`);
  writeFileSync(file, next);
  return import(pathToFileURL(file).href);
}

test("deleting the one-candidate guards admits an ambiguous pair", async () => {
  const email = readFileSync(resolve(root, "peaceai/test/fixtures/m80/brazilian-utils__javascript-eae100a5ddb3.txt"), "utf8");
  const twoFn = repo({
    "src/utilities/email/index.ts": email,
    "src/other.ts": "export function other(n: number): number { return n; }\n",
  });
  const asked = "add a characterization test for `isValid` and `other`";
  assert.equal(testLine(asked, twoFn), null);
  const opened = await mutant("slot-guard:one-export") as { testLine: typeof testLine };
  const admitted = opened.testLine(asked, twoFn);
  assert.match(admitted ?? "", /add a characterization test for (isValid|other) in src\//);

  const files = { "a.ts": 'import { n } from "./n.ts";\nexport const a = n;\n', "b.ts": 'import { n } from "./n.ts";\nexport const b = n;\n', "n.ts": "export const n = 1;\n" };
  const diagnostics = [
    { code: 5097 as const, file: "a.ts", specifier: "./n.ts" },
    { code: 5097 as const, file: "b.ts", specifier: "./n.ts" },
  ];
  assert.equal(importLine("Fix the typecheck failure", repo(files, diagnostics)), null);
  const imp = await mutant("slot-guard:one-import") as { importLine: typeof importLine };
  assert.match(imp.importLine("Fix the typecheck failure", repo(files, diagnostics)) ?? "", /fix the import of \.\/n\.ts in (a|b)\.ts/);

  const twoFiles = {
    "package.json": PKG,
    "tsconfig.json": TSCONFIG,
    "src/read-worker.ts": "export const port = 1;\n",
    "src/worker-extra.ts": "export const extra = 1;\n",
    "src/cart.test.ts": "export {}\n",
  };
  assert.equal(tsconfigLine("Add a typecheck:worker script over the reader", repo(twoFiles)), null);
  const entry = await mutant("slot-guard:single-entry") as { tsconfigLine: typeof tsconfigLine };
  assert.match(entry.tsconfigLine("Add a typecheck:worker script over the reader", repo(twoFiles)) ?? "", /excluding src\/\*\*\/\*\.test\.ts/);

  const bothModes = {
    "package.json": PKG,
    "tsconfig.json": TSCONFIG,
    "src/plain.js": "export const n = 1;\n",
    "src/cart.test.ts": "export {}\n",
  };
  assert.equal(tsconfigLine("Add a typecheck:lib script for the library and javascript", repo(bothModes)), null);
  const ts = await mutant("slot-guard:one-tsconfig") as { tsconfigLine: typeof tsconfigLine };
  assert.match(ts.tsconfigLine("Add a typecheck:lib script for the library and javascript", repo(bothModes)) ?? "", /typecheck:lib/);
  rmSync(base, { recursive: true, force: true });
});
