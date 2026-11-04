// REPRODUCE-REPORTED-FAILURE v1 CLI (M196, spec peaceai/spec/reproduce-v1.md). EXPERIMENTAL, PLAN-ONLY, NOT FOR CREDIT.
//   tsx peaceai/bin/reproduce-v1.ts <checkoutDir> (--request <text> | --request-file <file>) [--code CODE] [--site path:line] [--out dir]
// Runs plan-only-v5's diagnosis on the checkout (read-only), takes one diagnosed site (the first, or the one named),
// writes a candidate regression test and validates it as the stage-2 candidate uid (PEACEAI_STAGE2_CAND) in the
// loop's isolation, on a private copy. Only a REPRO_OK test is written, into --out (default .peaceai-out/reproduce
// under the current dir), never into the checkout. Nothing here is read by the loop or any grading.
// Prints codes, the site and the run counts only.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { typescriptEntry, useTypescript } from "../lib/tsresolve.ts";

const tsEntry = typescriptEntry();
if (!tsEntry || !useTypescript(tsEntry)) { console.log("refused TYPESCRIPT_NOT_FOUND"); process.exit(1); }
const { openRepo } = await import("../lib/codesearch.ts");
const { diagnose } = await import("../lib/plan5.ts");
const { privateRoots } = await import("../lib/loop.ts");
const { planRepro, validateRepro, REPRO_VERSION } = await import("../lib/reproduce.ts");

const usage = () => { console.log("usage: reproduce-v1.ts <checkoutDir> (--request <text> | --request-file <file>) [--code CODE] [--site path:line] [--out dir]"); process.exit(2); };
const argv = process.argv.slice(2);
const dir = argv.shift();
if (!dir || dir.startsWith("--")) usage();
const opt: Record<string, string> = {};
while (argv.length) {
  const k = argv.shift()!, v = argv.shift();
  if (!["--request", "--request-file", "--code", "--site", "--out"].includes(k) || v === undefined || k.slice(2) in opt) usage();
  opt[k.slice(2)] = v!;
}
if (!!opt.request === !!opt["request-file"]) usage();
const request = opt.request ?? readFileSync(opt["request-file"]!, "utf8");
const root = resolve(dir!);
const d = diagnose(openRepo(root), request);
if (d.refused) { console.log(`${REPRO_VERSION} refused REPRO_NO_DIAGNOSIS diag=${d.refused}`); process.exit(1); }
const want = opt.site ? /^(.+):(\d+)$/.exec(opt.site) : null;
if (opt.site && !want) usage();
const pick = d.codes.filter((c) => !opt.code || c.code === opt.code).flatMap((c) => c.sites.map((s) => ({ code: c.code, site: s })))
  .find((x) => !want || (x.site.path === want[1] && x.site.line === Number(want[2])));
if (!pick) { console.log(`${REPRO_VERSION} refused REPRO_NO_DIAGNOSIS`); process.exit(1); }
const where = `site=${pick.site.path}:${pick.site.line} via=${pick.site.via} symbol=${pick.site.symbol ?? "-"}`;
const plan = planRepro(openRepo(root), pick.code, pick.site);
if ("refuse" in plan) { console.log(`${REPRO_VERSION} ${pick.code} ${where} refused ${plan.refuse}${plan.detail ? ` detail=${plan.detail}` : ""}`); process.exit(1); }
const r = validateRepro(root, plan, { env: process.env, roots: privateRoots(resolve(import.meta.dirname, "..", ".."), process.env) });
const runs = r.runs ? Object.entries(r.runs).map(([v, x]) => `${v}=${x.exitCode}/${x.pass}/${x.fail}`).join(" ") : "";
console.log(`${REPRO_VERSION} ${pick.code} ${where} runner=${plan.runner.runner} channel=${plan.channel} trigger=${plan.trigger.callee} existing=${plan.existing.path}:${plan.existing.line} ${r.code}${r.detail ? ` detail=${r.detail}` : ""} ${runs}`.trimEnd());
const out = resolve(opt.out ?? ".peaceai-out/reproduce");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "result.json"), JSON.stringify({ version: REPRO_VERSION, code: pick.code, site: pick.site, result: r.code, detail: r.detail ?? null, runs: r.runs ?? null, testPath: plan.testPath, runner: plan.runner.runner, forCredit: false }, null, 2) + "\n");
if (r.code === "REPRO_OK") { writeFileSync(join(out, basename(plan.testPath)), plan.variants.repro); console.log(`wrote ${join(out, basename(plan.testPath))} (candidate for ${plan.testPath}; not a grading test)`); }
process.exit(r.code === "REPRO_OK" ? 0 : 1);
