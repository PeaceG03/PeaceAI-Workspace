// M195 cases: plan-only-v5's caught-and-reported shapes and template prefixes (rules `diag-report-*`,
// `diag-template-*`, `diag-detail-trim` in plan5.ts). Each new condition has admit cases on two shapes written for
// M195 (`mail`: flat npm + vitest; `agent`: pnpm + jest workspace) and at least one refused near miss. Run by
// m194-plan-v5.test.ts together with M194's cases, so the same mutation check covers them.
import assert from "node:assert/strict";
import type { IndexFile } from "../lib/symbols.ts";
import { planV5, type Case, type CaseCtx, type V5Module } from "./m194-cases.ts";
import { AGENT, AGENT_DAEMON, AGENT_REQ, agentWith, MAIL, MAIL_CLI, MAIL_REQ, mailWith } from "./m195-fixtures.ts";

export interface ShapedCase extends Case { shape: "mail" | "agent" }
type PlanV5 = ReturnType<V5Module["planTaskV5"]>;
const A = "packages/agent";
const code = (p: PlanV5, c: string) => p.diagnosis.codes.find((x) => x.code === c);
const sites = (p: PlanV5, c: string) => code(p, c)?.sites.map((s) => `${s.path}:${s.line} ${s.via} ${s.match} ${s.symbol}${s.shape ? ` ${s.shape}` : ""}`);
const shape = (p: PlanV5) => p.steps.map((s) => `${s.action} ${s.file ?? "-"} ${s.status}`);
/** Plans `request` on `files` and checks it is refused with every stated code unplaced. */
function refused(m: V5Module, c: CaseCtx, files: IndexFile[], request: string, codes: string[]): void {
  const p = planV5(m, c, files, request);
  assert.equal(p.diagnosis.refused, "NO_THROW_SITE");
  for (const x of codes) assert.equal(code(p, x)?.status, "not-thrown", x);
}
const mail = (path: string, content: string) => mailWith([{ path, content }]);
const agent = (path: string, content: string) => agentWith([{ path: `${A}/${path}`, content }]);
const SYNC_ONLY = "The mail sync fails with MAILBOX_SYNC_FAILED.";
const catchBody = (inner: string) => `export async function syncMailbox(user: string, f: (u: string) => Promise<string[]>): Promise<number> {\n  try {\n    return (await f(user)).length;\n  } catch (e) {\n${inner}\n    return 0;\n  }\n}\n`;

export const CASES_V5_REPORT: ShapedCase[] = [
  // -- diag-report-log: the code is an argument of a logging call (console / logger / process.stderr.write)
  { id: "mail-console-error-in-catch", shape: "mail", kind: "admit", condition: "diag-report-log", run: (m, c) => {
    const p = planV5(m, c, MAIL, MAIL_REQ);
    assert.equal(p.diagnosis.family, "diagnose-failure-codes");
    assert.equal(code(p, "MAILBOX_SYNC_FAILED")?.status, "reported");
    assert.deepEqual(sites(p, "MAILBOX_SYNC_FAILED"), ["src/sync.ts:3 catch-log token syncMailbox"]);
    assert.equal(p.files[0]?.reason, "catches and reports MAILBOX_SYNC_FAILED (catch-log)");
  } },
  { id: "agent-stderr-and-logger", shape: "agent", kind: "admit", condition: "diag-report-log", run: (m, c) => {
    const p = planV5(m, c, AGENT, AGENT_REQ);
    assert.deepEqual(sites(p, "STEP_RUN_FAILED"), [`${A}/src/start.ts:4 catch-log token start`]);
    assert.deepEqual(sites(p, "AGENT_CLI_CRASHED"), [`${A}/src/run.ts:5 catch-log token run`]);
  } },
  { id: "unrelated-string-in-catch", shape: "mail", kind: "refuse", condition: "diag-report-log", run: (m, c) => {
    // In the catch, but only a metrics key / a cache key: not logged, not a report.
    refused(m, c, mail("src/sync.ts", catchBody('    metrics.count("MAILBOX_SYNC_FAILED");\n    seen.set("MAILBOX_SYNC_FAILED", e);')), SYNC_ONLY, ["MAILBOX_SYNC_FAILED"]);
  } },
  { id: "code-only-in-comment", shape: "mail", kind: "refuse", condition: "diag-report-log", run: (m, c) => {
    refused(m, c, mail("src/sync.ts", catchBody('    // ops search for MAILBOX_SYNC_FAILED\n    console.error("sync failed", e);')), SYNC_ONLY, ["MAILBOX_SYNC_FAILED"]);
  } },
  { id: "logged-only-in-test-file", shape: "agent", kind: "refuse", condition: "diag-report-log", run: (m, c) => {
    const files = agentWith([
      { path: `${A}/src/start.ts`, content: 'export function start(go: () => Promise<void>): void {\n  go().catch(() => {});\n}\n' },
      { path: `${A}/test/start.test.ts`, content: 'test("x", async () => {\n  await Promise.reject(1).catch(() => console.error("STEP_RUN_FAILED"));\n});\n' },
    ]);
    refused(m, c, files, "The agent crashes with STEP_RUN_FAILED.", ["STEP_RUN_FAILED"]);
  } },
  // -- diag-report-push: pushed into an errors / warnings / failures / problems / issues array
  { id: "mail-warnings-push", shape: "mail", kind: "admit", condition: "diag-report-push", run: (m, c) => {
    assert.deepEqual(sites(planV5(m, c, MAIL, MAIL_REQ), "DIGEST_SEND_FAILED"), ["src/digest.ts:5 catch-push token sendDigest"]);
  } },
  { id: "agent-this-problems-push", shape: "agent", kind: "admit", condition: "diag-report-push", run: (m, c) => {
    const p = planV5(m, c, AGENT, AGENT_REQ);
    assert.deepEqual(sites(p, "CACHE_SAVE_FAILED"), [`${A}/src/cache.ts:5 catch-push token save`]);
    assert.equal(code(p, "CACHE_SAVE_FAILED")?.detail, "k1");
  } },
  { id: "push-into-other-array", shape: "mail", kind: "refuse", condition: "diag-report-push", run: (m, c) => {
    const body = "export async function sendDigest(to: string[], send: (a: string) => Promise<void>): Promise<string[]> {\n  const retried: string[] = [];\n  for (const a of to) {\n    try {\n      await send(a);\n    } catch {\n      retried.push(\"DIGEST_SEND_FAILED\");\n    }\n  }\n  return retried;\n}\n";
    refused(m, c, mail("src/digest.ts", body), "The digest fails with DIGEST_SEND_FAILED.", ["DIGEST_SEND_FAILED"]);
  } },
  // -- diag-report-result: returned / resolved as `{ ok|success: false, ... }`
  { id: "mail-returned-failed-result", shape: "mail", kind: "admit", condition: "diag-report-result", run: (m, c) => {
    assert.deepEqual(sites(planV5(m, c, MAIL, MAIL_REQ), "QUOTA_READ_FAILED"), ["src/quota.ts:2 catch-result token readQuota"]);
  } },
  { id: "agent-catch-arrow-result", shape: "agent", kind: "admit", condition: "diag-report-result", run: (m, c) => {
    assert.deepEqual(sites(planV5(m, c, AGENT, AGENT_REQ), "DEPS_RESOLVE_FAILED"), [`${A}/src/deps.ts:2 catch-result token resolveDeps`]);
  } },
  { id: "ok-true-or-unreturned-result", shape: "mail", kind: "refuse", condition: "diag-report-result", run: (m, c) => {
    const req = "The quota check fails with QUOTA_READ_FAILED.";
    const okTrue = "export async function readQuota(read: () => Promise<number>): Promise<{ ok: boolean; code?: string }> {\n  try {\n    return { ok: (await read()) < 0.9 };\n  } catch {\n    return { ok: true, code: \"QUOTA_READ_FAILED\" };\n  }\n}\n";
    refused(m, c, mail("src/quota.ts", okTrue), req, ["QUOTA_READ_FAILED"]);
    const kept = "declare const last: { set(v: unknown): void };\nexport async function readQuota(read: () => Promise<number>): Promise<number> {\n  try {\n    return await read();\n  } catch {\n    const r = { ok: false, code: \"QUOTA_READ_FAILED\" };\n    last.set(r);\n    return 0;\n  }\n}\n";
    refused(m, c, mail("src/quota.ts", kept), req, ["QUOTA_READ_FAILED"]);
  } },
  { id: "failed-result-outside-catch-is-a-check", shape: "agent", kind: "refuse", condition: "diag-report-result", run: (m, c) => {
    // A check that returns a failed result is a symptom report, not a caught failure.
    const body = 'export function resolveDeps(deps: string[]): { ok: boolean; code?: string } {\n  return deps.length ? { ok: true } : { ok: false, code: "DEPS_RESOLVE_FAILED" };\n}\n';
    refused(m, c, agent("src/deps.ts", body), "The build fails with DEPS_RESOLVE_FAILED.", ["DEPS_RESOLVE_FAILED"]);
  } },
  // -- diag-report-caught: only inside a catch block, a .catch(fn) handler or a .then(_, fn) rejection handler; the
  //    site is the try statement / promise chain (its enclosing function), not the logging line
  { id: "mail-site-is-the-try", shape: "mail", kind: "admit", condition: "diag-report-caught", run: (m, c) => {
    const p = planV5(m, c, MAIL, MAIL_REQ);
    assert.deepEqual(p.diagnosis.codes.map((x) => x.sites[0]?.line), [3, 5, 2], "the try lines, not the log / push / return lines");
    // Batch 34 (M198, intentional): the try in syncMailbox awaits fetchInbox, which throws, so fetchInbox is traced as
    // the probable cause and stepped above the symptom (fix-at-probable-cause joins notYet)
    assert.deepEqual(p.diagnosis.notYet, ["reproduce-reported-failure", "fix-at-report-site", "fix-at-probable-cause"]);
    assert.deepEqual(shape(p), ["edit-source src/inbox.ts missing", "edit-source src/sync.ts missing", "edit-source src/digest.ts missing", "edit-source src/quota.ts missing", "edit-test test/sync.test.ts missing", "edit-test test/digest.test.ts missing", "edit-test test/quota.test.ts missing", "run-tests - missing"]);
    assert.equal(p.tests.command, "npx vitest run test/sync.test.ts test/digest.test.ts test/quota.test.ts");
    assert.deepEqual(p.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8], "v4's run-tests step is renumbered, not copied with v4's number");
  } },
  { id: "agent-site-is-the-chain", shape: "agent", kind: "admit", condition: "diag-report-caught", run: (m, c) => {
    const p = planV5(m, c, AGENT, AGENT_REQ);
    // Batch 34 (M198, intentional): the chains' base calls runSteps() and main(argv) are traced as probable causes,
    // stepped above their symptoms; the symptom sites themselves are unchanged
    assert.deepEqual(p.files.filter((f) => f.role === "source" && !f.reason.startsWith("probable cause")).map((f) => f.path), ["start", "run", "cache", "deps"].map((f) => `${A}/src/${f}.ts`));
    assert.deepEqual(p.files.filter((f) => f.reason.startsWith("probable cause")).map((f) => `${f.path} ${f.reason}`), [`${A}/src/steps.ts probable cause of STEP_RUN_FAILED (caught, hop 1)`]);
    assert.deepEqual(p.steps.filter((s) => s.action === "edit-source").map((s) => s.symbol), ["runSteps", "start", "main", "run", "save", "resolveDeps"]);
    assert.ok(p.steps.every((s) => s.status === "missing"));
    assert.equal(p.tests.command, "cd packages/agent && pnpm jest test/start.test.ts test/run.test.ts test/cache.test.ts test/deps.test.ts");
  } },
  { id: "logged-in-try-block-not-catch", shape: "mail", kind: "refuse", condition: "diag-report-caught", run: (m, c) => {
    const body = 'export async function syncMailbox(f: () => Promise<string[]>): Promise<number> {\n  try {\n    console.error("MAILBOX_SYNC_FAILED");\n    return (await f()).length;\n  } finally {\n    console.error("done");\n  }\n}\n';
    refused(m, c, mail("src/sync.ts", body), SYNC_ONLY, ["MAILBOX_SYNC_FAILED"]);
  } },
  { id: "logged-in-success-handler", shape: "agent", kind: "refuse", condition: "diag-report-caught", run: (m, c) => {
    const body = 'import { logger } from "./logger.ts";\nimport { runSteps } from "./steps.ts";\nexport function start(): void {\n  runSteps().then(() => logger.error("STEP_RUN_FAILED"));\n  [1].forEach(() => logger.error("STEP_RUN_FAILED"));\n}\n';
    refused(m, c, agent("src/start.ts", body), "The agent crashes with STEP_RUN_FAILED.", ["STEP_RUN_FAILED"]);
  } },
  // -- diag-template-prefix: `PREFIX_${x}` builds a reported `PREFIX_<SEGMENT>`; the prefix needs 2+ segments, 5+ chars
  { id: "mail-thrown-template", shape: "mail", kind: "admit", condition: "diag-template-prefix", run: (m, c) => {
    const p = planV5(m, c, MAIL, "The sync fails with INBOX_FETCH_503.");
    assert.deepEqual(sites(p, "INBOX_FETCH_503"), ["src/inbox.ts:3 error-new template-prefix fetchInbox"]);
    assert.equal(p.files[0]?.reason, "throws INBOX_FETCH_503 (template)");
  } },
  { id: "agent-logged-template", shape: "agent", kind: "admit", condition: "diag-template-prefix", run: (m, c) => {
    const p = planV5(m, c, AGENT, "Artifact upload errors: the agent logs ARTIFACT_PUSH_502 and the build fails.");
    assert.deepEqual(sites(p, "ARTIFACT_PUSH_502"), [`${A}/src/artifact.ts:2 catch-log template-prefix pushArtifact`]);
    assert.deepEqual(p.diagnosis.notYet, ["reproduce-reported-failure", "fix-at-report-site"]);
  } },
  { id: "generic-or-short-prefix", shape: "mail", kind: "refuse", condition: "diag-template-prefix", run: (m, c) => {
    const body = (t: string) => `export async function fetchInbox(): Promise<void> {\n  const res = await fetch("https://mail.example.test/");\n  if (!res.ok) throw new Error(\`${t}\${res.status}\`);\n}\n`;
    refused(m, c, mail("src/inbox.ts", body("STATUS_")), "The sync fails with STATUS_503.", ["STATUS_503"]); // one segment
    refused(m, c, mail("src/inbox.ts", body("E_X_")), "The sync fails with E_X_503.", ["E_X_503"]); // too short
    refused(m, c, mail("src/inbox.ts", body("INBOX_FETCH_")), "The sync fails with INBOX_FETCH_503_RETRY.", ["INBOX_FETCH_503_RETRY"]); // more than one built segment
  } },
  // -- diag-template-boundary: the prefix starts the code (not glued to letters or to an earlier hole) and the hole ends it
  { id: "mail-template-after-punctuation", shape: "mail", kind: "admit", condition: "diag-template-boundary", run: (m, c) => {
    const body = 'export async function fetchInbox(): Promise<void> {\n  const res = await fetch("https://mail.example.test/");\n  if (!res.ok) throw new Error(`inbox: INBOX_FETCH_${res.status}: retry later`);\n}\n';
    assert.deepEqual(sites(planV5(m, c, mail("src/inbox.ts", body), "The sync fails with INBOX_FETCH_503."), "INBOX_FETCH_503"), ["src/inbox.ts:3 error-new template-prefix fetchInbox"]);
  } },
  { id: "agent-template-at-start", shape: "agent", kind: "admit", condition: "diag-template-boundary", run: (m, c) => {
    assert.equal(code(planV5(m, c, AGENT, "The build fails: ARTIFACT_PUSH_404 logged."), "ARTIFACT_PUSH_404")?.status, "reported");
  } },
  { id: "glued-prefix-or-continued-code", shape: "mail", kind: "refuse", condition: "diag-template-boundary", run: (m, c) => {
    const body = (t: string) => `export async function fetchInbox(kind: string): Promise<void> {\n  const res = await fetch("https://mail.example.test/");\n  if (!res.ok) throw new Error(\`${t}\`);\n}\n`;
    for (const t of ["MYINBOX_FETCH_${res.status}", "INBOX_FETCH_${res.status}_RETRY", "${kind}INBOX_FETCH_${res.status}"]) refused(m, c, mail("src/inbox.ts", body(t)), "The sync fails with INBOX_FETCH_503.", ["INBOX_FETCH_503"]);
  } },
  // -- diag-detail-trim: a sentence's full stop after `CODE:detail` is not part of the detail
  { id: "mail-detail-full-stop", shape: "mail", kind: "admit", condition: "diag-detail-trim", run: (m, c) => {
    assert.equal(code(planV5(m, c, MAIL, "The sync fails with MAILBOX_SYNC_FAILED:24."), "MAILBOX_SYNC_FAILED")?.detail, "24");
  } },
  { id: "agent-detail-full-stop", shape: "agent", kind: "admit", condition: "diag-detail-trim", run: (m, c) => {
    assert.equal(code(planV5(m, c, AGENT, "The agent crashes. It ends with STEP_RUN_FAILED:exit_3..."), "STEP_RUN_FAILED")?.detail, "exit_3");
  } },
  { id: "inner-dots-kept", shape: "mail", kind: "refuse", condition: "diag-detail-trim", run: (m, c) => {
    const p = planV5(m, c, MAIL, "The sync fails with MAILBOX_SYNC_FAILED:v2.1 and QUOTA_READ_FAILED:.");
    assert.equal(code(p, "MAILBOX_SYNC_FAILED")?.detail, "v2.1");
    assert.equal(code(p, "QUOTA_READ_FAILED")?.detail, null, "a detail that is only a full stop is no detail");
  } },
];

// -- Batch 31, toplevel-catch: a module-level `.catch(fn)` hung directly on a call to a function defined in the same
//    file is planned at that function (rules diag-toplevel-call, diag-toplevel-module, diag-toplevel-local). Each
//    near miss keeps the M195 site (the `.catch` call, symbol null), so "everything else stays as is".
const CLI_REQ = "The mail CLI exits with MAIL_CLI_FAILED.";
const DAEMON_REQ = "The agent daemon crashes on start: DAEMON_BOOT_FAILED.";
const mailTop = (m: V5Module, c: CaseCtx) => {
  const p = planV5(m, c, mail("src/cli.ts", MAIL_CLI), CLI_REQ);
  assert.deepEqual(sites(p, "MAIL_CLI_FAILED"), ["src/cli.ts:2 catch-log token main toplevel-catch"]);
  assert.deepEqual(p.steps.filter((s) => s.action === "edit-source").map((s) => `${s.file} ${s.symbol}`), ["src/cli.ts main"]);
  assert.equal(p.files[0]?.reason, "catches and reports MAIL_CLI_FAILED (catch-log, toplevel-catch)");
};
const agentTop = (m: V5Module, c: CaseCtx) => {
  const p = planV5(m, c, agent("src/daemon.ts", AGENT_DAEMON), DAEMON_REQ);
  assert.deepEqual(sites(p, "DAEMON_BOOT_FAILED"), [`${A}/src/daemon.ts:2 catch-log token boot toplevel-catch`]);
  assert.equal(p.steps[0]?.symbol, "boot");
};
/** The near miss: the site stays the `.catch` call at `line`, with no symbol and no shape (M195's site, unchanged). */
const unchanged = (m: V5Module, c: CaseCtx, files: IndexFile[], request: string, codeName: string, at: string) => {
  const p = planV5(m, c, files, request);
  assert.deepEqual(sites(p, codeName), [`${at} catch-log token null`]);
};
for (const [condition, why] of [["diag-toplevel-call", "call"], ["diag-toplevel-module", "module"], ["diag-toplevel-local", "local"]] as const) {
  CASES_V5_REPORT.push(
    { id: `mail-toplevel-catch-${why}`, shape: "mail", kind: "admit", condition, run: mailTop },
    { id: `agent-toplevel-catch-${why}`, shape: "agent", kind: "admit", condition, run: agentTop },
  );
}
CASES_V5_REPORT.push(
  { id: "toplevel-catch-on-method-call-or-then", shape: "mail", kind: "refuse", condition: "diag-toplevel-call", run: (m, c) => {
    // `.catch` on a method call (even one named like a local function), or a `.then(_, fn)`: not a call to that function
    const method = MAIL_CLI.replace("main().catch(", "const cli = { main };\ncli.main().catch(");
    unchanged(m, c, mail("src/cli.ts", method), CLI_REQ, "MAIL_CLI_FAILED", "src/cli.ts:7");
    const then = MAIL_CLI.replace("main().catch((e) => {", "main().then(undefined, (e) => {");
    unchanged(m, c, mail("src/cli.ts", then), CLI_REQ, "MAIL_CLI_FAILED", "src/cli.ts:6");
  } },
  { id: "toplevel-catch-on-non-call", shape: "agent", kind: "refuse", condition: "diag-toplevel-call", run: (m, c) => {
    const pending = AGENT_DAEMON.replace("void (boot()).catch(", "const pending = boot();\npending.catch(");
    unchanged(m, c, agent("src/daemon.ts", pending), DAEMON_REQ, "DAEMON_BOOT_FAILED", `${A}/src/daemon.ts:6`);
  } },
  { id: "toplevel-catch-inside-callback", shape: "agent", kind: "refuse", condition: "diag-toplevel-module", run: (m, c) => {
    // inside an anonymous callback (a signal handler): not a module-level call
    const inCb = AGENT_DAEMON.replace("void (boot()).catch((err: unknown) => logger.error({ code: \"DAEMON_BOOT_FAILED\", err }));", "process.on(\"SIGHUP\", () => {\n  boot().catch((err: unknown) => logger.error({ code: \"DAEMON_BOOT_FAILED\", err }));\n});");
    unchanged(m, c, agent("src/daemon.ts", inCb), DAEMON_REQ, "DAEMON_BOOT_FAILED", `${A}/src/daemon.ts:6`);
  } },
  { id: "toplevel-catch-in-class-field", shape: "mail", kind: "refuse", condition: "diag-toplevel-module", run: (m, c) => {
    const inClass = MAIL_CLI.replace("main().catch((e) => {", "export default class {\n  done = main().catch((e) => {").replace("  process.exitCode = 1;\n});", "  process.exitCode = 1;\n});\n}");
    unchanged(m, c, mail("src/cli.ts", inClass), CLI_REQ, "MAIL_CLI_FAILED", "src/cli.ts:7");
  } },
  { id: "toplevel-catch-on-imported-function", shape: "mail", kind: "refuse", condition: "diag-toplevel-local", run: (m, c) => {
    const imported = 'import { main } from "./main.ts";\nmain().catch((e) => {\n  console.error("MAIL_CLI_FAILED", e);\n});\n';
    unchanged(m, c, mail("src/cli.ts", imported), CLI_REQ, "MAIL_CLI_FAILED", "src/cli.ts:2");
  } },
  { id: "toplevel-catch-on-built-function", shape: "agent", kind: "refuse", condition: "diag-toplevel-local", run: (m, c) => {
    // a local name bound to a value that is not a function literal (built by a factory): the fix is not visibly there
    const built = AGENT_DAEMON.replace("const boot = async (): Promise<void> => {\n  await Promise.resolve();\n};", "const makeBoot = () => async (): Promise<void> => {};\nconst boot = makeBoot();");
    unchanged(m, c, agent("src/daemon.ts", built), DAEMON_REQ, "DAEMON_BOOT_FAILED", `${A}/src/daemon.ts:4`);
  } },
);
