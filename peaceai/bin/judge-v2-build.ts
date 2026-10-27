// Judge set v2 builder (peaceai/lib/judge-grid.ts): re-labels the v1 judge items on wider held-out grids built from
// each upstream function's own behaviour, and drops items whose grid cannot show that returning a parameter is wrong.
//   tsx peaceai/bin/judge-v2-build.ts --items <v1 items.json> --sources peaceai/model/judge-v2-sources.json \
//       --repos <dir>[,<dir>...] --out <dir>
// <dir>/<owner>__<repo> is a clone holding the pinned head (sources.items[].head). Writes <out>/items.json (kept
// items: v1 text unchanged, new label and counts, v1 label kept as labelV1) and <out>/build.json (counts, every drop
// with its reason, items sha256). Prints counts only (no item text). Fails closed on any v1 / sources mismatch.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exprRunner, functionText, paramsOfContext, rebuildItem, runner } from "../lib/judge-grid.ts";

export const SOURCES_SCHEMA = "peaceai-judge-v2-sources:v1";
export const ITEMS_SCHEMA_NOTE = "judge v2: v1 items re-labelled on wider held-out grids (peaceai/lib/judge-grid.ts)";

interface V1Item { key: string; repo: string; file: string; fn: string; ret: string; label: "right" | "wrong"; heldRight: number; heldWrong: number; expr: string; context: string; derived: string; reference: string; [k: string]: unknown }
interface Sources { schema: string; v1: { items: string; itemsSha256: string; count: number }; items: { key: string; head: string; described: number[] }[] }

const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

export function build(itemsText: string, sources: Sources, repoRoots: readonly string[]) {
  if (sources.schema !== SOURCES_SCHEMA) throw new Error("sources: wrong schema");
  if (sha256(itemsText) !== sources.v1.itemsSha256) throw new Error("v1 items sha256 differs from the sources pin");
  const v1 = JSON.parse(itemsText) as V1Item[];
  if (v1.length !== sources.v1.count || sources.items.length !== v1.length || v1.some((it, i) => sources.items[i]!.key !== it.key)) throw new Error("v1 items and sources do not line up");
  const kept: Record<string, unknown>[] = [];
  const drops: { key: string; reason: string; detail: string; v1Label: string; identity: boolean }[] = [];
  for (const [i, it] of v1.entries()) {
    const src = sources.items[i]!;
    if (!/^[0-9a-f]{40}$/.test(src.head)) throw new Error(`${it.key}: bad head`);
    const sig = paramsOfContext(it.context);
    const identity = !!sig && sig.params.some((p) => p.name === it.expr.trim());
    const drop = (reason: string, detail: string) => drops.push({ key: it.key, reason, detail, v1Label: it.label, identity });
    if (!sig || sig.fn !== it.fn || sig.ret !== it.ret) { drop("context_unparsed", "the v1 context line is not a plain typed signature"); continue; }
    const dir = repoRoots.map((r) => join(r, it.repo.replace("/", "__"))).find((d) => existsSync(d));
    let text: string | null = null;
    if (dir) { try { text = functionText(execFileSync("git", ["-C", dir, "show", `${src.head}:${it.file}`], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }), it.file, it.fn); } catch { text = null; } }
    if (!text) { drop("upstream_not_reproduced", "the upstream function was not found at the pinned head"); continue; }
    const r = rebuildItem(sig, src.described, text, { heldRight: it.heldRight, heldWrong: it.heldWrong }, runner(text, it.fn), exprRunner(it.expr, sig.params));
    if (!r.kept) { drop(r.reason, r.detail); continue; }
    kept.push({ ...it, label: r.label, heldRight: r.heldRight, heldWrong: r.heldWrong, labelV1: it.label, heldRightV1: it.heldRight, heldWrongV1: it.heldWrong, heldV2: r.held, skippedV2: r.skipped, identityWitnesses: r.identityWitnesses });
  }
  const itemsOut = JSON.stringify(kept, null, 1) + "\n";
  const c = (f: (x: Record<string, unknown>) => boolean) => kept.filter(f).length;
  const reasons: Record<string, number> = {};
  for (const d of drops) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
  const summary = {
    v1: { n: v1.length, right: v1.filter((x) => x.label === "right").length, wrong: v1.filter((x) => x.label === "wrong").length },
    v2: { n: kept.length, right: c((x) => x.label === "right"), wrong: c((x) => x.label === "wrong") },
    relabelled: { rightToWrong: c((x) => x.labelV1 === "right" && x.label === "wrong"), wrongToRight: c((x) => x.labelV1 === "wrong" && x.label === "right") },
    dropped: { n: drops.length, reasons, identityIndistinguishable: drops.filter((d) => d.reason === "identity_indistinguishable").length, identityIndistinguishableWithIdentityProgram: drops.filter((d) => d.reason === "identity_indistinguishable" && d.identity).length },
  };
  return { itemsOut, build: { note: ITEMS_SCHEMA_NOTE, v1: sources.v1, itemsSha256: sha256(itemsOut), summary, drops }, summary };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); if (i < 0 || !process.argv[i + 1]) { console.error(`missing ${k}`); process.exit(2); } return process.argv[i + 1]!; };
  const out = arg("--out");
  const r = build(readFileSync(arg("--items"), "utf8"), JSON.parse(readFileSync(arg("--sources"), "utf8")) as Sources, arg("--repos").split(","));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "items.json"), r.itemsOut);
  writeFileSync(join(out, "build.json"), JSON.stringify(r.build, null, 1) + "\n");
  console.log(`judge-v2 ${JSON.stringify(r.summary)} items_sha256=${r.build.itemsSha256}`);
}
