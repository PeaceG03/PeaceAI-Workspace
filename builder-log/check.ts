// Builder task log validator: schema per line + append-only against a base revision.
// Usage: tsx builder-log/check.ts [--base <git-rev>]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const LOG_PATH = "builder-log/tasks.jsonl";

/** Edit kinds (PeaceAI skills). APPROVED = learned rules live today; the rest are known gaps. */
export const APPROVED_SKILLS = [
  "TEST_CASE", // public-test-case-v1
  "TEST_CASE_APPEND", // public-test-case-append-v1
  "THROW_GUARD", // public-throw-guard-v1
  "ADD_FUNCTION", // public-add-function-v1 (existing module)
  "ADD_FUNCTION_NEW_MODULE", // public-add-function-v2
] as const;
export const MISSING_SKILLS = [
  "WORKFLOW_STEP", // PR #107, not approved
  "WORKFLOW_JOB",
  "CHECK_OBJECT_LITERAL_ARGS", // PR #108, not approved
  "COMPLEX_FUNCTION", // new function/module beyond ADD_FUNCTION's safe vocabulary (dates, loops, I/O)
  "IMPORT_EDIT", // change an existing import specifier
  "MODIFY_LOGIC", // multi-line logic change in an existing function
  "TSCONFIG_SCRIPT", // package script / tsconfig change
  "PEACEAI_SELF_CHANGE", // PeaceAI's own tooling: protected, never a PeaceAI edit by design
  "OPS_ACTION", // dispatch, close, label, diagnose: no code edit
  "ENV_FIX", // box/runner environment, no repo edit
] as const;
export type Skill = (typeof APPROVED_SKILLS)[number] | (typeof MISSING_SKILLS)[number];

export interface Entry {
  seq: number;
  date: string; // YYYY-MM-DD (America/Denver)
  time: string; // HH:MM MT
  asked: string;
  changed: string; // diff ref
  why: string;
  skill: Skill;
  mark: string; // "PeaceAI-able today" | "missing skill <SKILL>"
  by: "Builder" | "PeaceAI";
}

const KEYS = ["seq", "date", "time", "asked", "changed", "why", "skill", "mark", "by"];
// Diff ref: PeaceSTOCKS@<sha>, PeaceAI-Workspace@<sha>, PeaceAI-Workspace#<n>, "none (...)"; several joined by ", ".
const REF = /^(?:(?:PeaceSTOCKS|PeaceAI-Workspace)@[0-9a-f]{7,40}|PeaceAI-Workspace#\d+)$/;
// Public repo: refuse secret-shaped text and private-repo references.
const FORBIDDEN: [RegExp, string][] = [
  [/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|-----BEGIN/, "secret-shaped text"],
  [/PeaceSTOCKS-Net|Net-Runner|peacestocks-net|\bnet\//i, "private Net reference"],
  [/^diff --git|^@@ /m, "inline diff text"],
];

export function validateEntry(raw: unknown, expectSeq: number): string[] {
  const e = raw as Record<string, unknown>;
  const errs: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["not an object"];
  const keys = Object.keys(e);
  if (keys.join() !== KEYS.join()) errs.push(`keys must be exactly ${KEYS.join(",")} in order`);
  if (e.seq !== expectSeq) errs.push(`seq must be ${expectSeq}`);
  if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) errs.push("bad date");
  if (typeof e.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)) errs.push("bad time");
  for (const k of ["asked", "why"] as const)
    if (typeof e[k] !== "string" || (e[k] as string).trim().length < 8 || (e[k] as string).length > 400) errs.push(`${k} must be 8..400 chars`);
  if (typeof e.changed !== "string") errs.push("changed must be a string");
  else if (!/^none \(.{4,120}\)$/.test(e.changed) && !e.changed.split(", ").every((r) => REF.test(r)))
    errs.push("changed must be repo@sha / PeaceAI-Workspace#PR refs or 'none (reason)'");
  const approved = (APPROVED_SKILLS as readonly string[]).includes(e.skill as string);
  const missing = (MISSING_SKILLS as readonly string[]).includes(e.skill as string);
  if (!approved && !missing) errs.push(`unknown skill ${String(e.skill)}`);
  const want = approved ? "PeaceAI-able today" : `missing skill ${String(e.skill)}`;
  if (e.mark !== want) errs.push(`mark must be "${want}"`);
  if (e.by !== "Builder" && e.by !== "PeaceAI") errs.push("by must be Builder or PeaceAI");
  if (e.by === "PeaceAI" && !approved) errs.push("a PeaceAI-authored entry must use an approved skill");
  const text = JSON.stringify(raw);
  for (const [re, what] of FORBIDDEN) if (re.test(text)) errs.push(what);
  return errs;
}

export function validateLog(text: string): string[] {
  if (text.length > 0 && !text.endsWith("\n")) return ["file must end with a newline"];
  const errs: string[] = [];
  const lines = text.split("\n").slice(0, -1);
  lines.forEach((line, i) => {
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      errs.push(`line ${i + 1}: not JSON`);
      return;
    }
    if (JSON.stringify(v) !== line) errs.push(`line ${i + 1}: not canonical JSON (one compact object per line)`);
    for (const e of validateEntry(v, i + 1)) errs.push(`line ${i + 1}: ${e}`);
  });
  return errs;
}

/** Append-only: the base file must be a byte prefix of the head file. */
export function appendOnly(base: string, head: string): string[] {
  if (head.startsWith(base)) return [];
  const b = base.split("\n");
  const h = head.split("\n");
  const i = b.findIndex((l, n) => l !== h[n]);
  return [`existing line ${i + 1} was modified or removed (log is append-only)`];
}

function baseText(rev: string): string {
  try {
    return execFileSync("git", ["show", `${rev}:${LOG_PATH}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // No log at base (first PR). Confirm the revision itself exists, so a bad ref fails closed.
    execFileSync("git", ["cat-file", "-e", `${rev}^{commit}`]);
    return "";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const head = readFileSync(LOG_PATH, "utf8");
  const errs = validateLog(head);
  const i = process.argv.indexOf("--base");
  if (i > 0) errs.push(...appendOnly(baseText(process.argv[i + 1]!), head));
  if (errs.length) {
    for (const e of errs) console.error(`builder-log: ${e}`);
    process.exit(1);
  }
  console.log(`builder-log: ${head.split("\n").length - 1} entries OK${i > 0 ? " (append-only vs base)" : ""}`);
}
