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
const { planRepros, validateRepro, attemptAll, MAX_ATTEMPTS, REPRO_VERSION } = await import("../lib/reproduce.ts");

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
const planned = planRepros(openRepo(root), pick.code, pick.site);
if ("refuse" in planned) { console.log(`${REPRO_VERSION} ${pick.code} ${where} refused ${planned.refuse}${planned.detail ? ` detail=${planned.detail}` : ""}`); process.exit(1); }
// Batch 32: the ranked base tests, at most MAX_ATTEMPTS tried, each judged on its own three runs
const r = attemptAll(planned.plans, (p) => validateRepro(root, p, { env: process.env, roots: privateRoots(resolve(import.meta.dirname, "..", ".."), process.env) }));
const fmt = (runs: typeof r.runs) => (runs ? Object.entries(runs).map(([v, x]) => `${v}=${x.exitCode}/${x.pass}/${x.fail}`).join(" ") : "");
for (const [i, a] of (r.attempts ?? []).entries()) console.log(`attempt ${i + 1}/${Math.min(planned.plans.length, MAX_ATTEMPTS)} existing=${a.base.path}:${a.base.line} namesDependency=${a.rank.namesDependency} ownFile=${a.rank.ownFile} ${a.code}${a.detail ? ` detail=${a.detail}` : ""} ${fmt(a.runs)}`.trimEnd());
const first = planned.plans[0]!;
const plan = r.plan ?? first;
console.log(`${REPRO_VERSION} ${pick.code} ${where} runner=${plan.runner.runner} channel=${plan.channel} trigger=${plan.trigger.callee} candidates=${planned.plans.length} tried=${r.attempts?.length ?? 0} untried=${r.untried ?? 0} ${r.code}${r.detail ? ` detail=${r.detail}` : ""}${r.plan ? ` existing=${r.plan.existing.path}:${r.plan.existing.line}` : ""}`.trimEnd());
const out = resolve(opt.out ?? ".peaceai-out/reproduce");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "result.json"), JSON.stringify({ version: REPRO_VERSION, code: pick.code, site: pick.site, result: r.code, detail: r.detail ?? null, attempts: r.attempts ?? [], untried: r.untried ?? 0, testPath: r.plan?.testPath ?? null, runner: plan.runner.runner, forCredit: false }, null, 2) + "\n");
if (r.code === "REPRO_OK" && r.plan) { writeFileSync(join(out, basename(r.plan.testPath)), r.plan.variants.repro); console.log(`wrote ${join(out, basename(r.plan.testPath))} (candidate for ${r.plan.testPath}; not a grading test)`); }
process.exit(r.code === "REPRO_OK" ? 0 : 1);
