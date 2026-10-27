// CI: peaceai/source-corrections.jsonl is valid and add-only against a base revision (like builder-log/check.ts).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { correctionsAddOnly, parseSourceCorrections, SOURCE_CORRECTIONS_FILE } from "../lib/sourcecorrections.ts";

const head = readFileSync(SOURCE_CORRECTIONS_FILE, "utf8");
const { corrections, errors } = parseSourceCorrections(head);
const i = process.argv.indexOf("--base");
if (i > 0) {
  const rev = process.argv[i + 1] ?? "";
  if (!/^[0-9a-f]{7,40}$/.test(rev)) errors.push("--base needs a commit sha");
  else {
    let base = "";
    try {
      base = execFileSync("git", ["show", `${rev}:${SOURCE_CORRECTIONS_FILE}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      execFileSync("git", ["cat-file", "-e", `${rev}^{commit}`]); // no file at base (first PR); the revision must exist
    }
    errors.push(...correctionsAddOnly(base, head));
  }
}
if (errors.length) {
  for (const e of errors) console.error(`source-corrections: ${e}`);
  process.exit(1);
}
console.log(`source-corrections: ${corrections.length} corrections OK${i > 0 ? "; add-only vs base" : ""}`);
