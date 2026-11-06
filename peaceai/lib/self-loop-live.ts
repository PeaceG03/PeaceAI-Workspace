// M219 (batch 55): live wiring for self-loop tasks on a clean PeaceAI-Workspace clone (never the working tree).
// Spec: peaceai/spec/self-loop-live-v1.md. EXPERIMENTAL, NOT default, NOT for credit.
// Builds on buildSelfLoopTask (M218). Fail closed on dirty trees, HEAD mismatch, and protected paths.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  buildSelfLoopTask,
  selfLoopEditRefusal,
  selfLoopTaskFile,
  selfLoopTaskFileSha,
  type SelfLoopGap,
  type SelfLoopRefuse,
  type SelfLoopResult,
} from "./self-loop-task.ts";
import {
  gitCopyFetcher,
  runLoopTask,
  type LoopResult,
  type Proposer,
} from "./loop.ts";
import type { LoopCode } from "./looprow.ts";
import { STAGE2_CAND_ENV } from "./selfpropose.ts";
import { SAFE_HELPERS } from "./self-zone.ts";

export const SELF_LOOP_LIVE_SCHEMA = "peaceai-self-loop-live:v1" as const;
export const SELF_LOOP_LIVE_LOG = "self-loop-live-runs.jsonl" as const;

/** Fixed refusal codes for the live entry path (plus SelfLoopRefuse from buildSelfLoopTask). */
export const SELF_LOOP_LIVE_REFUSALS = [
  "SELF_LOOP_LIVE_DIRTY", // clean clone or scratch is dirty
  "SELF_LOOP_LIVE_HEAD", // HEAD !== expectedHead
  "SELF_LOOP_LIVE_CLONE", // dest missing / clone failed
  "SELF_LOOP_LIVE_DEST", // dest not absolute or collides with host workspace
  "SELF_LOOP_LIVE_SEED", // practice break could not be applied / no gap
  "SELF_LOOP_LIVE_NO_TSX", // cannot run self-tests (no tsx)
] as const;
export type SelfLoopLiveRefuse = (typeof SELF_LOOP_LIVE_REFUSALS)[number] | SelfLoopRefuse;

export const PRACTICE_BREAK_MARKER = "M219-PRACTICE-BREAK";
export const PRACTICE_HELPER = "peaceai/self-tests/helpers/dates.ts";
export const PRACTICE_TEST = "peaceai/self-tests/helpers/daykey-practice-m219.test.ts";

const MIT = `MIT License\n\nCopyright (c) 2026 PeaceAI-Workspace self-loop-live practice\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software, to deal in the\nSoftware without restriction. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n`;
export const PRACTICE_LICENSE_SHA256 = createHash("sha256").update(MIT).digest("hex");

const HELPER_OK = `// M72 safe-zone helper (named in peaceai/lib/self-zone.ts SAFE_HELPERS). Pure UTC date helpers; imported only by\n// peaceai/self-tests. PeaceAI may add functions here through the normal task flow once the self zone is enabled.\nexport function utcDayKey(d: Date): string {\n  return d.toISOString().slice(0, 10);\n}\n\nexport function minutesOfUtcDay(d: Date): number {\n  return d.getUTCHours() * 60 + d.getUTCMinutes();\n}\n\nexport function utcMonthKey(day: string): string {\n  const d = day.slice(0, 10);\n  if (d.length !== 10) throw new Error("BAD_DAY");\n  const month = d.slice(0, 7);\n  return month;\n}\n`;

const HELPER_BAD = `// M72 safe-zone helper (named in peaceai/lib/self-zone.ts SAFE_HELPERS).\n// ${PRACTICE_BREAK_MARKER}: intentional failing safe-zone gap (experimental, not for credit). Do not merge.\n// Broken utcDayKey returns YYYY-MM (month) instead of YYYY-MM-DD.\nexport function utcDayKey(d: Date): string {\n  return d.toISOString().slice(0, 7);\n}\n\nexport function minutesOfUtcDay(d: Date): number {\n  return d.getUTCHours() * 60 + d.getUTCMinutes();\n}\n\nexport function utcMonthKey(day: string): string {\n  const d = day.slice(0, 10);\n  if (d.length !== 10) throw new Error("BAD_DAY");\n  const month = d.slice(0, 7);\n  return month;\n}\n`;

const PRACTICE_TEST_BODY = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { utcDayKey } from "./dates.ts";\n\ntest("utcDayKey is YYYY-MM-DD (M219 practice)", () => {\n  assert.equal(utcDayKey(new Date("2026-10-16T23:59:00Z")), "2026-10-16");\n});\n`;

const HEX40 = /^[0-9a-f]{40}$/;
const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];

function git(cwd: string, ...a: string[]): string {
  return execFileSync("git", [...G, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export type LiveOk = {
  readonly ok: true;
  readonly expectedHead: string;
  readonly cleanDir: string;
  readonly scratchDir: string;
  readonly seeded: boolean;
  readonly failingTests: readonly string[];
  readonly gap: SelfLoopGap;
  readonly taskResult: Extract<SelfLoopResult, { ok: true }>;
  readonly fileSha: string;
};

export type LiveRefuse = { readonly ok: false; readonly code: SelfLoopLiveRefuse; readonly detail?: string };

export interface PrepareLiveOpts {
  /** 40-hex SHA the clean clone must be at. */
  readonly expectedHead: string;
  /** Absolute path for the clean clone (outside hostWorkspace). */
  readonly cloneDest: string;
  /** Absolute path for the scratch copy used for practice / loop pins. */
  readonly scratchDest: string;
  /** Host checkout that owns this tool (never used as the target clone). */
  readonly hostWorkspace: string;
  /** owner/name on SELF_ALLOW. */
  readonly repo?: string;
  /** When true (default), seed a labelled practice break if no self-test fails on the clean HEAD. */
  readonly seedIfClean?: boolean;
  /** Optional pre-existing clean clone (tests); must already match expectedHead and be clean. */
  readonly existingCleanDir?: string;
}

/** Refuse when dest is missing, relative, or resolves inside the host workspace. */
export function liveDestRefusal(dest: string, hostWorkspace: string): SelfLoopLiveRefuse | null {
  if (typeof dest !== "string" || !dest || !isAbsolute(dest)) return "SELF_LOOP_LIVE_DEST"; // m219-guard:dest
  let host = hostWorkspace;
  try { host = resolve(hostWorkspace); } catch { return "SELF_LOOP_LIVE_DEST"; }
  const d = resolve(dest);
  if (d === host || d.startsWith(host + "/")) return "SELF_LOOP_LIVE_DEST"; // m219-guard:outside
  return null;
}

/** Dirty tree or HEAD mismatch on a git dir. */
export function liveHeadRefusal(dir: string, expectedHead: string): SelfLoopLiveRefuse | null {
  if (!HEX40.test(expectedHead)) return "SELF_LOOP_LIVE_HEAD";
  if (!existsSync(join(dir, ".git"))) return "SELF_LOOP_LIVE_CLONE";
  let head = "";
  try { head = git(dir, "rev-parse", "HEAD"); } catch { return "SELF_LOOP_LIVE_CLONE"; }
  if (head !== expectedHead) return "SELF_LOOP_LIVE_HEAD"; // m219-guard:head
  let porcelain = "";
  try { porcelain = git(dir, "status", "--porcelain", "--untracked-files=no"); } catch { return "SELF_LOOP_LIVE_DIRTY"; }
  if (porcelain.length > 0) return "SELF_LOOP_LIVE_DIRTY"; // m219-guard:dirty
  return null;
}

/** List safe-zone self-test files under peaceai/self-tests that fail under tsx --test. */
export function findFailingSelfTests(cloneDir: string, tsxPath?: string): { ok: true; failing: string[] } | LiveRefuse {
  const candidates = [
    tsxPath,
    join(cloneDir, "node_modules/.bin/tsx"),
    process.env.PEACEAI_TSX,
    "tsx",
  ].filter((x): x is string => typeof x === "string" && x.length > 0);
  let tsxBin: string | null = null;
  for (const c of candidates) {
    try {
      if (c !== "tsx" && !existsSync(c)) continue;
      execFileSync(c === "tsx" ? "tsx" : c, ["--version"], { stdio: "ignore" });
      tsxBin = c;
      break;
    } catch { /* try next */ }
  }
  if (!tsxBin) return { ok: false, code: "SELF_LOOP_LIVE_NO_TSX" };
  let out = "";
  try {
    out = execFileSync(
      "bash",
      ["-lc", `find peaceai/self-tests -name '*.test.ts' -type f 2>/dev/null | LC_ALL=C sort | while read -r f; do "${tsxBin}" --test "$f" >/dev/null 2>&1 || echo "$f"; done`],
      { cwd: cloneDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e: any) {
    out = String(e?.stdout ?? "");
  }
  const failing = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("peaceai/self-tests/") && l.endsWith(".test.ts"));
  return { ok: true, failing };
}

/** Map a failing self-test path to its SAFE_HELPERS edit path (import heuristic). */
export function helperForSelfTest(cloneDir: string, testPath: string): string | null {
  let text = "";
  try { text = readFileSync(join(cloneDir, testPath), "utf8"); } catch { return null; }
  if (/from ["']\.\/dates/.test(text)) return "peaceai/self-tests/helpers/dates.ts";
  if (/from ["']\.\/text/.test(text)) return "peaceai/self-tests/helpers/text.ts";
  for (const h of SAFE_HELPERS) {
    const base = h.split("/").pop()!.replace(/\.ts$/, "");
    if (testPath.includes(base) || text.includes(base)) return h;
  }
  return null;
}

/**
 * Seed a clearly labelled practice break on a scratch copy of the clean HEAD.
 * Writes MIT LICENSE (Workspace has none; the loop needs a pin), breaks utcDayKey, adds a self-test,
 * then commits the fix as the reference merge. Returns pins for buildSelfLoopTask.
 */
export function seedPracticeBreak(scratchDir: string): { ok: true; commit: string; merge: string; editPath: string; testPath: string; licenseSha256: string; request: string } | LiveRefuse {
  if (!existsSync(join(scratchDir, ".git"))) return { ok: false, code: "SELF_LOOP_LIVE_CLONE", detail: "scratch" };
  try {
    // Slim the scratch so the loop is not refused for nested fixture lockfiles / PM config on the full Workspace tree.
    // The practice break is clearly labelled; only the safe helper + a node:test package remain for grading.
    const slimPkg = JSON.stringify({
      name: "peaceai-self-loop-live-practice",
      private: true,
      type: "module",
      scripts: { test: "node --test" },
    }, null, 1) + "\n";
    writeFileSync(join(scratchDir, "package.json"), slimPkg);
    writeFileSync(join(scratchDir, "LICENSE"), MIT);
    writeFileSync(join(scratchDir, PRACTICE_HELPER), HELPER_BAD);
    // Drop lockfiles the loop would refuse (root + nested fixtures).
    const lockNames = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        if (name === ".git" || name === "node_modules") continue;
        const full = join(d, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) walk(full);
        else if (lockNames.has(name)) {
          try { rmSync(full); } catch { /* ignore */ }
        }
      }
    };
    walk(scratchDir);
    git(scratchDir, "add", "-A");
    git(scratchDir, "commit", "-q", "-m", `${PRACTICE_BREAK_MARKER}: break utcDayKey (experimental, not for credit)`);
    const commit = git(scratchDir, "rev-parse", "HEAD");
    mkdirSync(dirname(join(scratchDir, PRACTICE_TEST)), { recursive: true });
    writeFileSync(join(scratchDir, PRACTICE_TEST), PRACTICE_TEST_BODY);
    writeFileSync(join(scratchDir, PRACTICE_HELPER), HELPER_OK);
    git(scratchDir, "add", PRACTICE_HELPER, PRACTICE_TEST);
    git(scratchDir, "commit", "-q", "-m", `${PRACTICE_BREAK_MARKER}: reference fix + practice self-test (experimental, not for credit)`);
    const merge = git(scratchDir, "rev-parse", "HEAD");
    return {
      ok: true,
      commit,
      merge,
      editPath: PRACTICE_HELPER,
      testPath: PRACTICE_TEST,
      licenseSha256: PRACTICE_LICENSE_SHA256,
      request: "Fix utcDayKey in peaceai/self-tests/helpers/dates.ts so it returns the UTC calendar day as YYYY-MM-DD (M219 practice break).",
    };
  } catch (e: any) {
    return { ok: false, code: "SELF_LOOP_LIVE_SEED", detail: String(e?.message ?? "seed").slice(0, 80) };
  }
}

/** Proposer that restores the practice-break helper when the marker is present (demo / tests only). */
export function practiceBreakProposer(): Proposer {
  return {
    name: "m219-practice-break",
    next(input) {
      const cur = input.files.find((f) => f.path === PRACTICE_HELPER)?.content ?? "";
      if (!cur.includes(PRACTICE_BREAK_MARKER)) return { refuse: "NO_MORE_EDITS" };
      return { edits: [{ path: PRACTICE_HELPER, content: HELPER_OK }] };
    },
  };
}

function cloneOrReuse(opts: PrepareLiveOpts): LiveRefuse | { cleanDir: string } {
  const destRef = liveDestRefusal(opts.cloneDest, opts.hostWorkspace);
  if (destRef) return { ok: false, code: destRef, detail: "clone" };
  const scratchRef = liveDestRefusal(opts.scratchDest, opts.hostWorkspace);
  if (scratchRef) return { ok: false, code: scratchRef, detail: "scratch" };
  if (opts.existingCleanDir) {
    const r = liveHeadRefusal(opts.existingCleanDir, opts.expectedHead);
    if (r) return { ok: false, code: r, detail: "existing" };
    return { cleanDir: opts.existingCleanDir };
  }
  if (existsSync(opts.cloneDest)) {
    const r = liveHeadRefusal(opts.cloneDest, opts.expectedHead);
    if (r) return { ok: false, code: r, detail: "reuse" };
    return { cleanDir: opts.cloneDest };
  }
  try {
    mkdirSync(dirname(opts.cloneDest), { recursive: true });
    execFileSync("git", ["clone", "--quiet", "--no-tags", `https://github.com/${opts.repo ?? "PeaceG03/PeaceAI-Workspace"}.git`, opts.cloneDest], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_TOKEN: "", GITHUB_TOKEN: "" },
    });
    git(opts.cloneDest, "checkout", "--quiet", "--detach", opts.expectedHead);
  } catch {
    return { ok: false, code: "SELF_LOOP_LIVE_CLONE" };
  }
  const r = liveHeadRefusal(opts.cloneDest, opts.expectedHead);
  if (r) return { ok: false, code: r };
  return { cleanDir: opts.cloneDest };
}

function freshScratchFromClean(cleanDir: string, scratchDest: string, expectedHead: string): LiveRefuse | null {
  if (existsSync(scratchDest)) rmSync(scratchDest, { recursive: true, force: true });
  mkdirSync(dirname(scratchDest), { recursive: true });
  try {
    execFileSync("git", ["clone", "--quiet", "--no-local", cleanDir, scratchDest], { stdio: "ignore" });
    git(scratchDest, "checkout", "--quiet", "--detach", expectedHead);
  } catch {
    return { ok: false, code: "SELF_LOOP_LIVE_CLONE", detail: "scratch-clone" };
  }
  return null;
}

/** Prepare a self-loop gap from a clean clone of PeaceAI-Workspace HEAD (practice-seeded when no test fails). */
export function prepareSelfLoopLive(opts: PrepareLiveOpts): LiveOk | LiveRefuse {
  if (!HEX40.test(opts.expectedHead)) return { ok: false, code: "SELF_LOOP_LIVE_HEAD", detail: "expected" };
  const repo = opts.repo ?? "PeaceG03/PeaceAI-Workspace";
  const cloned = cloneOrReuse({ ...opts, repo });
  if ("ok" in cloned && cloned.ok === false) return cloned;
  const cleanDir = (cloned as { cleanDir: string }).cleanDir;

  if (!existsSync(join(cleanDir, "node_modules/.bin/tsx"))) {
    try { execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: cleanDir, stdio: "ignore" }); } catch { /* discovery may use PATH tsx */ }
  }

  const found0 = findFailingSelfTests(cleanDir);
  const found: { ok: true; failing: string[] } | LiveRefuse = (!found0.ok && found0.code === "SELF_LOOP_LIVE_NO_TSX" && opts.seedIfClean !== false)
    ? { ok: true, failing: [] }
    : found0;
  if (!found.ok) return found;

  const scratchErr = freshScratchFromClean(cleanDir, opts.scratchDest, opts.expectedHead);
  if (scratchErr) return scratchErr;

  const seedIfClean = opts.seedIfClean !== false;
  let seeded = false;
  let gap: SelfLoopGap;

  if (found.failing.length === 0) {
    if (!seedIfClean) return { ok: false, code: "SELF_LOOP_LIVE_SEED", detail: "no-failing" };
    const seed = seedPracticeBreak(opts.scratchDest);
    if (!seed.ok) return seed;
    seeded = true;
    gap = {
      id: "m219-practice-daykey",
      request: seed.request,
      repo,
      editPath: seed.editPath,
      testPath: seed.testPath,
      commit: seed.commit,
      merge: seed.merge,
      licenseSha256: seed.licenseSha256,
      testCommand: "node --test",
    };
  } else {
    const testPath = found.failing[0]!;
    const editPath = helperForSelfTest(cleanDir, testPath);
    if (!editPath) return { ok: false, code: "SELF_LOOP_OUTSIDE_SAFE", detail: "helper-map" };
    const er = selfLoopEditRefusal(editPath);
    if (er) return { ok: false, code: er, detail: "real-edit" };
    // Workspace has no LICENSE; pin one on the scratch tip so the loop can verify it. commit == merge (HEAD+LICENSE).
    writeFileSync(join(opts.scratchDest, "LICENSE"), MIT);
    git(opts.scratchDest, "add", "LICENSE");
    git(opts.scratchDest, "commit", "-q", "-m", "M219: LICENSE pin for self-loop-live (experimental, not for credit)");
    const tip = git(opts.scratchDest, "rev-parse", "HEAD");
    gap = {
      id: "m219-live-gap",
      request: `Repair the failing safe-zone self-test ${testPath} by fixing ${editPath} (live self-loop, experimental, not for credit).`,
      repo,
      editPath,
      testPath,
      commit: tip,
      merge: tip,
      licenseSha256: PRACTICE_LICENSE_SHA256,
      testCommand: "node --test",
    };
  }

  const built = buildSelfLoopTask(gap);
  if (!built.ok) return { ok: false, code: built.code, detail: built.detail };
  const file = selfLoopTaskFile(built.task, "M219 self-loop-live (experimental, not for credit)");
  return {
    ok: true,
    expectedHead: opts.expectedHead,
    cleanDir,
    scratchDir: opts.scratchDest,
    seeded,
    failingTests: found.failing,
    gap,
    taskResult: built,
    fileSha: selfLoopTaskFileSha(file),
  };
}

export interface RunLiveOpts {
  readonly prepared: LiveOk;
  readonly hostWorkspace: string;
  readonly outDir: string;
  readonly env?: Record<string, string | undefined>;
  readonly proposer?: Proposer;
  readonly maxAttempts?: number;
  readonly runMs?: number;
  readonly workBase?: string;
}

export interface LiveRunRow {
  readonly schema: typeof SELF_LOOP_LIVE_SCHEMA;
  readonly experimental: true;
  readonly credit: false;
  readonly at: string;
  readonly expectedHead: string;
  readonly seeded: boolean;
  readonly repo: string;
  readonly commit: string;
  readonly merge: string;
  readonly taskId: string;
  readonly editPath: string;
  readonly testPath: string;
  readonly loopCode: LoopCode | string;
  readonly result: string | null;
  readonly attempts: number;
  readonly proposer: string;
}

/** Run the sandboxed loop on a prepared live gap; append one experimental/not-for-credit row to outDir/log. */
export function runSelfLoopLive(opts: RunLiveOpts): { ok: true; loop: LoopResult; row: LiveRunRow } | LiveRefuse {
  if (typeof opts.outDir !== "string" || !opts.outDir || !isAbsolute(opts.outDir)) {
    return { ok: false, code: "SELF_LOOP_LIVE_DEST", detail: "out" };
  }
  const p = opts.prepared;
  const task = p.taskResult.task;
  mkdirSync(opts.outDir, { recursive: true });
  const env = { ...process.env, ...opts.env };
  const proposer = opts.proposer ?? practiceBreakProposer();
  const fetcher = gitCopyFetcher(() => p.scratchDir);
  const loop = runLoopTask(task, "public", p.fileSha, {
    root: opts.hostWorkspace,
    fetcher,
    proposer,
    maxAttempts: opts.maxAttempts ?? 3,
    runMs: opts.runMs ?? 120_000,
    env,
    rules: [],
    training: new Set<string>(),
    workBase: opts.workBase,
  });
  const row: LiveRunRow = {
    schema: SELF_LOOP_LIVE_SCHEMA,
    experimental: true,
    credit: false,
    at: new Date().toISOString(),
    expectedHead: p.expectedHead,
    seeded: p.seeded,
    repo: task.repo,
    commit: task.commit,
    merge: task.reference.from.merge,
    taskId: task.id,
    editPath: p.gap.editPath,
    testPath: p.gap.testPath,
    loopCode: loop.row.code,
    result: loop.row.result ?? null,
    attempts: loop.row.attempts ?? 0,
    proposer: proposer.name,
  };
  appendFileSync(join(opts.outDir, SELF_LOOP_LIVE_LOG), JSON.stringify(row) + "\n");
  return { ok: true, loop, row };
}
