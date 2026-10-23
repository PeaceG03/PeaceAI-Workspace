// M100: print ledger-shaped entries (peaceai-derive-mistakes:v1) for the NEW kinds in a derive-practice-kinds
// artifact (the CI run's derive-practice-kinds.json), one per kind, ready to append to
// peaceai/test/m99-derive-mistakes.json in the PR that fixes them (add the `expected` block there).
// Usage: tsx peaceai/bin/derive-practice-dedup.ts derive-practice-kinds.json [--ledger path] > new-entries.json
import { readFileSync } from "node:fs";
import { kindsOf, ledgerEntriesForNew, type Kind, type LedgerLike } from "../lib/derive-practice-kinds.ts";

const argv = process.argv.slice(2);
const li = argv.indexOf("--ledger");
const ledgerPath = li >= 0 ? argv[li + 1]! : new URL("../test/m99-derive-mistakes.json", import.meta.url).pathname;
const file = argv.find((a, k) => !a.startsWith("--") && argv[k - 1] !== "--ledger");
if (!file) { console.error("usage: derive-practice-dedup.ts <kinds.json> [--ledger path]"); process.exit(2); }
const art = JSON.parse(readFileSync(file, "utf8")) as { kinds: Kind[] };
const ledger = (JSON.parse(readFileSync(ledgerPath, "utf8")) as { entries: LedgerLike[] }).entries;
// Re-checked against the ledger as it is now (a kind fixed since the run is no longer NEW); one representative per kind.
const fresh = kindsOf(art.kinds.flatMap((k) => Array.from({ length: k.count }, () => k.representative)), ledger, true);
for (const k of fresh) k.count = art.kinds.find((x) => x.kind === k.kind)?.count ?? k.count;
console.log(JSON.stringify({ schema: "peaceai-derive-mistakes:v1", entries: ledgerEntriesForNew(fresh) }, null, 1));
