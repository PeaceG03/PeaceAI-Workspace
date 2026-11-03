// M180 (limit-breaker chain 2, data only): the lb-corpus v2 builder (peaceai/lib/lbcorpus2.ts, peaceai/bin/lb-corpus2.ts,
// spec peaceai/spec/lb-corpus2-v1.md). The source rule and its near misses; attribution (every commit of a path is a
// passed squash merge); the per-file held-out slice; the append pass's cross-dedup against the chain-1 corpus; the
// non-overlap check (exact, normalised and near, each with a near miss just below the bar); the fingerprint; the CLI
// (deterministic, every refusal fail-closed, on a synthetic git repo); a mutation check over every c2-guard in the
// lib and the bin; the committed pins (peaceai/model/lb-corpus2*.json*) agree with the sources and the code; and the
// dev-task rule (Auditor #673 B1): no new train doc names, diagnoses or encodes the fix of a public dev task, checked on
// the committed data with matchers derived from peaceai/plan/tasks-public-v1.json and its reference-fix hashes, and an
// injected dev-task doc makes that check fail.
// Synthetic names only; no network; nothing here trains or reads any held-out or hidden data.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import * as real from "../lib/lbcorpus2.ts";
import * as L from "../lib/lbclean.ts";
import { parseExclusions } from "../lib/nlpairs.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const H = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const tsx = join(repo, "node_modules", ".bin", "tsx");
const CFG = JSON.parse(read("peaceai/model/lb-clean.json")) as L.LbConfig;
const SYN = "SynthOwner/Synth-Repo";
const EXTXT = `# public half\nunjs/defu\n# hidden half (hashes)\nsha256:${H(SYN.toLowerCase())}\n`;
const EX = parseExclusions(Buffer.from(EXTXT)) as Exclude<ReturnType<typeof parseExclusions>, { code: string }>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
type Mod = typeof real;

// fixture code: distinct identifiers per prefix
const block = (p: string, n = 40, from = 0) => Array.from({ length: n }, (_, i) => `export const ${p}V${i + from} = ${p}Compute${i + from}(${p}Alpha${i + from}, ${p}Beta${i + from}) + ${(i + from) * 7};`).join("\n") + "\n";
/** block(p) with its last k lines replaced (lowers shingle Jaccard against block(p) step by step) */
const edited = (p: string, k: number, n = 40) => block(p, n - k) + block(`${p}Q`, k, n - k);
const jac = (a: string, b: string) => { const x = new Set(L.shingles(L.tokens(a), CFG.dedup.shingleTokens)), y = new Set(L.shingles(L.tokens(b), CFG.dedup.shingleTokens)); let i = 0; for (const v of x) if (y.has(v)) i++; return i / (x.size + y.size - i); };
/** the smallest edit count k with Jaccard(block, edited k) < nearJaccard: k-1 is the nearest near-dup, k the near miss */
const NEAR_K = (() => { for (let k = 1; k < 40; k++) if (jac(block("nr"), edited("nr", k)) < CFG.dedup.nearJaccard) return k; throw new Error("no near miss"); })();
const inDoc = (i: number, text: string, split = "train", path = `src/f${i}.ts`): L.InDoc => ({ doc: i, text, man: { doc: i, split, repo: "PeaceG03/PeaceAI-Workspace", path } });
const HEX40 = "0123456789abcdef0123456789abcdef01234567";
const SRC = () => JSON.parse(read("peaceai/model/lb-corpus2.json"));
/** a pinned source blob, fail-closed: a shallow checkout (CI's actions/checkout, depth 1) lacks the blobs of files changed on
 * main after the sources tip, so a missing blob fetches the pinned tip commit from origin (depth 1) once and reads it again;
 * a failed fetch, a tip that is not a full sha, or a blob still absent FAILS the test (never a skip) */
let tipFetched = "";
const hasObj = (sha: string) => spawnSync("git", ["-C", repo, "cat-file", "-e", `${sha}^{blob}`], { stdio: "ignore" }).status === 0;
const pinnedBlob = (tip: string, path: string, blob: string): string => {
  assert.match(blob, /^[0-9a-f]{40}$/, `${path}: the pinned blob is not a full sha`);
  if (!hasObj(blob)) {
    assert.match(tip, /^[0-9a-f]{40}$/, `the sources tip is not a full sha: ${tip}`);
    if (tipFetched !== tip) {
      const r = spawnSync("git", ["-C", repo, "fetch", "--no-tags", "--depth=1", "origin", tip], { encoding: "utf8", timeout: 180_000 });
      assert.equal(r.status, 0, `${path}: pinned blob ${blob} is missing locally and fetching the sources tip ${tip} from origin failed (shallow checkout? network?): ${r.error ?? ""}${r.stderr ?? ""}`);
      tipFetched = tip;
    }
    assert.ok(hasObj(blob), `${path}: pinned blob ${blob} is still missing after fetching the sources tip ${tip}`);
    const atTip = spawnSync("git", ["-C", repo, "rev-parse", `${tip}:${path}`], { encoding: "utf8" });
    assert.equal(atTip.stdout.trim(), blob, `${path}: the sources tip ${tip} does not carry the pinned blob ${blob}`);
  }
  return execFileSync("git", ["-C", repo, "cat-file", "blob", blob], { encoding: "utf8", maxBuffer: 1 << 26 });
};

// synthetic dev task set (names unrelated to any real task) and its reference diff
const HEXA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", HEXB = "f0e1d2c3b4a5968778695a4b3c2d1e0f98765432";
const DEVSET = { schema: "peaceai-plan-tasks:v1", set: "synthetic", tasks: [{ id: "synthkit-drain-cap", repo: "SynthOrg/SynthKit", commit: HEXA,
  request: "Calling `drainQueue(items, ceiling, onDone)` must stop at the `ceiling`, and `x.y` is short.", reference: { from: { pr: 7, merge: HEXB } } }] };
const RUN1 = "while (pending.length > ceiling) { if (pending[head] === nil) break; pending.shift(); }";
const RUN1_RENAMED = "while (jobs.size > cap) { if (jobs[top] === none) break; jobs.pop(); }";
const RUN2 = "alphaOne.betaTwo(gammaThree, deltaFour).epsilonFive(zetaSix)";
const RUN2_RENAMED = "oneA.twoB(threeC, fourD).fiveE(sixF)";
const DEVDIFF = `diff --git a/src/q.ts b/src/q.ts\n--- a/src/q.ts\n+++ b/src/q.ts\n@@ -1,3 +1,5 @@\n const keep = 1\n+${RUN1}\n context()\n+${RUN2}\n`;
const devFix = (m: Mod, base: string[] = []) => m.devFixOf(DEVSET as any, new Map([["synthkit-drain-cap", DEVDIFF]]), base);

/** The rule case table. Returns the names of failing cases (empty = all pass). Used on the real module and on mutants. */
function runCases(m: Mod): string[] {
  const fails: string[] = [];
  const ok = (name: string, cond: () => boolean) => { try { if (!cond()) fails.push(name); } catch { fails.push(name); } };
  const sp = (p: string, t = "export const a = 1;\n") => m.sourceProblem(p, t);
  // source rule: admitted controls and near misses
  ok("src-ok", () => ["peaceai/spec/loop-v1.md", "peaceai/test/m1-a.test.ts", "peaceai/lib/x.mts", "a.cts", "a.js", "a.mjs", "a.cjs", "tool.py", "run.sh", "A.TS"].every((p) => sp(p) === null));
  ok("src-ext", () => ["a.json", "a.yml", "a.txt", "a.ts.bak", "Makefile", "a.tsx"].every((p) => sp(p) === "src_not_code_or_text"));
  ok("src-junk", () => sp("dist/a.js") === "src_junk_path" && sp("x/vendor/a.ts") === "src_junk_path" && sp("a.min.js") === "src_junk_path");
  ok("src-junk-near-miss", () => sp("distro/a.js") === null && sp("x/vendored.ts") === null);
  ok("src-fixture", () => sp("fixtures/a.ts") === "src_fixture" && sp("peaceai/test/fixture/a.ts") === "src_fixture" && sp("peaceai/test/fixtures/x/a.md") === "src_fixture");
  ok("src-fixture-near-miss", () => sp("peaceai/test/m171-fixtures.ts") === null && sp("peaceai/test/myfixtures/a.ts") === null);
  ok("src-workflow", () => sp(".github/scripts/a.ts") === "src_workflow" && sp(".github/a.md") === "src_workflow");
  ok("src-workflow-near-miss", () => sp("docs/.github/a.md") === null && sp("github/a.md") === null);
  for (const [name, p] of [["hidden", "lib/hidden.ts"], ["heldout", "model/heldout.py"], ["held-out", "spec/Held-Out-v1.md"], ["results", "results-repo/a.ts"], ["taskset", "lib/taskset.ts"],
    ["tasks-", "plan/tasks-public-v1.md"], ["exclusion", "model/exclusions.md"], ["drop-hash", "bin/drop-hashes.sh"], ["nl-pairs", "spec/nl-pairs-v1.md"], ["verdict", "bin/parse-verdict.ts"]] as const)
    ok(`src-eval-${name}`, () => sp(p) === "src_eval_adjacent");
  ok("src-eval-near-miss", () => ["lib/tasks.ts", "lib/held.ts", "lib/result.ts", "lib/task-set.ts", "spec/hide-v1.md", "lib/dropped.ts", "lib/pairs.ts"].every((p) => sp(p) === null));
  ok("src-hex", () => sp("a.ts", `const h = "${HEX40}";\n`) === "src_hash_literal" && sp("a.ts", `x ${HEX40.toUpperCase()} y`) === "src_hash_literal" && sp("a.ts", `(${HEX40}${"a".repeat(24)})`) === "src_hash_literal");
  ok("src-hex-near-miss", () => sp("a.ts", `const h = "${HEX40.slice(1)}";\n`) === null && sp("a.ts", `x${HEX40}${"a".repeat(25)}x`) === null && sp("a.ts", `g${HEX40}`) === "src_hash_literal" && sp("a.ts", `z${HEX40.slice(1)}z`) === null && sp("a.ts", `9${HEX40.slice(1)}z`) === "src_hash_literal");
  ok("src-utf8", () => sp("a.ts", "a \uFFFD b") === "src_not_utf8_text" && sp("a.ts", "a \u0000 b") === "src_not_utf8_text");
  // attribution
  ok("attr", () => m.attributable(["a", "b"], new Set(["a", "b", "c"])) && !m.attributable([], new Set(["a"])) && !m.attributable(["a", "x"], new Set(["a", "b"])));
  // sources file validation
  ok("sources-committed", () => m.sourcesProblems(SRC().sources).length === 0);
  ok("sources-passed-dup", () => { const s = SRC().sources; s.passed.push({ ...s.passed[0], pr: 99999 }); return m.sourcesProblems(s).includes("sources_passed"); });
  ok("sources-files-order", () => { const s = SRC().sources; s.files.reverse(); return m.sourcesProblems(s).includes("sources_files"); });
  ok("sources-files-unknown-pr", () => { const s = SRC().sources; s.files[0].prs = [1]; return m.sourcesProblems(s).includes("sources_files"); });
  // held-out slice: per file, deterministic, the boundary is strict
  ok("slice", () => {
    const u = parseInt(L.sha256("salt\nslice\npeaceai/x.ts").slice(0, 8), 16) / 0x100000000;
    if (m.sliceOf("peaceai/x.ts", "salt", u) !== "train" || m.sliceOf("peaceai/x.ts", "salt", u + 1e-9) !== real.HELDOUT2) return false;
    const n = Array.from({ length: 2000 }, (_, i) => m.sliceOf(`p/${i}.ts`, "salt", 0.15)).filter((s) => s === real.HELDOUT2).length;
    return n > 220 && n < 380 && m.sliceOf("p/1.ts", "salt", 0.15) === m.sliceOf("p/1.ts", "salt", 0.15);
  });
  // append pass: cross-dedup against the base, followers dropped with their piece, labels and ids
  const fimCfg = clone(CFG); fimCfg.fim.rate = 1;
  const base = [{ text: block("bt"), split: "train" }, { text: block("bh"), split: "heldout" }];
  const app = (input: L.InDoc[], c = fimCfg) => m.appendCorpus(base, input, c, EX, null);
  ok("append-cross-exact", () => { const r = app([inDoc(0, block("bh").replace(/ \+ /g, "  +  "))]); return r.report.cross.cross_exact_dup === 1 && r.out.length === 0 && r.report.cross.cross_followers >= 1; });
  ok("append-cross-near", () => { const r = app([inDoc(0, edited("bt", NEAR_K - 1))]); return r.report.cross.cross_near_dup === 1 && r.report.cross.cross_exact_dup === 0 && r.out.length === 0; });
  ok("append-cross-near-miss", () => { const r = app([inDoc(0, edited("bt", NEAR_K))]); return r.report.cross.cross_near_dup === 0 && r.out.some((o) => o.text === edited("bt", NEAR_K)); });
  ok("append-labels", () => {
    const r = app([inDoc(0, block("nA"), "train"), inDoc(1, block("nB"), real.HELDOUT2)]);
    const a = r.out.filter((o) => o.text === block("nA")), b = r.out.filter((o) => o.text === block("nB"));
    return a.length === 1 && a[0]!.man.split === "train" && b.length === 1 && b[0]!.man.split === real.HELDOUT2 && r.out.some((o) => "fimOf" in o.man && o.man.split === "train")
      && !r.out.some((o) => "fimOf" in o.man && o.man.split !== "train") && r.out.every((o, i) => o.man.doc === base.length + i && o.man.textSha256 === L.sha256(o.text))
      && r.report.newHeldoutV2 === 1 && r.report.docsOut === base.length + r.out.length;
  });
  ok("append-input-split", () => { try { app([inDoc(0, block("nC"), "heldout")]); return false; } catch (e) { return (e as Error).message === "input_split"; } });
  // non-overlap: [0, 2) base (train, heldout); then new docs
  const ov = (extra: { text: string; split: string }[], baseExtra: { text: string; split: string }[] = []) => m.overlapProblems([...base, ...baseExtra, ...extra], base.length + baseExtra.length, CFG.dedup);
  const only = (r: Record<string, number>, k: string | null) => Object.entries(r).every(([kk, v]) => v === (kk === k ? 1 : 0));
  ok("ov-clean", () => only(ov([{ text: block("x1"), split: "train" }, { text: block("x2"), split: real.HELDOUT2 }]), null));
  ok("ov-old-exact", () => only(ov([{ text: block("bh"), split: "train" }]), "new_train_vs_old_heldout_exact"));
  ok("ov-old-norm", () => only(ov([{ text: block("bh").replace(/\n/g, "\n\n  "), split: "train" }]), "new_train_vs_old_heldout_norm"));
  ok("ov-old-near", () => only(ov([{ text: edited("bh", NEAR_K - 1), split: "train" }]), "new_train_vs_old_heldout_near"));
  ok("ov-old-near-miss", () => only(ov([{ text: edited("bh", NEAR_K), split: "train" }]), null));
  ok("ov-v2-exact", () => only(ov([{ text: block("x3"), split: "train" }, { text: block("x3"), split: real.HELDOUT2 }]), "new_train_vs_heldout_v2_exact"));
  ok("ov-v2-near", () => only(ov([{ text: edited("x4", NEAR_K - 1), split: "train" }, { text: block("x4"), split: real.HELDOUT2 }]), "new_train_vs_heldout_v2_near"));
  ok("ov-v2-near-miss", () => only(ov([{ text: edited("x4", NEAR_K), split: "train" }, { text: block("x4"), split: real.HELDOUT2 }]), null));
  ok("ov-base-v2", () => only(ov([{ text: block("bt"), split: real.HELDOUT2 }]), "base_train_vs_heldout_v2_exact"));
  ok("ov-not-train", () => only(ov([{ text: block("bh"), split: real.HELDOUT2 }], [{ text: block("bh"), split: "heldout" }]), null));
  // dev-task rule (Auditor #673 B1): matchers from the set and its reference diff, each with a near miss
  const dset = () => m.devSetOf(DEVSET, devFix(m));
  const hits = (t: string) => m.devTaskHits(t, dset());
  const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
  ok("dev-name", () => same(hits("we use synthkit here"), ["dev_name"]) && same(hits("see SynthOrg/SynthKit"), ["dev_name"]) && same(hits("task synthkit-drain-cap ran"), ["dev_name"]) && same(hits("SYNTHKIT."), ["dev_name"]));
  ok("dev-name-near-miss", () => same(hits("synthkitchen and mysynthkit and synthkit_x"), []));
  ok("dev-span", () => same(hits("call drainQueue( items,ceiling , onDone ) now"), ["dev_span"]));
  ok("dev-span-near-miss", () => same(hits("call drainQueue(items, ceiling, onDoneX)"), []) && same(hits("xdrainQueue(items, ceiling, onDone)"), []) && same(hits("ceiling x.y"), []));
  ok("dev-sha", () => same(hits(`at ${HEXB.slice(0, 7)} and`), ["dev_sha"]) && same(hits(`(${HEXA.toUpperCase()})`), ["dev_sha"]));
  ok("dev-sha-near-miss", () => same(hits(`at ${HEXB.slice(0, 6)} and ${HEXB.slice(1, 9)} and ${HEXB.slice(0, 7)}0 z`), []));
  ok("dev-fix-exact", () => same(hits(`// note\n${RUN2}\n`), ["dev_fix"]) && same(hits(`x ${RUN1} y`), ["dev_fix"]));
  ok("dev-fix-exact-near-miss", () => { const t = L.tokens(RUN2); return t.length > real.DEVFIX_K && same(hits(t.slice(0, real.DEVFIX_K - 1).join(" ")), []) && same(hits(t.slice(-(real.DEVFIX_K - 1)).join(" ")), []) && same(hits(t.join(" ")), ["dev_fix"]); });
  ok("dev-fix-abst", () => same(hits(RUN1_RENAMED), ["dev_fix"]));
  ok("dev-fix-abst-near-miss", () => same(hits(RUN2_RENAMED), []));
  ok("dev-fix-runs-split", () => { const a = L.tokens(RUN1), b = L.tokens(RUN2); return same(hits([...a.slice(-5), ...b.slice(0, 5)].join(" ")), []); });
  ok("dev-fix-base-filter", () => { const f = devFix(m, [`unrelated ${RUN1} code`]), g = devFix(m); if (!(f.tasks[0]!.hashes.length < g.tasks[0]!.hashes.length)) return false;
    const d = m.devSetOf(DEVSET, f); return same(m.devTaskHits(RUN1, d), []) && same(m.devTaskHits(RUN2, d), ["dev_fix"]); });
  ok("dev-fix-diff-missing", () => { try { m.devFixOf(DEVSET as any, new Map(), []); return false; } catch (e) { return (e as Error).message === "devfix_diff_missing"; } });
  ok("dev-set-invalid", () => [{ ...DEVSET, schema: "x" }, { ...DEVSET, tasks: [] }, { ...DEVSET, tasks: [{ ...DEVSET.tasks[0], commit: "abc" }] }, { ...DEVSET, tasks: [DEVSET.tasks[0], DEVSET.tasks[0]] }]
    .every((st) => { try { m.devSetOf(st, devFix(m)); return false; } catch (e) { return (e as Error).message === "dev_set_invalid"; } }));
  ok("devfix-differs", () => { const f = devFix(m); return [{ ...f, schema: "x" }, { ...f, k: 9 }, { ...f, tasks: [{ ...f.tasks[0]!, merge: HEXA }] }, { ...f, tasks: [{ ...f.tasks[0]!, id: "other-task" }] }, { ...f, tasks: [{ ...f.tasks[0]!, hashes: [] }] }, { ...f, tasks: [] }]
    .every((x) => { try { m.devSetOf(DEVSET, x); return false; } catch (e) { return (e as Error).message === "devfix_differs"; } }); });
  ok("dev-train", () => m.devTrainHits([{ text: "uses synthkit", split: "train" }, { text: "plain", split: "train" }], dset()) === 1 && m.devTrainHits([{ text: "uses synthkit", split: real.HELDOUT2 }], dset()) === 0);
  ok("sources-dev-missing", () => { const s = SRC().sources; delete s.devTasks; return m.sourcesProblems(s).includes("sources_dev"); });
  const pins = (decisions: unknown[]) => ({ set: "s.json", setSha256: H("s"), fix: "f.json", fixSha256: H("f"), diffs: "how", decisions });
  const dd = (path: string, to = real.HELDOUT2 as string, hits = ["dev_name"], why = "w") => ({ path, to, hits, why }) as any;
  ok("dev-pins", () => m.devPinsProblems(pins([dd("a"), dd("b", "drop", ["dev_fix", "dev_name"])]), ["a", "b"]).length === 0);
  ok("dev-pins-bad", () => [[dd("x")], [dd("b"), dd("a")], [dd("a", "train")], [dd("a", "heldout")], [dd("a", real.HELDOUT2, [])], [dd("a", real.HELDOUT2, ["dev_other"])], [dd("a", real.HELDOUT2, ["dev_name"], "")]]
    .every((d) => same(m.devPinsProblems(pins(d), ["a", "b"]), ["dev_decisions"])) && same(m.devPinsProblems({ ...pins([]), setSha256: "x" }, []), ["dev_pins"]));
  ok("dev-decisions", () => { const h = new Map([["a", ["dev_name"]], ["b", []], ["c", ["dev_name", "dev_fix"]]]);
    return same(m.devDecisionProblems(h, [dd("a"), dd("c", "drop", ["dev_name", "dev_fix"])]), [])
      && same(m.devDecisionProblems(h, [dd("a")]), ["devtask_undecided:c"])
      && same(m.devDecisionProblems(h, [dd("a"), dd("c", "drop", ["dev_name"])]), ["devtask_decision_stale:c"])
      && same(m.devDecisionProblems(h, [dd("a"), dd("b"), dd("c", "drop", ["dev_name", "dev_fix"])]), ["devtask_decision_stale:b"])
      && same(m.devDecisionProblems(h, [dd("a"), dd("c", "drop", ["dev_name", "dev_fix"]), dd("z")]), ["devtask_decision_stale:z"]); });
  ok("added-runs", () => same(m.addedRuns(DEVDIFF), [RUN1, RUN2]));
  // fingerprint
  const parts = (): real.Fingerprint2Parts => ({ version: real.LB_CORPUS2_VERSION, codeSha256: { "a.ts": H("a") }, typescriptVersion: "5", configSha256: H("c"), exclusionsSha256: H("e"), sourcesSha256: H("s"),
    base: { docs: H("1"), manifest: H("2"), fingerprint: H("3") }, newInput: { docsSha256: H("4"), manifestSha256: H("5") }, refs: null, dropHashesSha256: [], out: { docs: H("6"), manifest: H("7") } });
  ok("fp", () => {
    const f = m.fingerprint2Of(parts()), g = parts(); g.out.docs = H("8"); const k = parts(); k.sourcesSha256 = H("9");
    const reordered = Object.fromEntries(Object.entries(parts()).reverse()) as unknown as real.Fingerprint2Parts;
    return /^[0-9a-f]{64}$/.test(f) && f === m.fingerprint2Of(parts()) && f === m.fingerprint2Of(reordered) && f !== m.fingerprint2Of(g) && f !== m.fingerprint2Of(k);
  });
  ok("fp-version", () => { try { m.fingerprint2Of({ ...parts(), version: "x" }); return false; } catch (e) { return (e as Error).message === "fingerprint_version"; } });
  ok("fp-sha", () => [{ ...parts(), configSha256: "x" }, { ...parts(), codeSha256: {} }].every((p) => { try { m.fingerprint2Of(p); return false; } catch (e) { return (e as Error).message === "fingerprint_sha"; } }));
  return fails;
}

test("m180: the source rule, slice, append pass, non-overlap and fingerprint cases pass (with near misses)", () => {
  assert.ok(NEAR_K >= 2, String(NEAR_K));
  assert.ok(jac(block("nr"), edited("nr", NEAR_K - 1)) >= CFG.dedup.nearJaccard && jac(block("nr"), edited("nr", NEAR_K)) > CFG.dedup.nearJaccard - 0.1, "near misses sit just below the bar");
  assert.deepEqual(runCases(real), []);
});

test("m180: a mutation check: removing or weakening any c2-guard in the lib fails a case", async () => {
  assert.deepEqual(runCases(real), [], "the real module passes every case, so a mutant fails on its own change");
  const src = read("peaceai/lib/lbcorpus2.ts");
  const lib = pathToFileURL(join(repo, "peaceai", "lib")).href;
  const fixed = src.replace(/from "\.\/([\w.-]+)"/g, (_, f) => `from "${lib}/${f}"`);
  const evalRe = "/hidden|held-?out|results|taskset|tasks-|exclusion|drop-hash|nl-pairs|verdict/i";
  const mutants: [string, string, string][] = [
    ["fixture dirs admitted", `{ code: "src_fixture", re: /(?:^|\\/)fixtures?\\// },`, ``],
    ["fixture rule unanchored", `/(?:^|\\/)fixtures?\\//`, `/fixtures?/`],
    ["workflows admitted", `{ code: "src_workflow", re: /^\\.github\\// },`, ``],
    ["workflow rule unanchored", `/^\\.github\\//`, `/github\\//`],
    ...["hidden", "held-?out", "results", "taskset", "tasks-", "exclusion", "drop-hash", "nl-pairs", "verdict"].map((a): [string, string, string] => [`eval-adjacent: ${a} admitted`, evalRe, evalRe.replace(new RegExp(`(?<=[/|])${a.replace(/[?-]/g, "\\$&")}(?=[|/])\\|?`), "").replace("|/", "/")]),
    ["eval-adjacent case-sensitive", evalRe, evalRe.slice(0, -1)],
    ["eval-adjacent too wide", evalRe, `/hidden|held|result|task|exclusion|drop|pairs|verdict/i`],
    ["any extension", `if (!SOURCE_EXT.test(path)) return "src_not_code_or_text";`, ``],
    ["junk paths admitted", `if (JUNK_PATH.some((r) => r.test(path))) return "src_junk_path";`, ``],
    ["deny list ignored", `for (const d of SOURCE_DENY) if (d.re.test(path)) return d.code;`, ``],
    ["hash literals admitted", `if (/(?<![0-9a-f])[0-9a-f]{40,64}(?![0-9a-f])/i.test(text)) return "src_hash_literal";`, ``],
    ["hash literal: 41+ only", `[0-9a-f]{40,64}(?!`, `[0-9a-f]{41,64}(?!`],
    ["hash literal: case-sensitive", `[0-9a-f]{40,64}(?![0-9a-f])/i.test(text)`, `[0-9a-f]{40,64}(?![0-9a-f])/.test(text)`],
    ["hash literal: any long hex run", `/(?<![0-9a-f])[0-9a-f]{40,64}(?![0-9a-f])/i`, `/[0-9a-f]{40,64}/i`],
    ["non-text admitted", `if (text.includes("\\uFFFD") || text.includes("\\u0000")) return "src_not_utf8_text";`, ``],
    ["no history admitted", `if (commits.length === 0) return false;`, ``],
    ["one passed commit enough", `return commits.every((c) => passed.has(c));`, `return commits.some((c) => passed.has(c));`],
    ["duplicate passed commits", ` || new Set(s.passed.map((x: any) => x.mergeCommit)).size !== s.passed.length`, ``],
    ["files unsorted", `(i === 0 || a[i - 1].path < f.path)`, `true`],
    ["files with unknown prs", `f.prs.every((n: unknown) => prs.has(n))`, `true`],
    ["slice boundary inclusive", `return u < rate ? HELDOUT2 : "train";`, `return u <= rate ? HELDOUT2 : "train";`],
    ["slice inverted", `return u < rate ? HELDOUT2 : "train";`, `return u < rate ? "train" : HELDOUT2;`],
    ["input split unchecked", `for (const d of input) if (d.man.split !== "train" && d.man.split !== HELDOUT2) throw new Error("input_split");`, ``],
    ["followers of a dropped piece kept", `if (!keepGroup) { cross.cross_followers++; continue; }`, ``],
    ["no cross exact dedup", `if (seen.has(normKey(o.text))) { cross.cross_exact_dup++; keepGroup = false; continue; }`, ``],
    ["no cross near dedup", `if (near.find(shingles(tokens(o.text), cfg.dedup.shingleTokens)) >= 0) { cross.cross_near_dup++; keepGroup = false; continue; }`, ``],
    ["slice not relabelled", `const split = o.man.split === "heldout" ? HELDOUT2 : o.man.split;`, `const split = o.man.split;`],
    ["overlap: no exact", `if (ex.has(sha256(t))) e++;`, `if (false) e++;`],
    ["overlap: no norm", `else if (nk.has(normKey(t))) n++;`, `else if (false) n++;`],
    ["overlap: no near", `else if (near.find(shingles(tokens(t), dedup.shingleTokens)) >= 0) m++;`, `else if (false) m++;`],
    ["sources without devTasks", `  if (devPinsProblems(s?.devTasks, Array.isArray(s?.files) ? s.files.map((f: any) => f?.path) : []).length) p.push("sources_dev");`, ``],
    ["fix shingles: no exact", `out.add(fixHash("exact", toks.slice(i, i + DEVFIX_K)));`, ``],
    ["fix shingles: no abstracted", `if (w.filter((x) => DEV_KEYWORDS.has(x)).length >= DEVFIX_MIN_KEYWORDS) out.add(fixHash("abst", w));`, ``],
    ["fix shingles: abstracted without keywords", `.length >= DEVFIX_MIN_KEYWORDS) out.add(`, `.length >= 0) out.add(`],
    ["added runs joined", `if (cur.length) runs.push(cur.join("\\n")); cur = [];`, ``],
    ["missing diff unchecked", `if (d === undefined) throw new Error("devfix_diff_missing");`, ``],
    ["no base filter", `for (const b of baseTexts) for (const x of fixShingles(tokens(b))) if (all.has(x)) common.add(x);`, ``],
    ["dev set unchecked", `if (devSetProblems(set).length) throw new Error("dev_set_invalid");`, ``],
    ["devfix file unchecked", `if (!ok) throw new Error("devfix_differs");`, ``],
    ["no dev names", `for (const n of [t.repo, t.repo.split("/")[1]!, t.id]) names.add(n.toLowerCase());`, ``],
    ["dev names: owner/repo only", `[t.repo, t.repo.split("/")[1]!, t.id]`, `[t.repo]`],
    ["dev names: case-sensitive", `names.add(n.toLowerCase());`, `names.add(n);`],
    ["no dev spans", `for (const m of t.request.matchAll(/\`([^\`]+)\`/g)) { const k = tokens(m[1]!); if (k.length >= DEV_SPAN_TOKENS) spans.add(k.join(" ")); }`, ``],
    ["dev spans: any length", `if (k.length >= DEV_SPAN_TOKENS) spans.add(`, `if (k.length >= 1) spans.add(`],
    ["no name hit", `if (d.names.some((n) => new RegExp(\`(?<![\\\\p{L}\\\\p{N}_])\${esc(n)}(?![\\\\p{L}\\\\p{N}_])\`, "u").test(low))) hits.push("dev_name");`, ``],
    ["name hit inside words", `new RegExp(\`(?<![\\\\p{L}\\\\p{N}_])\${esc(n)}(?![\\\\p{L}\\\\p{N}_])\`, "u")`, `new RegExp(esc(n), "u")`],
    ["no span hit", `if (d.spans.some((s) => joined.includes(\` \${s} \`))) hits.push("dev_span");`, ``],
    ["span hit inside tokens", `joined.includes(\` \${s} \`)`, `joined.includes(s)`],
    ["no sha hit", `if (hex.some((h) => d.shas.some((s) => s.startsWith(h)))) hits.push("dev_sha");`, ``],
    ["sha hit: 8+ only", `[0-9a-f]{7,40}(?!`, `[0-9a-f]{8,40}(?!`],
    ["sha hit: 6 enough", `[0-9a-f]{7,40}(?!`, `[0-9a-f]{6,40}(?!`],
    ["no fix hit", `for (const x of fixShingles(toks)) if (d.fix.has(x)) { hits.push("dev_fix"); break; }`, ``],
    ["decision for any path", `typeof d?.path === "string" && known.has(d.path) && (i === 0 || a[i - 1].path < d.path)`, `typeof d?.path === "string"`],
    ["decision to anything", `(DEV_DECISIONS as readonly string[]).includes(d.to) && Array.isArray(d.hits)`, `Array.isArray(d.hits)`],
    ["undecided hit admitted", `if (h.length && !d) p.push(\`devtask_undecided:\${path}\`);`, `if (false) p.push(\`devtask_undecided:\${path}\`);`],
    ["stale decision admitted", `else if (d && JSON.stringify(d.hits) !== JSON.stringify(h)) p.push(\`devtask_decision_stale:\${path}\`);`, ``],
    ["train hits count any split", `o.split === "train" && devTaskHits(o.text, d).length > 0`, `devTaskHits(o.text, d).length > 0`],
    ["train hits: two needed", `devTaskHits(o.text, d).length > 0).length;`, `devTaskHits(o.text, d).length > 1).length;`],
    ["fingerprint without version", `if (p.version !== LB_CORPUS2_VERSION) throw new Error("fingerprint_version");`, ``],
    ["fingerprint shas unchecked", `if (Object.keys(p.codeSha256).length === 0 || !all.every((h) => /^[0-9a-f]{64}$/.test(h))) throw new Error("fingerprint_sha");`, ``],
    ["fingerprint ignores its parts", `canon({ schema: FINGERPRINT2_SCHEMA, ...p })`, `canon({ schema: FINGERPRINT2_SCHEMA })`],
  ];
  const tagged = src.split("\n").filter((l) => /\/\/ c2-guard:[\w-]+/.test(l));
  assert.ok(tagged.length >= 24, String(tagged.length));
  for (const l of tagged) assert.ok(mutants.some(([, from]) => l.includes(from.trim())), `untested guard: ${/c2-guard:([\w-]+)/.exec(l)![1]}`);
  const dir = mkdtempSync(join(tmpdir(), "m180-mut-"));
  try {
    for (const [name, from, to] of mutants) {
      assert.ok(fixed.includes(from), `mutant site not found: ${name}`);
      const mutated = fixed.replace(from, to);
      assert.notEqual(mutated, fixed, `mutant is a no-op: ${name}`);
      const f = join(dir, `${H(name).slice(0, 12)}.ts`);
      writeFileSync(f, mutated);
      const mod = (await import(pathToFileURL(f).href)) as Mod;
      assert.ok(runCases(mod).length > 0, `mutant survived: ${name}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the CLI on a synthetic git repo
const G = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=m180", "-c", "user.email=m180", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const put = (root: string, files: Record<string, string>) => { for (const [p, t] of Object.entries(files)) { mkdirSync(join(root, p, ".."), { recursive: true }); writeFileSync(join(root, p), t); } };
const commit = (root: string, msg: string, files: Record<string, string>) => { put(root, files); G(root, "add", "-A"); G(root, "commit", "-q", "-m", msg); return G(root, "rev-parse", "HEAD"); };
const NOTES_A = Array.from({ length: 24 }, (_, i) => `Note ${i}: the synthkit run of item q${i}x ended with status s${i}y after step t${i}z.`).join("\n\n") + "\n";
const NOTES_B = "# fix notes for synthkit\n\n" + Array.from({ length: 12 }, (_, i) => `Item r${i}k: the patch used ${RUN2} in place u${i}v.`).join("\n\n") + "\n";
const PROSE = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} explains rule number ${i} of the synthetic spec with words w${i}a w${i}b w${i}c.`).join("\n\n") + "\n";
function fixture(dir: string) {
  const g = join(dir, "git"); mkdirSync(g); G(g, "init", "-q");
  commit(g, "init", { "README.txt": "synthetic\n" });
  const c1 = commit(g, "add alpha (#1)", { "src/alpha.ts": block("alpha"), "docs/beta.md": PROSE });
  const c2 = commit(g, "touch beta (#2)", { "docs/beta.md": PROSE + "One more line for beta.\n", "src/gamma.ts": block("gamma") });
  commit(g, "unattributed edit", { "src/gamma.ts": block("gamma") + "export const extra = 1;\n", "src/delta.ts": block("delta") });
  const c4 = commit(g, "more (#3)", { "src/fixtures/f.ts": block("fx"), "src/hash.ts": `export const h = "${HEX40}";\n` + block("hh"), "src/eps.ts": block("eps"), "src/zeta.json": "{}\n",
    "src/notes-a.md": NOTES_A, "src/notes-b.md": NOTES_B });
  G(g, "checkout", "-q", "-b", "side", c1); const side = commit(g, "side (#5)", { "src/side.ts": block("side") });
  G(g, "checkout", "-q", "-b", "mrg", c4); G(g, "merge", "-q", "--no-ff", "-m", "merge side (#4)", "side"); const merge = G(g, "rev-parse", "HEAD");
  G(g, "checkout", "-q", "main");
  // base corpus: train + heldout; the heldout doc is src/alpha.ts's text (the cross-dedup case)
  const b = join(dir, "base"); mkdirSync(b);
  writeFileSync(join(b, "docs.jsonl"), [block("bt"), block("alpha")].map((t, i) => JSON.stringify({ doc: i, text: t }) + "\n").join(""));
  writeFileSync(join(b, "manifest.jsonl"), ["train", "heldout"].map((s, i) => JSON.stringify({ doc: i, split: s, repo: "o/r", path: `p${i}.ts` }) + "\n").join(""));
  writeFileSync(join(b, "fingerprint.json"), JSON.stringify({ fingerprint: H("base-fp") }) + "\n");
  const r = join(dir, "refs"); mkdirSync(r);
  writeFileSync(join(r, "docs.jsonl"), JSON.stringify({ doc: 0, text: block("refq") }) + "\n");
  writeFileSync(join(r, "manifest.jsonl"), JSON.stringify({ doc: 0, split: "train", repo: "unjs/defu", path: "a.ts" }) + "\n");
  writeFileSync(join(dir, "ex.txt"), EXTXT);
  // a salt that puts src/alpha.ts on train and src/eps.ts in the slice
  // ... and both dev-task hit files on train by the slice (so only their decisions move or drop them)
  let salt = ""; for (let i = 0; i < 5000 && !salt; i++) if (real.sliceOf("src/alpha.ts", `s${i}`, 0.4) === "train" && real.sliceOf("src/eps.ts", `s${i}`, 0.4) === real.HELDOUT2
    && real.sliceOf("docs/beta.md", `s${i}`, 0.4) === "train" && real.sliceOf("src/notes-a.md", `s${i}`, 0.4) === "train" && real.sliceOf("src/notes-b.md", `s${i}`, 0.4) === "train") salt = `s${i}`;
  const devSet = join(dir, "devset.json"), devFixF = join(dir, "devfix.json");
  writeFileSync(devSet, JSON.stringify(DEVSET)); writeFileSync(devFixF, JSON.stringify(devFix(real)));
  const blob = (p: string) => G(g, "rev-parse", `${c4}:${p}`);
  const sources = {
    schema: real.SOURCES_SCHEMA, repo: "PeaceG03/PeaceAI-Workspace", tip: c4, license: "owner:PeaceG03", rule: "synthetic",
    passed: [{ pr: 1, mergeCommit: c1, passedHead: c1, evidence: "synthetic" }, { pr: 2, mergeCommit: c2, passedHead: c2, evidence: "synthetic" }, { pr: 3, mergeCommit: c4, passedHead: c4, evidence: "synthetic" }],
    base: { docs: H(readFileSync(join(b, "docs.jsonl"))), manifest: H(readFileSync(join(b, "manifest.jsonl"))), fingerprint: H("base-fp"), builtAt: c1 },
    slice: { salt, rate: 0.4 },
    files: [{ path: "docs/beta.md", blob: blob("docs/beta.md"), prs: [1, 2] }, { path: "src/alpha.ts", blob: blob("src/alpha.ts"), prs: [1] }, { path: "src/eps.ts", blob: blob("src/eps.ts"), prs: [3] },
      { path: "src/notes-a.md", blob: blob("src/notes-a.md"), prs: [3] }, { path: "src/notes-b.md", blob: blob("src/notes-b.md"), prs: [3] }],
    devTasks: { set: "synthetic-set.json", setSha256: H(readFileSync(devSet)), fix: "synthetic-fix.json", fixSha256: H(readFileSync(devFixF)), diffs: "synthetic",
      decisions: [{ path: "src/notes-a.md", to: real.HELDOUT2, hits: ["dev_name"], why: "names only" }, { path: "src/notes-b.md", to: "drop", hits: ["dev_name", "dev_fix"], why: "carries the fix" }] },
  };
  const write = (name: string, s: unknown) => { const p = join(dir, name); writeFileSync(p, JSON.stringify({ sources: s })); return p; };
  return { g, b, r, ex: join(dir, "ex.txt"), sources, write, side, merge, c1, dev: ["--dev-set", devSet, "--dev-fix", devFixF] };
}
const runBin = (bin: string, ...a: string[]) => spawnSync(tsx, [bin, ...a], { cwd: repo, encoding: "utf8" });
const BIN = join(repo, "peaceai/bin/lb-corpus2.ts");

test("m180: the CLI lists by the rule, builds deterministically, dedups against the base, and refuses fail-closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "m180-cli-"));
  try {
    const F = fixture(dir);
    assert.ok(F.sources.slice.salt, "salt found");
    const sp = F.write("sources.json", F.sources);
    const lst = runBin(BIN, "--list", "--repo", F.g, "--sources", sp);
    assert.equal(lst.status, 0, lst.stdout + lst.stderr);
    assert.deepEqual(JSON.parse(lst.stdout), F.sources.files); // gamma (an unattributed edit), delta, fixtures, the hash literal, json and README are out
    const hl = runBin(BIN, "--dev-hits", "--repo", F.g, "--sources", sp, ...F.dev);
    assert.equal(hl.status, 0, hl.stdout + hl.stderr);
    assert.deepEqual(JSON.parse(hl.stdout), F.sources.devTasks.decisions.map((d) => ({ path: d.path, hits: d.hits })));
    const build = (out: string, s = sp, bin = BIN, base = F.b) => runBin(bin, "--repo", F.g, "--base", base, "--refs", F.r, "--exclusions", F.ex, "--out", join(dir, out), "--sources", s, ...F.dev);
    const a = build("o1"), b = build("o2");
    assert.equal(a.status, 0, a.stdout + a.stderr); assert.equal(a.stdout, b.stdout);
    for (const f of ["docs.jsonl", "manifest.jsonl", "new-manifest.jsonl", "report.json", "fingerprint.json", "check/docs.jsonl", "check/manifest.jsonl"]) assert.ok(readFileSync(join(dir, "o1", f)).equals(readFileSync(join(dir, "o2", f))), f);
    const rep = JSON.parse(readFileSync(join(dir, "o1", "report.json"), "utf8"));
    assert.equal(rep.cross.cross_exact_dup, 1); // src/alpha.ts equals the base's held-out doc: dropped
    assert.ok(rep.newHeldoutV2 >= 1 && rep.newTrain >= 1, JSON.stringify(rep));
    assert.ok(Object.values(rep.overlap).every((v) => v === 0));
    // dev-task decisions: notes-b dropped, notes-a moved to heldout_v2 (the slice put both on train)
    assert.deepEqual(rep.devTask, { hitFiles: 2, movedToHeldoutV2: 1, dropped: 1, newTrainHits: 0 });
    const nmRows = readFileSync(join(dir, "o1", "new-manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(!nmRows.some((r) => r.path === "src/notes-b.md"), "dropped file absent");
    assert.ok(nmRows.some((r) => r.path === "src/notes-a.md") && nmRows.filter((r) => r.path === "src/notes-a.md").every((r) => r.split === real.HELDOUT2), "moved file held out");
    // the base bytes are verbatim at the head of the output; ids continue; the check corpus is lb-clean's vocabulary
    const outDocs = readFileSync(join(dir, "o1", "docs.jsonl")), baseDocs = readFileSync(join(F.b, "docs.jsonl"));
    assert.ok(outDocs.subarray(0, baseDocs.length).equals(baseDocs));
    const man = readFileSync(join(dir, "o1", "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(man.every((m, i) => m.doc === i)); assert.ok(man.slice(2).every((m) => m.origin === "auditor-passed-pr" && m.commit === F.sources.tip && m.textSha256));
    assert.ok(readFileSync(join(dir, "o1", "manifest.jsonl")).equals(Buffer.concat([readFileSync(join(F.b, "manifest.jsonl")), readFileSync(join(dir, "o1", "new-manifest.jsonl"))])));
    const chk = readFileSync(join(dir, "o1", "check", "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(chk.every((m, i) => m.doc === i && (m.split === "train" || m.split === "heldout")) && chk.length === man.length - 2);
    assert.ok(!a.stdout.includes("alphaV") && !a.stdout.includes("Paragraph"), "no text printed");
    const fp = JSON.parse(readFileSync(join(dir, "o1", "fingerprint.json"), "utf8"));
    assert.equal(fp.fingerprint, real.fingerprint2Of(fp.parts)); assert.equal(fp.parts.out.docs, H(outDocs));
    const c = runBin(BIN, "--check", join(dir, "o1")); assert.equal(c.status, 0, c.stdout); assert.match(c.stdout, /^lb-corpus2 check docs=\d+ base=2 (\w+=0 ?){9}$/m);
    // refusals (each writes nothing)
    const refused = (code: string, r: ReturnType<typeof runBin>, out?: string) => { assert.equal(r.status, 1, `${code}: ${r.stdout}${r.stderr}`); assert.equal(r.stdout, `lb-corpus2 refused: ${code}\n`); if (out) assert.ok(!existsSync(join(dir, out)), `${code}: wrote output`); };
    for (const [code, s] of SCENARIOS(F)) refused(code, build(`r-${code}`, F.write(`s-${code}.json`, s)), `r-${code}`);
    const b2 = join(dir, "base2"); cpSync(F.b, b2, { recursive: true }); writeFileSync(join(b2, "fingerprint.json"), JSON.stringify({ fingerprint: H("other") }));
    refused("base_pins_differ", build("r-base", sp, BIN, b2), "r-base");
    writeFileSync(join(dir, "ex-public.txt"), "# public half\nunjs/defu\n");
    refused("exclusions_no_hidden_hashes", runBin(BIN, "--repo", F.g, "--base", F.b, "--refs", F.r, "--exclusions", join(dir, "ex-public.txt"), "--out", join(dir, "r-ex"), "--sources", sp, ...F.dev));
    refused("usage", runBin(BIN, "--repo", F.g, "--base", F.b, "--refs", F.r, "--exclusions", F.ex, "--out", join(dir, "r-u"), "--sources", sp, "stray", ...F.dev), "r-u");
    // a corpus with an overlap fails --check
    const o3 = join(dir, "o3"); cpSync(join(dir, "o1"), o3, { recursive: true });
    const d3 = readFileSync(join(o3, "docs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)), m3 = readFileSync(join(o3, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const t = m3.findIndex((m, i) => i >= 2 && m.split === "train"); d3[t].text = d3[1].text;
    writeFileSync(join(o3, "docs.jsonl"), d3.map((d) => JSON.stringify(d) + "\n").join(""));
    const c3 = runBin(BIN, "--check", o3); assert.equal(c3.status, 2); assert.match(c3.stdout, /new_train_vs_old_heldout_exact=1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** refusal scenarios: [code, sources] (each passed-PR check is hit before any file is read) */
function SCENARIOS(F: ReturnType<typeof fixture>): [string, unknown][] {
  const s = F.sources;
  return [
    ["passed_not_squash", { ...s, passed: [...s.passed, { pr: 4, mergeCommit: F.merge, passedHead: F.merge, evidence: "x" }] }],
    ["passed_subject_pr", { ...s, passed: s.passed.map((p) => (p.pr === 1 ? { ...p, pr: 9 } : p)), files: s.files.map((f) => ({ ...f, prs: f.prs.map((n) => (n === 1 ? 9 : n)) })) }],
    ["passed_not_on_tip", { ...s, passed: [...s.passed, { pr: 5, mergeCommit: F.side, passedHead: F.side, evidence: "x" }] }],
    ["sources_files_differ", { ...s, files: s.files.slice(1) }],
    ["devtask_set_differs", { ...s, devTasks: { ...s.devTasks, setSha256: H("other set") } }],
    ["devtask_fix_differs", { ...s, devTasks: { ...s.devTasks, fixSha256: H("other fix") } }],
    ["devtask_undecided", { ...s, devTasks: { ...s.devTasks, decisions: s.devTasks.decisions.slice(1) } }],
    ["devtask_decision_stale", { ...s, devTasks: { ...s.devTasks, decisions: s.devTasks.decisions.map((d, i) => (i === 0 ? { ...d, hits: ["dev_name", "dev_span"] } : d)) } }],
  ];
}

test("m180: a mutation check: removing any c2-guard in the bin lets its refusal case through", () => {
  const bin = read("peaceai/bin/lb-corpus2.ts");
  const libUrl = pathToFileURL(join(repo, "peaceai", "lib")).href;
  const reloc = (src: string, libFile = "") => src.replace(/"\.\.\/lib\/([\w.-]+)"/g, (_, f) => (f === "lbcorpus2.ts" && libFile ? `"${pathToFileURL(libFile).href}"` : `"${libUrl}/${f}"`)).replace(`new URL("../../", import.meta.url).pathname`, JSON.stringify(repo + "/"));
  const mutants: [string, string, string][] = [
    ["passed_not_squash", `if (parents[0] !== p.mergeCommit || parents.length !== 2) refuse("passed_not_squash");`, ``],
    ["passed_subject_pr", `if (!git("log", "-1", "--format=%s", p.mergeCommit).trim().endsWith(\`(#\${p.pr})\`)) refuse("passed_subject_pr");`, ``],
    ["passed_not_on_tip", `catch { refuse("passed_not_on_tip"); }`, `catch { void 0; }`],
    ["sources_files_differ", `if (JSON.stringify(files) !== JSON.stringify(S.files)) refuse("sources_files_differ");`, ``],
    ["base_pins_differ", `if (L.sha256(base.docsBuf) !== S.base.docs || L.sha256(base.manBuf) !== S.base.manifest || baseFp !== S.base.fingerprint) refuse("base_pins_differ");`, ``],
    ["overlap_found", `if (Object.values(ov).some((v) => v > 0)) refuse("overlap_found");`, ``],
    ["devtask_set_differs", `if (!devHits && L.sha256(dsBuf) !== S.devTasks.setSha256) refuse("devtask_set_differs");`, ``],
    ["devtask_fix_differs", `if (!devHits && L.sha256(dfBuf) !== S.devTasks.fixSha256) refuse("devtask_fix_differs");`, ``],
    ["devtask_undecided", `if (decP.length) refuse(decP[0]!.split(":")[0]!);`, ``],
    ["dev_drop", `const input = files.filter((f) => decided.get(f.path) !== "drop").map(`, `const input = files.map(`],
    ["dev_move", `const split = decided.get(f.path) === C.HELDOUT2 ? C.HELDOUT2 : C.sliceOf(f.path, S.slice.salt, S.slice.rate);`, `const split = C.sliceOf(f.path, S.slice.salt, S.slice.rate);`],
    ["devtask_in_train", `if (C.devTrainHits(res.out.map((o) => ({ text: o.text, split: o.man.split })), dev!) > 0) refuse("devtask_in_train");`, ``],
  ];
  const tagged = bin.split("\n").filter((l) => /\/\/ c2-guard:[\w-]+/.test(l));
  assert.equal(tagged.length, mutants.length);
  for (const l of tagged) assert.ok(mutants.some(([, from]) => l.includes(from.trim())), `untested guard: ${/c2-guard:([\w-]+)/.exec(l)![1]}`);
  const dir = mkdtempSync(join(tmpdir(), "m180-binmut-"));
  try {
    const F = fixture(dir);
    // a lib whose cross dedup is off lets src/alpha.ts (= the base's held-out doc) through as train: only the bin's overlap check stops it
    const libSrc = read("peaceai/lib/lbcorpus2.ts").replace(/from "\.\/([\w.-]+)"/g, (_, f) => `from "${libUrl}/${f}"`);
    const noCross = join(dir, "nocross.ts");
    writeFileSync(noCross, libSrc.replace(`if (seen.has(normKey(o.text))) { cross.cross_exact_dup++; keepGroup = false; continue; }`, ``).replace(`if (near.find(shingles(tokens(o.text), cfg.dedup.shingleTokens)) >= 0) { cross.cross_near_dup++; keepGroup = false; continue; }`, ``));
    // a lib that accepts any decision list lets an undecided hit file through as train: only the bin's post-condition stops it
    const noDec = join(dir, "nodec.ts");
    const decHead = `export function devDecisionProblems(hitsOf: ReadonlyMap<string, string[]>, decisions: readonly DevDecision[]): string[] {`;
    assert.ok(libSrc.includes(decHead)); writeFileSync(noDec, libSrc.replace(decHead, `${decHead} if (hitsOf) return [];`));
    const scen = new Map<string, unknown>([...SCENARIOS(F), ["devtask_in_train", { ...F.sources, devTasks: { ...F.sources.devTasks, decisions: [] } }]]);
    const b2 = join(dir, "base2"); cpSync(F.b, b2, { recursive: true }); writeFileSync(join(b2, "fingerprint.json"), JSON.stringify({ fingerprint: H("other") }));
    const attempt = (binFile: string, code: string) => {
      const s = F.write(`s-${code}.json`, scen.get(code) ?? F.sources);
      return runBin(binFile, "--repo", F.g, "--base", code === "base_pins_differ" ? b2 : F.b, "--refs", F.r, "--exclusions", F.ex, "--out", join(dir, `o-${code}-${H(binFile).slice(0, 6)}`), "--sources", s, ...F.dev).stdout;
    };
    for (const [code, from, to] of mutants) {
      const lib = code === "overlap_found" ? noCross : code === "devtask_in_train" ? noDec : "";
      const ctl = join(dir, `ctl-${code}.mts`), mut = join(dir, `mut-${code}.mts`);
      const fixed = reloc(bin, lib);
      assert.ok(fixed.includes(from), `mutant site not found: ${code}`);
      writeFileSync(ctl, fixed); writeFileSync(mut, fixed.replace(from, to));
      if (code === "dev_drop" || code === "dev_move") { // a decision ignored puts its hit file on train: the post-condition refuses
        assert.ok(!attempt(ctl, code).includes("refused"), `control: ${code}`);
        assert.equal(attempt(mut, code), "lb-corpus2 refused: devtask_in_train\n", `mutant survived: ${code}`);
        continue;
      }
      assert.equal(attempt(ctl, code), `lb-corpus2 refused: ${code}\n`, `control: ${code}`);
      assert.ok(!attempt(mut, code).includes(`refused: ${code}`), `mutant survived: ${code}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("m180: the committed v2 pins agree with the sources file, the code and each other; the slice is disjoint from train", () => {
  const C = SRC();
  assert.deepEqual(real.sourcesProblems(C.sources), []);
  const fp = JSON.parse(read("peaceai/model/lb-corpus2-fingerprint.json"));
  const p = fp.parts as real.Fingerprint2Parts;
  assert.equal(fp.schema, real.FINGERPRINT2_SCHEMA); assert.equal(fp.fingerprint, real.fingerprint2Of(p));
  assert.equal(p.sourcesSha256, H(JSON.stringify(C.sources)), "re-pin after a sources change");
  for (const [f, h] of Object.entries(p.codeSha256)) assert.equal(h, H(readFileSync(join(repo, f))), `re-pin after a change to ${f}`);
  assert.deepEqual(Object.keys(p.codeSha256).sort(), ["peaceai/bin/lb-corpus2.ts", "peaceai/lib/lbclean.ts", "peaceai/lib/lbcorpus2.ts", "peaceai/lib/nlpairs.ts", "peaceai/lib/tsresolve.ts"]);
  assert.equal(p.configSha256, H(readFileSync(join(repo, "peaceai/model/lb-clean.json"))));
  assert.equal(p.exclusionsSha256, H(readFileSync(join(repo, "peaceai/model/nl-pairs-exclusions-hidden-hashes.txt"))));
  assert.deepEqual(p.dropHashesSha256, [H(readFileSync(join(repo, "peaceai/model/lb-hidden-drop-hashes.txt")))]);
  assert.deepEqual(p.base, { docs: C.sources.base.docs, manifest: C.sources.base.manifest, fingerprint: C.sources.base.fingerprint });
  // chain-1 pins are the cleared dailyRun corpus
  const lbt = JSON.parse(read("peaceai/model/lb-train.json"));
  assert.ok(lbt.clearedCorpora.some((c: any) => c.docs === C.sources.base.docs && c.manifest === C.sources.base.manifest && c.fingerprint === C.sources.base.fingerprint), "base = a cleared chain-1 corpus");
  const B = C.build;
  assert.deepEqual({ docs: B.docsSha256, manifest: B.manifestSha256 }, p.out); assert.equal(B.fingerprint, fp.fingerprint);
  const nm = readFileSync(join(repo, "peaceai/model/lb-corpus2-new-manifest.jsonl"));
  assert.equal(H(nm), B.newManifestSha256);
  const rows = nm.toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, B.newDocs); assert.equal(B.docs, B.baseDocs + B.newDocs);
  assert.ok(rows.every((r, i) => r.doc === B.baseDocs + i && r.origin === "auditor-passed-pr" && r.commit === C.sources.tip && r.license === "owner:PeaceG03"));
  const files = new Map<string, number[]>(C.sources.files.map((f: any) => [f.path, f.prs]));
  assert.ok(rows.every((r) => files.has(r.path) && JSON.stringify(r.prs) === JSON.stringify(files.get(r.path))));
  const v2 = rows.filter((r) => r.split === real.HELDOUT2), tr = rows.filter((r) => r.split === "train");
  assert.equal(v2.length + tr.length, rows.length); assert.equal(v2.length, B.newHeldoutV2); assert.ok(v2.length > 0);
  const to = new Map<string, string>(C.sources.devTasks.decisions.map((d: any) => [d.path, d.to]));
  assert.ok(v2.every((r) => real.sliceOf(r.path, C.sources.slice.salt, C.sources.slice.rate) === real.HELDOUT2 || to.get(r.path) === real.HELDOUT2));
  assert.ok(tr.every((r) => real.sliceOf(r.path, C.sources.slice.salt, C.sources.slice.rate) === "train" && !to.has(r.path)), "a train row is on train by the slice and has no dev-task decision");
  assert.ok(!rows.some((r) => to.get(r.path) === "drop"), "no row of a dropped file");
  assert.equal(B.newFiles, C.sources.files.length - [...to.values()].filter((v) => v === "drop").length);
  const v2Paths = new Set(v2.map((r) => r.path)), v2Sha = new Set(v2.map((r) => r.textSha256));
  assert.ok(!tr.some((r) => v2Paths.has(r.path) || v2Sha.has(r.textSha256)), "no slice file or text on the train side");
  assert.ok(Object.values(B.overlap).length === 9 && Object.values(B.overlap).every((v) => v === 0));
  // lb-chain2 v1 (the chain-2 run PR, after Auditor's #673 PASS): v2 is cleared by one add-only clearedCorpora entry at
  // exactly the build pins, and chain 2 is enabled; the only workflow that reaches the v2 builder is peace-lb-chain2.yml,
  // through lb-chain2-corpus.sh in its secrets-free c2-corpus job (m181-lb-chain2.test.ts pins that job's shape).
  const v2Cleared = lbt.clearedCorpora.filter((c: any) => c.docs === B.docsSha256 || c.manifest === B.manifestSha256 || c.fingerprint === B.fingerprint);
  assert.deepEqual(v2Cleared.map((c: any) => [c.docs, c.manifest, c.fingerprint]), [[B.docsSha256, B.manifestSha256, B.fingerprint]], "one entry, exactly the build pins");
  assert.equal(C.chain2.enabled, true);
  assert.equal(C.chain2.warmStart.manifestSha256, "1e513e5080e23453d4ca5b33911567a8958f5873503fd6b869f0fb5dd3ea2cd6");
  const wfs = readdirSync(join(repo, ".github", "workflows"));
  assert.deepEqual(wfs.filter((w) => /lb-corpus2\.ts|lbcorpus2|lb-chain2-corpus\.sh/.test(read(join(".github", "workflows", w)))), ["peace-lb-chain2.yml"], "only the chain-2 workflow reaches the v2 builder");
  assert.ok(!/lb-corpus2\.ts|lbcorpus2/.test(read(".github/workflows/peace-lb-chain2.yml")), "and only through lb-chain2-corpus.sh");
});

test("m180: the committed new set: no train doc names, diagnoses or encodes the fix of a public dev task (Auditor #673 B1)", () => {
  const C = SRC(), D = C.sources.devTasks;
  assert.equal(D.set, "peaceai/plan/tasks-public-v1.json", "the public dev task set file is the authority");
  const setBuf = readFileSync(join(repo, D.set)), fixBuf = readFileSync(join(repo, D.fix));
  assert.equal(H(setBuf), D.setSha256, "re-pin after a dev set change"); assert.equal(H(fixBuf), D.fixSha256, "re-pin after a devfix change");
  const set = JSON.parse(setBuf.toString("utf8")), fix = JSON.parse(fixBuf.toString("utf8"));
  const dev = real.devSetOf(set, fix);
  // the matchers are data from the set and its reference fixes: every task contributes names, shas and fix hashes
  for (const [i, t] of set.tasks.entries()) {
    assert.ok(dev.names.includes(t.repo.toLowerCase()) && dev.names.includes(t.repo.split("/")[1].toLowerCase()) && dev.names.includes(t.id.toLowerCase()), t.id);
    assert.ok(dev.shas.includes(t.commit) && dev.shas.includes(t.reference.from.merge), t.id);
    assert.ok(fix.tasks[i].hashes.length > 0 && /^[0-9a-f]{64}$/.test(fix.tasks[i].diffSha256), t.id);
  }
  // the fix file names no repository: plan.ts trainingRepos() would read one under peaceai/model as a training source (m144)
  assert.ok(!/"(name|repo|repos)"\s*:/.test(fixBuf.toString("utf8")), "no name/repo key in the devfix file");
  // the texts of the admitted files at the sources tip (their blobs)
  const textOf = new Map<string, string>(C.sources.files.map((f: any) => {
    const t = pinnedBlob(C.sources.tip, f.path, f.blob);
    assert.equal(createHash("sha1").update(`blob ${Buffer.byteLength(t)}\0`).update(t).digest("hex"), f.blob, `${f.path}: blob ${f.blob} does not hash to its pin`);
    return [f.path, t];
  }));
  const hitsOf = new Map([...textOf].map(([p, t]) => [p, real.devTaskHits(t, dev)]));
  assert.deepEqual(real.devDecisionProblems(hitsOf, D.decisions), [], "every hit file has a decision with exactly its hits, and no other file has one");
  const decided = new Map<string, string>(D.decisions.map((d: any) => [d.path, d.to]));
  const rows = readFileSync(join(repo, "peaceai/model/lb-corpus2-new-manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  /** problems of a new-manifest row list against the dev-task rule (empty = ok) */
  const problems = (rs: { path: string; split: string }[], texts: ReadonlyMap<string, string>) => {
    const p: string[] = [];
    for (const r of rs) {
      const t = texts.get(r.path);
      if (t === undefined) { p.push(`unknown_path:${r.path}`); continue; }
      if (r.split === "train" && real.devTaskHits(t, dev).length > 0) p.push(`train_hit:${r.path}`);
      if (decided.get(r.path) === "drop") p.push(`dropped_present:${r.path}`);
      if (decided.get(r.path) === real.HELDOUT2 && r.split !== real.HELDOUT2) p.push(`moved_on_train:${r.path}`);
    }
    return p;
  };
  assert.deepEqual(problems(rows, textOf), []);
  assert.ok(rows.filter((r) => r.split === "train").length > 0);
  // mutation: injecting a dev-task doc into train makes the check fail
  const drop = D.decisions.find((d: any) => d.to === "drop"), moved = D.decisions.find((d: any) => d.to === real.HELDOUT2);
  assert.ok(drop && moved);
  assert.ok(problems([...rows, { ...rows[0], path: drop.path, split: "train" }], textOf).includes(`train_hit:${drop.path}`), "a dropped dev-task doc injected into train");
  const flipped = rows.map((r) => (r.path === moved.path ? { ...r, split: "train" } : r));
  assert.ok(problems(flipped, textOf).includes(`train_hit:${moved.path}`), "a moved dev-task doc put back on train");
  const span = set.tasks.flatMap((t: any) => [...t.request.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string)).find((x: string) => L.tokens(x).length >= real.DEV_SPAN_TOKENS);
  assert.ok(span);
  for (const [name, text] of [["name", `Notes on the ${set.tasks[0].repo.split("/")[1]} run.\n`], ["owner/repo", `see ${set.tasks[1].repo}\n`], ["task id", `task ${set.tasks[2].id}\n`],
    ["request span", `x = ${span};\n`], ["merge sha", `fixed in ${set.tasks[3].reference.from.merge.slice(0, 9)}\n`]] as const) {
    const texts = new Map(textOf).set("peaceai/spec/injected.md", text);
    assert.deepEqual(problems([...rows, { ...rows[0], path: "peaceai/spec/injected.md", split: "train" }], texts), ["train_hit:peaceai/spec/injected.md"], `injected ${name}`);
  }
  // the fix hashes match real fix text: every dev_fix decision's file hits dev_fix and nothing else in the set does
  const fixFiles = [...hitsOf].filter(([, h]) => h.includes("dev_fix")).map(([p]) => p);
  assert.ok(fixFiles.length > 0 && fixFiles.every((p) => decided.get(p) === "drop"), "a file carrying reference-fix text is dropped");
});
