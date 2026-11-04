// M194 cases: what plan-only-v5's diagnose-from-failure-codes family must plan (admit) and the near miss it must refuse,
// for each of its tagged rules (`rule:diag-*` in plan5.ts). Each case runs against a planner module, so
// m194-plan-v5.test.ts can run the same cases against plan5.ts with one tagged rule mutated.
import assert from "node:assert/strict";
import type { RuleSpec } from "../lib/learned.ts";
import * as plan4 from "../lib/plan4.ts";
import type * as plan5 from "../lib/plan5.ts";
import type { IndexFile } from "../lib/symbols.ts";
import { BACKUP, BACKUP_REQ, backupWith, QUEUE, QUEUE_REQ, queueWith, UPLOAD } from "./m194-fixtures.ts";

export interface V5Module { planTaskV5: typeof plan5.planTaskV5; repoFromFiles: typeof plan5.repoFromFiles }
export interface CaseCtx { rules: RuleSpec[]; model: any }
export interface Case { id: string; kind: "admit" | "refuse"; condition: string; run(mod: V5Module, ctx: CaseCtx): void }
type PlanV5 = ReturnType<V5Module["planTaskV5"]>;

const codeFiles = (files: IndexFile[]) => files.filter((f) => /\.[cm]?[jt]sx?$/.test(f.path));
export function planV5(mod: V5Module, c: CaseCtx, files: IndexFile[], request: string): PlanV5 {
  const r = mod.repoFromFiles(files);
  try { return mod.planTaskV5("m194", request, { repo: "example-org/fixture", files: codeFiles(files), rules: c.rules, model: c.model, testCommand: null }, r.code); }
  finally { r.close(); }
}
export function planV4(c: CaseCtx, files: IndexFile[], request: string): plan4.PlanV4 {
  const r = plan4.repoFromFiles(files);
  try { return plan4.planTaskV4("m194", request, { repo: "example-org/fixture", files: codeFiles(files), rules: c.rules, model: c.model, testCommand: null }, r.code); }
  finally { r.close(); }
}
const shape = (p: { steps: { action: string; file: string | null }[] }) => p.steps.map((s) => `${s.action} ${s.file ?? "-"}`);
const code = (p: PlanV5, c: string) => p.diagnosis.codes.find((x) => x.code === c);
/** A refused diagnosis leaves v4's plan untouched (only `planner` and `diagnosis` differ). */
function sameAsV4(p: PlanV5, c: CaseCtx, files: IndexFile[], request: string): void {
  const { planner: _a, diagnosis: _b, ...rest } = p;
  const { planner: _c, ...v4 } = planV4(c, files, request);
  assert.deepEqual(rest, v4);
}

const UP = "src/upload.ts";
const up = (body: string) => backupWith([{ path: UP, content: body }]);
const ONLY_UPLOAD = "The nightly backup job fails with UPLOAD_PART_FAILED:HTTP_503.";
const FN = (inner: string) => `export async function putPart(url: string, body: Uint8Array): Promise<number> {\n  const res = await fetch(url, { method: "PUT", body });\n${inner}\n  return body.length;\n}\n`;
const W = "packages/worker";

export const CASES_V5: Case[] = [
  // -- the request
  { id: "failure-report-admits", kind: "admit", condition: "diag-failure-report", run: (m, c) => {
    const p = planV5(m, c, BACKUP, BACKUP_REQ);
    assert.equal(p.diagnosis.family, "diagnose-failure-codes");
    assert.deepEqual(shape(p), ["edit-source src/upload.ts", "edit-test test/upload.test.ts", "run-tests -"]);
    assert.equal(p.steps[0]!.symbol, "putPart");
    assert.equal(p.tests.command, "npx vitest run test/upload.test.ts");
  } },
  { id: "no-failure-report-is-v4", kind: "refuse", condition: "diag-failure-report", run: (m, c) => {
    const req = "Document UPLOAD_PART_FAILED and MANIFEST_STALE in the upload guide.";
    const p = planV5(m, c, BACKUP, req);
    assert.equal(p.diagnosis.refused, "NO_FAILURE_REPORT");
    sameAsV4(p, c, BACKUP, req);
  } },
  { id: "codes-in-order-detail-kept", kind: "admit", condition: "diag-code-shape", run: (m, c) => {
    const p = planV5(m, c, BACKUP, BACKUP_REQ);
    assert.deepEqual(p.diagnosis.codes.map((x) => [x.code, x.detail, x.status]), [["UPLOAD_PART_FAILED", "HTTP_503", "thrown"], ["MANIFEST_STALE", null, "not-thrown"]]);
  } },
  { id: "no-code-shaped-token", kind: "refuse", condition: "diag-code-shape", run: (m, c) => {
    // Words, single-word capitals and numbers are not codes: nothing to locate.
    const req = "The nightly backup upload fails with HTTP 503, an ERROR and a Timeout in putPart.";
    const p = planV5(m, c, BACKUP, req);
    assert.equal(p.diagnosis.refused, "NO_CODES");
    sameAsV4(p, c, BACKUP, req);
  } },
  // -- where a code is thrown
  { id: "thrown-object-literal", kind: "admit", condition: "diag-throw", run: (m, c) => {
    const p = planV5(m, c, up(FN('  if (!res.ok) throw Object.assign(new Error("upload failed"), { code: "UPLOAD_PART_FAILED" });')), ONLY_UPLOAD);
    assert.deepEqual(code(p, "UPLOAD_PART_FAILED")?.sites.map((s) => `${s.path}:${s.line} ${s.via} ${s.symbol}`), ["src/upload.ts:3 throw putPart"]);
  } },
  { id: "logged-only-not-thrown", kind: "refuse", condition: "diag-throw", run: (m, c) => {
    const files = up(FN('  if (!res.ok) console.error("UPLOAD_PART_FAILED", res.status);'));
    const p = planV5(m, c, files, ONLY_UPLOAD);
    assert.equal(p.diagnosis.refused, "NO_THROW_SITE");
    assert.equal(code(p, "UPLOAD_PART_FAILED")?.status, "not-thrown");
    sameAsV4(p, c, files, ONLY_UPLOAD);
  } },
  { id: "error-passed-to-callback", kind: "admit", condition: "diag-error-new", run: (m, c) => {
    const body = 'export class UploadError extends Error {}\nexport function putPart(ok: boolean, done: (e: Error | null) => void): void {\n  if (!ok) done(new UploadError("UPLOAD_PART_FAILED"));\n  else done(null);\n}\n';
    const p = planV5(m, c, up(body), ONLY_UPLOAD);
    assert.deepEqual(code(p, "UPLOAD_PART_FAILED")?.sites.map((s) => `${s.line} ${s.via} ${s.symbol}`), ["3 error-new putPart"]);
  } },
  { id: "non-error-constructor", kind: "refuse", condition: "diag-error-new", run: (m, c) => {
    const body = 'export class Notice { constructor(readonly text: string) {} }\nexport function putPart(ok: boolean): Notice | null {\n  return ok ? null : new Notice("UPLOAD_PART_FAILED");\n}\n';
    assert.equal(planV5(m, c, up(body), ONLY_UPLOAD).diagnosis.refused, "NO_THROW_SITE");
  } },
  { id: "promise-reject", kind: "admit", condition: "diag-reject", run: (m, c) => {
    const body = 'export function putPart(ok: boolean): Promise<number> {\n  return ok ? Promise.resolve(1) : Promise.reject("UPLOAD_PART_FAILED");\n}\n';
    assert.deepEqual(code(planV5(m, c, up(body), ONLY_UPLOAD), "UPLOAD_PART_FAILED")?.sites.map((s) => `${s.line} ${s.via}`), ["2 reject"]);
  } },
  { id: "resolve-is-not-reject", kind: "refuse", condition: "diag-reject", run: (m, c) => {
    const body = 'export function putPart(ok: boolean): Promise<string> {\n  return ok ? Promise.resolve("done") : Promise.resolve("UPLOAD_PART_FAILED");\n}\n';
    assert.equal(planV5(m, c, up(body), ONLY_UPLOAD).diagnosis.refused, "NO_THROW_SITE");
  } },
  { id: "error-subclass-super", kind: "admit", condition: "diag-error-class", run: (m, c) => {
    const p = planV5(m, c, QUEUE, QUEUE_REQ);
    assert.deepEqual(code(p, "HANDLER_TIMEOUT")?.sites.map((s) => `${s.path}:${s.line} ${s.via} ${s.symbol}`), [`${W}/src/run.ts:4 reject runHandler`]);
  } },
  { id: "non-error-superclass", kind: "refuse", condition: "diag-error-class", run: (m, c) => {
    const files = queueWith([{ path: `${W}/src/timeout.ts`, content: 'class Label { constructor(readonly text: string) {} }\nexport class HandlerTimeoutError extends Label {\n  constructor() {\n    super("HANDLER_TIMEOUT");\n  }\n}\n' }]);
    assert.equal(code(planV5(m, c, files, QUEUE_REQ), "HANDLER_TIMEOUT")?.status, "not-thrown");
  } },
  { id: "class-followed-to-thrower", kind: "admit", condition: "diag-class-follow", run: (m, c) => {
    const p = planV5(m, c, QUEUE, QUEUE_REQ);
    assert.deepEqual(shape(p), [`edit-source ${W}/src/run.ts`, `edit-source ${W}/src/lease.ts`, `edit-test ${W}/test/run.test.ts`, `edit-test ${W}/test/lease.test.ts`, "run-tests -"]);
    assert.equal(p.tests.command, "cd packages/worker && pnpm jest test/run.test.ts test/lease.test.ts");
  } },
  { id: "class-never-thrown-is-the-site", kind: "refuse", condition: "diag-class-follow", run: (m, c) => {
    // Nothing visible throws the class: the class itself is the site (not invented elsewhere).
    const files = queueWith([], (p) => p === `${W}/src/run.ts`);
    assert.deepEqual(code(planV5(m, c, files, QUEUE_REQ), "HANDLER_TIMEOUT")?.sites.map((s) => `${s.path}:${s.line} ${s.via} ${s.symbol}`), [`${W}/src/timeout.ts:1 error-class HandlerTimeoutError`]);
  } },
  { id: "statement-bound-normal-throw", kind: "admit", condition: "diag-statement-bound", run: (m, c) => {
    assert.equal(code(planV5(m, c, BACKUP, ONLY_UPLOAD), "UPLOAD_PART_FAILED")?.sites.length, 1);
  } },
  { id: "log-in-callback-inside-throw", kind: "refuse", condition: "diag-statement-bound", run: (m, c) => {
    // The code is only logged inside a callback that happens to sit in a throw expression; and a compared literal.
    const body = 'declare function wrap(e: Error, onSeen: () => void): Error;\ndeclare const log: { warn(s: string): void };\nexport function putPart(status: string, e: Error): void {\n  if (status === "UPLOAD_PART_FAILED") return;\n  throw wrap(e, () => log.warn("UPLOAD_PART_FAILED seen"));\n}\n';
    assert.equal(planV5(m, c, up(body), ONLY_UPLOAD).diagnosis.refused, "NO_THROW_SITE");
  } },
  { id: "source-site-only", kind: "admit", condition: "diag-source-only", run: (m, c) => {
    const files = backupWith([{ path: "test/fixtures/fake-upload.ts", content: 'export function fake(): never { throw new Error("UPLOAD_PART_FAILED"); }\n' }]);
    assert.deepEqual(code(planV5(m, c, files, ONLY_UPLOAD), "UPLOAD_PART_FAILED")?.sites.map((s) => s.path), ["src/upload.ts"]);
  } },
  { id: "thrown-only-in-tests", kind: "refuse", condition: "diag-source-only", run: (m, c) => {
    const files = backupWith([
      { path: UP, content: FN("  if (!res.ok) return -1;") },
      { path: "test/upload.test.ts", content: 'import { test } from "vitest";\ntest("x", () => { throw new Error("UPLOAD_PART_FAILED"); });\n' },
      { path: "examples/upload.ts", content: 'export function demo(): never { throw new Error("UPLOAD_PART_FAILED"); }\n' },
    ]);
    assert.equal(planV5(m, c, files, ONLY_UPLOAD).diagnosis.refused, "NO_THROW_SITE");
  } },
  { id: "constant-alias", kind: "admit", condition: "diag-alias", run: (m, c) => {
    assert.deepEqual(code(planV5(m, c, QUEUE, QUEUE_REQ), "QUEUE_LEASE_LOST")?.sites.map((s) => `${s.path}:${s.line} ${s.via} ${s.symbol}`), [`${W}/src/lease.ts:4 error-new renew`]);
  } },
  { id: "lowercase-property-is-no-alias", kind: "refuse", condition: "diag-alias", run: (m, c) => {
    // `code: "QUEUE_LEASE_LOST"` must not make every `code` identifier an alias of the code.
    const files = queueWith([
      { path: `${W}/src/errors.ts`, content: 'export const defaults = { code: "QUEUE_LEASE_LOST" };\nexport class LeaseError extends Error {}\n' },
      { path: `${W}/src/lease.ts`, content: 'import { LeaseError } from "./errors.ts";\nexport function renew(until: number, now: number, code: string): number {\n  if (until < now) throw new LeaseError(code);\n  return now + 30_000;\n}\n' },
    ]);
    assert.equal(code(planV5(m, c, files, QUEUE_REQ), "QUEUE_LEASE_LOST")?.status, "not-thrown");
  } },
  { id: "alias-thrown", kind: "admit", condition: "diag-alias-use", run: (m, c) => {
    assert.equal(code(planV5(m, c, QUEUE, QUEUE_REQ), "QUEUE_LEASE_LOST")?.status, "thrown");
  } },
  { id: "alias-only-compared", kind: "refuse", condition: "diag-alias-use", run: (m, c) => {
    const files = queueWith([{ path: `${W}/src/lease.ts`, content: 'import { LEASE_LOST } from "./errors.ts";\nexport function lost(reason: string): boolean {\n  return reason === LEASE_LOST;\n}\n' }]);
    assert.equal(code(planV5(m, c, files, QUEUE_REQ), "QUEUE_LEASE_LOST")?.status, "not-thrown");
  } },
  // -- deciding
  { id: "three-files-is-located", kind: "admit", condition: "diag-ambiguous", run: (m, c) => {
    const extra = ["a", "b"].map((x) => ({ path: `src/part-${x}.ts`, content: `export function ${x}(): never { throw new Error("UPLOAD_PART_FAILED"); }\n` }));
    const p = planV5(m, c, backupWith(extra), ONLY_UPLOAD);
    assert.equal(code(p, "UPLOAD_PART_FAILED")?.status, "thrown");
    assert.equal(p.steps.filter((s) => s.action === "edit-source").length, 3);
  } },
  { id: "four-files-is-ambiguous", kind: "refuse", condition: "diag-ambiguous", run: (m, c) => {
    const extra = ["a", "b", "c"].map((x) => ({ path: `src/part-${x}.ts`, content: `export function ${x}(): never { throw new Error("UPLOAD_PART_FAILED"); }\n` }));
    const files = backupWith(extra);
    const p = planV5(m, c, files, ONLY_UPLOAD);
    assert.equal(code(p, "UPLOAD_PART_FAILED")?.status, "ambiguous");
    assert.equal(p.diagnosis.refused, "NO_THROW_SITE");
    sameAsV4(p, c, files, ONLY_UPLOAD);
  } },
  { id: "one-thrown-code-admits", kind: "admit", condition: "diag-needs-site", run: (m, c) => {
    assert.deepEqual(planV5(m, c, BACKUP, BACKUP_REQ).diagnosis.notYet, ["reproduce-reported-failure", "fix-at-throw-site", "trace-unthrown-codes"]);
  } },
  { id: "only-symptom-codes-is-v4", kind: "refuse", condition: "diag-needs-site", run: (m, c) => {
    // MANIFEST_STALE is defined and returned, never thrown: v4's name-based plan stands.
    const req = "The nightly backup job fails: the manifest check reports MANIFEST_STALE.";
    const p = planV5(m, c, BACKUP, req);
    assert.equal(p.diagnosis.refused, "NO_THROW_SITE");
    assert.deepEqual(shape(p).slice(0, 1), ["edit-source src/manifest.ts"]);
    sameAsV4(p, c, BACKUP, req);
  } },
  { id: "admitted-plan-replaces-v4", kind: "admit", condition: "diag-fallback-v4", run: (m, c) => {
    // v4 plans the symptom constant (it is the only located name); v5 plans the throwing site.
    assert.deepEqual(shape(planV4(c, BACKUP, BACKUP_REQ)).slice(0, 1), ["edit-source src/manifest.ts"]);
    assert.deepEqual(shape(planV5(m, c, BACKUP, BACKUP_REQ)).slice(0, 1), ["edit-source src/upload.ts"]);
  } },
  { id: "refused-plan-is-v4", kind: "refuse", condition: "diag-fallback-v4", run: (m, c) => {
    const req = "`putPart` should not double the body length.";
    const p = planV5(m, c, BACKUP, req);
    assert.equal(p.diagnosis.family, null);
    sameAsV4(p, c, BACKUP, req);
  } },
  { id: "sites-in-code-order", kind: "admit", condition: "diag-plan-sites", run: (m, c) => {
    assert.deepEqual(planV5(m, c, QUEUE, QUEUE_REQ).files.filter((f) => f.role === "source").map((f) => `${f.path}: ${f.reason}`), [`${W}/src/run.ts: rejects with HANDLER_TIMEOUT`, `${W}/src/lease.ts: throws QUEUE_LEASE_LOST`]);
  } },
  { id: "one-step-per-file", kind: "refuse", condition: "diag-plan-sites", run: (m, c) => {
    // Two reported codes thrown in one file: one edit step, not two.
    const body = UPLOAD.replace("  return body.length;", '  if (body.length === 0) throw new Error("UPLOAD_EMPTY_BODY");\n  return body.length;');
    const p = planV5(m, c, up(body), "The backup fails with UPLOAD_EMPTY_BODY or UPLOAD_PART_FAILED:HTTP_500.");
    assert.equal(p.diagnosis.codes.filter((x) => x.status === "thrown").length, 2);
    assert.deepEqual(shape(p), ["edit-source src/upload.ts", "edit-test test/upload.test.ts", "run-tests -"]);
  } },
];
