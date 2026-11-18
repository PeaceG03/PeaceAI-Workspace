// Batch 19. The library files are the published parent and the published test.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { bodyOnSocket, genericAngles, repairBatch19, skipEndedResponse } from "../lib/batch19.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";

const fix = resolve(import.meta.dirname, "fixtures/m270");
const place = JSON.parse(readFileSync(join(import.meta.dirname, "m270-place.json"), "utf8")) as Record<string, string>;
const readFix = (name: string) => readFileSync(join(fix, name), "utf8");
const modules = resolve(import.meta.dirname, "../../node_modules");

function placeFiles(root: string, files: Record<string, string>) {
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

function filesOf(prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [fixture, dest] of Object.entries(place)) {
    if (!fixture.startsWith(prefix) || dest.startsWith("NODE/")) continue;
    out[dest] = readFix(fixture);
  }
  return out;
}

function dep(nm: string, name: string, manifest: string, files: Record<string, string>) {
  const root = join(nm, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), manifest);
  for (const [rel, fixture] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), readFileSync(join(fix, fixture)));
  }
}

function runtime(kind: "mlly" | "httpxy" | "srvx"): string {
  const dir = mkdtempSync(join(tmpdir(), "m270-mods-"));
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  for (const name of ["tsx", "esbuild", "@esbuild"]) {
    assert.equal(spawnSync("cp", ["-a", join(modules, name), join(nm, name)], { stdio: "ignore" }).status, 0, name);
  }
  mkdirSync(join(nm, "vitest"));
  writeFileSync(join(nm, "vitest/package.json"), `{"type":"module","exports":{".":"./index.js"}}\n`);
  writeFileSync(join(nm, "vitest/index.js"), readFileSync(join(import.meta.dirname, "m270-vitest-shim.js")));
  if (kind === "mlly") {
    dep(nm, "acorn", `{"exports":{".":{"import":"./dist/acorn.mjs","default":"./dist/acorn.mjs"}}}\n`, { "dist/acorn.mjs": "acorn-dist-acorn.mjs.txt" });
    dep(nm, "pathe", `{"type":"module","exports":{".":"./dist/index.mjs"}}\n`, {
      "dist/index.mjs": "pathe-dist-index.mjs.txt",
      "dist/shared/pathe.M-eThtNZ.mjs": "pathe-dist-shared-pathe.M-eThtNZ.mjs.txt",
    });
    const imr: Record<string, string> = {};
    for (const [fixture, dest] of Object.entries(place)) {
      if (dest.startsWith("NODE/import-meta-resolve/")) imr[dest.slice("NODE/import-meta-resolve/".length)] = fixture;
    }
    dep(nm, "import-meta-resolve", `{"type":"module","exports":{".":"./index.js"}}\n`, imr);
    dep(nm, "ufo", `{"type":"module","exports":{".":"./index.js"}}\n`, {});
    writeFileSync(join(nm, "ufo/index.js"), "export function joinURL(...parts){ return parts.map((p,i)=> i===0 ? String(p).replace(/\\/+$/,\"\") : String(p).replace(/^\\/+/,\"\")).filter(Boolean).join(\"/\"); }\n");
    dep(nm, "pkg-types", `{"type":"module","exports":{".":"./index.js"}}\n`, {});
    writeFileSync(join(nm, "pkg-types/index.js"), [
      "import { readFileSync } from 'node:fs';",
      "import { dirname, join } from 'node:path';",
      "import { fileURLToPath } from 'node:url';",
      "export async function readPackageJSON(id){",
      "  let dir = String(id).startsWith('file:') ? fileURLToPath(id) : String(id);",
      "  for (let i=0;i<6;i++){",
      "    try { return JSON.parse(readFileSync(join(dir,'package.json'),'utf8')); } catch {}",
      "    const next = dirname(dir); if (next===dir) break; dir = next;",
      "  }",
      "  return {};",
      "}",
      "",
    ].join("\n"));
  }
  if (kind === "httpxy") {
    dep(nm, "concat-stream", `{"main":"index.js"}\n`, {});
    writeFileSync(join(nm, "concat-stream/index.js"), [
      "const { Writable } = require('node:stream');",
      "module.exports = function concat(cb){",
      "  const chunks = [];",
      "  const w = new Writable({ write(chunk, _enc, next){ chunks.push(Buffer.from(chunk)); next(); } });",
      "  w.on('finish', () => cb(Buffer.concat(chunks)));",
      "  return w;",
      "};",
      "",
    ].join("\n"));
  }
  if (kind === "srvx") {
    dep(nm, "execa", `{"type":"module","exports":{".":"./index.js"}}\n`, {});
    writeFileSync(join(nm, "execa/index.js"), [
      "import { spawn } from 'node:child_process';",
      "export function execa(bin, args=[], opts={}){",
      "  const child = spawn(bin, args, { env: { ...process.env, ...(opts.env||{}) }, stdio: 'ignore' });",
      "  const promise = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => resolve({ exitCode: code })); });",
      "  promise.nodeChildProcess = child;",
      "  promise.kill = () => child.kill();",
      "  return promise;",
      "}",
      "",
    ].join("\n"));
    dep(nm, "get-port-please", `{"type":"module","exports":{".":"./index.js"}}\n`, {});
    writeFileSync(join(nm, "get-port-please/index.js"), [
      "import net from 'node:net';",
      "export function getRandomPort(){ return new Promise((resolve)=>{ const server=net.createServer(); server.listen(0,'127.0.0.1',()=>{ const port=server.address().port; server.close(()=>resolve(port)); }); }); }",
      "export async function waitForPort(port, opts={}){",
      "  const retries=opts.retries??50, delay=opts.delay??50;",
      "  for (let i=0;i<retries;i++){",
      "    try { await new Promise((resolve,reject)=>{ const socket=net.connect(port, opts.host||'127.0.0.1', ()=>{ socket.end(); resolve(); }); socket.on('error', reject); }); return; }",
      "    catch { await new Promise((r)=>setTimeout(r, delay)); }",
      "  }",
      "  throw new Error('port '+port);",
      "}",
      "",
    ].join("\n"));
  }
  return nm;
}

test("a generic argument is not an export name, and a check that is not this analyzer is refused", () => {
  const source = readFix("ml-src-analyze.ts.txt");
  const next = genericAngles(source);
  assert.match(next ?? "", /_isIdentifierBeforeAngleBracket/);
  assert.equal(genericAngles(next!), null);
  assert.equal(genericAngles(source.replace("function _extractExtraNames(", "function kept(")), null);
});

test("the proxy body waits for the socket, and a check that is not the stream middleware is refused", () => {
  const source = readFix("hx-src-middleware-web-incoming.ts.txt");
  const next = bodyOnSocket(source);
  assert.match(next ?? "", /once\("socket"/);
  assert.equal(bodyOnSocket(next!), null);
  assert.equal(bodyOnSocket(source.replace("export const stream = defineProxyMiddleware(", "export const kept = defineProxyMiddleware(")), null);
});

test("an ended Node response is not written again, and a check that is not sendNodeResponse is refused", () => {
  const source = readFix("sx-src-adapters-_node-send.ts.txt");
  const next = skipEndedResponse(source);
  assert.match(next ?? "", /handleAlreadyEndedResponse/);
  assert.equal(skipEndedResponse(next!), null);
  assert.equal(skipEndedResponse(source.replace("function _sendNodeResponse(", "function kept(")), null);
});

function rows() {
  const node = visibleNodeBin()!;
  const tsx = [node, "node_modules/tsx/dist/cli.mjs"];
  return {
    mods: [] as string[],
    list: [
      {
        files: filesOf("ml-"),
        pattern: "^src/analyze\\.ts$",
        cmd: [...tsx, "test/exports.test.ts"],
        modules: runtime("mlly"),
        why: /IAppMode/,
        restores: /_isIdentifierBeforeAngleBracket/,
      },
      {
        files: filesOf("hx-"),
        pattern: "^src/middleware/web-incoming\\.ts$",
        cmd: [...tsx, "test/middleware/web-incoming.test.ts"],
        modules: runtime("httpxy"),
        why: /ERR_HTTP_HEADERS_SENT/,
        restores: /once\("socket"/,
      },
      {
        files: filesOf("sx-"),
        pattern: "^src/adapters/_node/send\\.ts$",
        cmd: [...tsx, "test/node-error-paths.test.ts"],
        modules: runtime("srvx"),
        why: /ERR_STREAM_WRITE_AFTER_END/,
        restores: /handleAlreadyEndedResponse/,
      },
    ],
  };
}

test("the parent file fails the published check because the repair is absent, in-process and inside bwrap", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) built.mods.push(row.modules);
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m270-kill-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(row.modules, join(dir, "node_modules"));
    gitInit(dir);
    const direct = spawnSync(row.cmd[0]!, row.cmd.slice(1), { cwd: dir, encoding: "utf8" });
    const directOut = `${direct.stdout}\n${direct.stderr}`;
    assert.notEqual(direct.status, 0, directOut.slice(-900));
    assert.match(directOut, row.why, directOut.slice(-900));
    assert.doesNotMatch(directOut, /ReferenceError|SyntaxError|TransformError/, directOut.slice(-400));
    const sand = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(sand.unsafe, false, sand.stdout.slice(-400));
    assert.notEqual(sand.code, 0, sand.stdout.slice(-900));
    assert.match(sand.stdout, row.why, sand.stdout.slice(-900));
    const repaired = repairBatch19({
      root: dir, output: directOut, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    });
    assert.ok(repaired, directOut.slice(-900));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of built.mods) rmSync(resolve(dir, ".."), { recursive: true, force: true });
});

test("an any-cast that only matches one recorded answer is test-only for each batch 19 family", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  for (const symbol of ["findExports", "stream", "sendNodeResponse"]) {
    const strict = `export function ${symbol}(kind: string): string {\n  return kind === "b" ? "B" : "A";\n}\n`;
    const over = `export function ${symbol}(kind: any): string {\n  return "A";\n}\n`;
    const make = (body: string) => {
      const dir = mkdtempSync(join(tmpdir(), "m270-grade-"));
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

test("the published mlly, httpxy, and srvx checks fail before the repair and pass after, inside the sandbox", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const node = visibleNodeBin();
  assert.ok(node);
  const built = rows();
  for (const row of built.list) built.mods.push(row.modules);
  for (const row of built.list) {
    const dir = mkdtempSync(join(tmpdir(), "m270-run-"));
    placeFiles(dir, { ...row.files, ".gitignore": "node_modules\n" });
    symlinkSync(row.modules, join(dir, "node_modules"));
    gitInit(dir);
    const before = runInPracticeSandbox(dir, row.cmd, 120_000, { capture: true, nodePath: node, nodeModules: row.modules });
    assert.equal(before.unsafe, false, before.stdout.slice(-400));
    assert.notEqual(before.code, 0, before.stdout.slice(-500));
    const repaired = repairBatch19({
      root: dir, output: before.stdout, sourcePattern: row.pattern, nodePath: node!, nodeModules: row.modules, testCommand: row.cmd,
    });
    assert.ok(repaired, before.stdout.slice(-900));
    assert.match(repaired!.diff, row.restores);
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of built.mods) rmSync(resolve(dir, ".."), { recursive: true, force: true });
});
