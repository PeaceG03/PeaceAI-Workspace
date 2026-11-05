// M194 fixtures: small in-memory repositories written for plan-only-v5's diagnose-from-failure-codes family; they
// share nothing with any training, task or Peace project repo (no Peace project code, fixture or reference diff).
//   BACKUP: a flat npm + vitest package. src/upload.ts throws `UPLOAD_PART_FAILED:HTTP_<status>` from a template
//           literal (the failure's origin). src/manifest.ts DEFINES the constant MANIFEST_STALE and returns it as a check
//           result (a downstream symptom v4 locates by name). `backupWith` adds or replaces files.
//   QUEUE:  a pnpm workspace with jest in packages/worker. An Error subclass passes HANDLER_TIMEOUT to `super` and is
//           thrown via `reject(...)` in src/run.ts; src/lease.ts throws through a CONSTANT_CASE alias imported from
//           src/errors.ts (LEASE_LOST = "QUEUE_LEASE_LOST"). packages/api is an unrelated package.
import type { IndexFile } from "../lib/symbols.ts";
import { LICENSE } from "./m153-fixtures.ts";

const json = (o: unknown) => JSON.stringify(o, null, 2) + "\n";
const vt = 'import { test, expect } from "vitest";\n';

export const UPLOAD = [
  "export async function putPart(url: string, body: Uint8Array): Promise<number> {",
  '  const res = await fetch(url, { method: "PUT", body });',
  "  if (!res.ok) {",
  "    throw new Error(`UPLOAD_PART_FAILED:HTTP_${res.status}`);",
  "  }",
  "  return body.length;",
  "}",
  "",
].join("\n");
export const MANIFEST = [
  'export const MANIFEST_STALE = "MANIFEST_STALE";',
  "export function checkManifest(ageDays: number): { ok: boolean; code: string | null } {",
  "  return ageDays > 2 ? { ok: false, code: MANIFEST_STALE } : { ok: true, code: null };",
  "}",
  "",
].join("\n");

export const BACKUP: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: json({ name: "backup-fixture", scripts: { test: "vitest" }, devDependencies: { vitest: "1.0.0" } }) },
  { path: "package-lock.json", content: json({ name: "backup-fixture", lockfileVersion: 3, packages: {} }) },
  { path: "src/upload.ts", content: UPLOAD },
  { path: "src/manifest.ts", content: MANIFEST },
  { path: "test/upload.test.ts", content: `import { putPart } from "../src/upload.ts";\n${vt}test("putPart", () => { expect(typeof putPart).toBe("function"); });\n` },
  { path: "test/manifest.test.ts", content: `import { checkManifest, MANIFEST_STALE } from "../src/manifest.ts";\n${vt}test("stale", () => { expect(checkManifest(3).code).toBe(MANIFEST_STALE); });\n` },
];
/** BACKUP with files added (or replaced) and optionally some removed. */
export function backupWith(over: IndexFile[], drop: (p: string) => boolean = () => false): IndexFile[] {
  return [...BACKUP.filter((f) => !drop(f.path) && !over.some((o) => o.path === f.path)), ...over];
}

const W = "packages/worker";
export const QUEUE: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: json({ name: "queue-fixture", private: true, scripts: { test: "pnpm -r test" } }) },
  { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'\n" },
  { path: "pnpm-workspace.yaml", content: "packages:\n  - packages/*\n" },
  { path: `${W}/package.json`, content: json({ name: "@q/worker", scripts: { test: "jest" }, devDependencies: { jest: "29.0.0" } }) },
  { path: `${W}/src/errors.ts`, content: 'export const LEASE_LOST = "QUEUE_LEASE_LOST";\nexport class LeaseError extends Error {\n  constructor(code: string) {\n    super(code);\n  }\n}\n' },
  { path: `${W}/src/timeout.ts`, content: 'export class HandlerTimeoutError extends Error {\n  constructor() {\n    super("HANDLER_TIMEOUT");\n  }\n}\n' },
  { path: `${W}/src/run.ts`, content: 'import { HandlerTimeoutError } from "./timeout.ts";\nexport function runHandler(work: () => Promise<void>, ms: number): Promise<void> {\n  return new Promise((resolve, reject) => {\n    const t = setTimeout(() => reject(new HandlerTimeoutError()), ms);\n    work().then(() => { clearTimeout(t); resolve(); }, reject);\n  });\n}\n' },
  { path: `${W}/src/lease.ts`, content: 'import { LEASE_LOST, LeaseError } from "./errors.ts";\nexport interface Lease { id: string; until: number }\nexport function renew(lease: Lease, now: number): Lease {\n  if (lease.until < now) throw new LeaseError(LEASE_LOST);\n  return { ...lease, until: now + 30_000 };\n}\n' },
  { path: `${W}/test/run.test.ts`, content: 'import { runHandler } from "../src/run.ts";\ntest("runs", async () => { await runHandler(async () => {}, 10); });\n' },
  { path: `${W}/test/lease.test.ts`, content: 'import { renew } from "../src/lease.ts";\ntest("renews", () => { expect(renew({ id: "a", until: 5 }, 1).until).toBe(30_001); });\n' },
  { path: "packages/api/package.json", content: json({ name: "@q/api", scripts: { test: "jest" }, devDependencies: { jest: "29.0.0" } }) },
  { path: "packages/api/src/routes.ts", content: 'export function route(path: string): string {\n  if (!path.startsWith("/")) return "ROUTE_INVALID";\n  return path;\n}\n' },
  { path: "packages/api/test/routes.test.ts", content: 'import { route } from "../src/routes.ts";\ntest("route", () => { expect(route("/a")).toBe("/a"); });\n' },
];
export function queueWith(over: IndexFile[], drop: (p: string) => boolean = () => false): IndexFile[] {
  return [...QUEUE.filter((f) => !drop(f.path) && !over.some((o) => o.path === f.path)), ...over];
}

/** Requests (written for these fixtures; failure reports in plain words plus the codes a log would show). */
export const BACKUP_REQ = "The nightly backup job fails. Runs end with UPLOAD_PART_FAILED:HTTP_503 and then the manifest check reports MANIFEST_STALE. A transient upload error must be retried instead of failing the job. Add regression tests.";
export const QUEUE_REQ = "Worker jobs crash with HANDLER_TIMEOUT and then QUEUE_LEASE_LOST. A slow handler must not lose its lease: renew it while the handler runs, and add tests.";
