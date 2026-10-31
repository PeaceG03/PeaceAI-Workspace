// M167: model-v1, the model-backed edit proposer (peaceai/spec/edit-proposer-model-v1.md): lib/modelpropose.ts (the
// attempt side: checks and applies a ranking, holds no model), lib/modelscore.ts (the scoring side: candidate lists,
// the job gate, the no-network check, the ranking), bin/loop.ts --proposer model-v1, bin/model-v1-score.ts and
// .github/workflows/peace-model-v1-dev.yml. Tiny synthetic fixtures only (written for these tests, not modeled on any
// task); the scorer is a fake (never infer.py, never weights); no network. Every guard is a single line tagged
// "// m167-guard:<id>"; the mutation part deletes each in turn (and applies fixed semantic rewrites) and requires a
// case to fail.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openRepo } from "../lib/codesearch.ts";
import * as EP from "../lib/editpropose.ts";
import * as LM from "../lib/lm.ts";
import * as Loop from "../lib/loop.ts";
import * as MP from "../lib/modelpropose.ts";
import * as MS from "../lib/modelscore.ts";
import type { PlanTaskFile } from "../lib/plan.ts";
import { setup, teardown, type M152Ctx } from "./m152-fixtures.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const libDir = join(ROOT, "peaceai/lib");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
interface Libs { mp: typeof MP; ms: typeof MS; loop: typeof Loop }

let base: string;
let ctx: M152Ctx;
before(() => { base = mkdtempSync(join(tmpdir(), "peaceai-m167-")); ctx = setup(); });
after(() => { rmSync(base, { recursive: true, force: true }); teardown(ctx); });

let n = 0;
function repoDir(files: Record<string, string>): string {
  const d = join(base, `r${n++}`);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
const RANGE = "export function inRange(x: number, lo: number, hi: number): boolean {\n  return x >= lo && x < hi;\n}\n";
const PICK = "export function pickValue(o: Record<string, unknown>, k: string, d: unknown): unknown {\n  return o[k] || d;\n}\n";
const FILES = { "src/range.ts": RANGE, "src/pick.ts": PICK };
const REQUEST = "`inRange(5, 1, 5)` returns false, but the upper bound is inclusive.";
const NAMELESS = "Fix it so that it works.";
const TASK_FILE_SHA = "c".repeat(64);
const TASK_KEY = "0123456789abcdef";
const WEIGHTS = "8".repeat(64);
const MANIFEST = "9".repeat(64);
const PIN = { weightsSha256: WEIGHTS };
const fileList = (d: string) => Object.keys(FILES).sort().map((p) => ({ path: p, content: readFileSync(join(d, p), "utf8") }));
const input = (d: string, attempt = 1) => ({ files: fileList(d), attempt, feedback: [], baseline: null });

/** repair-v1's first candidate list for the fixture, as the scoring job builds it (request only). */
function queueOf(d: string, request = REQUEST, failing: string[] = []): EP.Candidate[] {
  const sites = EP.locate(openRepo(d), { request, failing });
  return sites.length ? EP.repairCandidates(sites, new Map(fileList(d).map((f) => [f.path, f.content] as const))) : [];
}
/** A ranking: reverse order by default (the fake model prefers later candidates), bound with the given lib. */
function rankingFor(l: Libs, cands: readonly EP.Candidate[], over: Partial<MP.Ranking> = {}, order?: number[]): MP.Ranking {
  const o = order ?? cands.map((_, i) => cands.length - 1 - i);
  const cs = l.mp.candidatesSha256(cands);
  const manifest = over.modelManifestSha256 ?? MANIFEST;
  return { schema: MP.RANKING_SCHEMA, taskFileSha256: TASK_FILE_SHA, weightsSha256: WEIGHTS, modelManifestSha256: manifest, entries: [{ taskKey: TASK_KEY, candidatesSha256: cs, order: o, bindingSha256: l.mp.bindingSha256(manifest, TASK_KEY, cs, o) }], ...over };
}
const asText = (r: unknown) => { const t = JSON.stringify(r); return { t, s: sha(t) }; };
const parse = (l: Libs, r: unknown, fileSha = TASK_FILE_SHA) => { const { t, s } = asText(r); return l.mp.parseRanking(t, s, PIN, fileSha); };
const reason = (x: ReturnType<typeof MP.parseRanking>) => (x.ok ? "OK" : x.reason);
/** The proposer's first proposal, or "threw" / the refusal code. */
function first(l: Libs, d: string, ranking: MP.Ranking | null, request = REQUEST, failing: string[] = [], key = TASK_KEY): string | EP.RepairEdit[] {
  const p = l.mp.modelProposer({ taskKey: key }, ranking);
  try { p.prepare(openRepo(d), { request, failing }); } catch { return "prepare-threw"; }
  try { const r = p.next(input(d)); return "refuse" in r ? r.refuse : r.edits; } catch { return "next-threw"; }
}
const tryOr = <T>(f: () => T): T | "threw" => { try { return f(); } catch { return "threw"; } };
const GOOD_ENV = { GITHUB_ACTIONS: "true", GITHUB_JOB: "model-v1-score", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_WORKFLOW_REF: "PeaceG03/PeaceAI-Workspace/.github/workflows/peace-model-v1-dev.yml@refs/heads/main" };
const fakeScorer = (items: { id: string; context: string; target: string }[]) => items.map((it) => ({ id: it.id, logprob: Number(it.id), tokens: 1 }));

interface Case { id: string; run: (l: Libs) => void }
const CASES: Case[] = [
  {
    id: "rerank: model-v1 proposes the ranking's first candidate (repair-v1's own first one is a different candidate); the row names the manifest",
    run(l) {
      const d = repoDir(FILES);
      const q = queueOf(d);
      assert.ok(q.length >= 3, "fixture: several candidates");
      const r = rankingFor(l, q);
      assert.deepEqual(first(l, d, r), q[q.length - 1]!.edits);
      const rep = EP.repairProposer(); rep.prepare(openRepo(d), { request: REQUEST, failing: [] });
      const e = rep.next(input(d));
      assert.ok("edits" in e && JSON.stringify(e.edits) === JSON.stringify(q[0]!.edits) && JSON.stringify(q[0]!.edits) !== JSON.stringify(q[q.length - 1]!.edits));
      assert.equal(l.mp.modelProposer({ taskKey: TASK_KEY }, r).modelManifestSha256, MANIFEST);
      assert.equal(l.mp.modelProposer({ taskKey: TASK_KEY }, null).modelManifestSha256, null);
      // later attempts follow the ranking, then NO_MORE_EDITS
      const p = l.mp.modelProposer({ taskKey: TASK_KEY }, rankingFor(l, q, {}, q.map((_, i) => i).reverse()));
      p.prepare(openRepo(d), { request: REQUEST, failing: [] });
      const seen: string[] = [];
      for (let a = 1; a <= q.length + 1; a++) { const x = p.next({ ...input(d, a), feedback: [] }); seen.push("refuse" in x ? x.refuse : JSON.stringify(x.edits)); }
      assert.deepEqual(seen, [...q.map((c) => JSON.stringify(c.edits)).reverse(), "NO_MORE_EDITS"]);
    },
  },
  {
    id: "request-only: failing test names never change model-v1's candidate list (the scoring job has none); near miss: they change repair-v1's",
    run(l) {
      const d = repoDir(FILES);
      const failing = ["`pickValue` keeps a zero"];
      assert.notEqual(MP.candidatesSha256(queueOf(d, REQUEST, failing)), MP.candidatesSha256(queueOf(d)), "fixture: failing names add sites");
      const q = queueOf(d);
      assert.deepEqual(first(l, d, rankingFor(l, q), REQUEST, failing), q[q.length - 1]!.edits);
    },
  },
  {
    id: "nothing located: the ranking must hold for an empty list too (NO_EDIT); near miss: a ranking for a non-empty list fails",
    run(l) {
      const d = repoDir(FILES);
      assert.equal(first(l, d, rankingFor(l, [], {}, []), NAMELESS), "NO_EDIT");
      assert.equal(first(l, d, rankingFor(l, queueOf(d)), NAMELESS), "next-threw");
    },
  },
  {
    id: "prepare refusals: no usable ranking, or no entry for this task, fail in prepare (PROPOSER_FAILED), never repair-v1's order",
    run(l) {
      const d = repoDir(FILES);
      const q = queueOf(d);
      const p0 = l.mp.modelProposer({ taskKey: TASK_KEY }, null);
      assert.throws(() => p0.prepare(openRepo(d), { request: REQUEST, failing: [] }), /none usable/);
      const p1 = l.mp.modelProposer({ taskKey: "fedcba9876543210" }, rankingFor(l, q));
      assert.throws(() => p1.prepare(openRepo(d), { request: REQUEST, failing: [] }), /no entry/);
      assert.deepEqual(first(l, d, rankingFor(l, q)), q[q.length - 1]!.edits, "near miss: the right task key works");
    },
  },
  {
    id: "apply refusals: another candidate list, a broken binding, a non-permutation or a missing entry throw (PROPOSER_FAILED)",
    run(l) {
      const d = repoDir(FILES);
      const q = queueOf(d);
      const r = rankingFor(l, q);
      assert.deepEqual(l.mp.applyRanking(r, TASK_KEY, q), [...q].reverse(), "near miss: the bound list applies");
      assert.throws(() => l.mp.applyRanking(r, TASK_KEY, q.slice(1)), /another candidate list/);
      const e = r.entries[0]!;
      const swapped = [e.order[1]!, e.order[0]!, ...e.order.slice(2)];
      assert.throws(() => l.mp.applyRanking({ ...r, entries: [{ ...e, order: swapped }] }, TASK_KEY, q), /binding mismatch/);
      const short = e.order.slice(0, -1);
      assert.throws(() => l.mp.applyRanking({ ...r, entries: [{ ...e, order: short, bindingSha256: l.mp.bindingSha256(MANIFEST, TASK_KEY, e.candidatesSha256, short) }] }, TASK_KEY, q), /not a permutation/);
      assert.throws(() => l.mp.applyRanking(r, "fedcba9876543210", q), /no entry/);
      // the manifest is in the binding: a ranking relabelled with another model's manifest fails
      const other = { ...r, modelManifestSha256: "7".repeat(64) };
      assert.equal(parse(l, other).ok, true);
      assert.equal(first(l, d, other), "next-threw");
      // the binding is exactly the documented formula
      assert.equal(e.bindingSha256, sha(`${MP.RANKING_SCHEMA}\n${MANIFEST}\n${TASK_KEY}\n${e.candidatesSha256}\n${e.order.join(",")}\n`));
      assert.equal(e.candidatesSha256, sha(JSON.stringify(q.map((c) => c.key))));
    },
  },
  {
    id: "parse: the text must hash to the job output, be the exact schema for this task file and the pinned weights",
    run(l) {
      const d = repoDir(FILES);
      const r = rankingFor(l, queueOf(d));
      assert.equal(reason(parse(l, r)), "OK");
      const { t, s } = asText(r);
      assert.equal(reason(l.mp.parseRanking(null, s, PIN, TASK_FILE_SHA)), "RANKING_MISSING");
      assert.equal(reason(l.mp.parseRanking(t, null, PIN, TASK_FILE_SHA)), "RANKING_SHA_MISMATCH");
      assert.equal(reason(l.mp.parseRanking(t + " ", s, PIN, TASK_FILE_SHA)), "RANKING_SHA_MISMATCH");
      const big = t + " ".repeat(MP.MAX_RANKING_BYTES);
      assert.equal(reason(l.mp.parseRanking(big, sha(big), PIN, TASK_FILE_SHA)), "RANKING_TOO_LARGE");
      assert.equal(reason(parse(l, { ...r, schema: "peaceai-model-v1-ranking:v0" })), "RANKING_INVALID");
      assert.equal(reason(parse(l, { ...r, extra: 1 })), "RANKING_INVALID");
      assert.equal(reason(parse(l, { ...r, modelManifestSha256: "X".repeat(64) })), "RANKING_INVALID");
      assert.equal(reason(parse(l, r, "d".repeat(64))), "RANKING_OTHER_TASK_FILE");
      assert.equal(reason(parse(l, { ...r, weightsSha256: "6".repeat(64) })), "RANKING_OTHER_WEIGHTS");
      const e = r.entries[0]!;
      assert.equal(reason(parse(l, { ...r, entries: [e, e] })), "RANKING_INVALID");
      assert.equal(reason(parse(l, { ...r, entries: [{ ...e, taskKey: "XYZ" }] })), "RANKING_INVALID");
      assert.equal(reason(parse(l, { ...r, entries: [{ ...e, order: [0, 0] }] })), "RANKING_INVALID");
      const o61 = Array.from({ length: 61 }, (_, i) => i);
      assert.equal(reason(parse(l, { ...r, entries: [{ ...e, order: o61 }] })), "RANKING_INVALID");
      const o60 = o61.slice(0, 60);
      assert.equal(reason(parse(l, { ...r, entries: [{ ...e, order: o60 }] })), "OK", "near miss: 60 candidates parse");
    },
  },
  {
    id: "pin and run: model-v1 runs only on the pinned public dev task file at the pinned --max",
    run(l) {
      const pin = JSON.parse(readFileSync(join(ROOT, MP.MODEL_V1_PIN), "utf8"));
      assert.equal(l.mp.modelV1PinProblem(pin), null);
      assert.equal(l.mp.modelV1PinProblem({ ...pin, version: "lm-v1-000000000000" }), "version");
      assert.equal(l.mp.modelV1PinProblem({ ...pin, taskFile: "peaceai/plan/tasks-hidden-v1.json" }), "task_file");
      const pub = join(ROOT, "peaceai/plan/tasks-public-v1.json");
      assert.equal(l.mp.modelV1RunProblem(pin, pub, 20, ROOT), null);
      assert.equal(l.mp.modelV1RunProblem(pin, "peaceai/plan/tasks-public-v1.json", 20, ROOT, ROOT), null);
      assert.equal(l.mp.modelV1RunProblem(pin, join(ROOT, "peaceai/plan/tasks-other.json"), 20, ROOT), "MODEL_V1_DEV_TASK_FILE_ONLY");
      assert.equal(l.mp.modelV1RunProblem(pin, pub, 3, ROOT), "MODEL_V1_MAX_NOT_PREREGISTERED");
      assert.equal(l.mp.modelV1RunProblem({ ...pin, maxAttempts: 0 }, pub, 0, ROOT), "MODEL_V1_PIN_INVALID");
    },
  },
  {
    id: "scoring job gate: only model-v1-score of peace-model-v1-dev.yml on main, dispatched, on Actions, in this repo, without candidate code",
    run(l) {
      assert.equal(l.ms.scoringJobAllowed(GOOD_ENV), true);
      assert.equal(l.ms.scoringJobAllowed({}), false, "the box (off Actions) is refused, unlike lmJobAllowed");
      assert.equal(LM.lmJobAllowed({}), true, "(lm.ts still allows off Actions)");
      assert.equal(l.ms.scoringJobAllowed({ ...GOOD_ENV, GITHUB_ACTIONS: undefined }), false);
      assert.equal(l.ms.scoringJobAllowed({ ...GOOD_ENV, PEACEAI_CANDIDATE_JOB: "true" }), false);
      assert.equal(l.ms.scoringJobAllowed({ ...GOOD_ENV, GITHUB_JOB: "model-v1-attempt" }), false);
      assert.equal(l.ms.scoringJobAllowed({ ...GOOD_ENV, GITHUB_REPOSITORY: "someone/PeaceAI-Workspace" }), false);
      assert.equal(l.ms.scoringJobAllowed({ ...GOOD_ENV, GITHUB_EVENT_NAME: "push" }), false);
      assert.equal(l.ms.scoringJobAllowed({ ...GOOD_ENV, GITHUB_REF: "refs/heads/loop/batch-8b" }), false);
      assert.equal(l.ms.scoringJobAllowed({ ...GOOD_ENV, GITHUB_WORKFLOW_REF: "PeaceG03/PeaceAI-Workspace/.github/workflows/ci.yml@refs/heads/main" }), false);
      assert.equal(LM.lmJobAllowed(GOOD_ENV), true, "runInfer's own gate passes in the scoring job");
      assert.equal(LM.lmJobAllowed({ ...GOOD_ENV, GITHUB_JOB: "model-v1-attempt" }), false);
    },
  },
  {
    id: "no network: only loopback (or nothing) may be left; manifest = sha256sum lines in LM_FILES order",
    run(l) {
      const a = [{ address: "10.0.0.2", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: null }] as never;
      assert.equal(l.ms.offline({}), true);
      assert.equal(l.ms.offline({ lo: a }), true);
      assert.equal(l.ms.offline({ eth0: [] as never }), true);
      assert.equal(l.ms.offline({ lo: a, eth0: a }), false);
      const shas = { "config.json": "1".repeat(64), "tokenizer.json": "2".repeat(64), "weights.npz": "3".repeat(64) };
      assert.equal(l.ms.modelManifest(shas), `${"1".repeat(64)}  config.json\n${"2".repeat(64)}  tokenizer.json\n${"3".repeat(64)}  weights.npz\n`);
      assert.equal(l.ms.modelManifestSha256(shas), sha(l.ms.modelManifest(shas)!));
      assert.equal(l.ms.modelManifestSha256({ ...shas, "weights.npz": "" }), null);
    },
  },
  {
    id: "ranking: mean log-probability high first, unscored last, ties keep repair-v1's order; a failed or mismatched scorer gives no ranking",
    run(l) {
      assert.deepEqual(l.ms.rankOrder([-1, -0.5, null, -0.5, -2]), [1, 3, 0, 4, 2]);
      assert.deepEqual(l.ms.rankOrder([0, 0, 0]), [0, 1, 2]);
      const c: MS.CandidatesFile = { schema: MS.CANDIDATES_SCHEMA, taskFileSha256: TASK_FILE_SHA, entries: [{ taskKey: TASK_KEY, candidatesSha256: "a".repeat(64), items: [{ context: "a", target: "b" }, { context: "c", target: "d" }] }, { taskKey: "fedcba9876543210", candidatesSha256: MP.candidatesSha256([]), items: [] }] };
      const m = { weightsSha256: WEIGHTS, modelManifestSha256: MANIFEST };
      const r = l.ms.buildRanking(c, fakeScorer, m);
      assert.ok(r.ok);
      assert.deepEqual(r.ranking.entries.map((e) => e.order), [[1, 0], []]);
      assert.equal(r.sha256, sha(r.text));
      assert.equal(reason(l.mp.parseRanking(r.text, r.sha256, PIN, TASK_FILE_SHA)), "OK");
      assert.deepEqual(tryOr(() => l.ms.buildRanking(c, () => null, m)), { ok: false, reason: "INFER_FAILED" });
      assert.deepEqual(tryOr(() => l.ms.buildRanking(c, (items) => fakeScorer(items).reverse(), m)), { ok: false, reason: "SCORES_MISMATCH" });
    },
  },
  {
    id: "candidate lists: the scoring job's list is exactly the one model-v1 rebuilds in the attempt job; a moved commit or failed fetch gives none",
    run(l) {
      const file: PlanTaskFile = { schema: "peaceai-plan-tasks:v1", set: "public", tasks: [ctx.task] };
      const { out, refused } = l.ms.buildCandidates(file, TASK_FILE_SHA, ctx.fetcher);
      assert.deepEqual(refused, {});
      assert.equal(out.entries.length, 1);
      const e = out.entries[0]!;
      assert.ok(e.items.length > 0 && e.items.every((it) => it.target.length > 0 && it.context.includes("src/window.ts")));
      // the attempt side on a fresh copy of the same commit (loop: openRepo on the reset copy, indexFiles as next's files)
      const r = l.ms.buildRanking(out, fakeScorer, { weightsSha256: WEIGHTS, modelManifestSha256: MANIFEST });
      assert.ok(r.ok);
      const c = ctx.fetcher(ctx.task.repo, ctx.task.commit, ctx.task.commit, []);
      try {
        const p = l.mp.modelProposer({ taskKey: e.taskKey }, r.ranking);
        p.prepare(openRepo(c.dir), { request: ctx.task.request, failing: ["lastN returns n items"] });
        const x = p.next({ files: l.loop.indexFiles(c.dir), attempt: 1, feedback: [], baseline: null });
        assert.ok("edits" in x, "the rebuilt list matches the scored one");
      } finally { c.close(); }
      const moved = l.ms.buildCandidates(file, TASK_FILE_SHA, (...a) => ({ ...ctx.fetcher(...a), head: "0".repeat(40) }));
      assert.deepEqual([moved.out.entries.length, moved.refused], [0, { COMMIT_MISMATCH: 1 }]);
      const failed = l.ms.buildCandidates(file, TASK_FILE_SHA, () => { throw new Error("offline"); });
      assert.deepEqual([failed.out.entries.length, failed.refused], [0, { FETCH_FAILED: 1 }]);
      const bad = l.ms.buildCandidates({ ...file, tasks: [{ ...ctx.task, repo: "not a repo" }] }, TASK_FILE_SHA, ctx.fetcher);
      assert.deepEqual(bad.refused, { TASK_INVALID: 1 });
    },
  },
  {
    id: "sha-model: loopSha256 binds modelpropose.ts (a changed model-v1 gives a new hash); near miss: a file outside the loop does not",
    run(l) {
      const root = join(base, `sha-root-${n++}`);
      mkdirSync(join(root, "peaceai/lib"), { recursive: true });
      for (const f of ["loop.ts", "looprow.ts", "loopdeps.ts", "editpropose.ts", "modelpropose.ts", "modelscore.ts"]) copyFileSync(join(libDir, f), join(root, "peaceai/lib", f));
      const h0 = l.loop.loopSha256(root);
      writeFileSync(join(root, "peaceai/lib/modelscore.ts"), "// changed\n");
      assert.equal(l.loop.loopSha256(root), h0);
      writeFileSync(join(root, "peaceai/lib/modelpropose.ts"), readFileSync(join(root, "peaceai/lib/modelpropose.ts"), "utf8") + "\n// changed\n");
      assert.notEqual(l.loop.loopSha256(root), h0, "a changed model-v1 kept the same loopSha256");
    },
  },
];

for (const c of CASES) test(`M167: ${c.id}`, () => c.run({ mp: MP, ms: MS, loop: Loop }));

// ---- static: what each side may import, and the bins' gates

const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => src(p).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const imports = (p: string) => [...code(p).matchAll(/from "([^"]+)"/g)].map((m) => m[1]!).sort();

test("M167: the attempt side (modelpropose.ts) holds no model: no lm.ts, no infer, no file, process or network module", () => {
  assert.deepEqual(imports("peaceai/lib/modelpropose.ts"), ["./codesearch.ts", "./editpropose.ts", "node:crypto", "node:path"]);
  assert.doesNotMatch(code("peaceai/lib/modelpropose.ts"), /infer\.py|weights\.npz|runInfer|\bfetch\(|https?:\/\//);
  assert.doesNotMatch(code("peaceai/lib/loop.ts"), /from "\.\/(?:lm|modelscore)\.ts"|runInfer/);
});

test("M167: the scoring side writes no file and opens no socket itself; runInfer and verifyModelDir are only in the scoring bin", () => {
  assert.doesNotMatch(code("peaceai/lib/modelscore.ts"), /node:(?:fs|net|http|https|dgram|child_process)|writeFile|\bfetch\(/);
  for (const f of ["peaceai/lib/modelpropose.ts", "peaceai/lib/modelscore.ts", "peaceai/lib/loop.ts", "peaceai/bin/loop.ts"]) assert.doesNotMatch(code(f), /runInfer\(|verifyModelDir\(/, f);
  const bin = code("peaceai/bin/model-v1-score.ts");
  const gate = bin.indexOf("if (!scoringJobAllowed(process.env))");
  assert.ok(gate > 0 && gate < bin.indexOf("readFileSync(") && gate < bin.indexOf("buildCandidates(") && gate < bin.indexOf("runInfer("), "the job gate comes before anything is read or run");
  const off = bin.indexOf("if (!offline())");
  assert.ok(off > 0 && off < bin.indexOf("verifyModelDir(") && off < bin.indexOf("runInfer("), "no network before the model is touched");
  assert.ok(bin.indexOf("verifyModelDir(") < bin.indexOf("runInfer("));
  assert.match(bin, /shas\["weights\.npz"\] !== pin!\.weightsSha256/);
});

test("M167: LM_JOBS pins model-v1-score to its workflow (runInfer's gate); the pin is the promoted, judged model", () => {
  assert.equal((LM.LM_JOB_WORKFLOWS as Record<string, string>)["model-v1-score"], MS.SCORE_WORKFLOW);
  const pin = JSON.parse(src(MP.MODEL_V1_PIN)), v2 = JSON.parse(src("peaceai/model/judge-v2.json"));
  for (const k of ["version", "runId", "weightsSha256"]) assert.equal(pin[k], v2.promoted[k], k);
  assert.equal(pin.maxAttempts, 20, "the pre-registered --max (spec)");
  assert.match(src("peaceai/spec/edit-proposer-model-v1.md"), /pre-registered `--max` is 20/);
});

test("M167: bin/loop.ts: model-v1 is checked (modelV1RunProblem) before any run; ranking flags need model-v1", () => {
  const bin = code("peaceai/bin/loop.ts");
  assert.ok(bin.indexOf("modelV1RunProblem(") > 0 && bin.indexOf("modelV1RunProblem(") < bin.indexOf("runLoopFile("));
  assert.match(bin, /prop !== "rules-v1" && prop !== "repair-v1" && prop !== MODEL_PROPOSER/);
  const tsx = join(ROOT, "node_modules/.bin/tsx");
  const run = (...a: string[]) => spawnSync(tsx, [join(ROOT, "peaceai/bin/loop.ts"), ...a], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 60_000 });
  const r1 = run("run", "peaceai/plan/tasks-public-v1.json", "--max", "3", "--proposer", "model-v1");
  assert.deepEqual([r1.status, r1.stdout.trim()], [2, "refused MODEL_V1_MAX_NOT_PREREGISTERED"]);
  const r2 = run("run", "peaceai/plan/tasks-public-v1.json", "--max", "20", "--proposer", "repair-v1", "--ranking", "/nonexistent");
  assert.deepEqual([r2.status, r2.stdout.trim()], [2, "refused RANKING_WITHOUT_MODEL_V1"]);
});

test("M167: bin/model-v1-score.ts refuses on the box (and anywhere but the scoring job) before reading or writing anything", () => {
  const tsx = join(ROOT, "node_modules/.bin/tsx");
  const out = join(base, "never.json");
  for (const env of [{ PATH: process.env.PATH }, { PATH: process.env.PATH, ...GOOD_ENV, PEACEAI_CANDIDATE_JOB: "true" }]) {
    const r = spawnSync(tsx, [join(ROOT, "peaceai/bin/model-v1-score.ts"), "candidates", "--out", out], { cwd: ROOT, encoding: "utf8", env, timeout: 60_000 });
    assert.deepEqual([r.status, r.stdout.trim()], [1, "refused SCORE_JOB_REFUSED"]);
    assert.equal(existsSync(out), false);
  }
});

test("M167: the workflow: dispatch-only, two jobs, weights only in the scoring job, no artifacts, no network while scoring, pinned key scripts", () => {
  const w = src(".github/workflows/peace-model-v1-dev.yml");
  assert.match(w, /^on:\n {2}workflow_dispatch:\n\npermissions: \{\}\n/m);
  assert.doesNotMatch(w, /upload-artifact|download-artifact|actions\/cache|pull_request|schedule:|workflow_run|inputs:/);
  const at = w.indexOf("\n  model-v1-attempt:\n");
  const score = w.slice(w.indexOf("\n  model-v1-score:\n"), at), attempt = w.slice(at);
  assert.ok(score.length > 0 && attempt.length > 0);
  assert.match(score, /environment: peaceai-results/);
  assert.match(score, /ranking: \$\{\{ steps\.score\.outputs\.ranking \}\}\n\s+ranking_sha256: \$\{\{ steps\.score\.outputs\.ranking_sha256 \}\}/);
  assert.match(score, /sudo unshare --net -- setpriv[^\n]*\n(?:[^\n]*\\\n)*[^\n]*model-v1-score\.ts score /);
  assert.match(score, /if: always\(\)\n\s+run: rm -rf "\$RUNNER_TEMP\/m"/);
  assert.doesNotMatch(score, /bin\/loop\.ts|PEACEAI_STAGE2_CAND|useradd/, "no candidate code in the scoring job");
  assert.doesNotMatch(attempt, /environment:|secrets\.|DEPLOY_KEY|model-v1-fetch|model-v1-score\.ts|venv|infer\.py/, "no weights or keys in the attempt job");
  assert.match(attempt, /needs: model-v1-score/);
  assert.match(attempt, /PEACEAI_CANDIDATE_JOB: "true"/);
  assert.match(attempt, /--proposer model-v1 --ranking "\$RUNNER_TEMP\/ranking\.json" --ranking-sha256 "\$RANKING_SHA256"/);
  assert.match(attempt, /RANKING: \$\{\{ needs\.model-v1-score\.outputs\.ranking \}\}/);
  for (const j of [score, attempt]) assert.match(j, /if: github\.repository == 'PeaceG03\/PeaceAI-Workspace' && github\.ref == 'refs\/heads\/main'/);
  const keys = /KEY_SCRIPTS_SHA256: \|-\n((?: {4}[0-9a-f]{64} {2}\S+\n)+)/.exec(w);
  assert.ok(keys, "pinned key scripts");
  for (const line of keys[1]!.trim().split("\n")) {
    const [h, f] = line.trim().split(/\s+/);
    assert.equal(sha(readFileSync(join(ROOT, f!)) as unknown as string), h, `${f} changed: re-pin KEY_SCRIPTS_SHA256`);
  }
  assert.deepEqual(keys[1]!.trim().split("\n").map((x) => x.trim().split(/\s+/)[1]).sort(), ["peaceai/bin/model-v1-fetch.sh", "peaceai/bin/with-deploy-key.sh"]);
});

// ---- mutants

const TAG = /\/\/ m167-guard:([a-z0-9-]+)\s*$/;
const FILESET = { mp: "modelpropose.ts", ms: "modelscore.ts", loop: "loop.ts" } as const;
type Key = keyof typeof FILESET;
const sources = Object.fromEntries(Object.entries(FILESET).map(([k, f]) => [k, readFileSync(join(libDir, f), "utf8")])) as Record<Key, string>;
const guards = (Object.keys(FILESET) as Key[]).flatMap((k) => sources[k].split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, file: k, line: i }] : []; }));
// [id, file, from, to]: each `from` must occur exactly once
const SEMANTIC: [string, Key, string, string][] = [
  ["failing-names-passed", "mp", "inner.prepare(search, { request: input.request, failing: [] });", "inner.prepare(search, input);"],
  ["no-reorder", "mp", "repairProposer({ name: MODEL_PROPOSER, order: (q) => applyRanking(ranking!, task.taskKey, q) })", "repairProposer({ name: MODEL_PROPOSER })"],
  ["binding-without-manifest", "mp", "return sha256(`${RANKING_SCHEMA}\\n${modelManifestSha256}\\n${taskKey}", "return sha256(`${RANKING_SCHEMA}\\n${taskKey}"],
  ["ties-reversed", "ms", "sort((a, b) => b.m - a.m || a.i - b.i)", "sort((a, b) => b.m - a.m || b.i - a.i)"],
  ["manifest-unordered", "ms", "return LM_FILES.map((f) => `${shas[f]}  ${f}\\n`).join(\"\");", "return [...LM_FILES].reverse().map((f) => `${shas[f]}  ${f}\\n`).join(\"\");"],
  ["offline-any", "ms", "every(([name, addrs]) => name === \"lo\" || !addrs || addrs.length === 0)", "every(() => true)"],
];

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m167-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string, files: Partial<Record<string, string>>): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(files[f] ?? join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
}

async function killed(name: string, texts: Record<Key, string>): Promise<{ failed: string[]; crashed: string[] }> {
  const paths = Object.fromEntries((Object.keys(FILESET) as Key[]).map((k) => [FILESET[k], join(dir, `mutant-${name}-${FILESET[k]}`)]));
  for (const k of Object.keys(FILESET) as Key[]) writeFileSync(paths[FILESET[k]]!, rewrite(texts[k], paths));
  const mp = await import(pathToFileURL(paths["modelpropose.ts"]!).href) as typeof MP;
  const ms = await import(pathToFileURL(paths["modelscore.ts"]!).href) as typeof MS;
  const loop = await import(pathToFileURL(paths["loop.ts"]!).href) as typeof Loop;
  const failed: string[] = [], crashed: string[] = [];
  for (const c of CASES) {
    try { c.run({ mp, ms, loop }); } catch (e) { (e instanceof assert.AssertionError ? failed : crashed).push(`${c.id}: ${String(e).slice(0, 200)}`); }
  }
  return { failed, crashed };
}

test("M167 mutation: the guard list is exact", () => {
  assert.deepEqual(guards.map((g) => `${g.file}:${g.id}`).sort(), [
    "loop:sha-model",
    "mp:apply-binding", "mp:apply-cands", "mp:apply-entry", "mp:apply-permutation", "mp:pin-public", "mp:pin-version", "mp:prepare-entry", "mp:prepare-no-ranking",
    "mp:rank-entry-key", "mp:rank-entry-order", "mp:rank-manifest", "mp:rank-schema", "mp:rank-sha", "mp:rank-size", "mp:rank-task-file", "mp:rank-weights", "mp:run-max", "mp:run-task-file",
    "ms:cands-commit", "ms:job-actions", "ms:job-candidate", "ms:job-dispatch", "ms:job-id", "ms:job-main", "ms:job-repo", "ms:job-workflow", "ms:score-failed", "ms:score-ids",
  ]);
});

test("M167 mutation: the unmutated sources pass every case (control)", async () => {
  assert.deepEqual(await killed("control", sources), { failed: [], crashed: [] });
});

for (const g of guards) {
  test(`M167 mutation: deleting ${g.file}:${g.id} fails a case`, async () => {
    const lines = sources[g.file].split("\n");
    lines.splice(g.line, 1);
    const r = await killed(`guard-${g.file}-${g.id}`, { ...sources, [g.file]: lines.join("\n") });
    assert.ok(r.failed.length > 0, `guard ${g.id} survived (crashed: ${r.crashed.join("; ")})`);
  });
}

for (const [id, file, from, to] of SEMANTIC) {
  test(`M167 mutation: semantic mutant ${id} fails a case`, async () => {
    assert.equal(sources[file].split(from).length, 2, `${id}: anchor must occur exactly once`);
    const r = await killed(`sem-${id}`, { ...sources, [file]: sources[file].replace(from, to) });
    assert.ok(r.failed.length > 0, `semantic mutant ${id} survived (crashed: ${r.crashed.join("; ")})`);
  });
}
