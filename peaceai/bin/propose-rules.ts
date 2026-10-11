// M8: mine, then write learned-rule specs and proposal bodies. Run from the box by an agent; it never
// approves anything. Usage:
//   propose-rules.ts --public <Repo>=<dir>[@rev] ... --core <dir>[@rev] --out <dir> [--write]
// Public proposals: spec -> peaceai/rules/learned/<id>.json, body (links only, no code) -> <out>/public-<id>.md
// Core proposals:   spec -> <core>/packages/coding-kernel/learned-rules/<id>.json, body with private example
//                   hunks -> <out>/core-<id>.md (for a PRIVATE PeaceAI-Results issue only).
// Every public body must then pass the leak gate (core text + personal info) before it is posted.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tally, type Observation } from "../lib/mine.ts";
import { exampleHunk, mineRepo } from "../lib/minegit.ts";
import { mineTests, TEST_MINING_REPOS } from "../lib/minetest.ts";
import { specFileText } from "../lib/learned.ts";
import { proposalBody, proposeRules } from "../lib/propose.ts";

const args = process.argv.slice(2);
const pub: { name: string; dir: string; rev: string }[] = [];
let core: { dir: string; rev: string } | null = null;
let out = "";
let write = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--public") { const [name, rest] = args[++i]!.split("="); const [dir, rev = "HEAD"] = rest!.split("@"); pub.push({ name: name!, dir: dir!, rev }); }
  else if (a === "--core") { const [dir, rev = "HEAD"] = args[++i]!.split("@"); core = { dir: dir!, rev }; }
  else if (a === "--out") out = resolve(args[++i]!);
  else if (a === "--write") write = true;
}
if (!out) throw new Error("--out is required");
mkdirSync(out, { recursive: true });
const repoRoot = resolve(import.meta.dirname, "../..");

if (pub.length) {
  const obs: Observation[] = [];
  for (const p of pub) {
    obs.push(...mineRepo(p.dir, p.rev, p.name).observations);
    // M12: test cases are mined only from the allowed public repositories (checked by label and origin).
    if (TEST_MINING_REPOS[p.name]) {
      const t = mineTests(p.dir, p.rev, p.name);
      console.log(`tests ${p.name} commits=${t.commits} cases=${t.observations.length}`);
      obs.push(...t.observations);
    } else console.log(`tests ${p.name} skipped (not an allowed public repository for test mining)`);
  }
  const stats = tally(obs);
  const { proposals, skipped } = proposeRules(stats, "public", pub.map((p) => `PeaceG03/${p.name}`));
  console.log(`public observations=${obs.length} proposals=${proposals.length} skipped=${skipped.map((s) => `${s.shape}:${s.why}`).join(",")}`);
  for (const p of proposals) {
    const links = p.stats.examples.map((e) => {
      const [repo, sha] = e.commit.split("@");
      return { label: `${repo}@${sha} ${e.path}:${e.line}`, url: `https://github.com/PeaceG03/${repo}/commit/${sha}` };
    });
    writeFileSync(join(out, `public-${p.spec.id}.md`), proposalBody(p, links) + "\n");
    if (write) {
      mkdirSync(join(repoRoot, "peaceai/rules/learned"), { recursive: true });
      writeFileSync(join(repoRoot, "peaceai/rules/learned", `${p.spec.id}.json`), specFileText(p.spec));
    }
    console.log(`public ${p.spec.id} sha256=${p.sha256} hunks=${p.stats.hunks} commits=${p.stats.commits} files=${p.stats.files}`);
  }
}
if (core) {
  const { observations } = mineRepo(core.dir, core.rev, "PeaceAI");
  const stats = tally(observations);
  const { proposals, skipped } = proposeRules(stats, "core", ["PeaceG03/PeaceAI"]);
  console.log(`core observations=${observations.length} proposals=${proposals.length} skipped=${skipped.map((s) => `${s.shape}:${s.why}`).join(",")}`);
  for (const p of proposals) {
    const examples = p.stats.examples.map((e) => exampleHunk(core!.dir, e.commit.split("@")[1]!, e.path, e.line));
    writeFileSync(join(out, `core-${p.spec.id}.md`), proposalBody(p, [], examples) + "\n");
    if (write) {
      const dir = join(core.dir, "packages/coding-kernel/learned-rules");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${p.spec.id}.json`), specFileText(p.spec));
    }
    console.log(`core ${p.spec.id} sha256=${p.sha256} hunks=${p.stats.hunks} commits=${p.stats.commits} files=${p.stats.files}`);
  }
}
