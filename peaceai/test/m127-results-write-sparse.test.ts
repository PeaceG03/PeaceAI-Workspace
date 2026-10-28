// M127 (Auditor follow-up on #564: Results grows ~20 MB per sweep arm, and results-write.sh cloned all of it).
// results-write.sh --sparse <path>...: a blobless (--filter=blob:none), shallow (--depth 1) clone with a no-cone sparse
// checkout of exactly the given literal paths, so only their blobs are fetched and every read or existence check under
// them sees the real files. On top of each caller's own checks it refuses (fail closed, nothing pushed): any file outside
// the paths (git would silently skip it), any change git did not stage, any staged path outside the paths, and any
// staged change that is not a new file (modify, delete, rename, type change); after the commit every added blob must
// equal the sha of the file written. Push races still retry from a fresh (sparse) clone. Without --sparse: unchanged.
// Every results-write.sh call in peace-lm-retrain.yml passes --sparse; this test runs those landing steps against a
// local bare Results fixture served over file:// with partial clone enabled.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const WF = read(".github/workflows/peace-lm-retrain.yml");
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8" }).trim();
const tmp = (fn: (d: string) => void) => { const d = mkdtempSync(join(tmpdir(), "m127t-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const block = (text: string, start: string, end: RegExp) => { const i = text.indexOf(start); assert.ok(i >= 0, start); const rest = text.slice(i + start.length); const j = rest.search(end); return j < 0 ? rest : rest.slice(0, j); };
const dedent = (t: string, n: number) => t.split("\n").map((l) => l.slice(Math.min(n, l.length - l.trimStart().length))).join("\n");
const stepRun = (name: string) => dedent(block(block(WF, `      - name: ${name}`, /\n      - name: |\n\n  [a-z]/), "        run: |\n", /$^/), 10).replaceAll("./peaceai/bin/with-deploy-key.sh ", "");

const RUN0 = "40700000010", RUN1 = "40700000011", V0 = "lm-v1-aaaaaaaaaaaa", V1 = "lm-v1-bbbbbbbbbbbb";
const BIG = randomBytes(256 * 1024);
// The seeded Results: README, latest.json, a landed model, a run with record + memcheck + a saved arm, a run with a
// record only (its candidate V1 landed without memcheck), another run's arms (big blobs never needed here).
const SEED: Record<string, string | Buffer> = {
  "README.md": "results\n",
  "models/lm/latest.json": `{"version":"${V0}"}\n`,
  [`models/lm/${V0}/config.json`]: `{"version":"${V0}"}\n`, [`models/lm/${V0}/weights.npz`]: BIG,
  [`models/lm/${V1}/config.json`]: `{"version":"${V1}"}\n`, [`models/lm/${V1}/weights.npz`]: randomBytes(1024),
  [`runs/lm-retrain/${RUN0}/record.json`]: `{"run":"${RUN0}"}\n`, [`runs/lm-retrain/${RUN0}/memcheck.json`]: "{\"status\":\"FAIL\"}\n",
  [`runs/lm-retrain/${RUN0}/arms/0/model/weights.npz`]: BIG,
  [`runs/lm-retrain/${RUN1}/record.json`]: `{"run":"${RUN1}"}\n`,
  "runs/lm-retrain/40600000000/arms/0/model/weights.npz": randomBytes(256 * 1024), "runs/lm-retrain/40600000000/arms/1/model/weights.npz": randomBytes(256 * 1024),
};
function results(d: string) {
  const bare = join(d, "results.git"); mkdirSync(bare); git(bare, "init", "-q", "--bare");
  git(bare, "config", "uploadpack.allowFilter", "true"); git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  const seed = join(d, "seed"); mkdirSync(seed); git(seed, "init", "-q");
  for (const [p, c] of Object.entries(SEED)) { mkdirSync(dirname(join(seed, p)), { recursive: true }); writeFileSync(join(seed, p), c); }
  git(seed, "add", "-A"); git(seed, "commit", "-q", "-m", "seed");
  writeFileSync(join(seed, "README.md"), "results (history: so a depth-1 clone is shallow)\n"); git(seed, "commit", "-q", "-am", "seed 2");
  git(seed, "push", "-q", bare, "HEAD:main");
  rmSync(seed, { recursive: true, force: true });
  return { bare, url: `file://${bare}`, head: () => git(bare, "rev-parse", "main") };
}
// results-write.sh run directly (no deploy key in tests; the remote override is its local-test hook).
function W(d: string, url: string, args: string[], script: string, env: Record<string, string> = {}) {
  const rt = mkdtempSync(join(d, "rt-")); const out = join(rt, "out"); writeFileSync(out, "");
  const r = spawnSync("bash", ["peaceai/bin/results-write.sh", ...args, "m127 test write", "bash", "-c", `set -euo pipefail\n${script}`], { cwd: repo, encoding: "utf8",
    env: { PATH: process.env.PATH!, HOME: d, GIT_CONFIG_NOSYSTEM: "1", RUNNER_TEMP: rt, GITHUB_OUTPUT: out, PEACEAI_RESULTS_REMOTE_OVERRIDE: url, EVID: rt, ...env } });
  return { status: r.status, stdout: r.stdout + r.stderr, out: readFileSync(out, "utf8"), rt };
}
const changes = (bare: string, from: string, to = "main") => git(bare, "diff", "--name-status", "--no-renames", from, to).split("\n").filter(Boolean);
const EVIDENCE = `git -C "$RESULTS_DIR" rev-list --objects --missing=print HEAD | grep -c "^?" > "$EVID/missing" || true
  git -C "$RESULTS_DIR" config remote.origin.partialclonefilter > "$EVID/filter" || true
  test -f "$(git -C "$RESULTS_DIR" rev-parse --absolute-git-dir)/shallow" && echo shallow > "$EVID/shallow"
  (cd "$RESULTS_DIR" && find . -path ./.git -prune -o -type f -print | sed "s|^\\./||" | LC_ALL=C sort) > "$EVID/files"`;

test("M127 --sparse: blobless shallow clone, only the given paths checked out (real blobs), a new file appended and pushed, blob sha verified", () => tmp((d) => {
  const R = results(d); const h0 = R.head();
  const w = W(d, R.url, ["--sparse", `/runs/lm-retrain/${RUN0}/`], `${EVIDENCE}
    cmp -s "$RESULTS_DIR/runs/lm-retrain/${RUN0}/record.json" <(printf '%s\\n' '{"run":"${RUN0}"}')
    sha256sum "$RESULTS_DIR/runs/lm-retrain/${RUN0}/arms/0/model/weights.npz" | cut -c1-64 > "$EVID/armsha"
    test ! -e "$RESULTS_DIR/models/lm/latest.json" && test ! -e "$RESULTS_DIR/README.md"
    echo '{"new":1}' > "$RESULTS_DIR/runs/lm-retrain/${RUN0}/memcheck-recheck-1.json"
    echo "recorded=yes" >> "$GITHUB_OUTPUT"`);
  assert.equal(w.status, 0, w.stdout); assert.match(w.stdout, /^results committed [0-9a-f]{40} at \S+ \(attempt 1\)$/m);
  const ev = (f: string) => readFileSync(join(w.rt, f), "utf8").trim();
  assert.equal(ev("filter"), "blob:none", "partial clone, blob:none"); assert.equal(ev("shallow"), "shallow", "depth 1");
  assert.ok(Number(ev("missing")) >= 6, `blobs outside the sparse paths are never fetched (missing=${ev("missing")})`);
  assert.deepEqual(ev("files").split("\n"), [`runs/lm-retrain/${RUN0}/arms/0/model/weights.npz`, `runs/lm-retrain/${RUN0}/memcheck.json`, `runs/lm-retrain/${RUN0}/record.json`]);
  assert.equal(ev("armsha"), sha(BIG), "a read under the sparse path gets the real blob");
  assert.deepEqual(changes(R.bare, h0), [`A\truns/lm-retrain/${RUN0}/memcheck-recheck-1.json`]);
  assert.equal(git(R.bare, "rev-parse", "main^"), h0, "one commit on top of the old head");
  assert.equal(git(R.bare, "show", `main:runs/lm-retrain/${RUN0}/memcheck-recheck-1.json`), '{"new":1}');
  assert.equal(w.out, `recorded=yes\nresults_sha=${R.head()}\nresults_time=${git(R.bare, "show", "-s", "--format=%cI", "main")}\n`, "outputs only after the push");
  const n = W(d, R.url, ["--sparse", `/runs/lm-retrain/${RUN0}/`], "true");
  assert.equal(n.status, 0, n.stdout); assert.match(n.stdout, /^nothing to record$/m); assert.equal(R.head(), git(R.bare, "rev-parse", "main"));
}));

test("M127 --sparse refuses modify, delete, rename, type change and any write outside the paths; nothing is pushed", () => tmp((d) => {
  const R = results(d); const h0 = R.head(); const r0 = `$RESULTS_DIR/runs/lm-retrain/${RUN0}`;
  const cases: [string, string[], string, RegExp][] = [
    ["modify a file under the path", [`/runs/lm-retrain/${RUN0}/`], `echo x >> "${r0}/record.json"`, /not append-only/],
    ["modify, staged by the recorder", [`/runs/lm-retrain/${RUN0}/`], `echo x >> "${r0}/record.json"; git -C "$RESULTS_DIR" add -A`, /not append-only/],
    ["delete", [`/runs/lm-retrain/${RUN0}/`], `rm "${r0}/memcheck.json"`, /not append-only/],
    ["delete, git rm", [`/runs/lm-retrain/${RUN0}/`], `git -C "$RESULTS_DIR" rm -q "runs/lm-retrain/${RUN0}/memcheck.json"`, /not append-only/],
    ["rename", [`/runs/lm-retrain/${RUN0}/`], `mv "${r0}/memcheck.json" "${r0}/memcheck-old.json"`, /not append-only/],
    ["rename, git mv", [`/runs/lm-retrain/${RUN0}/`], `git -C "$RESULTS_DIR" mv "runs/lm-retrain/${RUN0}/memcheck.json" "runs/lm-retrain/${RUN0}/m2.json"`, /not append-only/],
    ["type change (file -> symlink)", [`/runs/lm-retrain/${RUN0}/`], `rm "${r0}/memcheck.json"; ln -s record.json "${r0}/memcheck.json"`, /not append-only/],
    ["modify a file outside the paths (git would skip it silently)", [`/runs/lm-retrain/${RUN0}/`], `mkdir -p "$RESULTS_DIR/models/lm"; echo '{"version":"x"}' > "$RESULTS_DIR/models/lm/latest.json"`, /outside the --sparse paths/],
    ["append inside + modify outside", [`/runs/lm-retrain/${RUN0}/`], `echo n > "${r0}/new.json"; echo x > "$RESULTS_DIR/README.md"`, /outside the --sparse paths/],
    ["new file outside the paths", [`/runs/lm-retrain/${RUN0}/`], `mkdir -p "$RESULTS_DIR/runs/lm-retrain/${RUN1}"; echo n > "$RESULTS_DIR/runs/lm-retrain/${RUN1}/new.json"`, /./],
    ["delete outside the paths (git rm of a skipped path)", [`/runs/lm-retrain/${RUN0}/`], `git -C "$RESULTS_DIR" rm -q --sparse --cached models/lm/latest.json`, /not append-only|outside/],
  ];
  for (const [why, args, script, msg] of cases) {
    const w = W(d, R.url, args.flatMap((p) => ["--sparse", p]), script);
    assert.notEqual(w.status, 0, `${why}: refused\n${w.stdout}`); assert.match(w.stdout, msg, why);
    assert.doesNotMatch(w.stdout, /results committed|nothing to record/, why); assert.doesNotMatch(w.out, /results_sha/, why);
    assert.equal(R.head(), h0, `${why}: nothing pushed`);
  }
  for (const bad of ["runs/x/", "/runs/../x/", "/runs/./x", "/runs/*/", "/runs/x y/", "!/runs/x/", "/", "", "//runs"]) {
    const w = W(d, R.url, ["--sparse", bad], "echo n > \"$RESULTS_DIR/n\"");
    assert.notEqual(w.status, 0, bad); assert.match(w.stdout, /bad --sparse path: refused/, bad); assert.equal(R.head(), h0);
  }
  const m = spawnSync("bash", ["peaceai/bin/results-write.sh", "--sparse"], { cwd: repo, encoding: "utf8" });
  assert.notEqual(m.status, 0); assert.match(m.stdout, /--sparse needs a path/);
}));

test("M127 --sparse: a push race starts over from a fresh sparse clone (append-only retry); without --sparse the full clone is unchanged", () => tmp((d) => {
  const R = results(d); const h0 = R.head(); const other = join(d, "other");
  git(d, "clone", "-q", R.bare, other);
  // first attempt: someone else pushes first, so this push races; the second attempt re-clones and re-runs the recorder
  const w = W(d, R.url, ["--sparse", `/runs/lm-retrain/${RUN1}/`], `if [ ! -e "$EVID/../raced" ]; then : > "$EVID/../raced"
      (cd "${other}" && echo o > other.txt && git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -qm other && git push -q origin HEAD:main); fi
    test ! -e "$RESULTS_DIR/runs/lm-retrain/${RUN1}/memcheck.json"; echo '{"status":"PASS"}' > "$RESULTS_DIR/runs/lm-retrain/${RUN1}/memcheck.json"`);
  assert.equal(w.status, 0, w.stdout); assert.match(w.stdout, /results push raced \(attempt 1\); retrying from a fresh clone/); assert.match(w.stdout, /\(attempt 2\)$/m);
  assert.deepEqual(changes(R.bare, h0), ["A\tother.txt", `A\truns/lm-retrain/${RUN1}/memcheck.json`]);
  assert.deepEqual(changes(R.bare, "main^"), [`A\truns/lm-retrain/${RUN1}/memcheck.json`], "the retried commit is only the append");
  // no --sparse: the old full shallow clone (every file checked out), behaviour unchanged
  const f = W(d, R.url, [], `${EVIDENCE}\necho a > "$RESULTS_DIR/full.txt"`);
  assert.equal(f.status, 0, f.stdout); assert.ok(readFileSync(join(f.rt, "files"), "utf8").includes("models/lm/latest.json\n"), "full checkout");
  assert.equal(readFileSync(join(f.rt, "missing"), "utf8").trim(), "0", "no blob filter without --sparse");
  assert.deepEqual(changes(R.bare, "main^"), ["A\tfull.txt"]);
}));

// The real landing steps of peace-lm-retrain.yml (dry-run guard and results-write.sh kept; deploy key dropped).
function step(d: string, url: string, name: string, env: Record<string, string>) {
  const rt = mkdtempSync(join(d, "st-")); const out = join(rt, "out"); writeFileSync(out, "");
  const r = spawnSync("bash", ["-c", stepRun(name)], { cwd: repo, encoding: "utf8",
    env: { PATH: process.env.PATH!, HOME: d, GIT_CONFIG_NOSYSTEM: "1", RUNNER_TEMP: rt, GITHUB_OUTPUT: out, PEACEAI_RESULTS_REMOTE_OVERRIDE: url, DRY_RUN: "false", GITHUB_SHA: "1".repeat(40), MCO: "", ...env } });
  return { status: r.status, stdout: r.stdout + r.stderr, out: readFileSync(out, "utf8"), rt };
}
const MEMCHECK_LAND = "Land memcheck.json next to the run record and the candidate";
const CANDIDATE_LAND = "Land the run record (and, only on gate PASS, the candidate) in Results only";
const mcDir = (d: string, file: string, body: string) => { const m = mkdtempSync(join(d, "mc-")); writeFileSync(join(m, file), body); return m; };

test("M127 peace-lm-retrain.yml landings over the sparse clone: memcheck-only recheck, memcheck, candidate; append-only refusals unchanged", () => tmp((d) => {
  const R = results(d); let h = R.head();
  // memcheck-only: append memcheck-recheck-<run>.json under the source run (record.json read through the sparse path)
  const rc = { MCO: RUN0, GITHUB_RUN_ID: "40700000020", MC_DIR: mcDir(d, "recheck.json", "{\"status\":\"PASS\"}\n") };
  const a = step(d, R.url, MEMCHECK_LAND, rc); assert.equal(a.status, 0, a.stdout); assert.match(a.out, /^landed=true$/m);
  assert.deepEqual(changes(R.bare, h), [`A\truns/lm-retrain/${RUN0}/memcheck-recheck-40700000020.json`]); h = R.head();
  assert.notEqual(step(d, R.url, MEMCHECK_LAND, { ...rc, MC_DIR: mcDir(d, "recheck.json", "{}\n") }).status, 0, "the same recheck twice: refused");
  assert.notEqual(step(d, R.url, MEMCHECK_LAND, { ...rc, MCO: "40700000099", MC_DIR: mcDir(d, "recheck.json", "{}\n") }).status, 0, "a run without a record: refused");
  assert.equal(R.head(), h);
  // memcheck: both copies land next to an existing record and model; a second memcheck, or one for a missing model, refuses
  const mc = { GITHUB_RUN_ID: RUN1, V: V1, MC_DIR: mcDir(d, "memcheck.json", "{\"status\":\"PASS\"}\n") };
  const b = step(d, R.url, MEMCHECK_LAND, mc); assert.equal(b.status, 0, b.stdout);
  assert.deepEqual(changes(R.bare, h), [`A\tmodels/lm/${V1}/memcheck.json`, `A\truns/lm-retrain/${RUN1}/memcheck.json`]); h = R.head();
  assert.notEqual(step(d, R.url, MEMCHECK_LAND, { ...mc, MC_DIR: mcDir(d, "memcheck.json", "{}\n") }).status, 0, "memcheck.json exists: refused");
  assert.notEqual(step(d, R.url, MEMCHECK_LAND, { GITHUB_RUN_ID: RUN0, V: V0, MC_DIR: mcDir(d, "memcheck.json", "{}\n") }).status, 0, "existing run memcheck: refused");
  assert.notEqual(step(d, R.url, MEMCHECK_LAND, { ...mc, V: "", MC_DIR: mcDir(d, "memcheck.json", "{}\n") }).status, 0, "no version: refused");
  assert.equal(R.head(), h);
  // candidate: a run dir holding only saved arms gets the record and (PASS) the new model dir; anything more refuses
  const RUN2 = "40700000030", V2 = "lm-v1-cccccccccccc";
  const seed = join(d, "seed2"); git(d, "clone", "-q", R.bare, seed); mkdirSync(join(seed, "runs/lm-retrain", RUN2, "arms/0"), { recursive: true });
  writeFileSync(join(seed, "runs/lm-retrain", RUN2, "arms/0/save.json"), "{}\n"); git(seed, "add", "-A"); git(seed, "commit", "-qm", "arm"); git(seed, "push", "-q", "origin", "HEAD:main"); h = R.head();
  const cand = (run: string, pass: string, v: string) => {
    const m = mkdtempSync(join(d, "model-")); writeFileSync(join(m, "config.json"), JSON.stringify({ version: v })); writeFileSync(join(m, "weights.npz"), randomBytes(512));
    const e = mkdtempSync(join(d, "evals-")); writeFileSync(join(e, "record.json"), `{"run":"${run}"}\n`);
    return step(d, R.url, CANDIDATE_LAND, { GITHUB_RUN_ID: run, PASS: pass, MODEL_DIR: m, EVALS: e });
  };
  const c = cand(RUN2, "true", V2); assert.equal(c.status, 0, c.stdout);
  assert.deepEqual(changes(R.bare, h), [`A\tmodels/lm/${V2}/config.json`, `A\tmodels/lm/${V2}/weights.npz`, `A\truns/lm-retrain/${RUN2}/record.json`]); h = R.head();
  assert.match(cand(RUN2, "false", "none").stdout, /run dir already holds more than the saved arms/, "a second record: refused");
  assert.notEqual(cand("40700000031", "true", V2).status, 0, "the model dir already exists: refused");
  assert.equal(R.head(), h);
  assert.equal(git(R.bare, "show", "main:models/lm/latest.json"), `{"version":"${V0}"}`, "latest.json untouched");
  assert.ok(!existsSync(join(d, "seed")));
}));

test("M127 pins: every Results write in peace-lm-retrain.yml is sparse; the landing-script hash pins match results-write.sh", () => {
  const calls = WF.split("\n").filter((l) => /results-write\.sh /.test(l) && !/^\s*#/.test(l));
  assert.equal(calls.length, 5);
  for (const l of calls) assert.match(l, /results-write\.sh (--sparse "\/[^"\s]+" )+"|results-write\.sh "\$\{sp\[@\]\}" "/, l.trim());
  assert.match(WF, /sp=\(--sparse "\/runs\/lm-retrain\/\$GITHUB_RUN_ID\/"\)\n.*\n.*sp\+=\(--sparse "\/models\/lm\/\$v\/"\); fi\n/);
  const h = sha(readFileSync(join(repo, "peaceai/bin/results-write.sh")));
  for (const f of ["peace-lm-retrain.yml", "peace-lm-train-m49.yml", "peace-lm-judge-v2.yml"]) assert.ok(read(`.github/workflows/${f}`).includes(`${h}  peaceai/bin/results-write.sh\n`), f);
});
