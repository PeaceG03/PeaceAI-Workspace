// M207 (batch 43) verifier-v1: close M204 residuals that can be closed soundly; document the rest.
// Spec: peaceai/spec/verifier-v1.md ("M207"). EXPERIMENTAL, opt-in (VERDICT_MODE oop-v1), NOT the default.
// Closes:
//   (1) ACL-aware write check (POSIX ACL via getfacl; fail-closed OOP_VERIFIER_ACL);
//   (2) injectable privilege probe so has-sudo and probe-failure are testable (non-env DI).
// Documents as irreducible:
//   (3) forged harness reply-line (candidate shares the process; a nonce is still readable).
// Fixtures are synthetic (temp files + setfacl in a private dir we create and remove). No system ACL / user changes.
// Every m207-guard line deleted is caught by its own case. selfpropose / plandefault / plan4 / v4 digest unchanged.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as V from "../lib/verifier.ts";
import { STAGE2_CAND_ENV, stage2CandUid, type CandUid } from "../lib/selfpropose.ts";

type VT = typeof V;
const libDir = join(import.meta.dirname, "../lib");
const specPath = join(import.meta.dirname, "../spec/verifier-v1.md");
const tsPath = createRequire(join(libDir, "verifier.ts")).resolve("typescript");
const CAND = process.env.M207_CAND ?? process.env.M206_CAND ?? process.env.M204_CAND ?? process.env.M146_CAND ?? "";
const VERIFIER = process.env.M207_VERIFIER ?? process.env.M206_VERIFIER ?? process.env.M204_VERIFIER ?? process.env.PEACEAI_VERIFIER_UID ?? "";
const cu = stage2CandUid({ [STAGE2_CAND_ENV]: CAND });
const cand: CandUid | null = cu.ok ? cu.cand : null;
const vOk = cand !== null && V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand).ok;
const skipE2e = !(cand && vOk) && "needs peaceai-cand3 + PEACEAI_VERIFIER_UID=peaceai-verify";
const env = { ...process.env, [STAGE2_CAND_ENV]: CAND, [V.VERIFIER_UID_ENV]: VERIFIER };

const base = mkdtempSync(join(tmpdir(), "peaceai-m207-"));
after(() => {
  V.setVerifierPrivilegeProbeForTests(null);
  if (cand) for (const p of candPids(cand.uid)) spawnSync("sudo", ["-n", "kill", "-KILL", String(p)], { stdio: "ignore" });
  // drop any ACLs we set inside base, then remove
  spawnSync("sudo", ["-n", "rm", "-rf", "--", base], { stdio: "ignore" });
  rmSync(base, { recursive: true, force: true });
});
const candPids = (uid: number) => (spawnSync("ps", ["-e", "-o", "pid=,uid="], { encoding: "utf8" }).stdout ?? "").split("\n")
  .map((l) => l.trim().split(/\s+/).map(Number)).filter((x) => x.length === 2 && x[1] === uid && x[0]! > 0).map(([p]) => p!);
let n = 0;
function fixture(files: Record<string, string>): string {
  const d = join(base, `fx-${n++}`);
  for (const [f, t] of Object.entries(files)) { mkdirSync(join(d, f, ".."), { recursive: true }); writeFileSync(join(d, f), t); }
  return d;
}
const RANGE_OK = `export function span(xs) {
  if (!Array.isArray(xs) || xs.length === 0) throw new TypeError("want non-empty array");
  let min = xs[0], max = xs[0];
  for (const x of xs) { if (x < min) min = x; if (x > max) max = x; }
  return { min, max };
}
`;
const SPAN_CASE: V.DataCase[] = [{ id: "s", fn: "span", args: [[2, 1]], expect: { ok: true, value: { min: 1, max: 2 }, cmp: "deep" } }];

function rewriteV(t: string): string {
  return t.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
}
interface Mods { V: VT }
const SRC = { verifier: readFileSync(join(libDir, "verifier.ts"), "utf8"), harness: readFileSync(join(libDir, "verifier-harness.cjs"), "utf8"), judge: readFileSync(join(libDir, "verifier-judge.cjs"), "utf8") };
async function variant(o: { verifier?: string; aclSpec?: boolean } = {}): Promise<Mods & { dir: string }> {
  const d = join(base, `var-${n++}`);
  mkdirSync(join(d, "lib"), { recursive: true }); mkdirSync(join(d, "spec"), { recursive: true });
  writeFileSync(join(d, "lib/verifier.ts"), rewriteV(o.verifier ?? SRC.verifier));
  writeFileSync(join(d, "lib/verifier-harness.cjs"), SRC.harness);
  writeFileSync(join(d, "lib/verifier-judge.cjs"), SRC.judge);
  copyFileSync(specPath, join(d, "spec/verifier-v1.md"));
  chmodSync(join(d, "spec/verifier-v1.md"), 0o644);
  if (o.aclSpec && cand) {
    const sp = join(d, "spec/verifier-v1.md");
    const r = spawnSync("setfacl", ["-m", `u:${cand.name}:w`, sp], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  return { V: (await import(pathToFileURL(join(d, "lib/verifier.ts")).href + `?t=${n}`)) as VT, dir: d };
}
const tagsOf = (t: string) => t.split("\n").flatMap((l) => { const m = /\/\/ m207-guard:([a-z0-9-]+)/.exec(l); return m ? [m[1]!] : []; });
const drop = (text: string, tag: string) => {
  const ls = text.split("\n"), hit = (l: string) => new RegExp(`// m207-guard:${tag}(?![a-z0-9-])`).test(l);
  assert.equal(ls.filter(hit).length, 1, `one line holds ${tag}`);
  return ls.filter((l) => !hit(l)).join("\n");
};

// ---- synthetic admitted shapes (unrelated to PeaceSTOCKS / dev / reference)
test("M207 admit: two honest configurations still verify under oop-v1 (range + clip)", { skip: skipE2e }, () => {
  const clip = `"use strict";
exports.clip = (s, n) => {
  if (typeof s !== "string") throw new TypeError("want string");
  if (!Number.isInteger(n) || n < 0) throw new RangeError("bad n");
  return s.length <= n ? s : s.slice(0, n);
};
`;
  const r1 = V.verify({ root: fixture({ "src/range.mjs": RANGE_OK }), module: "src/range.mjs", cases: SPAN_CASE, env });
  assert.equal(r1.code, "OOP_OK", JSON.stringify(r1));
  const r2 = V.verify({
    root: fixture({ "src/clip.cjs": clip }), module: "src/clip.cjs", env,
    cases: [{ id: "c", fn: "clip", args: ["abcdef", 3], expect: { ok: true, value: "abc", cmp: "is" } }],
  });
  assert.equal(r2.code, "OOP_OK", JSON.stringify(r2));
});

// ---- (1) ACL-aware write check
test("M207 ACL: named user write grant / group write grant / mask strips write / none / unknown", { skip: !cand && "needs cand" }, () => {
  const c = cand!;
  const g = V.groupsOf(c.name);
  assert.ok(g.gids.size >= 1 && g.names.size >= 1);
  const d = join(base, `acl-${n++}`); mkdirSync(d, { recursive: true });
  const mk = (name: string) => { const p = join(d, name); writeFileSync(p, "x"); chmodSync(p, 0o644); return p; };

  const plain = mk("plain");
  assert.equal(V.candAclWrite(plain, c, g.gids, g.names), "none");
  assert.equal(V.candMayWrite(plain, c, g.gids), false);

  const userW = mk("userw");
  assert.equal(spawnSync("setfacl", ["-m", `u:${c.name}:w`, userW]).status, 0);
  assert.equal(V.candAclWrite(userW, c, g.gids, g.names), "grant");
  // mode bits alone still say no (owner is us, not cand; 644)
  assert.equal(V.candMayWrite(userW, c, g.gids), false);

  const userByUid = mk("useruid");
  assert.equal(spawnSync("setfacl", ["-m", `u:${c.uid}:w`, userByUid]).status, 0);
  assert.equal(V.candAclWrite(userByUid, c, g.gids, g.names), "grant");

  const grpName = [...g.names][0]!;
  const grpW = mk("grpw");
  assert.equal(spawnSync("setfacl", ["-m", `g:${grpName}:w`, grpW]).status, 0);
  assert.equal(V.candAclWrite(grpW, c, g.gids, g.names), "grant");

  const grpGid = mk("grpgid");
  const gid = [...g.gids][0]!;
  assert.equal(spawnSync("setfacl", ["-m", `g:${gid}:w`, grpGid]).status, 0);
  assert.equal(V.candAclWrite(grpGid, c, g.gids, g.names), "grant");

  // mask without write: named entry has w but effective does not
  const masked = mk("masked");
  assert.equal(spawnSync("setfacl", ["-m", `u:${c.name}:w`, masked]).status, 0);
  assert.equal(spawnSync("setfacl", ["-m", "m::r", masked]).status, 0);
  assert.equal(V.candAclWrite(masked, c, g.gids, g.names), "none");

  // reader failure -> unknown (fail-closed)
  assert.equal(V.candAclWrite(plain, c, g.gids, g.names, () => ({ status: 1, stdout: "" })), "unknown");
  assert.equal(V.candAclWrite(plain, c, g.gids, g.names, () => ({ status: 0, stdout: "not-an-acl-line\n" })), "unknown");

  // supplementary group on mode bits: a gid in candGids that is not required to be primary
  const suppl = mk("suppl");
  chmodSync(suppl, 0o664);
  // pretend the file's group is a synthetic supplementary gid the cand is in
  assert.equal(V.candMayWrite(suppl, c, new Set([statSync(suppl).gid, 999999])), true);
  assert.equal(V.candMayWrite(suppl, c, new Set([999999])), false, "no membership -> no group write");

  // cleanup ACLs in this dir (best effort)
  for (const f of ["userw", "useruid", "grpw", "grpgid", "masked"]) spawnSync("setfacl", ["-b", join(d, f)]);
});

test("M207 ACL: verify refuses OOP_VERIFIER_ACL when a guarded path grants the candidate write via ACL", { skip: skipE2e }, async () => {
  const w = await variant({ aclSpec: true });
  const r = w.V.verify({ root: fixture({ "src/range.mjs": RANGE_OK }), module: "src/range.mjs", cases: SPAN_CASE, env });
  assert.equal(r.code, "OOP_VERIFIER_ACL", JSON.stringify(r));
  assert.match(String((r as { detail?: string }).detail), /spec:grant/);
});

test("M207 ACL near-miss: a named ACL for a different user is not a grant", { skip: !cand && "needs cand" }, () => {
  const c = cand!;
  const g = V.groupsOf(c.name);
  const p = join(base, `other-${n++}`); writeFileSync(p, "x"); chmodSync(p, 0o644);
  // grant write to the verifier uid (not the candidate)
  assert.equal(spawnSync("setfacl", ["-m", `u:${VERIFIER}:w`, p]).status, 0);
  assert.equal(V.candAclWrite(p, c, g.gids, g.names), "none");
  spawnSync("setfacl", ["-b", p]);
});

// ---- (2) injectable privilege probe
test("M207 privilege probe: has-sudo and probe-fail refuse; clean restores", { skip: !cand && "needs cand" }, () => {
  const c = cand!;
  try {
    V.setVerifierPrivilegeProbeForTests(() => "has-sudo");
    assert.deepEqual(V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, c), { ok: false, code: "OOP_VERIFIER_BAD", detail: "has-sudo" });
    V.setVerifierPrivilegeProbeForTests(() => "probe-fail");
    assert.deepEqual(V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, c), { ok: false, code: "OOP_VERIFIER_BAD", detail: "sudo-probe" });
  } finally {
    V.setVerifierPrivilegeProbeForTests(null);
  }
  assert.equal(V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, c).ok, true);
});

test("M207 privilege probe near-miss: env cannot swap the probe (DI only)", { skip: !cand && "needs cand" }, () => {
  const c = cand!;
  const r = V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER, PEACEAI_VERIFIER_PRIVILEGE: "has-sudo", SUDO: "1" }, c);
  assert.equal(r.ok, true, "env must not be able to force has-sudo");
});

// ---- (3) forged reply residual is documented, not falsely closed
test("M207 forged-reply residual: spec records it as irreducible in-process", () => {
  const spec = readFileSync(specPath, "utf8");
  assert.match(spec, /## M207 \(batch 43\)/);
  assert.match(spec, /Forged reply-line.*irreducible/i);
  assert.match(spec, /\/proc\/self\/mem/);
  assert.match(spec, /share one process/);
  // must NOT claim the residual is closed
  assert.doesNotMatch(spec, /forged reply-line.*closed/i);
});

// ---- mutation: each m207-guard
const GUARD: Record<string, { file: "verifier"; e2e?: true; run(m: Mods): void | Promise<void> }> = {
  "has-sudo": { file: "verifier", run: (m) => {
    assert.ok(cand);
    m.V.setVerifierPrivilegeProbeForTests(() => "has-sudo");
    try {
      assert.deepEqual(m.V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand!), { ok: false, code: "OOP_VERIFIER_BAD", detail: "has-sudo" });
    } finally { m.V.setVerifierPrivilegeProbeForTests(null); }
  } },
  "sudo-probe": { file: "verifier", run: (m) => {
    assert.ok(cand);
    m.V.setVerifierPrivilegeProbeForTests(() => "probe-fail");
    try {
      assert.deepEqual(m.V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand!), { ok: false, code: "OOP_VERIFIER_BAD", detail: "sudo-probe" });
    } finally { m.V.setVerifierPrivilegeProbeForTests(null); }
  } },
  "acl-unknown": { file: "verifier", run: (m) => {
    assert.ok(cand);
    const g = m.V.groupsOf(cand!.name);
    assert.equal(m.V.candAclWrite("/no/such/path-m207", cand!, g.gids, g.names, () => ({ status: null, stdout: "", error: new Error("boom") })), "unknown");
  } },
  "acl-parse": { file: "verifier", run: (m) => {
    assert.ok(cand);
    const g = m.V.groupsOf(cand!.name);
    assert.equal(m.V.candAclWrite("x", cand!, g.gids, g.names, () => ({ status: 0, stdout: "weird:line:here\n" })), "unknown");
  } },
  "acl-parse-mask": { file: "verifier", run: (m) => {
    assert.ok(cand);
    const g = m.V.groupsOf(cand!.name);
    // named user entry, no mask line
    assert.equal(m.V.candAclWrite("x", cand!, g.gids, g.names, () => ({
      status: 0, stdout: `user::rw-\nuser:${cand!.name}:-w-\ngroup::r--\nother::r--\n`,
    })), "unknown");
  } },
  "acl-mask": { file: "verifier", run: (m) => {
    assert.ok(cand);
    const g = m.V.groupsOf(cand!.name);
    assert.equal(m.V.candAclWrite("x", cand!, g.gids, g.names, () => ({
      status: 0, stdout: `user::rw-\nuser:${cand!.name}:-w-\ngroup::r--\nmask::r--\nother::r--\n`,
    })), "none");
  } },
  "acl-user": { file: "verifier", run: (m) => {
    assert.ok(cand);
    const g = m.V.groupsOf(cand!.name);
    assert.equal(m.V.candAclWrite("x", cand!, g.gids, g.names, () => ({
      status: 0, stdout: `user::rw-\nuser:${cand!.name}:-w-\ngroup::r--\nmask::rw-\nother::r--\n`,
    })), "grant");
  } },
  "acl-group": { file: "verifier", run: (m) => {
    assert.ok(cand);
    const g = m.V.groupsOf(cand!.name);
    const gn = [...g.names][0]!;
    assert.equal(m.V.candAclWrite("x", cand!, g.gids, g.names, () => ({
      status: 0, stdout: `user::rw-\ngroup::r--\ngroup:${gn}:-w-\nmask::rw-\nother::r--\n`,
    })), "grant");
  } },
  "acl-check": { file: "verifier", e2e: true, run: async () => {
    // build a variant whose spec has an ACL grant for cand; deleting acl-check must stop the refusal
    const w = await variant({ verifier: CUR.verifier, aclSpec: true });
    const r = w.V.verify({ root: fixture({ "src/range.mjs": RANGE_OK }), module: "src/range.mjs", cases: SPAN_CASE, env });
    assert.equal(r.code, "OOP_VERIFIER_ACL", JSON.stringify(r));
  } },
};
let CUR = { verifier: SRC.verifier };

test("M207 mutation: every m207-guard tag has a case; each passes unmutated and fails with its line deleted", async () => {
  const all = tagsOf(SRC.verifier);
  assert.ok(all.length >= 8, `expected many guards, got ${all.length}: ${all.join(",")}`);
  for (const t of all) {
    assert.ok(GUARD[t], `no case for m207-guard:${t}`);
  }
  for (const t of all) {
    const g = GUARD[t]!;
    if (g.e2e && skipE2e) continue;
    if (!cand && t !== "acl-check") continue;
    CUR = { verifier: SRC.verifier };
    await g.run(await variant());
    CUR = { verifier: drop(SRC.verifier, t) };
    const mut = await variant({ verifier: CUR.verifier });
    let failed = false;
    try { await g.run(mut); } catch { failed = true; }
    assert.ok(failed, `deleting m207-guard:${t} was not caught by its own case`);
    mut.V.setVerifierPrivilegeProbeForTests(null);
  }
  CUR = { verifier: SRC.verifier };
  V.setVerifierPrivilegeProbeForTests(null);
});

test("M207 pins: selfpropose.ts, plandefault.ts, plan4.ts byte-identical to gen/batch42; v4 digest unchanged; runs.jsonl add-only; no Worker ctor literal", () => {
  const files = ["peaceai/lib/selfpropose.ts", "peaceai/lib/plandefault.ts", "peaceai/lib/plan4.ts", "peaceai/lib/plan4run.ts"];
  const diff = spawnSync("git", ["diff", "cea6e1b", "--", ...files], { encoding: "utf8" });
  assert.equal(diff.stdout, "", diff.stdout);
  const { plannerSha256V4 } = createRequire(import.meta.url)("../lib/plan4run.ts") as { plannerSha256V4: () => string };
  const sha = plannerSha256V4();
  assert.equal(typeof sha, "string");
  assert.equal(sha.length, 64);
  // runs.jsonl: only additions (diff against base should not delete lines)
  const runsDiff = spawnSync("git", ["diff", "cea6e1b", "-U0", "--", "peaceai/plan/runs.jsonl"], { encoding: "utf8" });
  for (const line of (runsDiff.stdout ?? "").split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---")) assert.fail(`runs.jsonl lost a line: ${line}`);
  }
  // no literal Worker ctor in new production files of this batch (tests may mention the needle)
  const needle = "new " + "Worker(";
  const newFiles = spawnSync("git", ["diff", "cea6e1b", "--name-only", "--diff-filter=A"], { encoding: "utf8" });
  for (const f of (newFiles.stdout ?? "").split("\n").filter(Boolean)) {
    if (!existsSync(f)) continue;
    if (f.startsWith("peaceai/test/")) continue;
    const t = readFileSync(f, "utf8");
    assert.equal(t.includes(needle), false, `${needle} in ${f}`);
  }
  assert.ok(existsSync(join(libDir, "plan4.ts")));
});

test("M207 hygiene: no candidate / verifier process outlives the file", { skip: !cand && "needs cand" }, () => {
  assert.deepEqual(candPids(cand!.uid), []);
  const vUid = Number((spawnSync("id", ["-u", VERIFIER], { encoding: "utf8" }).stdout ?? "").trim());
  if (Number.isInteger(vUid)) assert.deepEqual(candPids(vUid), []);
});
