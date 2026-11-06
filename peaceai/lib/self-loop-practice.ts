// M220 (batch 56): labelled practice-break shapes for self-loop-live. EXPERIMENTAL, NOT for credit.
// Spec: peaceai/spec/self-loop-practice-v1.md. Shapes are generic fault classes on SAFE_HELPERS only;
// they are not modeled on held-out / dev task diffs.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repairProposer } from "./editpropose.ts";
import {
  liveDestRefusal,
  liveHeadRefusal,
  runSelfLoopLive,
  type LiveOk,
  type LiveRefuse,
  type LiveRunRow,
} from "./self-loop-live.ts";
import { buildSelfLoopTask, selfLoopTaskFile, selfLoopTaskFileSha, type SelfLoopGap } from "./self-loop-task.ts";
import { type Proposer } from "./loop.ts";
import type { LoopCode } from "./looprow.ts";
import { STAGE2_CAND_ENV } from "./selfpropose.ts";

export const SELF_LOOP_PRACTICE_SCHEMA = "peaceai-self-loop-practice:v1" as const;
export const SELF_LOOP_PRACTICE_MARKER = "M220-PRACTICE-SHAPE";
export const SELF_LOOP_PRACTICE_RESULTS = "peaceai/self-tests/practice/m220-self-loop-practice-results.json";

const MIT = `MIT License\n\nCopyright (c) 2026 PeaceAI-Workspace self-loop-practice\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software, to deal in the\nSoftware without restriction. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n`;
export const PRACTICE_SET_LICENSE_SHA256 = createHash("sha256").update(MIT).digest("hex");

const DATES_PATH = "peaceai/self-tests/helpers/dates.ts";
const TEXT_PATH = "peaceai/self-tests/helpers/text.ts";

const DATES_OK = `// M72 safe-zone helper.\nexport function utcDayKey(d: Date): string {\n  return d.toISOString().slice(0, 10);\n}\n\nexport function minutesOfUtcDay(d: Date): number {\n  return d.getUTCHours() * 60 + d.getUTCMinutes();\n}\n\nexport function utcMonthKey(day: string): string {\n  const d = day.slice(0, 10);\n  if (d.length !== 10) throw new Error("BAD_DAY");\n  return d.slice(0, 7);\n}\n`;

const TEXT_OK = `// M72 safe-zone helper.\nexport function plural(count: number, word: string): string {\n  return count === 1 ? \`\${count} \${word}\` : \`\${count} \${word}s\`;\n}\n\nexport function truncate(text: string, max: number): string {\n  if (max < 1) return "";\n  return text.length <= max ? text : \`\${text.slice(0, max - 1)}…\`;\n}\n`;

export const PRACTICE_SHAPE_IDS = [
  "wrong-literal",
  "off-by-one",
  "swapped-args",
  "wrong-operator",
  "missing-return",
  "wrong-branch",
  "wrong-string-transform",
  "oracle-absent",
] as const;
export type PracticeShapeId = (typeof PRACTICE_SHAPE_IDS)[number];

export interface PracticeShape {
  readonly id: PracticeShapeId;
  /** Fault class label (generic; not a task id). */
  readonly kind: string;
  readonly editPath: string;
  readonly testPath: string;
  readonly request: string;
  /** Broken helper source at the practice commit. */
  readonly broken: string;
  /** Fixed helper source at the reference merge (for oracle-absent: still "correct" helper that cannot satisfy the test). */
  readonly fixed: string;
  readonly testBody: string;
  /** When true, a competent loop is not expected to PASS by editing only the helper. */
  readonly expectUnfixable: boolean;
}

function mark(kind: string, note: string): string {
  return `// ${SELF_LOOP_PRACTICE_MARKER}:${kind}: ${note} (experimental, not for credit). Do not merge.\n`;
}

/** Eight distinct seeded break shapes on SAFE_HELPERS (dates.ts / text.ts). */
export const PRACTICE_SHAPES: readonly PracticeShape[] = [
  {
    id: "wrong-literal",
    kind: "wrong-literal",
    editPath: DATES_PATH,
    testPath: "peaceai/self-tests/helpers/practice-wrong-literal.test.ts",
    request: "Fix utcDayKey so it returns the UTC calendar day as a ten-character YYYY-MM-DD string.",
    broken: mark("wrong-literal", "slice end is a wrong literal") +
      `export function utcDayKey(d: Date): string {\n  return d.toISOString().slice(0, 7);\n}\n\nexport function minutesOfUtcDay(d: Date): number {\n  return d.getUTCHours() * 60 + d.getUTCMinutes();\n}\n\nexport function utcMonthKey(day: string): string {\n  const d = day.slice(0, 10);\n  if (d.length !== 10) throw new Error("BAD_DAY");\n  return d.slice(0, 7);\n}\n`,
    fixed: DATES_OK,
    testBody: `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { utcDayKey } from "./dates.ts";\ntest("utcDayKey YYYY-MM-DD", () => {\n  assert.equal(utcDayKey(new Date("2026-10-16T23:59:00Z")), "2026-10-16");\n});\n`,
    expectUnfixable: false,
  },
  {
    id: "off-by-one",
    kind: "off-by-one",
    editPath: DATES_PATH,
    testPath: "peaceai/self-tests/helpers/practice-off-by-one.test.ts",
    request: "Fix minutesOfUtcDay so it returns hour*60+minute with no off-by-one drift.",
    broken: mark("off-by-one", "minutes total is one too high") +
      `export function utcDayKey(d: Date): string {\n  return d.toISOString().slice(0, 10);\n}\n\nexport function minutesOfUtcDay(d: Date): number {\n  return d.getUTCHours() * 60 + d.getUTCMinutes() + 1;\n}\n\nexport function utcMonthKey(day: string): string {\n  const d = day.slice(0, 10);\n  if (d.length !== 10) throw new Error("BAD_DAY");\n  return d.slice(0, 7);\n}\n`,
    fixed: DATES_OK,
    testBody: `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { minutesOfUtcDay } from "./dates.ts";\ntest("minutesOfUtcDay exact", () => {\n  assert.equal(minutesOfUtcDay(new Date("2026-10-16T01:02:00Z")), 62);\n});\n`,
    expectUnfixable: false,
  },
  {
    id: "swapped-args",
    kind: "swapped-args",
    editPath: TEXT_PATH,
    testPath: "peaceai/self-tests/helpers/practice-swapped-args.test.ts",
    request: "Fix plural so it formats as '<count> <word>' / '<count> <word>s', not the reverse order.",
    broken: mark("swapped-args", "count and word interpolated in swapped order") +
      `export function plural(count: number, word: string): string {\n  return count === 1 ? \`\${word} \${count}\` : \`\${word}s \${count}\`;\n}\n\nexport function truncate(text: string, max: number): string {\n  if (max < 1) return "";\n  return text.length <= max ? text : \`\${text.slice(0, max - 1)}…\`;\n}\n`,
    fixed: TEXT_OK,
    testBody: `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { plural } from "./text.ts";\ntest("plural order", () => {\n  assert.equal(plural(1, "file"), "1 file");\n  assert.equal(plural(2, "file"), "2 files");\n});\n`,
    expectUnfixable: false,
  },
  {
    id: "wrong-operator",
    kind: "wrong-operator",
    editPath: TEXT_PATH,
    testPath: "peaceai/self-tests/helpers/practice-wrong-operator.test.ts",
    request: "Fix plural so the singular branch is exactly when count === 1 (not another comparison).",
    broken: mark("wrong-operator", "singular branch uses === 0") +
      `export function plural(count: number, word: string): string {\n  return count === 0 ? \`\${count} \${word}\` : \`\${count} \${word}s\`;\n}\n\nexport function truncate(text: string, max: number): string {\n  if (max < 1) return "";\n  return text.length <= max ? text : \`\${text.slice(0, max - 1)}…\`;\n}\n`,
    fixed: TEXT_OK,
    testBody: `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { plural } from "./text.ts";\ntest("plural operator", () => {\n  assert.equal(plural(0, "run"), "0 runs");\n  assert.equal(plural(1, "run"), "1 run");\n});\n`,
    expectUnfixable: false,
  },
  {
    id: "missing-return",
    kind: "missing-return",
    editPath: DATES_PATH,
    testPath: "peaceai/self-tests/helpers/practice-missing-return.test.ts",
    request: "Fix utcMonthKey so it returns the YYYY-MM prefix after validating the day string.",
    broken: mark("missing-return", "no return after validation") +
      `export function utcDayKey(d: Date): string {\n  return d.toISOString().slice(0, 10);\n}\n\nexport function minutesOfUtcDay(d: Date): number {\n  return d.getUTCHours() * 60 + d.getUTCMinutes();\n}\n\nexport function utcMonthKey(day: string): string {\n  const d = day.slice(0, 10);\n  if (d.length !== 10) throw new Error("BAD_DAY");\n  const month = d.slice(0, 7);\n}\n`,
    fixed: DATES_OK,
    testBody: `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { utcMonthKey } from "./dates.ts";\ntest("utcMonthKey returns", () => {\n  assert.equal(utcMonthKey("2026-10-16"), "2026-10");\n});\n`,
    expectUnfixable: false,
  },
  {
    id: "wrong-branch",
    kind: "wrong-branch",
    editPath: TEXT_PATH,
    testPath: "peaceai/self-tests/helpers/practice-wrong-branch.test.ts",
    request: "Fix truncate so max < 1 yields an empty string; positive max truncates with an ellipsis when needed.",
    broken: mark("wrong-branch", "empty-string branch inverted") +
      `export function plural(count: number, word: string): string {\n  return count === 1 ? \`\${count} \${word}\` : \`\${count} \${word}s\`;\n}\n\nexport function truncate(text: string, max: number): string {\n  if (max >= 1) return "";\n  return text.length <= max ? text : \`\${text.slice(0, max - 1)}…\`;\n}\n`,
    fixed: TEXT_OK,
    testBody: `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { truncate } from "./text.ts";\ntest("truncate branch", () => {\n  assert.equal(truncate("abcd", -2), "");\n  assert.equal(truncate("abcd", 4), "abcd");\n});\n`,
    expectUnfixable: false,
  },
  {
    id: "wrong-string-transform",
    kind: "wrong-string-transform",
    editPath: TEXT_PATH,
    testPath: "peaceai/self-tests/helpers/practice-wrong-string-transform.test.ts",
    request: "Fix truncate so an over-long string becomes a prefix of length max-1 plus a single ellipsis character, not uppercasing or a raw slice.",
    broken: mark("wrong-string-transform", "uppercases instead of ellipsis truncate") +
      `export function plural(count: number, word: string): string {\n  return count === 1 ? \`\${count} \${word}\` : \`\${count} \${word}s\`;\n}\n\nexport function truncate(text: string, max: number): string {\n  if (max < 1) return "";\n  return text.length <= max ? text : text.slice(0, max).toUpperCase();\n}\n`,
    fixed: TEXT_OK,
    testBody: `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { truncate } from "./text.ts";\ntest("truncate transform", () => {\n  assert.equal(truncate("abcd", 1), "…");\n  assert.equal(truncate("abcd", 3), "ab…");\n});\n`,
    expectUnfixable: false,
  },
  {
    id: "oracle-absent",
    kind: "oracle-absent",
    editPath: DATES_PATH,
    testPath: "peaceai/self-tests/helpers/practice-oracle-absent.test.ts",
    request: "Fix utcDayKey so the practice self-test passes. The required day token is not stated in this request.",
    // Helper looks "reasonable" but cannot satisfy contradictory asserts; fixed == broken for honesty.
    broken: mark("oracle-absent", "helper cannot satisfy contradictory asserts; no honest single return works") +
      `export function utcDayKey(d: Date): string {\n  return d.toISOString().slice(0, 10);\n}\n\nexport function minutesOfUtcDay(d: Date): number {\n  return d.getUTCHours() * 60 + d.getUTCMinutes();\n}\n\nexport function utcMonthKey(day: string): string {\n  const d = day.slice(0, 10);\n  if (d.length !== 10) throw new Error("BAD_DAY");\n  return d.slice(0, 7);\n}\n`,
    fixed: mark("oracle-absent", "still unsatisfiable; reference keeps the same helper") +
      `export function utcDayKey(d: Date): string {\n  return d.toISOString().slice(0, 10);\n}\n\nexport function minutesOfUtcDay(d: Date): number {\n  return d.getUTCHours() * 60 + d.getUTCMinutes();\n}\n\nexport function utcMonthKey(day: string): string {\n  const d = day.slice(0, 10);\n  if (d.length !== 10) throw new Error("BAD_DAY");\n  return d.slice(0, 7);\n}\n`,
    testBody: `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { utcDayKey } from "./dates.ts";\ntest("utcDayKey contradictory oracle", () => {\n  const v = utcDayKey(new Date("2026-10-16T23:59:00Z"));\n  assert.equal(v, "2026-10-16");\n  assert.equal(v.length, 7);\n});\n`,
    expectUnfixable: true,
  },
];

const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
function git(cwd: string, ...a: string[]): string {
  return execFileSync("git", [...G, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function slimScratch(scratchDir: string): void {
  const slimPkg = JSON.stringify({
    name: "peaceai-self-loop-practice",
    private: true,
    type: "module",
    scripts: { test: "node --test" },
  }, null, 1) + "\n";
  writeFileSync(join(scratchDir, "package.json"), slimPkg);
  writeFileSync(join(scratchDir, "LICENSE"), MIT);
  const lockNames = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === ".git" || name === "node_modules") continue;
      const full = join(d, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (lockNames.has(name)) { try { rmSync(full); } catch { /* */ } }
    }
  };
  walk(scratchDir);
}

/** Seed one labelled practice shape onto a scratch clone of clean HEAD. */
export function seedPracticeShape(scratchDir: string, shape: PracticeShape): { ok: true; commit: string; merge: string } | LiveRefuse {
  if (!existsSync(join(scratchDir, ".git"))) return { ok: false, code: "SELF_LOOP_LIVE_CLONE", detail: "scratch" };
  try {
    slimScratch(scratchDir);
    // Ensure both helpers exist as OK companions except the edited one.
    if (shape.editPath === DATES_PATH) {
      writeFileSync(join(scratchDir, DATES_PATH), shape.broken);
      writeFileSync(join(scratchDir, TEXT_PATH), TEXT_OK);
    } else {
      writeFileSync(join(scratchDir, TEXT_PATH), shape.broken);
      writeFileSync(join(scratchDir, DATES_PATH), DATES_OK);
    }
    git(scratchDir, "add", "-A");
    git(scratchDir, "commit", "-q", "-m", `${SELF_LOOP_PRACTICE_MARKER}:${shape.id}: broken (experimental, not for credit)`);
    const commit = git(scratchDir, "rev-parse", "HEAD");
    mkdirSync(dirname(join(scratchDir, shape.testPath)), { recursive: true });
    writeFileSync(join(scratchDir, shape.testPath), shape.testBody);
    writeFileSync(join(scratchDir, shape.editPath), shape.fixed);
    git(scratchDir, "add", shape.editPath, shape.testPath);
    git(scratchDir, "commit", "-q", "-m", `${SELF_LOOP_PRACTICE_MARKER}:${shape.id}: reference (experimental, not for credit)`);
    const merge = git(scratchDir, "rev-parse", "HEAD");
    return { ok: true, commit, merge };
  } catch (e: any) {
    return { ok: false, code: "SELF_LOOP_LIVE_SEED", detail: String(e?.message ?? "seed").slice(0, 80) };
  }
}

export function practiceShapeById(id: string): PracticeShape | undefined {
  return PRACTICE_SHAPES.find((s) => s.id === id);
}

/** Repair proposer used for honest practice grading (not the M219 restore cheat). */
export function practiceGradeProposer(): Proposer {
  return repairProposer({ v2: true }) as unknown as Proposer;
}

export interface PracticeShapeResult {
  readonly id: PracticeShapeId;
  readonly kind: string;
  readonly expectUnfixable: boolean;
  readonly loopCode: LoopCode | string;
  readonly result: string | null;
  readonly attempts: number;
  readonly proposer: string;
  readonly gap?: string;
}

export interface PracticeSetReport {
  readonly schema: typeof SELF_LOOP_PRACTICE_SCHEMA;
  readonly experimental: true;
  readonly credit: false;
  readonly expectedHead: string;
  readonly at: string;
  readonly proposer: string;
  readonly shapes: PracticeShapeResult[];
  readonly passCount: number;
  readonly total: number;
  readonly passRate: number;
  readonly gaps: readonly string[];
}

function freshScratch(cleanDir: string, scratchDest: string, expectedHead: string): LiveRefuse | null {
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

export interface RunPracticeSetOpts {
  readonly expectedHead: string;
  readonly cleanDir: string;
  readonly scratchBase: string;
  readonly hostWorkspace: string;
  readonly outDir: string;
  readonly env?: Record<string, string | undefined>;
  readonly maxAttempts?: number;
  readonly runMs?: number;
  readonly shapes?: readonly PracticeShape[];
  readonly proposer?: Proposer;
}

/** Run every practice shape through the sandboxed loop; return an honest report (credit:false). */
export function runPracticeSet(opts: RunPracticeSetOpts): PracticeSetReport | LiveRefuse {
  const headRef = liveHeadRefusal(opts.cleanDir, opts.expectedHead);
  if (headRef) return { ok: false, code: headRef, detail: "clean" };
  const dest = liveDestRefusal(opts.scratchBase, opts.hostWorkspace);
  if (dest) return { ok: false, code: dest, detail: "scratchBase" };
  if (typeof opts.outDir !== "string" || !opts.outDir.startsWith("/")) {
    return { ok: false, code: "SELF_LOOP_LIVE_DEST", detail: "out" };
  }
  mkdirSync(opts.outDir, { recursive: true });
  const shapes = opts.shapes ?? PRACTICE_SHAPES;
  const proposer = opts.proposer ?? practiceGradeProposer();
  const env = { ...process.env, ...opts.env, [STAGE2_CAND_ENV]: opts.env?.[STAGE2_CAND_ENV] ?? process.env[STAGE2_CAND_ENV] };
  const rows: PracticeShapeResult[] = [];
  const gaps: string[] = [];

  for (const shape of shapes) {
    const scratchDest = join(opts.scratchBase, shape.id);
    const err = freshScratch(opts.cleanDir, scratchDest, opts.expectedHead);
    if (err) return err;
    const seeded = seedPracticeShape(scratchDest, shape);
    if (!seeded.ok) return seeded;
    const gap: SelfLoopGap = {
      id: `m220-${shape.id}`,
      request: shape.request,
      repo: "PeaceG03/PeaceAI-Workspace",
      editPath: shape.editPath,
      testPath: shape.testPath,
      commit: seeded.commit,
      merge: seeded.merge,
      licenseSha256: PRACTICE_SET_LICENSE_SHA256,
      testCommand: "node --test",
    };
    const built = buildSelfLoopTask(gap);
    if (!built.ok) {
      rows.push({
        id: shape.id,
        kind: shape.kind,
        expectUnfixable: shape.expectUnfixable,
        loopCode: built.code,
        result: "refused",
        attempts: 0,
        proposer: proposer.name,
        gap: `build refused ${built.code}`,
      });
      if (!shape.expectUnfixable) gaps.push(`${shape.id}: build refused ${built.code}`);
      continue;
    }
    const file = selfLoopTaskFile(built.task, `M220 practice ${shape.id} (experimental, not for credit)`);
    const fileSha = selfLoopTaskFileSha(file);
    const prepared: LiveOk = {
      ok: true,
      expectedHead: opts.expectedHead,
      cleanDir: opts.cleanDir,
      scratchDir: scratchDest,
      seeded: true,
      failingTests: [],
      gap,
      taskResult: built,
      fileSha,
    };
    const ran = runSelfLoopLive({
      prepared,
      hostWorkspace: opts.hostWorkspace,
      outDir: opts.outDir,
      env,
      proposer,
      maxAttempts: opts.maxAttempts ?? 5,
      runMs: opts.runMs ?? 90_000,
    });
    if (!ran.ok) {
      rows.push({
        id: shape.id,
        kind: shape.kind,
        expectUnfixable: shape.expectUnfixable,
        loopCode: ran.code,
        result: "refused",
        attempts: 0,
        proposer: proposer.name,
        gap: `live refused ${ran.code}`,
      });
      if (!shape.expectUnfixable) gaps.push(`${shape.id}: live refused ${ran.code}`);
      continue;
    }
    const passed = ran.row.loopCode === "PASS";
    let gapNote: string | undefined;
    if (!passed && !shape.expectUnfixable) {
      gapNote = missingSkillFor(shape, ran.row);
      gaps.push(`${shape.id}: ${gapNote}`);
    } else if (passed && shape.expectUnfixable) {
      gapNote = "unexpected PASS on unfixable shape (grader too strong / cheat)";
      gaps.push(`${shape.id}: ${gapNote}`);
    }
    rows.push({
      id: shape.id,
      kind: shape.kind,
      expectUnfixable: shape.expectUnfixable,
      loopCode: ran.row.loopCode,
      result: ran.row.result,
      attempts: ran.row.attempts,
      proposer: ran.row.proposer,
      gap: gapNote,
    });
  }

  const passCount = rows.filter((r) => r.loopCode === "PASS").length;
  const report: PracticeSetReport = {
    schema: SELF_LOOP_PRACTICE_SCHEMA,
    experimental: true,
    credit: false,
    expectedHead: opts.expectedHead,
    at: new Date().toISOString(),
    proposer: proposer.name,
    shapes: rows,
    passCount,
    total: rows.length,
    passRate: rows.length ? passCount / rows.length : 0,
    gaps,
  };
  writeFileSync(join(opts.outDir, "m220-practice-report.json"), JSON.stringify(report, null, 2) + "\n");
  appendFileSync(join(opts.outDir, "m220-practice-report.jsonl"), JSON.stringify(report) + "\n");
  return report;
}

/** Name the missing skill for a non-PASS fixable shape (honest; do not tune to pass). */
export function missingSkillFor(shape: PracticeShape, row: Pick<LiveRunRow, "loopCode" | "attempts" | "result">): string {
  const code = String(row.loopCode);
  if (code === "NO_EDIT" || code === "NO_MORE_EDITS") {
    return `repair locate/templates miss ${shape.kind} (proposer ${code})`;
  }
  if (code === "ATTEMPT_LIMIT") {
    return `repair candidates exhausted on ${shape.kind} without a passing edit`;
  }
  if (code.startsWith("CAND_UID_")) return `stage-2 cand unavailable (${code})`;
  if (code === "EDIT_SCOPE" || code === "SELF_PROTECTED") return `edit scope blocked on ${shape.kind}`;
  if (code.startsWith("BASELINE_") || code.startsWith("DEPS_") || code.startsWith("TEST_")) {
    return `loop pre-edit refusal ${code} on ${shape.kind}`;
  }
  return `unresolved ${shape.kind} ended ${code} after ${row.attempts} attempts`;
}

/** Pin check used by tests/mutants. */
export function practiceShapePins(): { ids: string[]; kinds: string[]; unfixable: string } {
  const ids = PRACTICE_SHAPES.map((s) => s.id);
  const kinds = PRACTICE_SHAPES.map((s) => s.kind);
  const u = PRACTICE_SHAPES.find((s) => s.expectUnfixable)!.id;
  let idsOut: string[] = [];
  let kindsOut: string[] = [];
  let unfixable = "";
  if (ids.length === 8) idsOut = ids; // m220-guard:ids
  if (new Set(kinds).size === 8) kindsOut = kinds; // m220-guard:kinds
  if (u === "oracle-absent") unfixable = u; // m220-guard:unfixable
  return { ids: idsOut, kinds: kindsOut, unfixable };
}
