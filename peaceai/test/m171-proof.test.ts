// M171 (Auditor ruling on run 41521457458): (b) the attempt job's userns step sets
// kernel.apparmor_restrict_unprivileged_userns=0, reads it back, prints userns-restrict=<0|1> only and refuses
// (CAND_NO_NAMESPACES, exit 1) unless it is 0 -- executed here against a fake sudo/sysctl; (c) the isolation proofs
// (lib/loopdeps.ts runIsolationProofs, run by `bin/loop.ts proofs` as the first command of the loop step) pass inside the real runner wrapper
// as the candidate uid and refuse each near miss; deleting any `// m171-proof-guard:` line, or any line of the
// userns step's refusal, makes a case fail. (a), the credential-free job and the step's place: workflows.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as isoproof from "../lib/loopdeps.ts";
import { runnerWrapper } from "../lib/loop.ts";
import { stage2CandUid } from "../lib/selfpropose.ts";
import { PROOF_CASES } from "./m171-proof-cases.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const WF = readFileSync(join(ROOT, ".github/workflows/peace-model-v1-dev.yml"), "utf8");
const CAND = process.env.M171_CAND ?? process.env.M146_CAND ?? "peaceai-cand";
const c = stage2CandUid({ PEACEAI_STAGE2_CAND: CAND });
const SKIP = "needs the stage-2 candidate uid and sudo (box / private job)";

for (const k of PROOF_CASES) {
  test(`M171 proof: ${k.id}`, async (t) => {
    if (!c.ok) { t.skip(SKIP); return; }
    await k.run(isoproof, c.cand, runnerWrapper);
  });
}

test("M171 proof: gitCredentialFiles finds the runner's credential files by name and git's fixed paths, nothing else", () => {
  const d = mkdtempSync(join(tmpdir(), "peaceai-m171-cred-"));
  try {
    const h = join(d, "h");
    for (const f of ["work/_temp/git-credentials-1.config", ".git-credentials", ".gitconfig", ".config/git/credentials", "work/x/notes.txt", "work/x/node_modules/.git-credentials"]) {
      spawnSync("mkdir", ["-p", join(h, f, "..")]); writeFileSync(join(h, f), "x");
    }
    assert.deepEqual(isoproof.gitCredentialFiles([join(h, "work/_temp"), h], h), [".config/git/credentials", ".git-credentials", ".gitconfig", "work/_temp/git-credentials-1.config"].map((f) => join(h, f)).sort());
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("M171 proof: bin/loop.ts proofs passes the loop's own runner wrapper, prints fixed codes only and exits 1 on any refusal", () => {
  const src = readFileSync(join(ROOT, "peaceai/bin/loop.ts"), "utf8");
  const block = src.slice(src.indexOf('if (process.argv[2] === "proofs") {'), src.indexOf("\n} else runLoopCommand();\n", src.indexOf('if (process.argv[2] === "proofs") {')));
  assert.ok(block.length > 0 && src.indexOf(block) < src.indexOf("const args = process.argv.slice(2);"), "handled before any loop argument");
  assert.match(block, /runIsolationProofs\(c\.cand, \{ env: process\.env, root: ROOT, wrapper: runnerWrapper \}\)/);
  const prints = [...block.matchAll(/console\.log\(([^;]*)\);/g)].map((m) => m[1]!);
  assert.deepEqual(prints, ["`refused ${c.reason}`", "`proof ${p}=${r.proofs[p]}`", "`git-credential files checked=${r.credFiles}`", "`refused ${r.refusal}`", '"isolation proofs ok"', '"refused PROOFS_CRASHED"']);
  assert.match(block, /if \(!r\.ok\) \{ console\.log\(`refused \$\{r\.refusal\}`\); process\.exit\(1\); \}/);
  const r = spawnSync(process.execPath, [...process.execArgv, join(ROOT, "peaceai/bin/loop.ts"), "proofs"], { encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 60_000 });
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), "refused CAND_UID_REQUIRED");
});

// ---- (b) the userns step, executed with a fake sudo and sysctl on PATH

function sysctlBody(text = WF): string {
  const at = text.indexOf("      - name: Lift the user namespace restriction");
  assert.ok(at > 0);
  const block = text.slice(at, text.indexOf("\n      - name:", at + 1));
  return block.slice(block.indexOf("run: |\n") + 7).split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
}
/** Runs the step with sysctl reading back `after` once written (`writes`: whether sudo sysctl -w takes effect). */
function runSysctl(body: string, before: string, writes: boolean) {
  const d = mkdtempSync(join(tmpdir(), "peaceai-m171-sysctl-"));
  try {
    writeFileSync(join(d, "v"), before);
    writeFileSync(join(d, "sudo"), `#!/bin/sh\n[ "$1" = -n ] && shift\nexec "$@"\n`);
    writeFileSync(join(d, "sysctl"), `#!/bin/sh\nD=${d}\nif [ "$1" = -n ]; then [ "$2" = kernel.apparmor_restrict_unprivileged_userns ] && cat "$D/v"; exit $?; fi\nif [ "$1" = -q ] && [ "$2" = -w ] && [ "$3" = kernel.apparmor_restrict_unprivileged_userns=0 ]; then ${writes ? 'echo 0 > "$D/v"; exit 0' : "exit 255"}; fi\nexit 2\n`);
    chmodSync(join(d, "sudo"), 0o755); chmodSync(join(d, "sysctl"), 0o755);
    const r = spawnSync("bash", ["-c", body], { encoding: "utf8", env: { PATH: `${d}:${process.env.PATH}` } });
    return { status: r.status, out: (r.stdout ?? "").trim() };
  } finally { rmSync(d, { recursive: true, force: true }); }
}
const SYSCTL_SCENARIOS: [string, boolean, number, string][] = [
  ["1", true, 0, "userns-restrict=0"],
  ["0", false, 0, "userns-restrict=0"],
  ["1", false, 1, "userns-restrict=1\nrefused CAND_NO_NAMESPACES"],
  ["2", false, 1, "userns-restrict=1\nrefused CAND_NO_NAMESPACES"],
  ["", false, 1, "userns-restrict=1\nrefused CAND_NO_NAMESPACES"],
];
const sysctlFails = (body: string) => SYSCTL_SCENARIOS.filter(([v, w, st, out]) => { const r = runSysctl(body, v, w); return r.status !== st || r.out !== out; }).map(([v, w]) => `${v}/${w}`);

test("M171 userns step: sets 0, reads it back, prints userns-restrict=<0|1> only, refuses CAND_NO_NAMESPACES unless 0", () => {
  const body = sysctlBody();
  assert.deepEqual(sysctlFails(body), []);
  for (const m of body.matchAll(/echo "([^"]*)"/g)) assert.match(m[1]!, /^(?:userns-restrict=[01]|refused CAND_NO_NAMESPACES)$/);
  assert.equal(body.trim().split("\n").length, 4, "set -uo pipefail, the write, the read-back, the refusal; nothing else");
});

test("M171 userns step mutation: deleting the write or the read-back, or weakening the refusal, makes a scenario fail", () => {
  const body = sysctlBody();
  const lines = body.split("\n");
  const muts: [string, string][] = [
    ["no write", lines.filter((l) => !l.startsWith("sudo -n sysctl")).join("\n")],
    ["no read-back", body.replace(/v=\$\(sysctl -n [^\n]*/, "v=0")],
    ["no exit", body.replace('echo "refused CAND_NO_NAMESPACES"; exit 1; fi', 'echo "refused CAND_NO_NAMESPACES"; fi')],
    ["no refusal", body.replace(/; else echo "userns-restrict=1"; echo "refused CAND_NO_NAMESPACES"; exit 1; fi/, "; fi")],
    ["any value passes", body.replace('[ "$v" = 0 ]', "true")],
  ];
  for (const [id, m] of muts) { assert.notEqual(m, body, id); assert.ok(sysctlFails(m).length > 0, `no scenario notices: ${id}`); }
});

// ---- mutation of the proof guards (lib/loopdeps.ts runIsolationProofs): each deleted guard line must make a proof case fail

const LIB = join(ROOT, "peaceai/lib");
const SRC = readFileSync(join(LIB, "loopdeps.ts"), "utf8");
const GUARDS = SRC.split("\n").flatMap((l, i) => { const m = /\/\/ m171-proof-guard:(proof-[a-z0-9-]+)\s*$/.exec(l); return m ? [{ id: m[1]!, line: i }] : []; });

test("M171 proof mutation: the guard tags are unique and cover every proof and refusal", () => {
  assert.deepEqual(GUARDS.map((g) => g.id).sort(), ["proof-97", "proof-98", "proof-bad", "proof-git-credentials", "proof-leftovers", "proof-net", "proof-range", "proof-runner-temp", "proof-temp-exists", "proof-uid", "proof-work", "proof-write"].sort());
});

for (const g of GUARDS) {
  test(`M171 proof mutation: deleting m171-proof-guard:${g.id} makes a proof case fail`, async (t) => {
    if (!c.ok) { t.skip(SKIP); return; }
    const dir = mkdtempSync(join(tmpdir(), "peaceai-m171-pmut-"));
    try {
      const text = SRC.split("\n").filter((_, i) => i !== g.line).join("\n").replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(LIB, f)).href)}`);
      const file = join(dir, `mutant-${g.id}.ts`);
      writeFileSync(file, text);
      const mutant = (await import(pathToFileURL(file).href)) as typeof isoproof;
      let failed = 0;
      for (const k of PROOF_CASES) { try { await k.run(mutant, c.cand, runnerWrapper); } catch (e) { if (e instanceof assert.AssertionError) failed++; else throw e; } }
      assert.ok(failed > 0, `no proof case notices m171-proof-guard:${g.id} removed`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
