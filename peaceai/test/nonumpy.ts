// numpy blocked for the stdlib-only Python entry points (#657): CI's tests job has no numpy, the box does, so a stray
// numpy import in a path the workflows run with the runner's system python3 (or in the chain decision) passed on the
// box and failed in CI. These helpers make every test of those paths run with numpy unimportable, on any machine.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The stdlib-only entry points: nothing they run may import numpy. */
export const STDLIB_ONLY = ["saves.py", "lb_run.py", "lb_daily.py", "daily_cycle.py"] as const;

const root = mkdtempSync(join(tmpdir(), "peaceai-nonumpy-"));
/** A PYTHONPATH dir whose numpy package raises ImportError on import. */
export const NONUMPY = join(root, "path");
mkdirSync(join(NONUMPY, "numpy"), { recursive: true });
writeFileSync(join(NONUMPY, "numpy/__init__.py"), 'raise ImportError("numpy blocked: stdlib-only entry point (#657)")\n');

/** Env for running a stdlib-only entry point with numpy blocked. */
export const noNumpyEnv = (base: NodeJS.ProcessEnv = process.env) =>
  ({ PYTHONPATH: base.PYTHONPATH ? `${NONUMPY}:${base.PYTHONPATH}` : NONUMPY });

/** A PEACEAI_PYTHON for the shell scripts: blocks numpy for the stdlib-only entry points, lets train.py/export.py have it. */
export function pyNoNumpyFor(py: string) {
  const f = join(root, `py-${Math.random().toString(36).slice(2)}`);
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  writeFileSync(f, `#!/usr/bin/env bash\ncase "$(basename -- "\${1:-}")" in\n  ${STDLIB_ONLY.join("|")}) PYTHONPATH=${q(NONUMPY)}\${PYTHONPATH:+:$PYTHONPATH} exec ${q(py)} "$@" ;;\nesac\nexec ${q(py)} "$@"\n`);
  chmodSync(f, 0o755);
  return f;
}
