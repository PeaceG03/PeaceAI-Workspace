// M18 verdict job (patch route): is the task base still the target's head? If not, write the regrade
// request comment (lib/regrade.ts) instead of building a patch on the old base. Fails closed.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanText } from "../lib/leak.ts";
import { regradeComment, validChosenMeta } from "../lib/regrade.ts";
import { isRepoName } from "../lib/target.ts";

const out = (pairs: Record<string, string>) => {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  console.log(lines.join(" "));
};
const target = process.env.TARGET ?? "";
const base = process.env.BASE_SHA ?? "";
const dir = process.env.CHOSEN_DIR ?? "";
if (!isRepoName(target) || !/^[0-9a-f]{40}$/.test(base)) { out({ stale: "error", reason: "bad-inputs" }); process.exit(0); }
const ls = spawnSync("git", ["ls-remote", `https://github.com/${target}.git`, "HEAD"], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const head = /^([0-9a-f]{40})\tHEAD$/m.exec(ls.stdout ?? "")?.[1] ?? "";
if (ls.status !== 0 || !head) { out({ stale: "error", reason: "head-unknown" }); process.exit(0); }
if (head === base) { out({ stale: "false", head }); process.exit(0); }
const metaFile = join(dir, "chosen.json");
const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : null;
if (!validChosenMeta(meta) || meta.baseSha !== base) { out({ stale: "true", head, ok: "false", reason: "chosen-meta-missing" }); process.exit(0); }
const body = regradeComment(meta, head, readFileSync(join(dir, "chosen.diff"), "utf8"));
if (!body) { out({ stale: "true", head, ok: "false", reason: "regrade-request-too-large" }); process.exit(0); }
if (scanText(body).length > 0) { out({ stale: "true", head, ok: "false", reason: "personal-info-in-regrade-request" }); process.exit(0); }
writeFileSync(process.env.BODY_FILE ?? "", body);
out({ stale: "true", head, ok: "true" });
