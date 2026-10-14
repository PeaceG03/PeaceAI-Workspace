// M28: regenerates peaceai/model/heldout.json from the PUBLIC clones by the committed rule (lib/heldout.ts).
// Usage: heldout-select.ts <dir with PeaceAI-Workspace/ and PeaceSTOCKS/ clones> [--write]
// Needs lib/minebody.ts (#136) for the expression-edit kind; refuses to run without it. Prints counts only.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildHeldOut, HELDOUT_AUTHOR, HELDOUT_HEADS, isTwoFile, kindOf, sha256Hex, type HeldOutEntry } from "../lib/heldout.ts";

export async function selectHeldOut(clones: string): Promise<HeldOutEntry[]> {
  const minebody = resolve(import.meta.dirname, "../lib/minebody.ts");
  if (!existsSync(minebody)) throw new Error("lib/minebody.ts (#136) is required for the expression-edit kind");
  const { mineBody } = (await import(minebody)) as { mineBody: (dir: string, rev: string, label: string) => { observations: { shape: string; commit: string }[] } };
  const out: HeldOutEntry[] = [];
  for (const [repo, head] of Object.entries(HELDOUT_HEADS)) {
    const dir = join(clones, repo.split("/")[1]!);
    const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
    const gs = (...a: string[]) => git(...a).toString("utf8").trim();
    if (!/github\.com[/:]PeaceG03\//.test(gs("remote", "get-url", "origin"))) throw new Error(`${dir}: not a public PeaceG03 clone`);
    const label = repo.split("/")[1]!;
    const expr = new Set(mineBody(dir, head, label).observations.filter((o) => o.shape === "EXPR_REPLACE").map((o) => o.commit.replace(/^[^@]*@/, "")));
    for (const sha of gs("rev-list", "--no-merges", `--author=${HELDOUT_AUTHOR}`, head).split("\n").filter(Boolean)) {
      const ns = gs("show", "--name-status", "--format=", "--no-renames", sha).split("\n").filter(Boolean);
      const kind = kindOf(isTwoFile(ns), [...expr].some((e) => sha.startsWith(e)));
      if (!kind) continue;
      const paths = ns.map((l) => l.split("\t")[1]!).sort();
      const hashes = new Set<string>();
      for (const rev of [sha, `${sha}^`, head]) for (const p of paths) {
        try { hashes.add(sha256Hex(git("show", `${rev}:${p}`))); } catch { /* absent at that revision */ }
      }
      out.push({ repo, sha, kind, paths, contentSha256: [...hashes].sort() });
    }
  }
  return out;
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const [clones, flag] = process.argv.slice(2);
  if (!clones) throw new Error("usage: heldout-select.ts <clones dir> [--write]");
  const file = resolve(import.meta.dirname, "../model/heldout.json");
  const fixedAt = JSON.parse(readFileSync(file, "utf8")).fixedAt as string;
  const h = buildHeldOut(await selectHeldOut(resolve(clones)), fixedAt);
  const all = [...h.sets.A, ...h.sets.B];
  const n = (k: string) => all.filter((e) => e.kind === k).length;
  console.log(`held-out commits=${all.length} two-file=${n("two-file")} expression-edit=${n("expression-edit")} both=${n("two-file+expression-edit")} A=${h.sets.A.length} B=${h.sets.B.length}`);
  if (flag === "--write") writeFileSync(file, JSON.stringify(h, null, 2) + "\n");
}
