// M8: mine edit shapes from a repository's commits. Usage: mine-rules.ts <repo dir> [rev] [--json out]
// Reads git history locally (read-only). Prints the frequency table; never prints code.
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { tally } from "../lib/mine.ts";
import { mineRepo } from "../lib/minegit.ts";

const [repo, rev = "HEAD", flag, out] = process.argv.slice(2);
if (!repo) throw new Error("usage: mine-rules.ts <repo> [rev] [--json out]");
const { commits, observations } = mineRepo(repo, rev, basename(repo));
const stats = tally(observations);
console.log(`commits=${commits} observations=${observations.length}`);
for (const s of stats) console.log(`${s.shape.padEnd(18)} hunks=${String(s.hunks).padStart(4)} commits=${String(s.commits).padStart(4)} files=${String(s.files).padStart(4)} ${s.covered ? `covered:${s.covered}` : "UNCOVERED"}`);
if (flag === "--json" && out) writeFileSync(out, JSON.stringify({ commits, stats }, null, 2) + "\n");
