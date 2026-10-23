// M100: merge derive-practice shard reports (peaceai/bin/derive-practice.ts --out) into wrong-pick KINDS
// (peaceai/lib/derive-practice-kinds.ts), write a small JSON artifact and a Markdown summary. Exit 1 only when a
// NEW blocking kind (not in the derive mistakes ledger, not the known limit) was found.
// Usage: tsx peaceai/bin/derive-practice-kinds.ts --out kinds.json [--summary summary.md] [--seed N] report1.json report2.json ...
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { kindsOf, KINDS_SCHEMA, type LedgerLike } from "../lib/derive-practice-kinds.ts";

const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const out = opt("out") ?? "derive-practice-kinds.json", summary = opt("summary"), ledgerPath = opt("ledger") ?? new URL("../test/m99-derive-mistakes.json", import.meta.url).pathname;
const files = argv.filter((a, k) => !a.startsWith("--") && !argv[k - 1]?.startsWith("--"));
type Report = { seed: number; engine: string; family?: string; totals: Record<string, number>; categories: Record<string, unknown>; wrongAccepted: (LedgerLike & Record<string, unknown>)[]; knownLimitWrong: (LedgerLike & Record<string, unknown>)[] };
const reports = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as Report);
if (!reports.length) { console.error("no reports"); process.exit(2); }
const ledger = (JSON.parse(readFileSync(ledgerPath, "utf8")) as { entries: LedgerLike[] }).entries;
const totals: Record<string, number> = {};
for (const r of reports) for (const [k, v] of Object.entries(r.totals)) totals[k] = (totals[k] ?? 0) + v;
const blocking = kindsOf(reports.flatMap((r) => r.wrongAccepted), ledger, true);
const knownLimit = kindsOf(reports.flatMap((r) => r.knownLimitWrong), ledger, false);
const newBlocking = blocking.filter((k) => k.isNew);
const seeds = [...new Set(reports.map((r) => r.seed))], engines = [...new Set(reports.map((r) => r.engine))], families = [...new Set(reports.map((r) => r.family ?? "all"))];
const art = { schema: KINDS_SCHEMA, seeds, engines, families, shards: reports.length, totals, blockingKinds: blocking.length, newBlockingKinds: newBlocking.length, kinds: blocking, knownLimitKinds: knownLimit };
writeFileSync(out, JSON.stringify(art, null, 1) + "\n");
const md = [
  `### derive practice: seed ${seeds.join(", ")} (family ${families.join(", ")}, engine ${engines.join(", ")})`,
  `Reproduce: \`tsx peaceai/bin/derive-practice.ts --seed ${seeds[0]} --count <total> --family ${families[0]} --budget 100000\``,
  "",
  `${totals.tasks ?? 0} tasks in ${reports.length} shards: ${totals.right ?? 0} right, ${totals.refused ?? 0} refused, ${totals.wrongBlocking ?? 0} wrong accepted (blocking), ${totals.wrongKnownLimit ?? 0} known-limit wrong, ${totals.unsafe ?? 0} unsafe.`,
  `**${blocking.length} blocking wrong kinds, ${newBlocking.length} NEW** (not in the mistakes ledger).`,
  "",
  "| kind | count | ledger | smallest representative |",
  "|---|---:|---|---|",
  ...blocking.map((k) => `| \`${k.kind.replace(/\|/g, "\\|")}\` | ${k.count} | ${k.isNew ? "**NEW**" : k.knownAs} | \`${String(k.representative.wrongProgram).replace(/\|/g, "\\|")}\` (${k.representative.examples.length} examples) |`),
  ...(knownLimit.length ? ["", `Known limit (not failing): ${knownLimit.map((k) => `\`${k.kind}\` x${k.count}`).join(", ")}`] : []),
  "",
].join("\n");
if (summary) appendFileSync(summary, md);
console.log(`${totals.tasks ?? 0} tasks; ${blocking.length} blocking kinds, ${newBlocking.length} NEW; artifact ${out}`);
process.exit(newBlocking.length ? 1 : 0);
