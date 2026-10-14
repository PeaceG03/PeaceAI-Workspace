// M33: regenerates peaceai/model/heldout-c.json (set C) from the PUBLIC clones by the committed rule (lib/heldout.ts).
// Usage: heldout-select-c.ts <dir with PeaceAI-Workspace/ and PeaceSTOCKS/ clones> [--write]. Prints counts only.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { agentMade, buildHeldOutC, builderLogRefs, HELDOUT_AUTHOR, HELDOUT_C_HEADS, isSourceTest, sha256Hex, type HeldOutCEntry } from "../lib/heldout.ts";

export function selectHeldOutC(clones: string): HeldOutCEntry[] {
  const ab = JSON.parse(readFileSync(resolve(import.meta.dirname, "../model/heldout.json"), "utf8"));
  const inAB = new Set<string>([...ab.sets.A, ...ab.sets.B].map((e: { repo: string; sha: string }) => `${e.repo}@${e.sha}`));
  const ws = join(clones, "PeaceAI-Workspace");
  const refs = builderLogRefs(execFileSync("git", ["-C", ws, "show", `${HELDOUT_C_HEADS["PeaceG03/PeaceAI-Workspace"]}:builder-log/tasks.jsonl`], { maxBuffer: 1 << 26 }).toString("utf8"));
  const out: HeldOutCEntry[] = [];
  for (const [repo, head] of Object.entries(HELDOUT_C_HEADS)) {
    const dir = join(clones, repo.split("/")[1]!);
    const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
    const gs = (...a: string[]) => git(...a).toString("utf8").trim();
    if (!/github\.com[/:]PeaceG03\//.test(gs("remote", "get-url", "origin"))) throw new Error(`${dir}: not a public PeaceG03 clone`);
    for (const sha of gs("rev-list", "--no-merges", `--author=${HELDOUT_AUTHOR}`, head).split("\n").filter(Boolean)) {
      if (inAB.has(`${repo}@${sha}`)) continue;
      const [at, subject] = gs("show", "-s", "--format=%cI%x00%s", sha).split("\0") as [string, string];
      if (agentMade(repo, sha, at, subject, refs)) continue;
      const ns = gs("show", "--name-status", "--format=", "--no-renames", sha).split("\n").filter(Boolean);
      if (!isSourceTest(ns)) continue;
      const paths = ns.map((l) => l.split("\t")[1]!).sort();
      const hashes = new Set<string>();
      for (const rev of [sha, `${sha}^`, head]) for (const p of paths) {
        try { hashes.add(sha256Hex(git("show", `${rev}:${p}`))); } catch { /* absent at that revision */ }
      }
      out.push({ repo, sha, kind: "source+test", paths, contentSha256: [...hashes].sort() });
    }
  }
  return out;
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const [clones, flag, fixedAtArg] = process.argv.slice(2);
  if (!clones) throw new Error("usage: heldout-select-c.ts <clones dir> [--write <fixedAt>]");
  const file = resolve(import.meta.dirname, "../model/heldout-c.json");
  let fixedAt = fixedAtArg;
  if (!fixedAt) fixedAt = JSON.parse(readFileSync(file, "utf8")).fixedAt as string;
  const c = buildHeldOutC(selectHeldOutC(resolve(clones)), fixedAt);
  console.log(`held-out C commits=${c.sets.C.length} hashes=${new Set(c.sets.C.flatMap((e) => e.contentSha256)).size}`);
  if (flag === "--write") writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
}
