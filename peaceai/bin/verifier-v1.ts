// VERIFIER-V1 CLI (M202, spec peaceai/spec/verifier-v1.md). EXPERIMENTAL, NOT DEFAULT, NOT FOR CREDIT.
//   tsx peaceai/bin/verifier-v1.ts <checkoutDir> --module <path> (--cases <jsonFile> | --from-test <testFile>) [--out dir]
// Runs data-only cases against <module> out-of-process as PEACEAI_STAGE2_CAND. Prints one summary line and writes
// result.json (forCredit: false) under --out. Never writes into the checkout. Never selected by the loop by default.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const usage = () => {
  console.log("usage: verifier-v1.ts <checkoutDir> --module <path> (--cases <jsonFile> | --from-test <testFile>) [--out dir]");
  process.exit(2);
};
const argv = process.argv.slice(2);
const dir = argv.shift();
if (!dir || dir.startsWith("--")) usage();
const opt: Record<string, string> = {};
while (argv.length) {
  const k = argv.shift()!, v = argv.shift();
  if (!["--module", "--cases", "--from-test", "--out"].includes(k) || v === undefined || k.slice(2) in opt) usage();
  opt[k.slice(2)] = v!;
}
if (!opt.module || !!opt.cases === !!opt["from-test"]) usage();

const { VERIFIER_VERSION, extractCasesFromSource, loadCaseFile, verify } = await import("../lib/verifier.ts");
const root = resolve(dir!);
const modulePath = opt.module;
let cases;
if (opt.cases) {
  const loaded = loadCaseFile(resolve(opt.cases));
  if (!loaded.ok) { console.log(`${VERIFIER_VERSION} refused ${loaded.code}${loaded.detail ? ` detail=${loaded.detail}` : ""}`); process.exit(1); }
  cases = loaded.cases;
} else {
  const text = readFileSync(resolve(root, opt["from-test"]!), "utf8");
  const ex = extractCasesFromSource(text, opt["from-test"]!);
  if (!ex.ok) { console.log(`${VERIFIER_VERSION} refused ${ex.code}${ex.detail ? ` detail=${ex.detail}` : ""}`); process.exit(1); }
  cases = ex.cases;
}
const r = verify({ root, module: modulePath, cases, env: process.env });
const summary = r.code === "OOP_OK"
  ? `${VERIFIER_VERSION} module=${modulePath} cases=${cases.length} pass=${r.pass} fail=${r.fail} leftovers=${r.leftovers} ${r.code}`
  : `${VERIFIER_VERSION} module=${modulePath} cases=${cases.length} refused ${r.code}${r.detail ? ` detail=${r.detail}` : ""}`;
console.log(summary);
const out = resolve(opt.out ?? ".peaceai-out/verifier");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "result.json"), JSON.stringify({ version: VERIFIER_VERSION, module: modulePath, result: r, forCredit: false }, null, 2) + "\n");
process.exit(r.code === "OOP_OK" && (r.fail ?? 1) === 0 ? 0 : 1);
