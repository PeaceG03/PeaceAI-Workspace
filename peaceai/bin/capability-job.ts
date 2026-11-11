// Experimental. credit: false. Read-only Job A replay of the builder-log set.
//   tsx peaceai/bin/capability-job.ts --core-archive <file> [--as-of YYYY-MM-DD] [--out <dir>]
// The archive is extracted into a private temporary directory, checked against peaceai/core-pin.json, and built from that same directory. A caller-supplied checkout is not a source.
// Once the byte and tree checks pass, that directory is a git checkout of the pin tree so gate.ts can index it. The tree is unchanged.
// Each replay row is bound to this head, this tree, and the sha256 of the log.
// A missing core checkout leaves every runnable row unmeasured and does not invent a pass.
// --out must be outside this repo.
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { LOG_PATH, type Entry } from "../../builder-log/check.ts";
import { makeGitOnMainChecker, denverYmd } from "../../builder-log/coverage.ts";
import { parseLogEntries } from "../../builder-log/coverage.ts";
import { buildCapabilityReport, inputDigest, type ReplayBind } from "../lib/capabilityreport.ts";
import { CORE_ENTRY, adoptIssueBody, boundReplay, citedIssue, classifyJobOutput, commitRef, landingParent, replayIssueTitle, type CommitRef } from "../lib/capabilityjob.ts";
import { canonicalRequest, guessFamily, scoreFamilies, trainRequestModel, type FamilyRow } from "../lib/requestfamily.ts";

const ROW_MS = 45_000;

const USAGE = "usage: capability-job.ts --core-archive <file> [--as-of YYYY-MM-DD] [--out <dir>]";
const PIN_PATH = "peaceai/core-pin.json";

function flag(name: string, args: string[]): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) throw new Error(USAGE);
  return v;
}

function gitLine(cwd: string, args: string[]): string | null {
  try { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

/** Drop a caller's repo-locating git env so commands see `cwd`, matching indexGitTree. */
function gitLocalEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/.test(k)));
}

/** `git init` + `git add` on a pin-checked extract. Returns the index tree (`git write-tree`). */
function materializePinCheckout(root: string): string {
  const env = gitLocalEnv();
  execFileSync("git", ["init", "-q"], { cwd: root, env, stdio: "ignore" });
  execFileSync("git", ["add", "-A", "-f"], { cwd: root, env, stdio: "ignore" });
  return execFileSync("git", ["write-tree"], { cwd: root, env, encoding: "utf8" }).trim();
}

function insideRepo(root: string, target: string): boolean {
  const repo = realpathSync(resolve(root));
  let cur = resolve(target);
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = resolve(cur, "..");
    if (parent === cur) break;
    rest.push(cur.slice(parent.length + 1));
    cur = parent;
  }
  const base = realpathSync(cur);
  const full = rest.length ? resolve(base, ...rest.reverse()) : base;
  const rel = relative(repo, full);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith("..") && !isAbsolute(rel));
}

export function archiveSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export interface CorePin { schema: "peaceai-core-pin:v1"; commit: string; archiveSha256: string; tree: string }

export function readCorePin(text: string): CorePin | null {
  try {
    const p = JSON.parse(text) as CorePin;
    if (p.schema !== "peaceai-core-pin:v1") return null;
    if (!/^[0-9a-f]{40}$/.test(p.commit) || !/^[0-9a-f]{64}$/.test(p.archiveSha256) || !/^[0-9a-f]{40}$/.test(p.tree)) return null;
    return p;
  } catch { return null; }
}

/** Git tree sha of a directory, computed in a private copy so the source bytes stay put. */
export function gitTreeSha(root: string): string {
  const tmp = mkdtempSync(join(tmpdir(), "peaceai-tree-"));
  chmodSync(tmp, 0o700);
  try {
    execFileSync("cp", ["-a", `${root}/.`, tmp]);
    execFileSync("chmod", ["-R", "u+w", tmp]);
    rmSync(join(tmp, ".git"), { recursive: true, force: true });
    execFileSync("git", ["init", "-q"], { cwd: tmp, stdio: "ignore" });
    execFileSync("git", ["add", "-A", "-f"], { cwd: tmp, stdio: "ignore" });
    return execFileSync("git", ["write-tree"], { cwd: tmp, encoding: "utf8" }).trim();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function findCoreRoot(dir: string): string | null {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    if (existsSync(join(cur, CORE_ENTRY))) return cur;
    let names: { name: string; isDirectory: () => boolean }[] = [];
    try { names = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const name of names) if (name.isDirectory() && name.name !== ".git") stack.push(join(cur, name.name));
  }
  return null;
}

export interface PinnedExtract { dir: string; root: string; dispose: () => void }

/** Extract the archive into a fresh 0700 directory and accept it only when both the bytes and the tree match the pin. The accepted directory is a git checkout of that tree. */
export function extractPinnedCore(archivePath: string, pin: CorePin | null): PinnedExtract | { error: string } {
  if (!pin) return { error: "CORE_PIN_UNREADABLE" };
  if (!existsSync(archivePath)) return { error: `CORE_ARCHIVE_MISSING: ${archivePath}` };
  const digest = archiveSha256(archivePath);
  if (digest !== pin.archiveSha256) return { error: `CORE_ARCHIVE_MISMATCH: ${digest}` };
  const dir = mkdtempSync(join(tmpdir(), "peaceai-core-"));
  chmodSync(dir, 0o700);
  const dispose = () => rmSync(dir, { recursive: true, force: true });
  const extracted = spawnSync("tar", ["-xf", archivePath, "-C", dir], { encoding: "utf8" });
  if (extracted.status !== 0) { dispose(); return { error: "CORE_EXTRACT_FAILED" }; }
  const root = findCoreRoot(dir);
  if (!root) { dispose(); return { error: `CORE_ENTRY_MISSING: ${CORE_ENTRY}` }; }
  let tree = "";
  try { tree = gitTreeSha(root); } catch { dispose(); return { error: "CORE_TREE_UNREADABLE" }; }
  if (tree !== pin.tree) { dispose(); return { error: `CORE_TREE_MISMATCH: ${tree}` }; }
  let indexed = "";
  try { indexed = materializePinCheckout(root); } catch { dispose(); return { error: "CORE_CHECKOUT_FAILED" }; }
  if (indexed !== pin.tree) { dispose(); return { error: `CORE_TREE_MISMATCH: ${indexed}` }; }
  chmodSync(dir, 0o700);
  return { dir, root, dispose };
}

/** Re-read the tree of the directory about to be built. A change since the extract check refuses the build. */
export function coreStillPinned(root: string, pin: CorePin): string | null {
  let tree = "";
  try { tree = gitTreeSha(root); } catch { return "CORE_TREE_UNREADABLE"; }
  if (tree !== pin.tree) return `CORE_TREE_MISMATCH: ${tree}`;
  return null;
}

/** Extract, check, and build from that same directory. The caller discards `coreDir` when the job is done. `afterCheck` runs only in tests. */
export function pinnedKernel(archivePath: string, pin: CorePin | null, tooling: string, afterCheck?: (root: string) => void): { bundle: string; coreDir: string; dispose: () => void } | { error: string } {
  const opened = extractPinnedCore(archivePath, pin);
  if ("error" in opened) return opened;
  try {
    afterCheck?.(opened.root);
    const stale = coreStillPinned(opened.root, pin!);
    if (stale) { opened.dispose(); return { error: stale }; }
    const built = kernelBundle(opened.root, tooling);
    if ("error" in built) { opened.dispose(); return built; }
    return { bundle: built.bundle, coreDir: opened.root, dispose: opened.dispose };
  } catch (err) {
    opened.dispose();
    throw err;
  }
}

function kernelBundle(coreDir: string, tooling: string): { bundle: string } | { error: string } {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-kernel-"));
  const out = join(dir, "kernel.cjs");
  if (insideRepo(tooling, out)) return { error: "KERNEL_OUT_INSIDE_REPO" };
  const r = spawnSync("bash", [join(tooling, "peaceai/bin/build-kernel.sh"), coreDir, out], { encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) return { error: `KERNEL_BUILD_FAILED: exit ${r.status ?? "null"}` };
  return { bundle: out };
}

function mergeSha(pr: number): string | null {
  const r = spawnSync("gh", ["pr", "view", String(pr), "--repo", "PeaceG03/PeaceAI-Workspace", "--json", "mergeCommit"], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) return null;
  try {
    const oid = (JSON.parse(r.stdout) as { mergeCommit?: { oid?: string } }).mergeCommit?.oid;
    return oid && /^[0-9a-f]{40}$/.test(oid) ? oid : null;
  } catch { return null; }
}

/** A repo@sha already in the row, a recovered merge commit, or a permanent reason there is no commit. */
function targetOf(changed: string): CommitRef | { reason: string } {
  const ref = commitRef(changed);
  if (ref) return ref;
  const none = /^none \(([^)]*)\)$/.exec(changed.trim());
  if (none) return { reason: `UNMEASURABLE: ${none[1]}` };
  const prs = [...changed.matchAll(/PeaceAI-Workspace#(\d+)/g)].map((m) => Number(m[1]));
  if (prs.length !== 1) return { reason: prs.length === 0 ? "UNMEASURABLE: no repo sha and no pull request number" : `UNMEASURABLE: ${prs.length} pull request refs and no sha` };
  const sha = mergeSha(prs[0]!);
  if (!sha) return { reason: `UNMEASURABLE: PeaceAI-Workspace#${prs[0]} has no merge commit` };
  return { repo: "PeaceAI-Workspace", sha };
}

/** A pass is a candidate the production gate accepts. An append without fixSha is rejected there. */
function productionGate(tooling: string, dir: string, outDir: string, coreDir: string, targetName: string): { status: "pass" | "fail"; reason: string } | null {
  const summary = join(outDir, "summary.json");
  if (!existsSync(summary)) return null;
  let count = 0;
  try { count = ((JSON.parse(readFileSync(summary, "utf8")) as { candidates?: unknown[] }).candidates ?? []).length; } catch { return null; }
  if (count < 1) return null;
  const ran = spawnSync(join(tooling, "node_modules/.bin/tsx"), [join(tooling, "peaceai/bin/gate.ts")], {
    cwd: tooling, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, PEACEAI_OUT_DIR: outDir, PEACEAI_WORKSPACE_DIR: dir, PEACEAI_CORE_DIR: coreDir, PEACEAI_TARGET: targetName },
  });
  const out = `${ran.stdout ?? ""}\n${ran.stderr ?? ""}`;
  if (ran.status === 0 && /GATE PASS/.test(out)) return { status: "pass", reason: `GATE_PASS:${count}` };
  return { status: "fail", reason: "GATE_FAIL" };
}

function issueBody(n: number): string | null {
  const r = spawnSync("gh", ["issue", "view", String(n), "--repo", "PeaceG03/PeaceAI-Workspace", "--json", "body"], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) return null;
  try {
    const body = (JSON.parse(r.stdout) as { body?: unknown }).body;
    return typeof body === "string" ? body : null;
  } catch { return null; }
}

function runOne(tooling: string, bundle: string, ref: CommitRef, asked: string, seq: number, coreDir: string): { status: "pass" | "fail" | "unmeasured"; reason: string } {
  const src = ref.repo === "PeaceSTOCKS" ? (process.env.PEACESTOCKS_CLONE?.trim() || "") : tooling;
  if (!src || !existsSync(src)) return { status: "unmeasured", reason: `NO_CLONE: ${ref.repo}` };
  const rev = landingParent(ref.sha);
  if (!rev) return { status: "unmeasured", reason: `CHECKOUT_FAILED: ${ref.repo}@${ref.sha}` };
  const dir = join(tmpdir(), `peaceai-joba-${seq}-${ref.sha.slice(0, 8)}`);
  rmSync(dir, { recursive: true, force: true });
  const add = spawnSync("git", ["-C", src, "worktree", "add", "--detach", "--quiet", dir, rev], { encoding: "utf8", timeout: 60_000 });
  if (add.status !== 0) {
    spawnSync("git", ["-C", src, "worktree", "remove", "--force", dir], { stdio: "ignore" });
    rmSync(dir, { recursive: true, force: true });
    return { status: "unmeasured", reason: `CHECKOUT_FAILED: ${ref.repo}@${rev}` };
  }
  const outDir = mkdtempSync(join(tmpdir(), "peaceai-joba-out-"));
  try {
    const r = spawnSync(join(tooling, "node_modules/.bin/tsx"), [join(tooling, "peaceai/bin/generate.ts")], {
      cwd: tooling, encoding: "utf8", timeout: ROW_MS,
      env: { ...process.env, PEACEAI_KERNEL_BUNDLE: bundle, PEACEAI_OUT_DIR: outDir, PEACEAI_WORKSPACE_DIR: dir, PEACEAI_TARGET: `PeaceG03/${ref.repo}`, PEACEAI_TEST_EXISTING: "true", ISSUE_TITLE: replayIssueTitle(seq), ISSUE_BODY: asked.slice(0, 8000) },
    });
    let candidates: number | null = null;
    const summary = join(outDir, "summary.json");
    if (existsSync(summary)) {
      try { candidates = ((JSON.parse(readFileSync(summary, "utf8")) as { candidates?: unknown[] }).candidates ?? []).length; } catch { candidates = null; }
    }
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    const gated = productionGate(tooling, dir, outDir, coreDir, `PeaceG03/${ref.repo}`);
    if (gated) return gated;
    return classifyJobOutput({ timedOut, code: r.status, candidates, stdout: `${r.stdout ?? ""}\n${r.stderr ?? ""}` });
  } finally {
    spawnSync("git", ["-C", src, "worktree", "remove", "--force", dir], { stdio: "ignore" });
    rmSync(dir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) { console.log(USAGE); return; }
  const asOf = flag("--as-of", args) ?? denverYmd();
  const out = flag("--out", args);
  const coreArchive = flag("--core-archive", args);
  if (!coreArchive) { console.log(USAGE); process.exit(2); }
  const repo = resolve(import.meta.dirname, "../..");
  if (out && insideRepo(repo, resolve(out))) { console.log("refused WRITE_IN_TARGET"); process.exit(2); }
  const logText = readFileSync(resolve(repo, LOG_PATH), "utf8");
  const head = gitLine(repo, ["rev-parse", "HEAD"]);
  const tree = gitLine(repo, ["rev-parse", "HEAD^{tree}"]);
  if (!head || !tree) { console.log("refused NO_HEAD"); process.exit(2); }
  const pin = readCorePin(readFileSync(join(repo, PIN_PATH), "utf8"));
  const bind: ReplayBind = { head, tree, input: inputDigest(logText), coreCommit: pin?.commit, archiveSha256: pin?.archiveSha256 };
  const stocks = process.env.PEACESTOCKS_CLONE?.trim() || "";
  const cloneHead = stocks ? gitLine(stocks, ["rev-parse", "HEAD"]) : null;
  const onMain = stocks && cloneHead && /^[0-9a-f]{40}$/.test(cloneHead) ? makeGitOnMainChecker(stocks) : null;
  const built = pinnedKernel(resolve(coreArchive), pin, repo);
  const problem = "error" in built ? built.error : null;
  const coreCommit = problem || !pin ? null : pin.commit;
  const archiveSha = pin?.archiveSha256 ?? "";
  const buildError = problem ?? (built && "error" in built ? built.error : null);
  const bundle = built && "bundle" in built ? built.bundle : null;
  const entries = new Map(parseLogEntries(logText).map((e) => [e.seq, e as Entry]));
  const familyRows: FamilyRow[] = [...entries.values()].map((e) => ({ seq: e.seq, asked: e.asked, skill: e.skill }));
  const model = trainRequestModel(familyRows);
  const devScore = scoreFamilies(model, familyRows, false);
  const heldScore = scoreFamilies(model, familyRows, true);
  console.log(`family dev rows=${devScore.rows} correct=${devScore.correct} wrong=${devScore.wrong} refused=${devScore.refused} kept=${model.families.join(",")}`);
  console.log(`family heldout rows=${heldScore.rows} correct=${heldScore.correct} wrong=${heldScore.wrong} refused=${heldScore.refused}`);
  const preview = buildCapabilityReport(logText, asOf, onMain, [], null, bind, cloneHead);
  const replay = [];
  for (const r of preview.rows.filter((row) => row.inSet)) {
    const entry = entries.get(r.seq);
    const changed = entry?.changed ?? "";
    const asked = entry?.asked ?? "";
    const target = targetOf(changed);
    let rec;
    if ("reason" in target) rec = boundReplay(r.seq, "unmeasured", target.reason, bind);
    else {
      const g = guessFamily(model, asked);
      if (g.none) rec = boundReplay(r.seq, "fail", "NOT_CODE_FAMILY", bind);
      else if (!g.family) rec = boundReplay(r.seq, "fail", "CLASSIFIER_UNSURE", bind);
      else {
        const canon = canonicalRequest(g.family, asked);
        if (!canon) rec = boundReplay(r.seq, "fail", `NO_SLOTS: ${g.family}`, bind);
        else if (buildError || !bundle) rec = boundReplay(r.seq, "unmeasured", buildError ?? "KERNEL_MISSING", bind);
        else {
          const n = g.family === "TEST_CASE_EXISTING" ? citedIssue(asked) : null;
          const raw = n ? issueBody(n) : null;
          const adopted = raw ? adoptIssueBody(asked, raw, r.seq) : null;
          const ran = runOne(repo, bundle, target, adopted ?? canon, r.seq, "error" in built ? "" : built.coreDir);
          rec = boundReplay(r.seq, ran.status, ran.reason, bind);
        }
      }
    }
    console.log(`row ${r.seq} ${rec.status} ${rec.reason}`);
    replay.push(rec);
  }
  const report = buildCapabilityReport(logText, asOf, onMain, replay, null, bind, cloneHead);
  const counts = new Map<string, number>();
  for (const row of report.rows) if (row.inSet) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "replay.jsonl"), replay.map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(out, "capability-job.json"), JSON.stringify({ experimental: true, credit: false, coreProblem: buildError, coreCommit, archiveSha256: archiveSha || null, bind, reasons: ranked, report }, null, 2) + "\n");
  }
  console.log(`experimental credit=false asOf=${report.asOf} core=${buildError ?? `pinned ${coreCommit}`} archive=${archiveSha || "git"}`);
  console.log(`realPass=${report.realPass} passes=${report.passes} fails=${report.fails} unmeasured=${report.unmeasured} set=${report.setSize}`);
  console.log(`official ancestry=${report.official.ancestry} ${report.official.percent}% (${report.official.able}/${report.official.tasks}) cloneHead=${report.official.cloneHead ?? "none"}`);
  console.log(`bind head=${bind.head} tree=${bind.tree} input=${bind.input}`);
  for (const [reason, n] of ranked) console.log(`reason ${n} ${reason}`);
  if (!("error" in built)) built.dispose();
}

if (process.argv[1] && process.argv[1].endsWith("capability-job.ts")) main();
