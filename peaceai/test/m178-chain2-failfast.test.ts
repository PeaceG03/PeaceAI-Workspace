// Batch 17 (steer b): peaceai/bin/lb-chain2-run.sh fails fast. Under `set -euo pipefail`, a failed heldout_v2 evaluation
// exits 4 with LB_C2_EVAL_V2_FAILED as the last line, so the workflow's later steps (the R2 save copy, the row, the
// Results row) do not run for a day whose row could not be built anyway (the row needs eval-v2.json). The real script
// runs against stand-ins: PY dispatches on the script name, and a stand-in lb-daily-cycle.sh plays the trained day.
// Mutants (the old `|| echo`, exit 0, no -e line) must each fail a check here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SRC = readFileSync(resolve(import.meta.dirname, "../bin/lb-chain2-run.sh"), "utf8");
const FAKE_PY = `#!/usr/bin/env bash
case "$(basename "$1")" in
  lb_chain2.py) printf '30\\nfresh\\n--steps\\n4\\n' ;;
  eval_v2.py) echo eval >> "$FAKE_LOG"; exit "\${FAKE_EVAL_RC:-0}" ;;
  *) exit 9 ;;
esac
`;
const FAKE_CYCLE = `#!/usr/bin/env bash
echo "cycle $*" >> "$FAKE_LOG"
mkdir -p "$2/logs"
[ "\${FAKE_TRAINED:-1}" = 1 ] && mkdir -p "$2/work/$4/model" && echo '{}' > "$2/work/$4/model/eval.json"
exit "\${FAKE_CYCLE_RC:-0}"
`;

type R = { status: number | null; last: string; log: string };
function runDay(src: string, env: Record<string, string> = {}): R {
  const d = mkdtempSync(join(tmpdir(), "m178-c2ff-"));
  try {
    for (const p of ["bin", "model", "S", "C", "W"]) mkdirSync(join(d, p));
    const w = (p: string, t: string) => { writeFileSync(join(d, p), t); chmodSync(join(d, p), 0o755); };
    w("bin/lb-chain2-run.sh", src); w("bin/lb-daily-cycle.sh", FAKE_CYCLE); w("py", FAKE_PY);
    writeFileSync(join(d, "T.json"), "{}");
    const r = spawnSync("bash", [join(d, "bin/lb-chain2-run.sh"), join(d, "C"), join(d, "S"), join(d, "T.json"), "a".repeat(64), join(d, "W")], {
      encoding: "utf8",
      env: { PATH: process.env.PATH!, PY: join(d, "py"), LB_MODEL_DIR: join(d, "model"), LB_TODAY: "2026-11-03", LB_JOB_START: "1", FAKE_LOG: join(d, "log"), ...env },
    });
    const log = existsSync(join(d, "log")) ? readFileSync(join(d, "log"), "utf8") : "";
    return { status: r.status, last: (r.stdout.trim().split("\n").pop() ?? ""), log };
  } finally { rmSync(d, { recursive: true, force: true }); }
}
function checks(src: string): string[] {
  const bad: string[] = [];
  if (!/^set -euo pipefail$/m.test(src)) bad.push("set -euo pipefail");
  const ok = runDay(src);
  if (ok.status !== 0 || !/eval/.test(ok.log)) bad.push(`trained day, eval ok: ${ok.status}`);
  const fail = runDay(src, { FAKE_EVAL_RC: "1" });
  if (fail.status !== 4 || fail.last !== "LB_C2_EVAL_V2_FAILED") bad.push(`eval fails: ${fail.status} ${fail.last}`);
  const untrained = runDay(src, { FAKE_TRAINED: "0", FAKE_EVAL_RC: "1" });
  if (untrained.status !== 0 || /eval/.test(untrained.log)) bad.push(`no eval.json: ${untrained.status}`); // near miss: no eval, no failure
  const cyc = runDay(src, { FAKE_CYCLE_RC: "3" });
  if (cyc.status !== 3 || /eval/.test(cyc.log)) bad.push(`cycle fails: ${cyc.status}`); // the cycle's own code, unchanged
  return bad;
}

test("lb-chain2-run.sh: set -euo pipefail; a failed heldout_v2 eval exits 4 (LB_C2_EVAL_V2_FAILED); ok / untrained / cycle-failure days unchanged", () => {
  assert.deepEqual(checks(SRC), []);
});

test("lb-chain2-run.sh fail-fast mutants each fail a check", () => {
  const sub = (a: string, b: string) => { assert.ok(SRC.includes(a), a); return SRC.replace(a, b); };
  const MUT: [string, string][] = [
    ["old swallow", sub(`|| { echo "LB_C2_EVAL_V2_FAILED"; exit 4; }`, `|| echo "LB_C2_EVAL_V2_FAILED"`)],
    ["exit 0", sub(`echo "LB_C2_EVAL_V2_FAILED"; exit 4;`, `echo "LB_C2_EVAL_V2_FAILED"; exit 0;`)],
    ["no -e", sub("set -euo pipefail\n", "set -uo pipefail\n")],
    ["cycle code lost", sub(`[ "$rc" = 0 ] || exit "$rc"`, `[ "$rc" = 0 ] || exit 1`)],
  ];
  for (const [name, t] of MUT) assert.notDeepEqual(checks(t), [], name);
});
