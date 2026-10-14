// M31: the public-runner LM corpus check fails on any held-out sha256 and on anything off the public allowlist.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { heldOutHashes } from "../lib/lmcorpus.ts";
import { docsProblems, filterPublic, manifestProblems, validAllow, type PublicManifestEntry } from "../lib/lmpublic.ts";
import { protectedReason } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const allowRaw = JSON.parse(readFileSync(join(root, "peaceai/model/lm-public-allow.json"), "utf8"));
const allow = validAllow(allowRaw)!;
const heldOut = heldOutHashes(JSON.parse(readFileSync(join(root, "peaceai/model/heldout.json"), "utf8")));
const [src, commit] = Object.entries(allow.sources)[0]!;
const entry = (sha256: string, over: Partial<PublicManifestEntry> = {}): PublicManifestEntry => ({ doc: 0, source: src, visibility: "public", commit, path: "src/x.ts", sha256, bytes: 1, license: "owner:PeaceG03", split: "train", ...over });
const ok = allow.sha256[0]!, held = [...heldOut][0]!;

test("M31: the committed allowlist is valid, Peace's public sources only, and holds no held-out sha256", () => {
  assert.ok(allow, "valid");
  assert.ok(Object.keys(allow.sources).every((s) => s === "PeaceG03/PeaceSTOCKS" || s === "PeaceG03/PeaceAI-Workspace"));
  assert.equal(allow.sha256.filter((h) => heldOut.has(h)).length, 0);
  assert.equal(heldOut.size > 0, true);
});

test("M31: manifestProblems fails on any held-out sha256 and on anything off the allowlist", () => {
  assert.deepEqual(manifestProblems([entry(ok)], heldOut, allow), []);
  assert.match(manifestProblems([entry(ok), entry(held)], heldOut, allow).join(";"), /held-out sha256 present: 1/);
  assert.match(manifestProblems([entry(ok, { visibility: "private" })], heldOut, allow).join(";"), /non-public/);
  assert.match(manifestProblems([entry(ok, { source: "PeaceG03/PeaceAI" })], heldOut, allow).join(";"), /source not in/);
  assert.match(manifestProblems([entry(ok, { commit: "0".repeat(40) })], heldOut, allow).join(";"), /commit differs/);
  assert.match(manifestProblems([entry("f".repeat(64))], heldOut, allow).join(";"), /not in the public allowlist/);
  assert.match(manifestProblems([], heldOut, allow).join(";"), /empty/);
  // even if a held-out sha were (wrongly) allowlisted, the check still fails
  assert.match(manifestProblems([entry(held)], heldOut, { ...allow, sha256: [...allow.sha256, held] }).join(";"), /held-out sha256 present/);
});

test("M31: filterPublic drops held-out, private and off-list entries; its output passes the check", () => {
  const m = [entry(ok), entry(held), entry(ok, { visibility: "private" }), entry("e".repeat(64))];
  const docs = m.map((_, i) => JSON.stringify({ doc: i, text: `t${i}` }));
  const r = filterPublic(m, docs, heldOut, allow);
  assert.equal(r.manifest.length, 1); assert.equal(r.dropped, 3); assert.equal(JSON.parse(r.docs[0]!).text, "t0");
  assert.deepEqual(manifestProblems(r.manifest, heldOut, allow), []);
});

test("M31: lm-manifest-check exits 1 on a held-out sha and 0 on a clean manifest", () => {
  const d = mkdtempSync(join(tmpdir(), "m31-"));
  const run = (rows: PublicManifestEntry[], texts = rows.map(() => "x")) => { const f = join(d, "m.jsonl"), g = join(d, "d.jsonl");
    writeFileSync(f, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(g, texts.map((t, i) => JSON.stringify({ doc: i, text: t })).join("\n") + "\n");
    return spawnSync(join(root, "node_modules/.bin/tsx"), [join(root, "peaceai/bin/lm-manifest-check.ts"), f, g], { encoding: "utf8" }); };
  const bad = run([entry(ok), entry(held)]);
  assert.equal(bad.status, 1); assert.match(bad.stdout, /FAIL held-out sha256 present: 1/);
  // a clean manifest needs a real allowlisted text: any tracked file still byte-identical to its pinned version.
  const real = execFileSync("git", ["ls-files", "src", "peaceai/lib"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean)
    .map((p) => readFileSync(join(root, p), "utf8")).find((t) => allow.sha256.includes(createHash("sha256").update(t).digest("hex")));
  assert.ok(real !== undefined, "some tracked file is still allowlisted");
  const good = run([entry(createHash("sha256").update(real!).digest("hex"))], [real!]);
  assert.equal(good.status, 0, good.stdout); assert.match(good.stdout, /PASS files=1 .*heldout_present=0/);
});

test("M31/M37: the workflow fetches the manifest corpus, runs the ext manifest check before training, and lands only in Results", () => {
  const wf = readFileSync(join(root, ".github/workflows/peace-lm-train.yml"), "utf8");
  const at = (s: string) => wf.indexOf(s);
  assert.ok(at("stage refused") > 0 && at("stage refused") < at("peaceai/bin/ext-fetch.ts"), "stage gate first");
  assert.ok(at("peaceai/bin/ext-fetch.ts") > 0 && at("peaceai/bin/ext-fetch.ts") < at("peaceai/bin/ext-manifest-check.ts") && at("peaceai/bin/ext-manifest-check.ts") < at("peaceai/model/train.py"), "fetch, check, then train");
  assert.ok(at("wiredAsEval") > at("peaceai/model/export.py") && at("wiredAsEval") < at("Land the model"), "set C v2 eval after export, gated on wiredAsEval");
  assert.ok(!/PeaceG03\/PeaceAI\.git|PeaceAI\.git"/.test(wf.replace("PeaceAI-Results.git", "")), "no private core clone");
  assert.ok(!/upload-artifact/.test(wf), "weights never become a public artifact");
  assert.match(wf, /results-write\.sh/);
  assert.equal((wf.match(/secrets\.PEACEAI_RESULTS_DEPLOY_KEY/g) ?? []).length, 1, "the key is given to the landing step only");
  for (const p of ["peaceai/lib/lmpublic.ts", "peaceai/bin/lm-manifest-check.ts", "peaceai/bin/lm-public-corpus.ts", "peaceai/model/lm-public-allow.json"]) assert.ok(protectedReason(p), p);
  void execFileSync;
});

const H = (t: string) => createHash("sha256").update(t).digest("hex");

test("Auditor #140: the manifest check re-hashes every doc against its manifest entry", () => {
  const m = [entry(H("a"), { doc: 0 }), entry(H("b"), { doc: 1 })];
  assert.deepEqual(docsProblems(m, [JSON.stringify({ doc: 0, text: "a" }), JSON.stringify({ doc: 1, text: "b" })], H), []);
  assert.match(docsProblems(m, [JSON.stringify({ doc: 0, text: "a" }), JSON.stringify({ doc: 1, text: "SWAPPED" })], H).join(), /does not match the manifest sha256: 1/);
  assert.match(docsProblems(m, [JSON.stringify({ doc: 0, text: "a" })], H).join(), /count differ/);
  assert.match(docsProblems(m, [JSON.stringify({ doc: 1, text: "b" }), JSON.stringify({ doc: 0, text: "a" })], H).join(), /does not match/, "reordered");
  assert.match(docsProblems(m, ["not json", JSON.stringify({ doc: 1, text: "b" })], H).join(), /does not match/);
});

test("Auditor #140: the CLI fails on a doc whose text differs from the manifest, and without docs.jsonl", () => {
  const d = mkdtempSync(join(tmpdir(), "m31d-"));
  const f = join(d, "m.jsonl"), g = join(d, "d.jsonl");
  writeFileSync(f, JSON.stringify(entry(ok)) + "\n"); writeFileSync(g, JSON.stringify({ doc: 0, text: "smuggled" }) + "\n");
  const tsx = join(root, "node_modules/.bin/tsx"), cli = join(root, "peaceai/bin/lm-manifest-check.ts");
  const r = spawnSync(tsx, [cli, f, g], { encoding: "utf8" });
  assert.equal(r.status, 1); assert.match(r.stdout, /does not match the manifest sha256: 1/);
  const n = spawnSync(tsx, [cli, f], { encoding: "utf8" });
  assert.equal(n.status, 1); assert.match(n.stdout, /docs\.jsonl required/);
});

/** The landing step's own script, run against a scratch Results checkout. */
function land(version: string, extra?: (results: string, model: string) => void): { status: number | null; out: string; staged: string } {
  const wf = readFileSync(join(root, ".github/workflows/peace-lm-train.yml"), "utf8");
  const m = wf.match(/bash -c '(set -euo pipefail\n[\s\S]*?)'\n/);
  assert.ok(m, "landing script found");
  const d = mkdtempSync(join(tmpdir(), "m31l-")), results = join(d, "results"), model = join(d, "model");
  mkdirSync(join(results, "models/lm"), { recursive: true }); mkdirSync(model);
  execFileSync("git", ["init", "-q", results]);
  writeFileSync(join(model, "config.json"), JSON.stringify({ version })); writeFileSync(join(model, "weights.npz"), "w");
  extra?.(results, model);
  const r = spawnSync("bash", ["-c", m![1]!], { encoding: "utf8", env: { ...process.env, RESULTS_DIR: results, MODEL_DIR: model } });
  const staged = spawnSync("git", ["-C", results, "diff", "--cached", "--name-only"], { encoding: "utf8" }).stdout;
  return { status: r.status, out: r.stdout + r.stderr, staged };
}

test("Auditor #140 1: the landing path is validated and only models/lm/<version>/ may be staged", () => {
  const good = land("lm-v1-0123456789ab");
  assert.equal(good.status, 0, good.out);
  assert.deepEqual(good.staged.trim().split("\n").sort(), ["models/lm/lm-v1-0123456789ab/config.json", "models/lm/lm-v1-0123456789ab/weights.npz"]);
  for (const v of ["../../latest.json", "..", ".", "a/b", "", "lm v1", "x;rm"]) {
    const r = land(v);
    assert.notEqual(r.status, 0, v); assert.match(r.out, /landing refused: bad version/, v);
  }
  const stray = land("lm-v1-0123456789ab", (res) => writeFileSync(join(res, "models/lm/latest.json"), "{}"));
  assert.notEqual(stray.status, 0); assert.match(stray.out, /landing refused: path outside models\/lm\/lm-v1-0123456789ab\//);
});

test("Auditor #140: a training failure prints only an exit marker, never the training log", () => {
  const wf = readFileSync(join(root, ".github/workflows/peace-lm-train.yml"), "utf8");
  assert.match(wf, /\|\| \{ echo "train failed exit=\$\?"; exit 1; \}/);
  assert.ok(!/tail[^\n]*train\.log|cat[^\n]*train\.log/.test(wf));
});

test("Auditor #140 F1-F3: no fail-open on a long list, renames counted as both paths, symlinks refused", () => {
  const V = "lm-v1-0123456789ab";
  const long = land(V, (res, model) => {
    for (let i = 0; i < 3000; i++) writeFileSync(join(model, `f${String(i).padStart(4, "0")}.txt`), `x${i}`);
    writeFileSync(join(res, "models/lm/zz-stray.json"), "{}");
  });
  assert.notEqual(long.status, 0); assert.match(long.out, /landing refused: path outside/);
  // a rename INTO the folder: latest.json is deleted outside and the same bytes arrive inside. With rename detection
  // only the new path would be listed; --no-renames lists the deletion too.
  const ren = land(V, (res, model) => {
    writeFileSync(join(res, "models/lm/latest.json"), '{"version":"old-model"}\n');
    execFileSync("git", ["-C", res, "add", "-A"]); execFileSync("git", ["-C", res, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"]);
    execFileSync("rm", [join(res, "models/lm/latest.json")]);
    writeFileSync(join(model, "latest.json"), '{"version":"old-model"}\n');
  });
  assert.notEqual(ren.status, 0, ren.out); assert.match(ren.out, /landing refused: path outside/);
  const link = land(V, (_res, model) => symlinkSync("/etc/passwd", join(model, "tokenizer.json")));
  assert.notEqual(link.status, 0); assert.match(link.out, /landing refused: symlink in model dir/);
  const dot = land("lm-v1-a.b"); // '.' is literal in the prefix check, not a regex wildcard
  assert.equal(dot.status, 0, dot.out);
  const near = land("lm-v1-a.b", (res) => { mkdirSync(join(res, "models/lm/lm-v1-aXb"), { recursive: true }); writeFileSync(join(res, "models/lm/lm-v1-aXb/w"), "x"); });
  assert.notEqual(near.status, 0, "a sibling the regex '.' would have matched is refused");
});
