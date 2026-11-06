// EXPERIMENTAL learn step 4: training pairs from DEV practice problems only. credit is always false.
// Not wired into training, upload, or workflows.
//
// The JSONL is the ft-pairs writer shape (peaceai/bin/ft-pairs.ts): docs.jsonl {doc,text} and
// manifest.jsonl {doc,split,repo,sha,path,function}. That writer is not exported from ftpairs.ts
// (it lives inline in the bin, which this change does not edit), so the lines are written here
// in that exact key order. Held-out problems are never emitted. Each kept pair is checked with
// leak.scanText and dedupe.editKey against the held-out diffs; flagged pairs are dropped and counted.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { editKey } from "./dedupe.ts";
import type { FtDoc } from "./ftpairs.ts";
import { scanText } from "./leak.ts";
import type { PracticeProblem, PracticeRun } from "./learnpractice.ts";

export const LEARN_PAIRS_SCHEMA = "peaceai-learn-pairs:v1" as const;

export interface PairBuild {
  schema: typeof LEARN_PAIRS_SCHEMA;
  experimental: true;
  credit: false;
  docs: FtDoc[];
  dropped: { leak: number; nearDuplicate: number };
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** A git diff parseDiff / editKey can read. The non-test edit is the whole function file. */
export function functionDiff(path: string, before: string, after: string): string {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const body = [...oldLines.map((l) => `-${l}`), ...newLines.map((l) => `+${l}`)].join("\n");
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n${body}\n`;
}

function pairText(p: PracticeProblem): string {
  return `// EXPERIMENTAL credit: false\n// peaceai-learn-pair:v1\n// input\n${p.broken}// failing test\n${p.test}// output\n${p.fixed ?? ""}`;
}

/**
 * DEV problems solved and verified by the real test. Held-out problems, and anything derived
 * from them, are not emitted. A DEV edit that matches a held-out edit, or a pair leak.scanText
 * flags, is dropped and counted.
 */
export function buildLearnPairs(run: PracticeRun, program: string): PairBuild {
  const held = run.problems.filter((p) => p.set === "heldout");
  const heldKeys = new Set(held.map((p) => editKey(functionDiff(p.sourcePath, p.broken, p.original))));
  const heldTests = held.map((p) => p.test).filter((t) => t.length > 0);
  const docs: FtDoc[] = [];
  const dropped = { leak: 0, nearDuplicate: 0 };
  const dev = run.problems.filter((p) => p.set === "dev" && p.solved && p.verified && p.fixed !== null).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const p of dev) {
    const text = pairText(p);
    if (scanText(text).length > 0) { dropped.leak++; continue; }
    const key = editKey(functionDiff(p.sourcePath, p.broken, p.fixed ?? p.original));
    const originalKey = editKey(functionDiff(p.sourcePath, p.broken, p.original));
    if (heldKeys.has(key) || heldKeys.has(originalKey) || heldTests.some((t) => text.includes(t))) {
      dropped.nearDuplicate++;
      continue;
    }
    docs.push({
      repo: program,
      sha: sha256(p.fixed ?? ""),
      path: p.sourcePath,
      function: p.function,
      text,
      split: "train",
    });
  }
  return { schema: LEARN_PAIRS_SCHEMA, experimental: true, credit: false, docs, dropped };
}

/** Same lines as peaceai/bin/ft-pairs.ts `emit`. */
export function writeLearnPairs(dir: string, built: PairBuild): void {
  const docs: string[] = [];
  const man: string[] = [];
  built.docs.forEach((d, n) => {
    docs.push(JSON.stringify({ doc: n, text: d.text }));
    man.push(JSON.stringify({ doc: n, split: d.split, repo: d.repo, sha: d.sha, path: d.path, function: d.function }));
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "docs.jsonl"), docs.length ? `${docs.join("\n")}\n` : "");
  writeFileSync(join(dir, "manifest.jsonl"), man.length ? `${man.join("\n")}\n` : "");
  writeFileSync(join(dir, "meta.json"), `${JSON.stringify({ schema: built.schema, experimental: true, credit: false, dropped: built.dropped, docs: built.docs.length }, null, 2)}\n`);
}

export interface PairLine { doc: number; text: string; split: string; repo: string; sha: string; path: string; function: string }

/** Reads the ft-pairs JSONL back (docs.jsonl {doc,text} + manifest.jsonl), the way the builder parses it. */
export function readLearnPairs(dir: string): PairLine[] {
  const docs = new Map<number, string>();
  for (const line of readFileSync(join(dir, "docs.jsonl"), "utf8").split("\n")) {
    if (!line) continue;
    const d = JSON.parse(line) as { doc: number; text: string };
    docs.set(d.doc, d.text);
  }
  const out: PairLine[] = [];
  for (const line of readFileSync(join(dir, "manifest.jsonl"), "utf8").split("\n")) {
    if (!line) continue;
    const m = JSON.parse(line) as { doc: number; split: string; repo: string; sha: string; path: string; function: string };
    out.push({ doc: m.doc, text: docs.get(m.doc) ?? "", split: m.split, repo: m.repo, sha: m.sha, path: m.path, function: m.function });
  }
  return out;
}
