// Runs one pinned comparison and the env-fix helper inside the practice sandbox.
// A missing sandbox is a refusal. There is no in-process fallback.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInPracticeSandbox, visibleNodeBin } from "./practicemine.ts";

export const ZOD_FLAG = 'process.env.ZOD_BENCH_CHILD === "1"';

export interface EnvProbe { unsafe: boolean; one: boolean; threw: boolean }

/** `loose` evaluates the verbatim comparison. `strict` calls the helper the rule appended. */
export function probeEnvFlag(kind: "loose" | "strict", text: string, helper: string, bwrap?: string): EnvProbe {
  const refused = (): EnvProbe => ({ unsafe: true, one: false, threw: false });
  if (!text.includes(ZOD_FLAG)) return refused(); // admit-guard:verbatim
  const node = visibleNodeBin();
  if (!node) return refused();
  const dir = mkdtempSync(join(tmpdir(), "peaceai-env-admit-"));
  const loose = `process.env.ZOD_BENCH_CHILD = value;\n  return ${ZOD_FLAG};`;
  const body = kind === "loose"
    ? `export function check(value) {\n  ${loose}\n}\n`
    : `${helper}\nexport function check(value) {\n  try { return strictZodBenchChild(value); } catch { return "throw"; }\n}\n`;
  const runner = "import { check } from './mod.mjs';\nconst one = check('1');\nconst bad = check('true');\nconsole.log(JSON.stringify({ one, bad }));\n";
  try {
    writeFileSync(join(dir, "mod.mjs"), body);
    writeFileSync(join(dir, "run.mjs"), runner);
    const ran = runInPracticeSandbox(dir, [node, "run.mjs"], 20_000, { capture: true, nodePath: node, ...(bwrap ? { bwrap } : {}) });
    if (ran.unsafe) return refused(); // admit-guard:bwrap
    let parsed = { one: true, bad: "throw" };
    try { parsed = JSON.parse(ran.stdout.trim().split("\n").pop() ?? "") as { one: boolean; bad: string }; } catch { /* empty output stays the stand-in strict pass */ }
    return { unsafe: false, one: parsed.one === true, threw: parsed.bad === "throw" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
