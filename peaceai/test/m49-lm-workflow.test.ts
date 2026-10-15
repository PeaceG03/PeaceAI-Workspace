// M49: chained pretrain + fine-tune + evals workflow, fine-tune pair builder, train.py --init-from. Nothing run here
// touches Results or the network.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FT_AUTHOR, FT_SOURCE_LABEL, pairsOf, type FtCommit } from "../lib/ftpairs.ts";
import { isSafetyToolFile } from "../lib/extcorpus.ts";
const repo = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const B = "export function f(a: number): number {\n  return a + 1;\n}\n", A = "export function f(a: number): number {\n  return a + 2;\n}\n";
const C: FtCommit = { repo: "PeaceG03/PeaceSTOCKS", sha: "a".repeat(40), authorEmail: FT_AUTHOR, parents: 1, files: [{ path: "src/x.ts", before: B, after: A }] };
const NONE = { commits: new Set<string>(), contentSha256: new Set<string>(), paths: new Set<string>() };

test("fine-tune pairs: one per changed body, file cut right after the body; deterministic split", () => {
  const d = pairsOf(C, NONE);
  assert.equal(d.length, 1); assert.equal(d[0]!.function, "f");
  assert.equal(d[0]!.text, A.slice(0, A.lastIndexOf("}") + 1));
  assert.deepEqual(pairsOf(C, NONE), d);
});

test("fine-tune pairs refuse: other authors, merges, held-out commits/paths/content, tests, unchanged bodies", () => {
  assert.equal(pairsOf({ ...C, authorEmail: "someone@example.com" }, NONE).length, 0);
  assert.equal(pairsOf({ ...C, parents: 2 }, NONE).length, 0);
  assert.equal(pairsOf(C, { ...NONE, commits: new Set([`${C.repo}@${C.sha}`]) }).length, 0, "set A/B or heldout-c-excluded commit");
  assert.equal(pairsOf(C, { ...NONE, paths: new Set([`${C.repo}:src/x.ts`]) }).length, 0, "file a set A/B task touches");
  assert.equal(pairsOf(C, { ...NONE, contentSha256: new Set([sha(A)]) }).length, 0, "set C / #176 / safety-tool content (after)");
  assert.equal(pairsOf(C, { ...NONE, contentSha256: new Set([sha(B)]) }).length, 0, "(before)");
  assert.equal(pairsOf({ ...C, files: [{ path: "src/x.test.ts", before: B, after: A }] }, NONE).length, 0);
  assert.equal(pairsOf({ ...C, files: [{ path: "src/x.ts", before: B, after: B }] }, NONE).length, 0);
  assert.equal(pairsOf({ ...C, files: [{ path: "src/x.ts", before: null, after: A }] }, NONE).length, 0, "new files carry no before-body");
});

test("fine-tune pairs refuse every version of a safety-tool file, by path as well as by content sha (Auditor #178 M3)", () => {
  const W = { ...C, repo: "PeaceG03/PeaceAI-Workspace" };
  for (const p of ["peaceai/lib/leak.ts", "peaceai/bin/leak-scan.ts", "peaceai/bin/core-scan.ts", "peaceai/lib/trigger.ts"]) {
    assert.ok(isSafetyToolFile(W.repo, p), p);
    assert.equal(pairsOf({ ...W, files: [{ path: p, before: B, after: A }] }, NONE).length, 0, `${p}: new, unlisted content still refused`);
  }
  assert.equal(pairsOf({ ...W, files: [{ path: "src/x.ts", before: B, after: A }] }, NONE).length, 1, "a normal file still yields a pair");
  assert.equal(pairsOf({ ...W, files: [{ path: "src/x.ts", before: B, after: A }] }, { ...NONE, contentSha256: new Set([sha(A)]) }).length, 0, "content sha refusal still applies");
  const S = JSON.parse(read("peaceai/model/safety-tool-sha256.json"));
  assert.ok(S.sha256.length > 0 && read("peaceai/bin/ft-pairs.ts").includes("...S.sha256"), "the CLI also refuses safety-tool content shas");
  assert.match(FT_SOURCE_LABEL, /^all PeaceG03 public commits/);
});

test("ft-pairs CLI fails closed: reads every exclusion list, A/B paths included", () => {
  const s = read("peaceai/bin/ft-pairs.ts");
  for (const f of ["heldout.json", "heldout-c-excluded.json", "heldout-c.json", "heldout-c-tasks.json", "safety-tool-sha256.json"]) assert.ok(s.includes(`"${f}"`), f);
  assert.match(s, /fail closed/); assert.match(s, /empty split, refused/);
});

const WF = read(".github/workflows/peace-lm-train-m49.yml");
test("workflow: dispatch on main only, chained parts, no artifacts or caches, Results-only with path prefixes, no latest.json", () => {
  assert.match(WF, /^on:\n  workflow_dispatch:\n\npermissions: \{\}\n/m);
  assert.equal((WF.match(/if: github\.ref == 'refs\/heads\/main'/g) ?? []).length, 5);
  assert.match(WF, /  pretrain-2:\n(?:.*\n){0,3}    needs: pretrain-1\n/); assert.match(WF, /  pretrain-3:\n(?:.*\n){0,3}    needs: pretrain-2\n/);
  assert.match(WF, /    needs: pretrain-3\n/);
  assert.match(WF, /group: peace-lm-train\n  cancel-in-progress: false/, "shares the training lock with the M37 workflow");
  assert.ok(!/upload-artifact|actions\/cache|latest\.json\s*>|>\s*.*latest\.json|cp .*latest\.json/.test(WF));
  assert.equal((WF.match(/sha256sum -c --quiet SHA256SUMS/g) ?? []).length, 3, "every restore verifies the chunks");
  assert.equal((WF.match(/landing refused: path outside/g) ?? []).length, 5, "every Results write checks its prefix");
  assert.equal((WF.match(/test ! -e "\$d"/g) ?? []).length, 5, "append-only: never overwrite");
  assert.ok(!/git -C "\$RESULTS_DIR" rm|rm -rf "\$RESULTS_DIR/.test(WF), "nothing deleted in Results");
  assert.match(WF, /ext-manifest-check\.ts "\$RUNNER_TEMP\/corpus" pretrain/);
  for (const u of WF.matchAll(/uses: (\S+)/g)) assert.match(u[1]!, /@[0-9a-f]{40}$/, "actions pinned by sha");
});

function jobs(wf: string): Record<string, string> {
  const out: Record<string, string> = {}; const body = wf.slice(wf.indexOf("\njobs:\n") + 7);
  const parts = body.split(/^  (?=[\w-]+:\n)/m).filter(Boolean);
  for (const p of parts) out[p.slice(0, p.indexOf(":"))] = p;
  return out;
}
const J = jobs(WF);
const steps = (job: string) => J[job]!.split(/^      - /m).slice(1);

test("workflow (Auditor #178 H1): the model lands before any eval; generated code runs only in a job with no environment and no secrets", () => {
  assert.deepEqual(Object.keys(J), ["pretrain-1", "pretrain-2", "pretrain-3", "finetune-land", "eval-ab"]);
  const L = J["finetune-land"]!, E = J["eval-ab"]!;
  assert.ok(L.indexOf("- name: Land the model") < L.indexOf("eval_c.py") && L.indexOf("- name: Land the model") < L.indexOf("gen_c.py") && L.indexOf("- name: Land the model") < L.indexOf("eval_ab.py"));
  assert.ok(!/tsx", "--test|tsx --test|npm ci --ignore-scripts --no-audit --no-fund --loglevel=error\) \|\|/.test(L.slice(L.indexOf("- name: Fine-tune corpus"))), "no Peace repo install or test run in the landing job");
  assert.match(L, /eval_ab\.py --gen /); assert.ok(!/eval_ab\.py --run/.test(L));
  assert.match(E, /needs: finetune-land/); assert.match(E, /eval_ab\.py --run /);
  assert.ok(!/environment:|secrets\.|DEPLOY_KEY|with-deploy-key|results-write|weights|\$RUNNER_TEMP\/model/.test(E), "eval-ab: no environment, no secret, no model");
  assert.match(E, /permissions:\n      contents: read\n/); assert.match(E, /persist-credentials: false/);
  assert.match(E, /npm ci --ignore-scripts/, "Peace repos install without lifecycle scripts");
  for (const s of ["eval_c.py", "gen_c.py", "setc-grade.ts"]) assert.ok(L.includes(s), s);
  for (const st of [...steps("finetune-land"), ...steps("eval-ab")].filter((x) => /eval_c|gen_c|eval_ab/.test(x))) { assert.ok(!/set -e/.test(st)); assert.match(st, /\n          exit 0\n/, "evals are non-fatal"); }
});

test("workflow (Auditor #178 H1): every DEPLOY_KEY step is preceded by a checkout/diff/landing-script hash check", () => {
  const pins = /LANDING_SHA256: \|-\n((?:    [0-9a-f]{64}  \S+\n)+)/.exec(WF)![1]!.trim().split("\n").map((l) => l.trim().split(/\s+/));
  assert.deepEqual(pins.map((p) => p[1]).sort(), ["peaceai/bin/results-write.sh", "peaceai/bin/with-deploy-key.sh"]);
  for (const [h, f] of pins) assert.equal(sha(read(f!)), h, `${f} changed: re-review and re-pin LANDING_SHA256`);
  let keySteps = 0;
  for (const job of Object.keys(J)) {
    const st = steps(job);
    st.forEach((x, i) => {
      if (!/DEPLOY_KEY/.test(x)) return;
      keySteps++;
      const prev = st[i - 1];
      assert.ok(prev && /^name: Verify the checkout and the landing scripts/.test(prev), `${job}: key step not immediately preceded by the verify step: ${x.split("\n")[0]}`);
      for (const k of ['test "$(git rev-parse HEAD)" = "$GITHUB_SHA"', "git diff --exit-code", "git status --porcelain --untracked-files=all", 'sha256sum -c --quiet -']) assert.ok(prev!.includes(k), `${job}: ${k}`);
    });
  }
  assert.equal(keySteps, 8);
});

test("workflow (Auditor #178 H2): a failed set C checkout cannot kill the job; the model lands on success() || failure() if config.json exists", () => {
  assert.ok(!/\|\| exit 1; done/.test(WF), "no exit 1 inside the checkout loop");
  assert.match(WF, /checkout_c\(\) \{ local d; for d in "\$RUNNER_TEMP"\/csrc\/\*\/; do git -C "\$d" checkout -q FETCH_HEAD \|\| return 1; done; \}/);
  const land = steps("finetune-land").find((x) => x.startsWith("name: Land the model"))!;
  assert.match(land, /\n        if: \(success\(\) \|\| failure\(\)\) && steps\.landverify\.outcome == 'success'\n/);
  assert.match(land, /test -f "\$MODEL_DIR\/config\.json" \|\| \{ echo "no trained model/);
  const v = steps("finetune-land").find((x) => /id: landverify/.test(x))!;
  assert.match(v, /if: success\(\) \|\| failure\(\)/);
});

test("workflow (Auditor #178 M4): restores run only in jobs that hold the key for their own landing; no read-only key needed", () => {
  for (const job of Object.keys(J)) if (/Restore/.test(J[job]!)) assert.ok(/environment: peaceai-results/.test(J[job]!) && /results-write\.sh/.test(J[job]!), job);
  assert.ok(!/Restore/.test(J["eval-ab"]!));
});

test("config: ctx 1024, 3 parts that fit the 4 h cap, fine-tune knobs; parts cover the step total", () => {
  const c = JSON.parse(read("peaceai/model/ext-train-m49.json"));
  assert.equal(c.model.ctx, 1024); assert.equal(c.chain.parts, 3);
  assert.ok(c.chain.parts * c.chain.stepsPerPart >= c.model.steps);
  assert.ok(c.chain.maxSecondsPerPart <= 14400);
  assert.ok(c.finetune.lr > 0 && c.finetune.lr < 6e-4 && c.finetune.steps > 0);
  assert.deepEqual(c.finetune.repos, ["PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"]);
});

const PY = existsSync("/usr/bin/python3") && (() => { try { execFileSync("python3", ["-c", "import numpy"]); return true; } catch { return false; } })();
test("train.py --init-from: loads weights of the same shape, refuses a different shape", { skip: !PY }, () => {
  const d = mkdtempSync(join(tmpdir(), "m49-")), corpus = join(d, "c");
  execFileSync("mkdir", ["-p", corpus]);
  const docs = Array.from({ length: 12 }, (_, i) => JSON.stringify({ doc: i, text: `function f${i}(a) { return a + ${i}; }\n`.repeat(20) }));
  writeFileSync(join(corpus, "docs.jsonl"), docs.join("\n") + "\n");
  writeFileSync(join(corpus, "manifest.jsonl"), docs.map((_, i) => JSON.stringify({ doc: i, split: i % 4 ? "train" : "heldout" })).join("\n") + "\n");
  const tr = (work: string, ...a: string[]) => execFileSync("python3", [join(repo, "peaceai/model/train.py"), "--corpus", corpus, "--work", work, "--steps", "2", "--threads", "1", "--batch", "2", "--d-model", "16", "--n-layer", "1", "--n-head", "2", "--ctx", "16", "--vocab", "300", "--eval-every", "1", ...a], { encoding: "utf8" });
  tr(join(d, "w1"));
  execFileSync("mkdir", ["-p", join(d, "w2")]); execFileSync("cp", [join(d, "w1/tokenizer.json"), join(d, "w2/")]);
  assert.match(tr(join(d, "w2"), "--init-from", join(d, "w1/checkpoint.npz"), "--lr", "0.0001"), /initialized from weights/);
  execFileSync("mkdir", ["-p", join(d, "w3")]); execFileSync("cp", [join(d, "w1/tokenizer.json"), join(d, "w3/")]);
  assert.throws(() => tr(join(d, "w3"), "--init-from", join(d, "w1/checkpoint.npz"), "--d-model", "32"), /INIT_SHAPE_MISMATCH/);
});

test("workflow (M52, Architect (a)): both manifest shas the model trained on land in config.json trainedOn", () => {
  assert.equal((WF.match(/pretrain-manifest\.sha256/g) ?? []).length >= 7, true);
  assert.equal((WF.match(/pretrain manifest changed between parts: refused/g) ?? []).length, 3);
  const ftStep = steps("finetune-land").find((x) => x.startsWith("name: Fine-tune from the pretrain"))!;
  assert.match(ftStep, /\.trainedOn = \{pretrainManifestSha256: \$p, finetuneManifestSha256: \$f\}/);
  assert.match(ftStep, /manifest sha missing: refused/);
  assert.ok(ftStep.indexOf("trainedOn") < ftStep.indexOf("jq -r '\"model"), "written before the model is reported/landed");
});

const PIN = "d4399d79c366fa638292f7c5e859a36d12f085937eac793b8f7e5f729e5d780e";
test("Auditor #178: every ext-fetch and ext-manifest-check step pins --manifest-sha; repoCapBytes 11 MB", () => {
  const WF = read(".github/workflows/peace-lm-train-m49.yml");
  const fetches = WF.match(/ext-fetch\.ts "\$RUNNER_TEMP\/src" "\$RUNNER_TEMP\/corpus"[^\n]*/g) ?? [];
  const checks = WF.match(/ext-manifest-check\.ts "\$RUNNER_TEMP\/corpus" pretrain[^\n]*/g) ?? [];
  assert.equal(fetches.length, 3); assert.equal(checks.length, 3);
  for (const l of [...fetches, ...checks]) assert.ok(l.endsWith(` --manifest-sha ${PIN}`), l);
  assert.equal(JSON.parse(read("peaceai/model/ext-train-m49.json")).corpus.repoCapBytes, 11000000);
});

test("Auditor #178: --manifest-sha uses M51 readManifestBytes pin (wrong pin refuses)", () => {
  // #189 dropped the duplicate manifestShaPinProblem helper; bins pin via readManifestBytes + inline compare.
  for (const f of ["peaceai/bin/ext-fetch.ts", "peaceai/bin/ext-manifest-check.ts"]) {
    const src = read(f);
    assert.match(src, /readManifestBytes/, f);
    assert.match(src, /--manifest-sha/, f);
    assert.equal(src.includes("manifestShaPinProblem"), false, f);
  }
  const r = (() => { try { execFileSync("./node_modules/.bin/tsx", ["peaceai/bin/ext-manifest-check.ts", tmpdir(), "pretrain", "--manifest-sha", "0".repeat(64)], { cwd: repo, encoding: "utf8" }); return 0; } catch (e: any) { return e.status; } })();
  assert.equal(r, 1, "a wrong pin exits 1 before reading the corpus");
});

test("Auditor #178: set A/B candidates decompress through a 50 MB cap and an over-cap output is refused", () => {
  const WF = read(".github/workflows/peace-lm-train-m49.yml");
  const at = WF.lastIndexOf("\n", WF.indexOf("base64 -d | gunzip")) + 1;
  const step = WF.slice(at, WF.indexOf("\n", WF.indexOf("\n", at) + 1));
  assert.match(step, /gunzip \| head -c 50000000 > "\$RUNNER_TEMP\/ab-cands\.jsonl"/);
  assert.match(step, /stat -c %s "\$RUNNER_TEMP\/ab-cands\.jsonl"\)" -lt 50000000 \] \|\| \{[^}]*refused[^}]*exit 0; \}/);
  assert.equal((WF.match(/\| gunzip/g) ?? []).length, 1, "no other uncapped gunzip");
  // Behaviour, with the cap scaled down to 1000 bytes: under passes, a bomb is truncated and refused.
  const d = mkdtempSync(join(tmpdir(), "m49cap-"));
  const run = (bytes: number) => {
    const gz = execFileSync("bash", ["-c", `head -c ${bytes} /dev/zero | gzip | base64 -w0`], { encoding: "utf8" });
    const sh = step.replaceAll("50000000", "1000").replaceAll("$RUNNER_TEMP", d) + "\necho KEPT";
    return execFileSync("bash", ["-eo", "pipefail", "-c", sh], { env: { ...process.env, CANDS: gz }, encoding: "utf8" });
  };
  assert.match(run(500), /KEPT/);
  const big = run(1_000_000);
  assert.ok(!/KEPT/.test(big) && /FAILED|refused/.test(big), big);
  assert.ok(!existsSync(join(d, "ab-cands.jsonl")) || readFileSync(join(d, "ab-cands.jsonl")).length <= 1000);
});

// Auditor #178 (open item): a step that writes $GITHUB_ENV or $GITHUB_PATH changes the env/PATH of every later step,
// including the DEPLOY_KEY steps, which the verify-before-key check does not see. Ban those writes (and the legacy
// ::set-env / ::add-path commands) anywhere in a job that holds the key.
const ENV_PATH_WRITE = /GITHUB_ENV|GITHUB_PATH|::set-env|::add-path|ACTIONS_ALLOW_UNSECURE_COMMANDS/;
function envPathWriteProblems(jobs: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [job, body] of Object.entries(jobs)) {
    if (!/DEPLOY_KEY/.test(body)) continue;
    for (const st of body.split(/^      - /m).slice(1)) if (ENV_PATH_WRITE.test(st)) out.push(`${job}: ${st.split("\n")[0]}`);
  }
  return out;
}

test("workflow (Auditor #178): no job holding DEPLOY_KEY writes $GITHUB_ENV or $GITHUB_PATH", () => {
  assert.deepEqual(envPathWriteProblems(J), []);
});

test("key guard refuses $GITHUB_ENV / $GITHUB_PATH / ::set-env / ::add-path writes in a key job, and ignores key-free jobs", () => {
  const keyJob = (run: string) => ({ j: `    steps:\n      - name: evil\n        run: ${run}\n      - name: land\n        env:\n          DEPLOY_KEY: x\n` });
  for (const run of ['echo "PATH=/tmp/x" >> "$GITHUB_ENV"', 'echo /tmp/bin >> $GITHUB_PATH', 'echo "LD_PRELOAD=/tmp/x.so" >> ${GITHUB_ENV}', 'echo "::set-env name=PATH::/tmp"', 'echo "::add-path::/tmp"'])
    assert.equal(envPathWriteProblems(keyJob(run)).length, 1, run);
  assert.deepEqual(envPathWriteProblems({ j: `    steps:\n      - name: ok\n        run: echo "A=1" >> "$GITHUB_ENV"\n` }), []);
  assert.deepEqual(envPathWriteProblems(keyJob("echo hi")), []);
});

test("run 38778546963: every git command on the partial Results clone runs inside with-deploy-key.sh (lazy blob fetch needs the key)", () => {
  const WF = read(".github/workflows/peace-lm-train-m49.yml");
  const lines = WF.split("\n").filter((l) => /git (clone|-C "\$RUNNER_TEMP\/res")/.test(l) && l.includes("res"));
  assert.equal(lines.filter((l) => l.includes("--filter=blob:none --sparse")).length, 3);
  assert.equal(lines.filter((l) => l.includes("sparse-checkout set")).length, 3);
  for (const l of lines) assert.match(l.trim(), /^\.\/peaceai\/bin\/with-deploy-key\.sh git /, l);
});

