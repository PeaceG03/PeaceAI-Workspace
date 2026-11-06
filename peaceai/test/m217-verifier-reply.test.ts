// M217 (batch 53): close the forged reply-line protocol residual with a runner-generated per-call nonce.
// Spec: peaceai/spec/verifier-v1.md ("M217"). EXPERIMENTAL oop-v1; NOT the default; NOT for credit.
// Closes (fail closed): missing / wrong nonce, extra lines, duplicate lines, out-of-order id, unparsed / noise,
// replay of a prior call's stdout under a new nonce. Remaining flag-trust residual is named OOP_REPLY_FORGE_TERMINAL.
// Every m217-guard line deleted is caught by its own case.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as V from "../lib/verifier.ts";
import { STAGE2_CAND_ENV, stage2CandUid, type CandUid } from "../lib/selfpropose.ts";

type VT = typeof V;
const libDir = join(import.meta.dirname, "../lib");
const specPath = join(import.meta.dirname, "../spec/verifier-v1.md");
const tsPath = createRequire(join(libDir, "verifier.ts")).resolve("typescript");
const CAND = process.env.M217_CAND ?? process.env.M207_CAND ?? process.env.M204_CAND ?? process.env.M146_CAND ?? "";
const VERIFIER = process.env.M217_VERIFIER ?? process.env.M207_VERIFIER ?? process.env.PEACEAI_VERIFIER_UID ?? "";
const cu = stage2CandUid({ [STAGE2_CAND_ENV]: CAND });
const cand: CandUid | null = cu.ok ? cu.cand : null;
const vOk = cand !== null && V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand).ok;
const skipE2e = !(cand && vOk) && "needs peaceai-cand3 + PEACEAI_VERIFIER_UID=peaceai-verify";
const env = { ...process.env, [STAGE2_CAND_ENV]: CAND, [V.VERIFIER_UID_ENV]: VERIFIER };

const base = mkdtempSync(join(tmpdir(), "peaceai-m217-"));
after(() => {
  if (cand) {
    const pids = (spawnSync("ps", ["-e", "-o", "pid=,uid="], { encoding: "utf8" }).stdout ?? "").split("\n")
      .map((l) => l.trim().split(/\s+/).map(Number)).filter((x) => x.length === 2 && x[1] === cand.uid && x[0]! > 0).map(([p]) => p!);
    for (const p of pids) spawnSync("sudo", ["-n", "kill", "-KILL", String(p)], { stdio: "ignore" });
  }
  rmSync(base, { recursive: true, force: true });
});
let n = 0;
function fixture(files: Record<string, string>): string {
  const d = join(base, `fx-${n++}`);
  for (const [f, t] of Object.entries(files)) { mkdirSync(join(d, f, ".."), { recursive: true }); writeFileSync(join(d, f), t); }
  return d;
}
const ADD_OK = `export function add(a, b) { return a + b; }\n`;
const ADD_CASE: V.DataCase[] = [{ id: "a", fn: "add", args: [2, 3], expect: { ok: true, value: 5, cmp: "is" } }];
const N1 = "11".repeat(16);
const N2 = "22".repeat(16);
const N3 = "33".repeat(16);

function reply(o: Record<string, unknown>): string { return JSON.stringify(o) + "\n"; }
function okLine(id: number, nonce: string, value: unknown): string {
  return reply({ v: 1, id, nonce, ok: true, value, exact: true, sync: true });
}

// ---- pure judge shapes (no cand): each forging shape refused
test("M217 forge shapes: missing / wrong nonce, extra, duplicate, out-of-order, unparsed, replay", () => {
  const c = ADD_CASE[0]!;
  const baseRun = (stdout: string, nonce: string) => ({ status: 0, stdout, nonce });

  // missing nonce on the wire
  assert.equal(V.judgeRuns({
    cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [baseRun(reply({ v: 1, id: 1, ok: true, value: 5, exact: true, sync: true }), N1)],
  }).code, "OOP_PROTOCOL");

  // wrong nonce (reply nonce != runner nonce)
  assert.equal(V.judgeRuns({
    cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [baseRun(okLine(1, N2, 5), N1)],
  }).code, "OOP_PROTOCOL");
  assert.equal((V.judgeRuns({
    cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [baseRun(okLine(1, N2, 5), N1)],
  }) as any).detail, "nonce-mismatch");

  // runner nonce missing / malformed
  assert.equal(V.judgeRuns({
    cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [{ status: 0, stdout: okLine(1, N1, 5) }],
  }).code, "OOP_PROTOCOL");

  // extra line (two protocol lines)
  assert.equal(V.judgeRuns({
    cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [baseRun(okLine(1, N1, 5) + okLine(1, N1, 5), N1)],
  }).code, "OOP_PROTOCOL");
  assert.match(String((V.judgeRuns({
    cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [baseRun(okLine(1, N1, 5) + okLine(1, N1, 5), N1)],
  }) as any).detail), /^lines:/);

  // duplicate / empty with non-zero exit already covered; unparsed noise
  assert.equal(V.judgeRuns({
    cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [baseRun("# pass 1\n", N1)],
  }).code, "OOP_STDOUT_NOISE");

  // out-of-order id (reply id 2 for case index 0)
  assert.equal(V.judgeRuns({
    cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [baseRun(okLine(2, N1, 5), N1)],
  }).code, "OOP_PROTOCOL");
  assert.equal((V.judgeRuns({
    cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [baseRun(okLine(2, N1, 5), N1)],
  }) as any).detail, "id-mismatch");

  // replay: prior call's stdout (nonce N1) under a new runner nonce N2
  const prior = okLine(1, N1, 5);
  assert.equal(V.judgeRuns({
    cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [baseRun(prior, N2)],
  }).code, "OOP_PROTOCOL");

  // multi-case: second run reuses first run's stdout (wrong nonce for case 2)
  const cases2: V.DataCase[] = [
    { id: "a", fn: "add", args: [1, 1], expect: { ok: true, value: 2, cmp: "is" } },
    { id: "b", fn: "add", args: [2, 2], expect: { ok: true, value: 4, cmp: "is" } },
  ];
  assert.equal(V.judgeRuns({
    cases: cases2, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [baseRun(okLine(1, N1, 2), N1), baseRun(okLine(1, N1, 4), N3)], // wrong id + wrong nonce on #2
  }).code, "OOP_PROTOCOL");

  // honest: matching nonce + id
  const ok = V.judgeRuns({
    cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
    runs: [baseRun(okLine(1, N1, 5), N1)],
  });
  assert.equal(ok.code, "OOP_OK");
  if (ok.code === "OOP_OK") assert.deepEqual({ pass: ok.pass, fail: ok.fail }, { pass: 1, fail: 0 });
});

test("M217 parseResponse requires a 32-hex nonce", () => {
  assert.equal((V.parseResponse(JSON.stringify({ v: 1, id: 1, ok: true, value: 1 })) as any).detail, "nonce");
  assert.equal((V.parseResponse(JSON.stringify({ v: 1, id: 1, ok: true, value: 1, nonce: "short" })) as any).detail, "nonce");
  assert.equal((V.parseResponse(JSON.stringify({ v: 1, id: 1, ok: true, value: 1, nonce: "GG".repeat(16) })) as any).detail, "nonce");
  const n = "0f".repeat(16);
  const g = V.parseResponse(JSON.stringify({ v: 1, id: 1, ok: true, value: 1, nonce: n, exact: true, sync: true }));
  assert.equal(g.ok, true);
  if (g.ok && g.resultOk) assert.equal(g.nonce, n);
});

test("M217 newReplyNonce: 32 lowercase hex, distinct across calls", () => {
  const a = V.newReplyNonce(), b = V.newReplyNonce();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.match(b, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

test("M217 terminal: OOP_REPLY_FORGE_TERMINAL names the remaining flag-trust residual", () => {
  assert.equal(V.OOP_REPLY_FORGE_TERMINAL, "OOP_REPLY_FORGE_TERMINAL");
  assert.equal(V.oopReplyForgeTerminal(), "OOP_REPLY_FORGE_TERMINAL");
  const spec = readFileSync(specPath, "utf8");
  assert.match(spec, /## M217/);
  assert.match(spec, /OOP_REPLY_FORGE_TERMINAL/);
  assert.match(spec, /per-call nonce/i);
  assert.match(spec, /nonce-mismatch|wrong nonce/i);
});

// ---- e2e: honest path still works; a hostile module that forges without the nonce is refused
test("M217 e2e: honest add passes; forged stdout without the call nonce is refused", { skip: skipE2e }, () => {
  const ok = V.verify({ root: fixture({ "src/add.mjs": ADD_OK }), module: "src/add.mjs", cases: ADD_CASE, env });
  assert.equal(ok.code, "OOP_OK", JSON.stringify(ok));
  if (ok.code === "OOP_OK") assert.deepEqual({ pass: ok.pass, fail: ok.fail }, { pass: 1, fail: 0 });

  // module prints a forged protocol line (fixed nonce) then returns; harness also replies -> extra line OR
  // if exit before harness reply, wrong/missing binding. Either way not OOP_OK with a pass.
  const forge = `export function add(a, b) {
  process.stdout.write(JSON.stringify({ v: 1, id: 1, nonce: "${N1}", ok: true, value: 5, exact: true, sync: true }) + "\\n");
  return a + b;
}
`;
  const bad = V.verify({ root: fixture({ "src/add.mjs": forge }), module: "src/add.mjs", cases: ADD_CASE, env });
  assert.notEqual(bad.code === "OOP_OK" && bad.pass === 1 && bad.fail === 0, true, JSON.stringify(bad));
});

// ---- mutation: each m217-guard
function rewriteV(t: string): string {
  return t.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
}
const SRC = {
  verifier: readFileSync(join(libDir, "verifier.ts"), "utf8"),
  harness: readFileSync(join(libDir, "verifier-harness.cjs"), "utf8"),
  judge: readFileSync(join(libDir, "verifier-judge.cjs"), "utf8"),
};
const tagsOf = (t: string, prefix: string) => t.split("\n").flatMap((l) => {
  const m = new RegExp(`// ${prefix}-guard:([a-z0-9-]+)`).exec(l);
  return m ? [m[1]!] : [];
});
const drop = (text: string, prefix: string, tag: string) => {
  const ls = text.split("\n"), hit = (l: string) => new RegExp(`// ${prefix}-guard:${tag}(?![a-z0-9-])`).test(l);
  assert.equal(ls.filter(hit).length, 1, `one line holds ${tag}`);
  return ls.filter((l) => !hit(l)).join("\n");
};
async function variant(o: { verifier?: string; judge?: string } = {}): Promise<{ V: VT }> {
  const d = join(base, `var-${n++}`);
  mkdirSync(join(d, "lib"), { recursive: true }); mkdirSync(join(d, "spec"), { recursive: true });
  writeFileSync(join(d, "lib/verifier.ts"), rewriteV(o.verifier ?? SRC.verifier));
  writeFileSync(join(d, "lib/verifier-harness.cjs"), SRC.harness);
  writeFileSync(join(d, "lib/verifier-judge.cjs"), o.judge ?? SRC.judge);
  writeFileSync(join(d, "spec/verifier-v1.md"), readFileSync(specPath));
  const mod = (await import(pathToFileURL(join(d, "lib/verifier.ts")).href + `?t=${n}`)) as VT;
  return { V: mod };
}

test("M217 mutation: deleting m217-guard:nonce makes wrong-nonce pass; nonce-parse / terminal guards caught", async () => {
  const jTags = tagsOf(SRC.judge, "m217");
  const vTags = tagsOf(SRC.verifier, "m217");
  assert.deepEqual(jTags.sort(), ["nonce", "nonce-parse"]);
  assert.deepEqual(vTags.sort(), ["terminal"]);

  // control: wrong nonce refused
  {
    const m = await variant();
    const r = m.V.judgeRuns({
      cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
      runs: [{ status: 0, stdout: okLine(1, N2, 5), nonce: N1 }],
    });
    assert.equal(r.code, "OOP_PROTOCOL");
  }
  // delete m217-guard:nonce -> wrong nonce is no longer refused at the match site (may still parse)
  {
    const m = await variant({ judge: drop(SRC.judge, "m217", "nonce") });
    const r = m.V.judgeRuns({
      cases: ADD_CASE, maxBytes: V.MAX_LINE_BYTES, maxDepth: V.MAX_DEPTH,
      runs: [{ status: 0, stdout: okLine(1, N2, 5), nonce: N1 }],
    });
    // without the match check, a well-formed reply with a different nonce credits
    assert.equal(r.code, "OOP_OK", `mutant must credit wrong nonce, got ${JSON.stringify(r)}`);
  }
  // delete m217-guard:nonce-parse -> missing nonce parses (then nonce-mismatch or credit)
  {
    const m = await variant({ judge: drop(SRC.judge, "m217", "nonce-parse") });
    const parsed = m.V.parseResponse(JSON.stringify({ v: 1, id: 1, ok: true, value: 5, exact: true, sync: true }));
    assert.equal(parsed.ok, true, "mutant must accept a reply without nonce");
  }
  // delete m217-guard:terminal -> helper falls through to the open sentinel
  {
    const m = await variant({ verifier: drop(SRC.verifier, "m217", "terminal") });
    assert.equal(m.V.oopReplyForgeTerminal(), "OOP_REPLY_FORGE_OPEN");
  }
});
