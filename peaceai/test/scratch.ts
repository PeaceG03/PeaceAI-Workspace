// Batch 10 (box hygiene): test scratch dirs that remove themselves. A test that made its dirs with
// mkdtempSync(join(tmpdir(), prefix)) and never removed them leaked one dir per case into /tmp on every run (the box ran
// out of inodes: about 5,100 leaked dirs, 368k inodes, mostly m42-, m49mc-, m6-, m49p-, m7-job-b-, m52-, m31l-).
// scratchDir makes the same dir and registers it; every registered dir (and any `<dir>.<ext>` file a tool wrote beside
// it, e.g. stage-chosen's `<dir>.diff`) is removed when the test process exits, pass or fail. Only paths this process
// made with mkdtemp are touched. A dir the stage-2 candidate uid wrote into (files it owns) may need root to remove:
// then `sudo -n rm -rf` is tried on that exact path, and a failure is ignored (cleanup never fails a test).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const made: string[] = [];
let hooked = false;

/** mkdtempSync(join(base, prefix)), removed when the process exits. */
export function scratchDir(prefix: string, base: string = tmpdir()): string {
  const dir = mkdtempSync(join(base, prefix));
  made.push(dir);
  if (!hooked) { hooked = true; process.on("exit", cleanupScratch); }
  return dir;
}

/** Removes every dir scratchDir made so far (and its `<dir>.<ext>` siblings). Safe to call more than once. */
export function cleanupScratch(): void {
  for (const dir of made.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* retried below */ }
    if (existsSync(dir)) spawnSync("sudo", ["-n", "rm", "-rf", "--", dir], { stdio: "ignore" });
    const name = basename(dir);
    let sibs: string[] = [];
    try { sibs = readdirSync(dirname(dir)).filter((e) => e.startsWith(`${name}.`)); } catch { sibs = []; }
    for (const s of sibs) { try { rmSync(join(dirname(dir), s), { recursive: true, force: true }); } catch { /* ignore */ } }
  }
}
