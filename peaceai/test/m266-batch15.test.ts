// Batch 15. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { rawInterpolate, registrationDedupe, repairBatch15, ttyGate } from "../lib/batch15.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const fix = resolve(import.meta.dirname, "fixtures/m266");
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
const readHarness = (name: string) => readFileSync(join(import.meta.dirname, name), "utf8");
const modules = resolve(repoRoot, "node_modules");
const layout = JSON.parse(readFileSync(join(import.meta.dirname, "m266-layout.json"), "utf8")) as Record<string, { fixture: string; dest: string }[]>;

function filesOf(group: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of layout[group]!) out[row.dest] = readFix(row.fixture);
  return out;
}
function one(group: string, dest: string): string {
  return filesOf(group)[dest]!;
}
function place(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}
function gitInit(root: string) {
  const git = (args: string[]) => spawnSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
}
function runtimeModules(extra: "c12" | "none"): string {
  const dir = mkdtempSync(join(tmpdir(), "m266-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    const copied = spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" });
    assert.equal(copied.status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), readHarness("m266-vitest-shim.js"));
  if (extra === "c12") {
    const stub = (name: string, body: string) => {
      mkdirSync(join(nm, name), { recursive: true });
      writeFileSync(join(nm, name, "package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
      writeFileSync(join(nm, name, "index.js"), body);
    };
    stub("pathe", `export { resolve, join, normalize, dirname, basename, extname } from "node:path";\n`);
    stub("defu", `export function defu(target, ...sources) { return Object.assign({}, ...sources, target); }\n`);
    stub("exsolve", `export function resolveModulePath() { return undefined; }\n`);
    stub("rc9", `export function read() { return {}; }\nexport function update() {}\n`);
    stub("perfect-debounce", `export function debounce(fn) { return fn; }\n`);
  }
  return nm;
}

test("a TTY is not the kiro agent, and a check that is not detectAgent is refused", () => {
  const source = one("se", "src/agents.ts");
  const next = ttyGate(source);
  assert.match(next ?? "", /noTTY: true/);
  assert.equal(ttyGate(next!), null);
  assert.equal(ttyGate(source.replace("export function detectAgent", "export function kept")), null);
});

test("overlaps are deduped by registration, and a check that is not routesOverlap is refused", () => {
  const source = one("r3", "src/operations/overlap.ts");
  const next = registrationDedupe(source);
  assert.match(next ?? "", /entry\.route/);
  assert.equal(registrationDedupe(next!), null);
  assert.equal(registrationDedupe(source.replace('from "../_subsume.ts"', 'from "../kept.ts"')), null);
});

test("an escaped dotenv reference stays literal, and a check that is not setupDotenv is refused", () => {
  const source = one("cd", "src/dotenv.ts");
  const next = rawInterpolate(source);
  assert.match(next ?? "", /resolvedValues/);
  assert.equal(rawInterpolate(next!), null);
  assert.equal(rawInterpolate(source.replace("export async function setupDotenv", "export async function kept")), null);
});

test("deleting the new line is killed by the published check, in-process and inside bwrap", (t) => {
  const agent = ttyGate(one("se", "src/agents.ts"));
  const overlap = registrationDedupe(one("r3", "src/operations/overlap.ts"));
  const dotenv = rawInterpolate(one("cd", "src/dotenv.ts"));
  assert.ok(agent && overlap && dotenv);
  const agentFile = agent.replace("if (opts?.noTTY && process.stdout?.isTTY)", "if (opts?.noTTY && !process.stdout?.isTTY)");
  const overlapFile = overlap.replace("if (routes?.has(entry.route)) continue;", "if (false) continue;");
  const dotenvFile = dotenv.replace("  const raw = { ...target };\n", "");
  assert.notEqual(agentFile, agent);
  assert.notEqual(overlapFile, overlap);
  assert.notEqual(dotenvFile, dotenv);
  const node = visibleNodeBin();
  assert.ok(node);
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const plain = runtimeModules("none");
  const c12 = runtimeModules("c12");
  const cases: { files: Record<string, string>; dest: string; body: string; cmd: string[]; pattern: string; modules: string }[] = [
    {
      files: { ...filesOf("se"), "package.json": `{"type":"module"}\n`, "src/agents.ts": agentFile },
      dest: "src/agents.ts", body: agentFile, cmd: [...tsx, "test/agents.test.ts"], pattern: "agents\\.ts$", modules: plain,
    },
    {
      files: { ...filesOf("r3"), "package.json": `{"type":"module"}\n`, "src/operations/overlap.ts": overlapFile },
      dest: "src/operations/overlap.ts", body: overlapFile, cmd: [...tsx, "test/overlap.test.ts"], pattern: "overlap\\.ts$", modules: plain,
    },
    {
      files: { ...filesOf("cd"), "package.json": `{"type":"module"}\n`, "src/dotenv.ts": dotenvFile },
      dest: "src/dotenv.ts", body: dotenvFile, cmd: [...tsx, "test/dotenv.test.ts"], pattern: "dotenv\\.ts$", modules: c12,
    },
  ];
  for (const row of cases) {
    const dir = mkdtempSync(join(tmpdir(), "m266-kill-"));
    place(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(row.modules, join(dir, "node_modules"));
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    assert.notEqual(direct.status, 0, row.dest);
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(sand.unsafe, false, row.dest);
    assert.notEqual(sand.code, 0, row.dest);
    gitInit(dir);
    assert.equal(repairBatch15({
      root: dir, output: sand.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    }), null, row.dest);
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(resolve(plain, ".."), { recursive: true, force: true });
  rmSync(resolve(c12, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 15 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["detectAgent", "routesOverlap", "setupDotenv"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m266-grade-"));
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src/fn.ts"), body);
      return dir;
    };
    const left = make(over);
    const right = make(strict);
    try {
      const graded = gradeBehavior({
        candidateRoot: left, fixRoot: right, nodePath: node!,
        target: { symbol, file: "src/fn.ts", form: "named", exportName: symbol, args: [["a"]] },
      });
      assert.equal(graded.behavior, "verified_test_only", symbol);
    } finally {
      rmSync(left, { recursive: true, force: true });
      rmSync(right, { recursive: true, force: true });
    }
  }
});

test("the published std-env, rou3, and c12 checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const tsx = [node!, "node_modules/tsx/dist/cli.mjs"];
  const plain = runtimeModules("none");
  const c12 = runtimeModules("c12");

  const env = mkdtempSync(join(tmpdir(), "m266-env-"));
  place(env, { ...filesOf("se"), "package.json": `{"type":"module"}\n` });
  gitInit(env);
  const ecmd = [...tsx, "test/agents.test.ts"];
  const agents = runInPracticeSandbox(env, ecmd, 120_000, { capture: true, nodePath: node, nodeModules: plain });
  assert.equal(agents.unsafe, false, agents.stdout.slice(-400));
  assert.notEqual(agents.code, 0, agents.stdout.slice(-700));
  const tty = repairBatch15({ root: env, output: agents.stdout, sourcePattern: "agents\\.ts$", nodePath: node!, nodeModules: plain, testCommand: ecmd });
  assert.ok(tty, agents.stdout.slice(-900));
  assert.match(tty!.diff, /noTTY/);

  const router = mkdtempSync(join(tmpdir(), "m266-rou-"));
  place(router, { ...filesOf("r3"), "package.json": `{"type":"module"}\n` });
  gitInit(router);
  const rcmd = [...tsx, "test/overlap.test.ts"];
  const overlaps = runInPracticeSandbox(router, rcmd, 120_000, { capture: true, nodePath: node, nodeModules: plain });
  assert.equal(overlaps.unsafe, false, overlaps.stdout.slice(-400));
  assert.notEqual(overlaps.code, 0, overlaps.stdout.slice(-700));
  const deduped = repairBatch15({ root: router, output: overlaps.stdout, sourcePattern: "overlap\\.ts$", nodePath: node!, nodeModules: plain, testCommand: rcmd });
  assert.ok(deduped, overlaps.stdout.slice(-900));
  assert.match(deduped!.diff, /entry\.route/);

  const config = mkdtempSync(join(tmpdir(), "m266-c12-"));
  place(config, { ...filesOf("cd"), "package.json": `{"type":"module"}\n` });
  gitInit(config);
  const ccmd = [...tsx, "test/dotenv.test.ts"];
  const dotted = runInPracticeSandbox(config, ccmd, 120_000, { capture: true, nodePath: node, nodeModules: c12 });
  assert.equal(dotted.unsafe, false, dotted.stdout.slice(-400));
  assert.notEqual(dotted.code, 0, dotted.stdout.slice(-700));
  const raw = repairBatch15({ root: config, output: dotted.stdout, sourcePattern: "dotenv\\.ts$", nodePath: node!, nodeModules: c12, testCommand: ccmd });
  assert.ok(raw, dotted.stdout.slice(-900));
  assert.match(raw!.diff, /resolvedValues/);

  rmSync(env, { recursive: true, force: true });
  rmSync(router, { recursive: true, force: true });
  rmSync(config, { recursive: true, force: true });
  rmSync(resolve(plain, ".."), { recursive: true, force: true });
  rmSync(resolve(c12, ".."), { recursive: true, force: true });
});
