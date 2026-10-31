// M157-M161 shared helpers: the tiny corpus, train.py runner and the guard mutation check (each tagged guard in
// lbtrain.py / daily_cycle.py has one case in m157-lbtrain-cases.py; disabling the guard must change its outcome).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const repo = resolve(import.meta.dirname, "..", "..");
export const py = process.env.PEACEAI_PYTHON ?? "python3";
export const MODEL = join(repo, "peaceai/model");
export const TRAIN = join(MODEL, "train.py");
export const CASES = join(repo, "peaceai/test/m157-lbtrain-cases.py");
export const TINY = ["--d-model", "16", "--n-layer", "1", "--n-head", "2", "--ctx", "32", "--vocab", "300", "--batch", "2", "--threads", "1", "--eval-every", "2"];
export const GUARDED = ["lbtrain.py", "daily_cycle.py"];

export function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "m157-"));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** 80 small TypeScript docs with an lb-clean style difficulty.score (more branches = harder); every 10th is heldout. */
/** opts.bigHeld (batch 6): 80 extra held-out docs after the usual 80, so a ctx-32 run has at least the 113 held-out
 *  windows that --val-split disjoint needs (export's 96 eval windows, a one-window gap, then the val windows). */
export function tinyCorpus(dir: string, opts: { difficulty?: boolean; name?: string; bigHeld?: boolean } = {}) {
  const c = join(dir, opts.name ?? "corpus");
  mkdirSync(c, { recursive: true });
  const docs: string[] = [], man: string[] = [];
  for (let i = 0; i < (opts.bigHeld ? 160 : 80); i += 1) {
    const n = 1 + ((i * 7) % 6);
    const body = Array.from({ length: n }, (_, j) => `  if (x > ${j}) { x = x - ${j}; }\n`).join("");
    const text = `export function f${i}(x: number): number {\n${body}  return x + ${i};\n}\n`;
    docs.push(JSON.stringify({ doc: i, text }));
    man.push(JSON.stringify({ doc: i, split: i % 10 === 3 || i >= 80 ? "heldout" : "train", ...(opts.difficulty === false ? {} : { difficulty: { score: n * 10, level: "easy" } }) }));
  }
  writeFileSync(join(c, "docs.jsonl"), docs.join("\n") + "\n");
  writeFileSync(join(c, "manifest.jsonl"), man.join("\n") + "\n");
  writeFileSync(join(c, "fingerprint.json"), JSON.stringify({ fingerprint: "e".repeat(64) }) + "\n");
  return c;
}

export const train = (args: string[], script = TRAIN) => spawnSync(py, [script, ...TINY, ...args], { encoding: "utf8" });
export const ok = (args: string[]) => { const r = train(args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
export function refused(args: string[], code: string) {
  const r = train(args);
  assert.notEqual(r.status, 0, `expected ${code}, got success`);
  assert.equal(r.stderr.trim().split("\n").pop(), code, `stderr ends with exactly the code: ${r.stderr}`);
}
export const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
export const stateHash = (file: string) => execFileSync(py, ["-c", `import numpy as np,hashlib,sys;z=np.load(sys.argv[1]);print(hashlib.sha256(b"".join(k.encode()+z[k].tobytes() for k in sorted(z.files) if k!="meta")).hexdigest())`, file], { encoding: "utf8" }).trim();
export const losses = (work: string) => readFileSync(join(work, "metrics.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.loss !== undefined).map((r) => [r.step, r.loss, r.grad_norm]);
export const runCase = (dir: string, name: string) => execFileSync(py, [CASES, dir, name], { encoding: "utf8" }).trim();

export function guards(prefix: RegExp) {
  const out: { file: string; name: string }[] = [];
  for (const file of GUARDED) for (const g of readFileSync(join(MODEL, file), "utf8").matchAll(/# guard:([a-z0-9-]+)$/gm)) if (prefix.test(g[1]!)) out.push({ file, name: g[1]! });
  return out;
}

/** Disable each guard matching prefix (its `if ...:` becomes `if False:`) in a copy of the model dir; its case must change. */
export function mutationCheck(prefix: RegExp, expectReal: Record<string, string | RegExp>) {
  const gs = guards(prefix);
  assert.deepEqual(gs.map((g) => g.name).sort(), Object.keys(expectReal).sort(), "every tagged guard has a case and no case is untagged");
  withDir((dir) => {
    for (const g of gs) {
      const m = join(dir, g.name);
      mkdirSync(m);
      for (const f of readdirSync(MODEL).filter((x) => x.endsWith(".py") || x.endsWith(".json"))) copyFileSync(join(MODEL, f), join(m, f));
      const real = runCase(MODEL, g.name);
      const want = expectReal[g.name]!;
      if (typeof want === "string") assert.equal(real, want, `real outcome of ${g.name}`); else assert.match(real, want, `real outcome of ${g.name}`);
      const lines = readFileSync(join(m, g.file), "utf8").split("\n");
      const i = lines.findIndex((l) => l.endsWith(`# guard:${g.name}`));
      assert.match(lines[i]!, /^\s+if .+:  # guard:/, `${g.name} is an if-guard`);
      lines[i] = lines[i]!.replace(/if .+:  # guard:/, "if False:  # guard:");
      writeFileSync(join(m, g.file), lines.join("\n"));
      const mutated = runCase(m, g.name);
      assert.notEqual(mutated, real, `guard ${g.name}: disabling it must change "${real}"`);
    }
  });
}

/** A copy of peaceai/model (+ bin/lb-daily-cycle.sh) under dir/name with exact text edits (each `from` must occur
 * exactly once in its file): the mutants for logic outside the tagged if-guards (train.py's stop.json wrapper, its
 * resume checks, lb-daily-cycle.sh). Returns the copy's root; its train.py is root/model/train.py. */
export function textMutant(dir: string, name: string, edits: { file: string; from: string; to: string }[]) {
  const root = join(dir, name);
  mkdirSync(join(root, "model"), { recursive: true }); mkdirSync(join(root, "bin"), { recursive: true });
  for (const f of readdirSync(MODEL).filter((x) => x.endsWith(".py") || x.endsWith(".json"))) copyFileSync(join(MODEL, f), join(root, "model", f));
  copyFileSync(join(repo, "peaceai/bin/lb-daily-cycle.sh"), join(root, "bin/lb-daily-cycle.sh"));
  for (const e of edits) applyEdit(join(root, e.file), e.from, e.to);
  return root;
}

export function applyEdit(path: string, from: string, to: string) {
  assert.ok(existsSync(path), path);
  const src = readFileSync(path, "utf8");
  assert.equal(src.split(from).length, 2, `mutant anchor occurs exactly once in ${path}: ${from}`);
  writeFileSync(path, src.replace(from, to));
}

/** stop.json of a work dir (or null). */
export const stopOf = (work: string) => (existsSync(join(work, "stop.json")) ? JSON.parse(readFileSync(join(work, "stop.json"), "utf8")) : null);
