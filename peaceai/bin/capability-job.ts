// Experimental. credit: false. Read-only Job A replay of the builder-log set.
//   tsx peaceai/bin/capability-job.ts --core <PeaceAI checkout> [--as-of YYYY-MM-DD] [--out <dir>]
// --core is a read-only checkout that contains packages/coding-kernel. It is not vendored.
// Each replay row is bound to this head, this tree, and the sha256 of the log.
// A missing core checkout leaves every runnable row unmeasured and does not invent a pass.
// --out must be outside this repo.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { LOG_PATH, type Entry } from "../../builder-log/check.ts";
import { makeGitOnMainChecker, denverYmd } from "../../builder-log/coverage.ts";
import { parseLogEntries } from "../../builder-log/coverage.ts";
import { buildCapabilityReport, inputDigest, type ReplayBind } from "../lib/capabilityreport.ts";
import { CORE_ENTRY, boundReplay, classifyJobOutput, commitRef, rowUnrunnable, type CommitRef } from "../lib/capabilityjob.ts";

const ROW_MS = 45_000;

const USAGE = "usage: capability-job.ts --core <dir> [--as-of YYYY-MM-DD] [--out <dir>]";

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

export function coreProblem(coreDir: string): string | null {
  if (!existsSync(coreDir)) return `CORE_MISSING: ${coreDir} does not exist`;
  const entry = join(coreDir, CORE_ENTRY);
  if (!existsSync(entry)) return `CORE_ENTRY_MISSING: ${entry} is not in the checkout`;
  const commit = gitLine(coreDir, ["rev-parse", "HEAD"]);
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) return `CORE_UNPINNED: ${coreDir} has no commit`;
  return null;
}

function kernelBundle(coreDir: string, commit: string, tooling: string): { bundle: string } | { error: string } {
  const out = join(tmpdir(), `peaceai-kernel-${commit}.cjs`);
  if (insideRepo(tooling, out)) return { error: "KERNEL_OUT_INSIDE_REPO" };
  if (!existsSync(out)) {
    const r = spawnSync("bash", [join(tooling, "peaceai/bin/build-kernel.sh"), coreDir, out], { encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) return { error: `KERNEL_BUILD_FAILED: exit ${r.status ?? "null"}` };
  }
  return { bundle: out };
}

function runOne(tooling: string, bundle: string, ref: CommitRef, asked: string, seq: number): { status: "pass" | "fail" | "unmeasured"; reason: string } {
  const src = ref.repo === "PeaceSTOCKS" ? (process.env.PEACESTOCKS_CLONE?.trim() || "") : tooling;
  if (!src || !existsSync(src)) return { status: "unmeasured", reason: `NO_CLONE: ${ref.repo}` };
  const dir = join(tmpdir(), `peaceai-joba-${seq}-${ref.sha.slice(0, 8)}`);
  rmSync(dir, { recursive: true, force: true });
  const add = spawnSync("git", ["-C", src, "worktree", "add", "--detach", "--quiet", dir, ref.sha], { encoding: "utf8", timeout: 60_000 });
  if (add.status !== 0) return { status: "unmeasured", reason: `CHECKOUT_FAILED: ${ref.repo}@${ref.sha}` };
  const outDir = mkdtempSync(join(tmpdir(), "peaceai-joba-out-"));
  try {
    const r = spawnSync(join(tooling, "node_modules/.bin/tsx"), [join(tooling, "peaceai/bin/generate.ts")], {
      cwd: tooling, encoding: "utf8", timeout: ROW_MS,
      env: { ...process.env, PEACEAI_KERNEL_BUNDLE: bundle, PEACEAI_OUT_DIR: outDir, PEACEAI_WORKSPACE_DIR: dir, PEACEAI_TARGET: `PeaceG03/${ref.repo}`, ISSUE_TITLE: `builder-log seq ${seq}`, ISSUE_BODY: asked.slice(0, 8000) },
    });
    let candidates: number | null = null;
    const summary = join(outDir, "summary.json");
    if (existsSync(summary)) {
      try { candidates = ((JSON.parse(readFileSync(summary, "utf8")) as { candidates?: unknown[] }).candidates ?? []).length; } catch { candidates = null; }
    }
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
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
  const core = flag("--core", args);
  const asOf = flag("--as-of", args) ?? denverYmd();
  const out = flag("--out", args);
  if (!core) { console.log(USAGE); process.exit(2); }
  const repo = resolve(import.meta.dirname, "../..");
  if (out && insideRepo(repo, resolve(out))) { console.log("refused WRITE_IN_TARGET"); process.exit(2); }
  const logText = readFileSync(resolve(repo, LOG_PATH), "utf8");
  const head = gitLine(repo, ["rev-parse", "HEAD"]);
  const tree = gitLine(repo, ["rev-parse", "HEAD^{tree}"]);
  if (!head || !tree) { console.log("refused NO_HEAD"); process.exit(2); }
  const bind: ReplayBind = { head, tree, input: inputDigest(logText) };
  const stocks = process.env.PEACESTOCKS_CLONE?.trim() || "";
  const cloneHead = stocks ? gitLine(stocks, ["rev-parse", "HEAD"]) : null;
  const onMain = stocks && cloneHead && /^[0-9a-f]{40}$/.test(cloneHead) ? makeGitOnMainChecker(stocks) : null;
  const coreDir = resolve(core);
  const problem = coreProblem(coreDir);
  const coreCommit = problem ? null : gitLine(coreDir, ["rev-parse", "HEAD"]);
  const built = !problem && coreCommit ? kernelBundle(coreDir, coreCommit, repo) : null;
  const buildError = problem ?? (built && "error" in built ? built.error : null);
  const bundle = built && "bundle" in built ? built.bundle : null;
  const entries = new Map(parseLogEntries(logText).map((e) => [e.seq, e as Entry]));
  const preview = buildCapabilityReport(logText, asOf, onMain, [], null, bind, cloneHead);
  const replay = preview.rows.filter((r) => r.inSet).map((r) => {
    const changed = entries.get(r.seq)?.changed ?? "";
    const structural = rowUnrunnable(changed);
    if (structural) return boundReplay(r.seq, "unmeasured", structural, bind);
    if (buildError || !bundle) return boundReplay(r.seq, "unmeasured", buildError ?? "KERNEL_MISSING", bind);
    const ref = commitRef(changed)!;
    const ran = runOne(repo, bundle, ref, entries.get(r.seq)?.asked ?? "", r.seq);
    return boundReplay(r.seq, ran.status, ran.reason, bind);
  });
  const report = buildCapabilityReport(logText, asOf, onMain, replay, null, bind, cloneHead);
  const counts = new Map<string, number>();
  for (const row of report.rows) if (row.inSet) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "replay.jsonl"), replay.map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(out, "capability-job.json"), JSON.stringify({ experimental: true, credit: false, coreProblem: problem, coreCommit, bind, reasons: ranked, report }, null, 2) + "\n");
  }
  console.log(`experimental credit=false asOf=${report.asOf} core=${buildError ?? `pinned ${coreCommit}`}`);
  console.log(`realPass=${report.realPass} passes=${report.passes} fails=${report.fails} unmeasured=${report.unmeasured} set=${report.setSize}`);
  console.log(`official ancestry=${report.official.ancestry} ${report.official.percent}% (${report.official.able}/${report.official.tasks}) cloneHead=${report.official.cloneHead ?? "none"}`);
  console.log(`bind head=${bind.head} tree=${bind.tree} input=${bind.input}`);
  for (const [reason, n] of ranked) console.log(`reason ${n} ${reason}`);
}

if (process.argv[1] && process.argv[1].endsWith("capability-job.ts")) main();
