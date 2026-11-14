// Practice runner launch. The fixtures are synthetic. They are not practice-set rows.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PRACTICE_AVA_CONFIG, applyPracticeTestLaunch, declaredLoaderMissing, declaredTypeScriptLoader, dependencyFingerprint,
  INSTALL_READER_MARK, RETIRED_INSTALL_MS, ensurePracticeInstall, gradedLaunchMode, loaderFingerprintNote, loaderInstalled,
  practiceSandboxReady, practiceTestLaunch, publishInstallTree, reapRetiredInstalls,
  sandboxExtraEnv, tsconfigOmitsTest, visibleNodeBin,
} from "../lib/practicemine.ts";
import { runRecordedTest } from "../bin/practice-replay.ts";
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
  assert.equal(tsconfigOmitsTest(JSON.stringify({ include: ["{src,test}/**/*.ts"] }), "test/t.ts"), false);
  assert.equal(tsconfigOmitsTest(JSON.stringify({ extends: "@sindresorhus/tsconfig" }), "test/t.ts"), false);
  assert.equal(tsconfigOmitsTest(TEST_INCLUDED, "test/test.ts"), false);
  assert.equal(tsconfigOmitsTest(JSON.stringify({ files: ["source/index.ts"] }), "test/test.ts"), true);
  assert.equal(tsconfigOmitsTest("{}", "test/test.ts"), false);
  const outside = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: AVA3, tsconfig: SOURCE_ONLY, mode: "relaxed" });
  assert.equal(outside.env.TS_NODE_TRANSPILE_ONLY, "true");
  const enumKept = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: AVA3, tsconfig: SOURCE_ONLY, mode: "relaxed", constEnum: true });
  assert.equal(enumKept.env.TS_NODE_TRANSPILE_ONLY, undefined);
  const enumAsked = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: AVA3, tsconfig: TRANSPILE, mode: "relaxed", constEnum: true });
  assert.equal(enumAsked.env.TS_NODE_TRANSPILE_ONLY, "true");
  assert.deepEqual(outside.cmd.slice(0, 3), ["./node_modules/.bin/ava", "--config", PRACTICE_AVA_CONFIG]);
  assert.equal(outside.cmd.at(-1), "test/test.ts");
  assert.match(outside.configText ?? "", /ts-node\/register/);
  assert.doesNotMatch(outside.configText ?? "", /TSIMP_DIAG/);
  const inside = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: AVA3, tsconfig: TEST_INCLUDED, mode: "relaxed" });
  assert.equal(inside.env.TS_NODE_TRANSPILE_ONLY, undefined);
  const checked = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: AVA3, tsconfig: SOURCE_ONLY, mode: "typecheck" });
  assert.deepEqual(checked.env, {});
  assert.equal(checked.configText, null);
  assert.deepEqual(checked.cmd, ["./node_modules/.bin/ava", "test/test.ts"]);
  assert.equal(gradedLaunchMode("after"), "typecheck");
  assert.equal(gradedLaunchMode("before"), "typecheck");
  const already = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: LOADER, tsconfig: TRANSPILE, mode: "relaxed" });
  assert.equal(already.env.TS_NODE_TRANSPILE_ONLY, "true");
});

test("tsimp diagnostics stay on when the test is in the tsconfig, and drop only for an omitted overlay", () => {
  const omitted = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: TSIMP, tsconfig: SOURCE_ONLY, mode: "relaxed" });
  assert.match(omitted.configText ?? "", /"TSIMP_DIAG":"ignore"/);
  assert.match(omitted.configText ?? "", /tsimp\/import/);
  assert.equal(omitted.env.TS_NODE_TRANSPILE_ONLY, undefined);
  const covered = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: TSIMP, tsconfig: TEST_INCLUDED, mode: "relaxed" });
  const typecheckTsimp = practiceTestLaunch({ command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: TSIMP, tsconfig: SOURCE_ONLY });
  assert.equal(typecheckTsimp.configText, null);
  assert.equal(typecheckTsimp.env.TSIMP_DIAG, undefined);
  assert.match(covered.configText ?? "", /"TSIMP_DIAG":"error"/);
  const fileWins = practiceTestLaunch({
    command: ["./node_modules/.bin/ava", "test/test.ts"], testFile: "test/test.ts", packageJson: TSIMP, tsconfig: SOURCE_ONLY, avaConfigFile: true, mode: "relaxed",
  });
  assert.equal(fileWins.configText, null);
  assert.deepEqual(fileWins.cmd, ["./node_modules/.bin/ava", "test/test.ts"]);
  const plain = practiceTestLaunch({ command: ["node", "--test", "test/test.ts"], testFile: "test/test.ts", packageJson: AVA3, tsconfig: SOURCE_ONLY, mode: "relaxed" });
  assert.equal(plain.configText, null);
  assert.equal(plain.env.TS_NODE_TRANSPILE_ONLY, "true");
});

test("sandbox env keeps the loader flag and drops every other key", () => {
  assert.deepEqual(sandboxExtraEnv({ TS_NODE_TRANSPILE_ONLY: "true", TSIMP_DIAG: "ignore", TOKEN: "secret", PATH: "/tmp" }), {
    TS_NODE_TRANSPILE_ONLY: "true", TSIMP_DIAG: "ignore",
  });
  assert.deepEqual(sandboxExtraEnv({ TS_NODE_TRANSPILE_ONLY: "false", TSIMP_DIAG: "error" }), {});
});

test("a const enum keeps type-checking when the test file is outside include", () => {
  const root = mkdtempSync(join(tmpdir(), "practice-const-enum-"));
  mkdirSync(join(root, "source"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${AVA3}\n`);
  writeFileSync(join(root, "tsconfig.json"), `${SOURCE_ONLY}\n`);
  writeFileSync(join(root, "source", "levels.ts"), "export const enum Level { High = \"high\" }\n");
  writeFileSync(join(root, "test", "test.ts"), "import { Level } from \"../source/levels\";\nexport const label = Level.High;\n");
  try {
    const kept = applyPracticeTestLaunch(root, ["./node_modules/.bin/ava", "test/test.ts"], "test/test.ts", "relaxed");
    assert.equal(kept.env.TS_NODE_TRANSPILE_ONLY, undefined);
    rmSync(join(root, "source", "levels.ts"));
    const plain = applyPracticeTestLaunch(root, ["./node_modules/.bin/ava", "test/test.ts"], "test/test.ts", "relaxed");
    assert.equal(plain.env.TS_NODE_TRANSPILE_ONLY, "true");
    const checked = applyPracticeTestLaunch(root, ["./node_modules/.bin/ava", "test/test.ts"], "test/test.ts", "typecheck");
    assert.deepEqual(checked.env, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nif echo "$@" | grep -q 'ts-node@'; then mkdir -p node_modules/ts-node; printf '%s\\n' '{"name":"ts-node","version":"8.10.2","main":"index.js"}' > node_modules/ts-node/package.json; printf '%s\\n' 'module.exports={}' > node_modules/ts-node/index.js; exit 0; fi\nmkdir -p node_modules/ava\nprintf '%s\\n' '{"name":"ava","main":"index.js"}' > node_modules/ava/package.json\nprintf '%s\\n' 'module.exports={}' > node_modules/ava/index.js\nexit 0\n`);
  spawnSync("chmod", ["+x", join(bin, "npm")], { stdio: "ignore" });
  spawnSync("ln", ["-s", node, join(bin, "node")], { stdio: "ignore" });
  const tool = { nodePath: join(bin, "node"), nodeVersion: "v22.23.4", manager: "npm" as const, managerVersion: "10.9.9" };
  spawnSync("git", ["init", "-q", origin], { stdio: "ignore" });
  writeFileSync(join(origin, "package.json"), `${AVA3}\n`);
  spawnSync("git", ["-C", origin, "add", "package.json"], { stdio: "ignore" });
  spawnSync("git", ["-C", origin, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"], { stdio: "ignore" });
  const sha = spawnSync("git", ["-C", origin, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const pkgText = readFileSync(join(origin, "package.json"), "utf8");
  assert.equal(loaderFingerprintNote(pkgText), "ts-node@^8.3.0");
  const fingerprint = dependencyFingerprint(pkgText, "", tool);
  const bare = createHash("sha256").update("peaceai-practice-deps:v1\n").update("npm\0").update("10.9.9\0").update("v22.23.4\0").update(pkgText).update("\0").update("").update("\0").update("").digest("hex");
  assert.notEqual(fingerprint, bare);
  const noted = createHash("sha256").update("peaceai-practice-deps:v1\n").update("npm\0").update("10.9.9\0").update("v22.23.4\0").update(pkgText).update("\0").update("").update("\0").update("ts-node@^8.3.0").digest("hex");
  assert.equal(fingerprint, noted);
  const stale = join(cache, "installs", fingerprint);
  mkdirSync(join(stale, "node_modules"), { recursive: true });
  writeFileSync(join(stale, ".practice-complete"), `${fingerprint}\n`);
  writeFileSync(join(stale, "node_modules", "stale"), "kept\n");
  const homesBefore = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("peaceai-install-home-")));
  try {
    const installed = ensurePracticeInstall(origin, { repo: "example/loader", baseSha: sha, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false);
    assert.equal(installed.ok, true, installed.lines.join("\n"));
    assert.equal(existsSync(join(installed.modules ?? "", "ts-node", "package.json")), true);
    assert.equal(existsSync(join(installed.modules ?? "", "stale")), false);
    const args = readFileSync(log, "utf8");
    const repair = args.split("\n").find((line) => line.includes("ts-node@"));
    assert.ok(repair, args);
    assert.match(repair ?? "", /ts-node@\^8\.3\.0/);
    assert.match(repair ?? "", /--ignore-scripts/);
    assert.match(repair ?? "", /--no-save/);
    assert.doesNotMatch(repair ?? "", /ts-node@latest/);
    const leaked = readdirSync(tmpdir()).filter((name) => name.startsWith("peaceai-install-home-") && !homesBefore.has(name));
    assert.deepEqual(leaked, []);
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
    const applied = applyPracticeTestLaunch(root, ["./node_modules/.bin/ava", testFile], testFile, "relaxed");
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

test("a loader package.json with no resolvable entry is not installed", () => {
  const dir = mkdtempSync(join(tmpdir(), "practice-loader-entry-"));
  const pkg = join(dir, "node_modules", "ts-node");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), "{\"name\":\"ts-node\",\"bin\":\"dist/bin.js\"}\n");
  assert.equal(loaderInstalled(join(dir, "node_modules"), "ts-node"), false);
  mkdirSync(join(pkg, "dist"), { recursive: true });
  writeFileSync(join(pkg, "dist", "bin.js"), "#!/usr/bin/env node\n");
  assert.equal(loaderInstalled(join(dir, "node_modules"), "ts-node"), true);
  writeFileSync(join(pkg, "package.json"), "{\"name\":\"ts-node\",\"main\":\"dist/index.js\"}\n");
  assert.equal(loaderInstalled(join(dir, "node_modules"), "ts-node"), false);
  mkdirSync(join(pkg, "dist"), { recursive: true });
  writeFileSync(join(pkg, "dist", "index.js"), "module.exports={}\n");
  assert.equal(loaderInstalled(join(dir, "node_modules"), "ts-node"), true);
  rmSync(dir, { recursive: true, force: true });
});

test("a live install stays in place while a missing loader is rebuilt beside it", async () => {
  const node = visibleNodeBin();
  assert.ok(node);
  const origin = mkdtempSync(join(tmpdir(), "practice-live-"));
  const cache = mkdtempSync(join(tmpdir(), "practice-live-cache-"));
  const bin = mkdtempSync(join(tmpdir(), "practice-live-bin-"));
  const phase = join(cache, "phase");
  const log = join(cache, "npm-args");
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho start > ${JSON.stringify(phase)}\nsleep 0.4\necho "$@" >> ${JSON.stringify(log)}\nif echo "$@" | grep -q 'ts-node@'; then mkdir -p node_modules/ts-node; printf '%s\\n' '{"name":"ts-node","version":"8.10.2","main":"index.js"}' > node_modules/ts-node/package.json; printf '%s\\n' 'module.exports={}' > node_modules/ts-node/index.js; echo done > ${JSON.stringify(phase)}; exit 0; fi\nmkdir -p node_modules/ava\nprintf '%s\\n' '{"name":"ava","main":"index.js"}' > node_modules/ava/package.json\nprintf '%s\\n' 'module.exports={}' > node_modules/ava/index.js\necho done > ${JSON.stringify(phase)}\nexit 0\n`);
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
  writeFileSync(join(stale, "node_modules", "kept"), "live\n");
  const watch = join(cache, "watch");
  const child = spawn(node, ["-e", `
    const fs = require("fs");
    const dest = process.argv[1];
    const phase = process.argv[2];
    const out = process.argv[3];
    fs.writeFileSync(out, "watching\\n");
    let gap = false;
    let saw = false;
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      let text = "";
      try { text = fs.readFileSync(phase, "utf8").trim(); } catch { text = ""; }
      if (text === "start") {
        saw = true;
        if (!fs.existsSync(dest + "/node_modules/kept")) gap = true;
      }
      if (text === "done") break;
    }
    fs.appendFileSync(out, (gap ? "gap" : "held") + "\\n" + (saw ? "saw" : "missed") + "\\n");
  `, stale, phase, watch], { stdio: "ignore" });
  try {
    const started = Date.now();
    while (!existsSync(watch) && Date.now() - started < 2000) spawnSync("sleep", ["0.01"]);
    const installed = ensurePracticeInstall(origin, { repo: "example/live", baseSha: sha, toolchain: tool }, cache, { npm: false, pnpm: false, yarn: false }, false);
    assert.equal(installed.ok, true, installed.lines.join("\n"));
    await new Promise((resolve) => child.on("exit", resolve));
    const report = readFileSync(watch, "utf8");
    assert.match(report, /saw/);
    assert.match(report, /held/);
    assert.doesNotMatch(report, /gap/);
    assert.equal(existsSync(join(installed.modules ?? "", "ts-node", "index.js")), true);
  } finally {
    child.kill();
    rmSync(origin, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test("a candidate with a type error does not pass-after", { timeout: 120_000 }, (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "practice-type-after-"));
  const pkg = {
    scripts: { test: "node -r ts-node/register test/t.ts" },
    devDependencies: { "ts-node": "10.9.2", typescript: "5.4.5" },
  };
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg) + "\n");
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, esModuleInterop: true, module: "commonjs", moduleResolution: "node", target: "es2020", skipLibCheck: true },
    include: ["src"],
  }) + "\n");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "src", "f.ts"), "export function f(a: number): number {\n  const bad: string = 1;\n  return a + 1;\n}\n");
  writeFileSync(join(root, "test", "t.ts"), "import assert from \"node:assert/strict\";\nimport { f } from \"../src/f\";\nassert.equal(f(1), 2);\n");
  const installed = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: root, encoding: "utf8", timeout: 90_000,
  });
  if (installed.status !== 0) { rmSync(root, { recursive: true, force: true }); assert.fail(installed.stderr || installed.stdout); }
  const store = mkdtempSync(join(tmpdir(), "practice-type-modules-"));
  rmSync(store, { recursive: true, force: true });
  spawnSync("cp", ["-a", join(root, "node_modules"), store], { stdio: "ignore" });
  rmSync(join(root, "package-lock.json"), { force: true });
  spawnSync("git", ["init", "-q", root], { stdio: "ignore" });
  spawnSync("git", ["-C", root, "add", "package.json", "tsconfig.json", "src/f.ts", "test/t.ts"], { stdio: "ignore" });
  spawnSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"], { stdio: "ignore" });
  const restore = () => {
    rmSync(join(root, "node_modules"), { recursive: true, force: true });
    spawnSync("cp", ["-a", store, join(root, "node_modules")], { stdio: "ignore" });
  };
  const cmd = [join(root, "node_modules/.bin/ts-node"), "test/t.ts"];
  const modules = join(root, "node_modules");
  try {
    restore();
    const before = runRecordedTest(root, cmd, node, modules, "before", "test/t.ts");
    assert.equal(before.blocked, false, "fail-before was blocked");
    assert.notEqual(before.code, 0, "fail-before type-checks and fails on const bad: string = 1");
    restore();
    const after = runRecordedTest(root, cmd, node, modules, "after", "test/t.ts");
    assert.equal(after.blocked, false, "pass-after was blocked");
    assert.notEqual(after.code, 0, "pass-after type-checks and fails on const bad: string = 1");
    assert.equal(before.code !== 0 && after.code === 0, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
  }
});

test("a no-op candidate does not pass when only the relaxed launch fails", { timeout: 120_000 }, (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "practice-enum-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    scripts: { test: "node -r ts-node/register test/t.ts" },
    devDependencies: { "ts-node": "10.9.2", typescript: "5.4.5" },
  }) + "\n");
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, esModuleInterop: true, module: "commonjs", moduleResolution: "node", target: "es2020", skipLibCheck: true },
    include: ["src"],
  }) + "\n");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "src", "levels.d.ts"), "export const enum Level { Low = 1, High = 2 }\n");
  writeFileSync(join(root, "src", "f.ts"), "import { Level } from \"./levels\";\nexport function f(level: Level): string {\n  return level === Level.High ? \"high\" : \"low\";\n}\n");
  writeFileSync(join(root, "test", "t.ts"), "import assert from \"node:assert/strict\";\nimport { Level } from \"../src/levels\";\nimport { f } from \"../src/f\";\nassert.equal(f(Level.High), \"high\");\n");
  const installed = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root, encoding: "utf8", timeout: 90_000 });
  if (installed.status !== 0) { rmSync(root, { recursive: true, force: true }); assert.fail(installed.stderr || installed.stdout); }
  const store = mkdtempSync(join(tmpdir(), "practice-enum-modules-"));
  rmSync(store, { recursive: true, force: true });
  spawnSync("cp", ["-a", join(root, "node_modules"), store], { stdio: "ignore" });
  rmSync(join(root, "package-lock.json"), { force: true });
  spawnSync("git", ["init", "-q", root], { stdio: "ignore" });
  spawnSync("git", ["-C", root, "add", "package.json", "tsconfig.json", "src/levels.d.ts", "src/f.ts", "test/t.ts"], { stdio: "ignore" });
  spawnSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"], { stdio: "ignore" });
  const restore = () => {
    rmSync(join(root, "node_modules"), { recursive: true, force: true });
    spawnSync("cp", ["-a", store, join(root, "node_modules")], { stdio: "ignore" });
  };
  const cmd = [join(root, "node_modules/.bin/ts-node"), "test/t.ts"];
  const modules = join(root, "node_modules");
  try {
    restore();
    const before = runRecordedTest(root, cmd, node, modules, "before", "test/t.ts");
    restore();
    const after = runRecordedTest(root, cmd, node, modules, "after", "test/t.ts");
    assert.equal(before.blocked, false);
    assert.equal(after.blocked, false);
    assert.equal(before.code, 0);
    assert.equal(after.code, 0);
    assert.equal(before.code !== 0 && after.code === 0, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
  }
});

test("publishing an install does not delete the tree a process still has as its cwd", async () => {
  const node = visibleNodeBin();
  assert.ok(node);
  const root = mkdtempSync(join(tmpdir(), "practice-publish-"));
  const dest = join(root, "installs", "abc");
  const staging = join(root, "installs", "abc.partial");
  mkdirSync(join(dest, "node_modules"), { recursive: true });
  writeFileSync(join(dest, "node_modules", "kept"), "old\n");
  mkdirSync(join(staging, "node_modules"), { recursive: true });
  writeFileSync(join(staging, "node_modules", "kept"), "new\n");
  const out = join(root, "reader");
  const go = join(root, "go");
  const child = spawn(node, ["-e", `
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], "ready");
    const end = Date.now() + 5000;
    while (!fs.existsSync(process.argv[2]) && Date.now() < end) {}
    try { fs.readFileSync("node_modules/kept"); fs.writeFileSync(process.argv[1], "ok"); }
    catch { fs.writeFileSync(process.argv[1], "missing"); }
  `, out, go], { cwd: dest, stdio: "ignore" });
  try {
    const started = Date.now();
    while (!existsSync(out) && Date.now() - started < 2000) spawnSync("sleep", ["0.01"]);
    publishInstallTree(staging, dest);
    writeFileSync(go, "1\n");
    await new Promise((resolve) => child.on("exit", resolve));
    assert.equal(readFileSync(out, "utf8"), "ok");
    assert.equal(readFileSync(join(dest, "node_modules", "kept"), "utf8"), "new\n");
    assert.equal(existsSync(join(root, "installs", "abc.retired-" + process.pid)), false);
    const retired = readdirSync(join(root, "installs")).filter((name) => name.startsWith("abc.retired-"));
    assert.equal(retired.length, 1);
    assert.equal(readFileSync(join(root, "installs", retired[0]!, "node_modules", "kept"), "utf8"), "old\n");
  } finally {
    child.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test("retired installs are reaped only after a day, and a lock or reader mark keeps them", () => {
  const cache = mkdtempSync(join(tmpdir(), "practice-reap-"));
  const installs = join(cache, "installs");
  const locks = join(cache, "locks");
  mkdirSync(installs, { recursive: true });
  mkdirSync(locks, { recursive: true });
  const oldStamp = Date.now() - RETIRED_INSTALL_MS - 1000;
  const young = join(installs, `aa.retired-1-${Date.now()}`);
  const aged = join(installs, `bb.retired-1-${oldStamp}`);
  const marked = join(installs, `cc.retired-1-${oldStamp}`);
  const locked = join(installs, `dd.retired-1-${oldStamp}`);
  for (const dir of [young, aged, marked, locked]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(marked, INSTALL_READER_MARK), "1\n");
  writeFileSync(join(locks, "dd.lock"), "1\n");
  try {
    const removed = reapRetiredInstalls(cache);
    assert.equal(existsSync(young), true);
    assert.equal(existsSync(aged), false);
    assert.equal(existsSync(marked), true);
    assert.equal(existsSync(locked), true);
    assert.equal(removed.length, 1);
    assert.equal(removed[0], aged);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});
