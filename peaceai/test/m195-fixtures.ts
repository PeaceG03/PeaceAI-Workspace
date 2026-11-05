// M195 fixtures: small in-memory repositories written for plan-only-v5's caught-and-reported shapes (a code logged in a
// catch block or a promise's rejection handler, pushed into a problems array there, or returned there as a failed
// result; and codes a template builds from a literal prefix). They share nothing with any training, task or Peace
// project repo (no Peace project code, fixture, request wording or reference diff).
//   MAIL:  a flat npm + vitest package. src/sync.ts logs MAILBOX_SYNC_FAILED with console.error in a catch block;
//          src/inbox.ts throws a template `INBOX_FETCH_${status}`; src/digest.ts pushes DIGEST_SEND_FAILED into
//          `warnings` in a catch inside a loop; src/quota.ts returns `{ ok: false, code: "QUOTA_READ_FAILED" }` in a catch.
//   AGENT: a pnpm workspace with jest in packages/agent. src/start.ts logs STEP_RUN_FAILED through `logger.error` in a
//          `.then(ok, onError)` handler; src/run.ts writes AGENT_CLI_CRASHED to process.stderr in a `.catch`;
//          src/cache.ts pushes CACHE_SAVE_FAILED into `this.problems` in a `.catch`; src/deps.ts resolves
//          `{ ok: false, code: "DEPS_RESOLVE_FAILED" }` from a `.catch` arrow; src/artifact.ts logs a template
//          `ARTIFACT_PUSH_${...}` with `log.warn` in a catch block. packages/web is an unrelated package.
//   Batch 31 (top-level catch): MAIL_CLI is a CLI file whose module-level `main().catch(..)` logs MAIL_CLI_FAILED for a
//          `main` declared in the same file; AGENT_DAEMON does the same for a const arrow `boot` with a parenthesized
//          receiver behind `void`, logging DAEMON_BOOT_FAILED through `logger.error`.
import type { IndexFile } from "../lib/symbols.ts";
import { LICENSE } from "./m153-fixtures.ts";

const json = (o: unknown) => JSON.stringify(o, null, 2) + "\n";
const vt = 'import { test, expect } from "vitest";\n';
const lines = (...l: string[]) => [...l, ""].join("\n");

export const SYNC = lines(
  'import { fetchInbox } from "./inbox.ts";',
  "export async function syncMailbox(user: string): Promise<number> {",
  "  try {",
  "    const messages = await fetchInbox(user);",
  "    return messages.length;",
  "  } catch (e) {",
  "    console.error(`MAILBOX_SYNC_FAILED:${(e as Error).message}`);",
  "    return 0;",
  "  }",
  "}",
);
export const INBOX = lines(
  "export async function fetchInbox(user: string): Promise<string[]> {",
  "  const res = await fetch(`https://mail.example.test/${user}/inbox`);",
  "  if (!res.ok) throw new Error(`INBOX_FETCH_${res.status}`);",
  "  return (await res.json()) as string[];",
  "}",
);
export const DIGEST = lines(
  "export async function sendDigest(to: string[], send: (addr: string) => Promise<void>): Promise<{ sent: number; warnings: string[] }> {",
  "  const warnings: string[] = [];",
  "  let sent = 0;",
  "  for (const addr of to) {",
  "    try {",
  "      await send(addr);",
  "      sent++;",
  "    } catch {",
  "      warnings.push(`DIGEST_SEND_FAILED:${addr}`);",
  "    }",
  "  }",
  "  return { sent, warnings };",
  "}",
);
export const QUOTA = lines(
  "export async function readQuota(read: () => Promise<number>): Promise<{ ok: boolean; code?: string }> {",
  "  try {",
  "    return { ok: (await read()) < 0.9 };",
  "  } catch {",
  '    return { ok: false, code: "QUOTA_READ_FAILED" };',
  "  }",
  "}",
);

export const MAIL: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: json({ name: "mail-fixture", scripts: { test: "vitest" }, devDependencies: { vitest: "1.0.0" } }) },
  { path: "package-lock.json", content: json({ name: "mail-fixture", lockfileVersion: 3, packages: {} }) },
  { path: "src/sync.ts", content: SYNC },
  { path: "src/inbox.ts", content: INBOX },
  { path: "src/digest.ts", content: DIGEST },
  { path: "src/quota.ts", content: QUOTA },
  { path: "test/sync.test.ts", content: `import { syncMailbox } from "../src/sync.ts";\n${vt}test("sync", () => { expect(typeof syncMailbox).toBe("function"); });\n` },
  { path: "test/digest.test.ts", content: `import { sendDigest } from "../src/digest.ts";\n${vt}test("digest", async () => { expect((await sendDigest([], async () => {})).sent).toBe(0); });\n` },
  { path: "test/quota.test.ts", content: `import { readQuota } from "../src/quota.ts";\n${vt}test("quota", async () => { expect((await readQuota(async () => 0.1)).ok).toBe(true); });\n` },
];
export function mailWith(over: IndexFile[], drop: (p: string) => boolean = () => false): IndexFile[] {
  return [...MAIL.filter((f) => !drop(f.path) && !over.some((o) => o.path === f.path)), ...over];
}

const A = "packages/agent";
export const START = lines(
  'import { logger } from "./logger.ts";',
  'import { runSteps } from "./steps.ts";',
  "export function start(): void {",
  "  runSteps().then(",
  '    () => logger.info("done"),',
  '    (err) => logger.error({ code: "STEP_RUN_FAILED", err }),',
  "  );",
  "}",
);
export const RUN = lines(
  "export async function main(argv: string[]): Promise<void> {",
  '  if (argv.length > 9) throw new Error("too many arguments");',
  "}",
  "export function run(argv: string[]): void {",
  "  main(argv).catch((err) => {",
  "    process.stderr.write(`AGENT_CLI_CRASHED:${String(err)}\\n`);",
  "    process.exitCode = 1;",
  "  });",
  "}",
);
export const CACHE = lines(
  "export class ArtifactCache {",
  "  readonly problems: string[] = [];",
  "  constructor(private store: { put(k: string, v: Uint8Array): Promise<void> }) {}",
  "  save(key: string, data: Uint8Array): Promise<void> {",
  "    return this.store.put(key, data).catch(() => {",
  "      this.problems.push(`CACHE_SAVE_FAILED:${key}`);",
  "    });",
  "  }",
  "}",
);
export const DEPS = lines(
  "export function resolveDeps(load: () => Promise<string[]>): Promise<{ ok: boolean; deps?: string[]; code?: string }> {",
  '  return load().then((deps) => ({ ok: true, deps })).catch(() => ({ ok: false, code: "DEPS_RESOLVE_FAILED" }));',
  "}",
);
export const ARTIFACT = lines(
  "export async function pushArtifact(url: string, body: Uint8Array, log: { warn(s: string): void }): Promise<boolean> {",
  "  try {",
  '    const res = await fetch(url, { method: "PUT", body });',
  "    if (!res.ok) throw new Error(String(res.status));",
  "    return true;",
  "  } catch (e) {",
  "    log.warn(`ARTIFACT_PUSH_${(e as Error).message}`);",
  "    return false;",
  "  }",
  "}",
);
const jt = (imp: string, name: string, body: string) => `import { ${name} } from "../src/${imp}.ts";\ntest("${name}", () => { ${body} });\n`;
export const AGENT: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: json({ name: "agent-fixture", private: true, scripts: { test: "pnpm -r test" } }) },
  { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'\n" },
  { path: "pnpm-workspace.yaml", content: "packages:\n  - packages/*\n" },
  { path: `${A}/package.json`, content: json({ name: "@a/agent", scripts: { test: "jest" }, devDependencies: { jest: "29.0.0" } }) },
  { path: `${A}/src/logger.ts`, content: "export const logger = {\n  info: (m: unknown) => console.log(m),\n  error: (m: unknown) => console.error(m),\n};\n" },
  { path: `${A}/src/steps.ts`, content: "export async function runSteps(): Promise<void> {\n  await Promise.resolve();\n}\n" },
  { path: `${A}/src/start.ts`, content: START },
  { path: `${A}/src/run.ts`, content: RUN },
  { path: `${A}/src/cache.ts`, content: CACHE },
  { path: `${A}/src/deps.ts`, content: DEPS },
  { path: `${A}/src/artifact.ts`, content: ARTIFACT },
  { path: `${A}/test/start.test.ts`, content: jt("start", "start", "expect(typeof start).toBe(\"function\");") },
  { path: `${A}/test/run.test.ts`, content: jt("run", "run", "expect(typeof run).toBe(\"function\");") },
  { path: `${A}/test/cache.test.ts`, content: jt("cache", "ArtifactCache", "expect(typeof ArtifactCache).toBe(\"function\");") },
  { path: `${A}/test/deps.test.ts`, content: jt("deps", "resolveDeps", "expect(typeof resolveDeps).toBe(\"function\");") },
  { path: `${A}/test/artifact.test.ts`, content: jt("artifact", "pushArtifact", "expect(typeof pushArtifact).toBe(\"function\");") },
  { path: "packages/web/package.json", content: json({ name: "@a/web", scripts: { test: "jest" }, devDependencies: { jest: "29.0.0" } }) },
  { path: "packages/web/src/page.ts", content: 'export function title(s: string): string {\n  return s ? s : "PAGE_TITLE_MISSING";\n}\n' },
  { path: "packages/web/test/page.test.ts", content: 'import { title } from "../src/page.ts";\ntest("title", () => { expect(title("a")).toBe("a"); });\n' },
];
export function agentWith(over: IndexFile[], drop: (p: string) => boolean = () => false): IndexFile[] {
  return [...AGENT.filter((f) => !drop(f.path) && !over.some((o) => o.path === f.path)), ...over];
}

/** Requests written for these fixtures: failure reports in plain words plus the codes a log would show. */
export const MAIL_REQ = "The hourly mail sync job fails. Logs show MAILBOX_SYNC_FAILED:timeout, then DIGEST_SEND_FAILED and QUOTA_READ_FAILED. A transient inbox error must be retried instead of failing the sync. Add regression tests.";
export const AGENT_REQ = "The build agent crashes. Its log shows STEP_RUN_FAILED, then AGENT_CLI_CRASHED and CACHE_SAVE_FAILED:k1, and DEPS_RESOLVE_FAILED. A failed step must be retried before the agent gives up; add tests.";

/** Batch 31: a top-level `.catch` hung directly on a call to a function defined in the same file. */
export const MAIL_CLI = lines(
  'import { syncMailbox } from "./sync.ts";',
  "async function main(): Promise<void> {",
  '  const n = await syncMailbox(process.argv[2] ?? "me");',
  "  console.log(`synced ${n}`);",
  "}",
  "main().catch((e) => {",
  '  console.error("MAIL_CLI_FAILED", e);',
  "  process.exitCode = 1;",
  "});",
);
export const AGENT_DAEMON = lines(
  'import { logger } from "./logger.ts";',
  "const boot = async (): Promise<void> => {",
  "  await Promise.resolve();",
  "};",
  'void (boot()).catch((err: unknown) => logger.error({ code: "DAEMON_BOOT_FAILED", err }));',
);
