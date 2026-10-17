// Box dry run of the learned-rule half of Job A on a PeaceSTOCKS clone. Usage: tsx dry.ts <issue.json> <clone> <outdir>
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const W = "/workspace/v4-main/peaceai";
const { admitRules, loadApprovedList } = await import(`${W}/lib/approved.ts`);
const { applyRule, pathExistsIn, specHash } = await import(`${W}/lib/learned.ts`);
const { loadTargets, scopeOf } = await import(`${W}/lib/target.ts`);
const { cleanIssueText } = await import(`${W}/lib/taskmap.ts`);
const { nlDecision } = await import(`${W}/lib/nlparse.ts`);
const [issueFile, repo, out] = process.argv.slice(2);
const issue = JSON.parse(readFileSync(issueFile!, "utf8"));
const tracked = execFileSync("git", ["-C", repo!, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const target = "PeaceG03/PeaceSTOCKS";
const scope = scopeOf(loadTargets().targets[target]);
const specs = readdirSync(`${W}/rules/learned`).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(`${W}/rules/learned/${f}`, "utf8")));
const adm = admitRules(specs, loadApprovedList(`${W}/rules/approved.json`));
const nl = nlDecision(issue, undefined, new Set(adm.filter((a: any) => a.decision === "APPROVED" && a.spec).map((a: any) => a.spec.kind)));
console.log("nl", nl.status, nl.status === "unsure" ? nl.reason : "");
const task = nl.status === "parsed" ? { title: "", body: nl.objective } : issue;
const objective = cleanIssueText(task);
const files = tracked.filter((p) => scope.isSource(p) && !scope.isDenied(p)).map((path) => ({ path, content: readFileSync(join(repo!, path), "utf8") }));
const exists = pathExistsIn(repo!, tracked);
mkdirSync(out!, { recursive: true });
let n = 0;
for (const a of adm) {
  if (a.decision !== "APPROVED" || !a.spec) continue;
  const why: { reason?: string } = {};
  const e = applyRule(a.spec, objective, files, scope.isTest, target, why, exists);
  if (!e) { if (why.reason) console.log("refuse", a.spec.id, why.reason); continue; }
  n++;
  console.log("EDIT", a.spec.id, specHash(a.spec).slice(0, 8), e.path, e.create ? "create" : "edit", (e.extra ?? []).map((x: any) => x.path).join(","), e.selfGrade ? "selfGrade" : "", e.fixSha ?? "");
  writeFileSync(join(out!, `${n}.json`), JSON.stringify({ id: a.spec.id, edit: e }));
}
console.log("edits", n);
