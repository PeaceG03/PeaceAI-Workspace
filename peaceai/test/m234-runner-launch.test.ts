// Practice runner launch. The fixtures are synthetic. They are not practice-set rows.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PRACTICE_AVA_CONFIG, applyPracticeTestLaunch, declaredLoaderMissing, declaredTypeScriptLoader, dependencyFingerprint,
  ensurePracticeInstall, practiceSandboxReady, practiceTestLaunch, sandboxExtraEnv, tsconfigOmitsTest, visibleNodeBin,
} from "../lib/practicemine.ts";
import { avaEarlyDetail, classifyRunnerOutput, loaderMissingDetail, runTestSpec, type SpecInput } from "../lib/testspec.ts";

const SOURCE_ONLY = JSON.stringify({ compilerOptions: { strict: true }, include: ["source"] });
const TEST_INCLUDED = JSON.stringify({ include: ["source", "test"] });
const TRANSPILE = JSON.stringify({ include: ["source", "test"], "ts-node": { transpileOnly: true } });

const AVA3 = JSON.stringify({
  scripts: { test: "xo && ava" },
  devDependencies: { ava: "^3.3.0", "ts-node": "^8.3.0" },
  ava: { extensions: ["ts"], require: ["ts-node/register"] },
});
const LOADER = JSON.stringify({
  scripts: { test: "tsc --noEmit && xo && ava" },
  devDependencies: { ava: "^5.3.0", "ts-node": "^10.9.1" },
  ava: { extensions: { ts: "module" }, nodeArguments: ["--loader=ts-node/esm"] },
});
const TSIMP = JSON.stringify({
  scripts: { test: "tsc --noEmit && xo && ava" },
  devDependencies: { ava: "^6.1.3", tsimp: "2.0.11", typescript: "5.5.3" },
  ava: { environmentVariables: { TSIMP_DIAG: "error" }, extensions: { ts: "module" }, nodeArguments: ["--import=tsimp/import"] },
});

test("the declared loader is the one the ava config names, at the manifest range", () => {
  const ava3 = declaredTypeScriptLoader(AVA3, SOURCE_ONLY);
  assert.deepEqual(ava3, { name: "ts-node", specifier: "ts-node/register", range: "^8.3.0", transpileOnly: false });
  const loader = declaredTypeScriptLoader(LOADER, TRANSPILE);
  assert.equal(loader?.name, "ts-node");
  assert.equal(loader?.specifier, "ts-node/esm");
  assert.equal(loader?.range, "^10.9.1");
  assert.equal(loader?.transpileOnly, true);
  const tsimp = declaredTypeScriptLoader(TSIMP, SOURCE_ONLY);
  assert.equal(tsimp?.name, "tsimp");
  assert.equal(tsimp?.specifier, "tsimp/import");
  assert.equal(tsimp?.range, "2.0.11");
  assert.equal(declaredTypeScriptLoader(JSON.stringify({ ava: { require: ["esm"] }, devDependencies: { esm: "^3.2.25" } }), null), null);
  assert.equal(declaredTypeScriptLoader(JSON.stringify({ scripts: { test: "mocha -r ts-node/register" }, devDependencies: { "ts-node": "~10.9.1" } }), null)?.range, "~10.9.1");
  const unpinned = (range: string) => JSON.stringify({ ava: { require: ["ts-node/register"] }, devDependencies: { "ts-node": range } });
  assert.equal(declaredLoaderMissing("/missing", unpinned("latest")), null);
  assert.equal(declaredLoaderMissing("/missing", unpinned("git+https://example.com/ts-node.git")), null);
  assert.equal(declaredLoaderMissing("/missing", AVA3), "ts-node");
});

test("an overlaid test outside the tsconfig include is transpiled, and one inside it is not", () => {
  assert.equal(tsconfigOmitsTest(SOURCE_ONLY, "test/test.ts"), true);
  assert.equal(tsconfigOmitsTest('{\n\t"include": [\n\t\t"source",\n\t],\n}\n', "test/test.ts"), true);
  assert.equal(tsconfigOmitsTest(TEST_INCLUDED, "test/test.ts"), false);
  assert.equal(tsconfigOmitsTest(JSON.stringify({ files: ["source/index.ts"] }), "test/test.ts"), true);
  assert.equal(tsconfigOmitsTest("{}", "test/test.ts"), false);
  const outside = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: AVA3, tsconfig: SOURCE_ONLY });
  assert.equal(outside.env.TS_NODE_TRANSPILE_ONLY, "true");
  assert.deepEqual(outside.cmd.slice(0, 3), ["./node_modules/.bin/ava", "--config", PRACTICE_AVA_CONFIG]);
  assert.equal(outside.cmd.at(-1), "test/test.ts");
  assert.match(outside.configText ?? "", /ts-node\/register/);
  assert.doesNotMatch(outside.configText ?? "", /TSIMP_DIAG/);
  const inside = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: AVA3, tsconfig: TEST_INCLUDED });
  assert.equal(inside.env.TS_NODE_TRANSPILE_ONLY, undefined);
  const already = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: LOADER, tsconfig: TRANSPILE });
  assert.equal(already.env.TS_NODE_TRANSPILE_ONLY, "true");
});

test("tsimp diagnostics stay on when the test is in the tsconfig, and drop only for an omitted overlay", () => {
  const omitted = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: TSIMP, tsconfig: SOURCE_ONLY });
  assert.match(omitted.configText ?? "", /"TSIMP_DIAG":"ignore"/);
  assert.match(omitted.configText ?? "", /tsimp\/import/);
  assert.equal(omitted.env.TS_NODE_TRANSPILE_ONLY, undefined);
  const covered = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: TSIMP, tsconfig: TEST_INCLUDED });
  assert.match(covered.configText ?? "", /"TSIMP_DIAG":"error"/);
  const fileWins = practiceTestLaunch({
    command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: TSIMP, tsconfig: SOURCE_ONLY, avaConfigFile: true,
  });
  assert.equal(fileWins.configText, null);
  assert.deepEqual(fileWins.cmd, ["./node_modules/.bin/ava", "test/test.ts"]);
  const plain = practiceTestLaunch({ command: ["node", "--test", "test/test.ts"], testFile: "test/test.ts", packageJson: AVA3, tsconfig: SOURCE_ONLY });
  assert.equal(plain.configText, null);
  assert.equal(plain.env.TS_NODE_TRANSPILE_ONLY, "true");
});

test("sandbox env keeps the loader flag and drops every other key", () => {
  assert.deepEqual(sandboxExtraEnv({ TS_NODE_TRANSPILE_ONLY: "true", TSIMP_DIAG: "ignore", TOKEN: "secret", PATH: "/tmp" }), {
    TS_NODE_TRANSPILE_ONLY: "true", TSIMP_DIAG: "ignore",
  });
  assert.deepEqual(sandboxExtraEnv({ TS_NODE_TRANSPILE_ONLY: "false", TSIMP_DIAG: "error" }), {});
});

test("an ava assertion is not an early exit, and a worker crash names its error", () => {
  const crash = [
    "Uncaught exception in test/test.ts",
    "TypeError: Cannot read properties of undefined (reading 'emptyString')",
    "✖ test/test.ts exited with a non-zero exit code: 1",
  ].join("\n");
  assert.equal(avaEarlyDetail(crash, 1), "TypeError: Cannot read properties of undefined (reading 'emptyString')");
  assert.equal(avaEarlyDetail("✘ test/test.ts exited due to an error:\nError [ERR_MODULE_NOT_FOUND]: Cannot find package 'ts-node' imported from /work", 1), "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ts-node' imported from /work");
  assert.equal(avaEarlyDetail("✘ [fail]: is.htmlElement\nTypeError: testIs is not a function\n1 test failed", 1), null);
  assert.equal(avaEarlyDetail("✘ [fail]: pad\nUncaught exception in test/test.ts\nTypeError: testIs is not a function\n✖ test/test.ts exited with a non-zero exit code: 1", 1), null);
  assert.equal(classifyRunnerOutput("✖ is.weakRef Error thrown in test\n1 test failed", 1), "assertion_seen");
  assert.equal(avaEarlyDetail("not ok 1 - pad\nAssertionError: expected 2 to be 3", 1), null);
  assert.equal(avaEarlyDetail(crash, 0), null);
  assert.equal(loaderMissingDetail("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ts-node' imported from /work", "ts-node")?.includes("Cannot find package 'ts-node'"), true);
  assert.equal(loaderMissingDetail("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'left-pad'", "ts-node"), null);
  assert.equal(loaderMissingDetail("Cannot find package 'ts-node'", null), null);
});

test("a finished install without the declared ts-node is rebuilt, and the repair uses the manifest range", () => {
  const node = visibleNodeBin();
  assert.ok(node);
  const origin = mkdtempSync(join(tmpdir(), "practice-loader-"));
  const cache = mkdtempSync(join(tmpdir(), "practice-loader-cache-"));
  const bin = mkdtempSync(join(tmpdir(), "practice-loader-bin-"));
  const log = join(cache, "npm-args");
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nif echo "$@" | grep -q 'ts-node@'; then mkdir -p node_modules/ts-node; echo '{"name":"ts-node"}' > node_modules/ts-node/package.json; exit 0; fi\nmkdir -p node_modules/ava\necho '{"name":"ava"}' > node_modules/ava/package.json\nexit 0\n`);
  spawnSync("chmod", ["+x", join(bin, "npm")], { stdio: "ignore" });
  spawnSync("ln", ["-s", node, join(bin, "node")], { stdio: "ignore" });
  const tool = { nodePath: join(bin, "node"), nodeVersion: "v22.23.4", manager: "npm" as const, managerVersion: "10.9.9" };
  spawnSync("git", ["init", "-q", origin], { stdio: "ignore" });
  writeFileSync(join(origin, "package.json"), `${AVA3}\n`);
  spawnSync("git", ["-C", origin, "add", "package.json"], { stdio: "ignore" });
  spawnSync("git", ["-C", origin, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"], { stdio: "ignore" });
  const sha = spawnSync("git", ["-C", origin, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const fingerprint = dependencyFingerprint(readFileSync(join(origin, "package.json"), "utf8"), "", tool);
  const stale = join(cache, "installs", fingerprint);
  mkdirSync(join(stale, "node_modules"), { recursive: true });
  writeFileSync(join(stale, ".practice-complete"), `${fingerprint}\n`);
  writeFileSync(join(stale, "node_modules", "stale"), "kept\n");
  try {
    const installed = ensurePracticeInstall(origin, { repo: "example/loader", baseSha: sha, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false);
    assert.equal(installed.ok, true, installed.lines.join("\n"));
    assert.equal(existsSync(join(installed.modules ?? "", "ts-node", "package.json")), true);
    assert.equal(existsSync(join(installed.modules ?? "", "stale")), false);
    const args = readFileSync(log, "utf8");
    assert.match(args, /ts-node@\^8\.3\.0/);
    assert.doesNotMatch(args, /ts-node@latest/);
    const again = ensurePracticeInstall(origin, { repo: "example/loader", baseSha: sha, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false);
    assert.equal(again.ok, true);
    assert.equal(readFileSync(log, "utf8"), args);
  } finally {
    rmSync(origin, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test("the spec reports a missing declared loader and an ava early exit, and keeps an assertion", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "practice-spec-launch-"));
  const testFile = "test/test.ts";
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${AVA3}\n`);
  writeFileSync(join(root, "tsconfig.json"), `${SOURCE_ONLY}\n`);
  writeFileSync(join(root, testFile), "import assert from \"node:assert/strict\";\nimport test from \"node:test\";\ntest(\"t\", () => { assert.equal(1, 2); });\n");
  spawnSync("git", ["init", "-q", root], { stdio: "ignore" });
  spawnSync("git", ["-C", root, "add", "-A"], { stdio: "ignore" });
  spawnSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"], { stdio: "ignore" });
  const input = (command: string[], file = testFile): SpecInput => ({
    root, subject: "fixture", testFile: file, testCommand: command, sourcePattern: "^src/.+\\.ts$", toolchain: { nodePath: node },
  });
  const script = (body: string) => [node, "-e", body];
  try {
    const missing = runTestSpec(input(script("console.error(\"Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ts-node' imported from /work\"); process.exit(1)")));
    assert.equal(missing.status, "cant");
    if (missing.status === "cant") {
      assert.equal(missing.reason, "CANT_DO_YET_LOADER_MISSING");
      assert.equal(missing.diagnostic.kind, "loader_missing");
      assert.match(missing.diagnostic.lines[0] ?? "", /Cannot find package 'ts-node'/);
    }
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ scripts: { test: "node --test" } })}\n`);
    const unrelated = runTestSpec(input(script("console.error(\"Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ts-node'\"); process.exit(1)")));
    assert.equal(unrelated.status, "cant");
    if (unrelated.status === "cant") assert.equal(unrelated.reason, "CANT_DO_YET_RUNNER_ERROR");
    writeFileSync(join(root, "package.json"), `${AVA3}\n`);
    const early = runTestSpec(input(script("console.log('error loader-transpile ' + (process.env.TS_NODE_TRANSPILE_ONLY === 'true' ? 'yes' : 'no')); console.log('Uncaught exception in test/test.ts'); console.log('TypeError: Cannot read properties of undefined (reading emptyString)'); console.log('test/test.ts exited with a non-zero exit code: 1'); process.exit(1)")));
    assert.equal(early.status, "cant");
    if (early.status === "cant") {
      assert.equal(early.reason, "CANT_DO_YET_AVA_EARLY_EXIT");
      assert.equal(early.diagnostic.lines[0], "TypeError: Cannot read properties of undefined (reading emptyString)");
      assert.ok(early.diagnostic.lines.some((line) => line.includes("loader-transpile yes")));
    }
    const applied = applyPracticeTestLaunch(root, ["./node_modules/.bin/ava", testFile], testFile);
    assert.equal(readFileSync(join(root, PRACTICE_AVA_CONFIG), "utf8").includes("ts-node/register"), true);
    assert.equal(readFileSync(join(root, "package.json"), "utf8").includes("\"test\":\"xo && ava\""), true);
    assert.deepEqual(applied.cmd.slice(0, 3), ["./node_modules/.bin/ava", "--config", PRACTICE_AVA_CONFIG]);
    const assertion = runTestSpec(input(script("console.log('✘ [fail]: pad'); console.log('AssertionError: expected 1 to be 2'); process.exit(1)")));
    assert.equal(assertion.status, "cant");
    if (assertion.status === "cant") {
      assert.notEqual(assertion.reason, "CANT_DO_YET_AVA_EARLY_EXIT");
      assert.notEqual(assertion.reason, "CANT_DO_YET_LOADER_MISSING");
      assert.notEqual(assertion.reason, "CANT_DO_YET_RUNNER_ERROR");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
