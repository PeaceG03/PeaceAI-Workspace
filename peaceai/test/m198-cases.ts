// M198 cases (Batch 34): plan-only-v5's symptom-to-cause trace. For each tagged trace rule (`rule:trace-*` in plan5.ts)
// admit cases (on both module styles where the rule is not style-specific: BILLING, a class-based TypeScript ESM
// service; ETL, a functional CommonJS pipeline) and refused near misses, each run against a planner module so
// m198-plan-v5-trace.test.ts can run them with one tagged rule mutated.
import assert from "node:assert/strict";
import type { IndexFile } from "../lib/symbols.ts";
import { planV4, planV5, type Case, type CaseCtx, type V5Module } from "./m194-cases.ts";
import { B, BILLING, BILLING_REQ, billingWith, CONFIG, ETL, ETL_REQ, etlWith, INVOICE, PIPELINE, PRICES, READ, PARSE, SCHEDULE } from "./m198-fixtures.ts";

export interface TraceCase extends Case { shape: "billing" | "etl" }
type PlanV5 = ReturnType<V5Module["planTaskV5"]>;
const SVC = `${B}/src/invoice-service.ts`;
const PR = `${B}/src/prices.ts`;
/** One trace as `STOP sym@path:line/via/hop, ...` (STOP `-` when it ran out of in-repo producers). */
function tr(p: PlanV5, code: string): string {
  const t = p.diagnosis.traces.filter((x) => x.code === code);
  assert.equal(t.length, 1, `one trace for ${code}`);
  return `${t[0]!.stop ?? "-"} ${t[0]!.causes.map((c) => `${c.symbol}@${c.path}:${c.line}/${c.via}/${c.hop}`).join(", ")}`.trim();
}
const steps = (p: PlanV5) => p.steps.map((s) => `${s.action} ${s.file ?? "-"} ${s.symbol ?? "-"}`);
const allMissing = (p: PlanV5) => assert.ok(p.steps.every((s) => s.status === "missing"), "every step stays missing");
const rep = (text: string, from: string, to: string) => { assert.equal(text.split(from).length - 1, 1, `fixture anchor ${from}`); return text.replace(from, to); };
const svc = (from: string, to: string, more: IndexFile[] = []) => billingWith([{ path: SVC, content: rep(INVOICE, from, to) }, ...more]);
const pipe = (from: string, to: string, more: IndexFile[] = []) => etlWith([{ path: "src/pipeline.js", content: rep(PIPELINE, from, to) }, ...more]);
const PLAN_ONLY = "Invoices fail with INVOICE_PLAN_MISSING.";
const TOTAL_ONLY = "Invoices fail with INVOICE_TOTAL_INVALID:pro.";
const DELIVERY_ONLY = "Invoice delivery fails with INVOICE_DELIVERY_FAILED.";
const SETTLE_ONLY = "The settle run fails: logs show INVOICE_SETTLE_FAILED:c7.";
const EMPTY_ONLY = "The import job fails with ETL_BATCH_EMPTY.";
const WRITE_ONLY = "The import job fails with ETL_WRITE_FAILED:timeout.";
const CONFIG_ONLY = "The scheduler fails: logs show ETL_CONFIG_FAILED.";
const IF_PLAN = '    if (!plan) throw new BillingError("INVOICE_PLAN_MISSING");';
const IF_EMPTY = '  if (rows.length === 0) throw new Error("ETL_BATCH_EMPTY");';
const PLAN_OF = `planOf@${SVC}:10/value/1`;
const PRICE_FOR = `priceFor@${PR}:2/value/1`;
const LOOKUP = `lookupPrice@${PR}:5/delegate/2`;
const READ_BATCH = "readBatch@src/read.js:2/value/1";
const PARSE_ROWS = "parseRows@src/parse.js:1/delegate/2";

export const CASES_V5_TRACE: TraceCase[] = [
  // -- trace-condition: the site sits in a branch of an `if` (its condition is what the trace reads)
  { id: "billing-value-cause-above-symptom", shape: "billing", kind: "admit", condition: "trace-condition", run: (m, c) => {
    const p = planV5(m, c, BILLING, BILLING_REQ);
    assert.equal(tr(p, "INVOICE_PLAN_MISSING"), `- ${PLAN_OF}`);
    assert.deepEqual(steps(p), [`edit-source ${SVC} planOf`, `edit-source ${PR} priceFor`, `edit-source ${PR} lookupPrice`, `edit-source ${SVC} deliver`, `edit-source ${SVC} issue`, `edit-test ${B}/test/invoice-service.test.ts -`, "run-tests - -"]);
    assert.deepEqual(p.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7]);
    allMissing(p);
  } },
  { id: "etl-value-cause-above-symptom", shape: "etl", kind: "admit", condition: "trace-condition", run: (m, c) => {
    const p = planV5(m, c, ETL, EMPTY_ONLY);
    assert.equal(tr(p, "ETL_BATCH_EMPTY"), `- ${READ_BATCH}, ${PARSE_ROWS}`);
    assert.deepEqual(steps(p), ["edit-source src/read.js readBatch", "edit-source src/parse.js parseRows", "edit-source src/pipeline.js run", "edit-test test/pipeline.test.js -", "run-tests - -"]);
    allMissing(p);
  } },
  { id: "billing-unconditional-throw", shape: "billing", kind: "refuse", condition: "trace-condition", run: (m, c) => {
    const p = planV5(m, c, svc(IF_PLAN, '    throw new BillingError("INVOICE_PLAN_MISSING");'), PLAN_ONLY);
    assert.equal(tr(p, "INVOICE_PLAN_MISSING"), "TRACE_NO_CONDITION");
    assert.deepEqual(steps(p), [`edit-source ${SVC} issue`, `edit-test ${B}/test/invoice-service.test.ts -`, "run-tests - -"]);
  } },
  { id: "etl-unconditional-throw", shape: "etl", kind: "refuse", condition: "trace-condition", run: (m, c) => {
    assert.equal(tr(planV5(m, c, pipe(IF_EMPTY, '  throw new Error("ETL_BATCH_EMPTY");'), EMPTY_ONLY), "ETL_BATCH_EMPTY"), "TRACE_NO_CONDITION");
  } },
  // -- trace-depends: the condition reads a const-bound call result (also destructured); not a parameter, a field,
  //    a `let`, or a predicate call's own result
  { id: "billing-const-bound-price", shape: "billing", kind: "admit", condition: "trace-depends", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, TOTAL_ONLY), "INVOICE_TOTAL_INVALID"), `- ${PRICE_FOR}, ${LOOKUP}`);
  } },
  { id: "etl-destructured-binding", shape: "etl", kind: "admit", condition: "trace-depends", run: (m, c) => {
    const files = pipe("  const rows = readBatch(text);\n  if (rows.length === 0)", "  const [first] = readBatch(text);\n  const rows = [first];\n  if (!first)");
    assert.equal(tr(planV5(m, c, files, EMPTY_ONLY), "ETL_BATCH_EMPTY"), `- ${READ_BATCH}, ${PARSE_ROWS}`);
  } },
  { id: "billing-condition-reads-field-or-predicate", shape: "billing", kind: "refuse", condition: "trace-depends", run: (m, c) => {
    assert.equal(tr(planV5(m, c, svc(IF_PLAN, '    if (this.customers.size === 0) throw new BillingError("INVOICE_PLAN_MISSING");'), PLAN_ONLY), "INVOICE_PLAN_MISSING"), "TRACE_INDEPENDENT");
    // a predicate's result is not a value the site reads; its argument (a parameter) has no producer
    const pred = svc(IF_PLAN, '    if (!isPlanId(id)) throw new BillingError("INVOICE_PLAN_MISSING");', []);
    const withPred = pred.map((f) => (f.path === SVC ? { ...f, content: f.content + "function isPlanId(s: string): boolean {\n  return s.length > 0;\n}\n" } : f));
    assert.equal(tr(planV5(m, c, withPred, PLAN_ONLY), "INVOICE_PLAN_MISSING"), "TRACE_INDEPENDENT");
  } },
  { id: "etl-condition-reads-parameter-or-let", shape: "etl", kind: "refuse", condition: "trace-depends", run: (m, c) => {
    assert.equal(tr(planV5(m, c, pipe(IF_EMPTY, '  if (text.length === 0) throw new Error("ETL_BATCH_EMPTY");'), EMPTY_ONLY), "ETL_BATCH_EMPTY"), "TRACE_INDEPENDENT");
    assert.equal(tr(planV5(m, c, pipe("  const rows = readBatch(text);", "  let rows = readBatch(text);"), EMPTY_ONLY), "ETL_BATCH_EMPTY"), "TRACE_INDEPENDENT");
  } },
  // -- trace-rethrow: the site throws inside a catch block: the try block's failing call is the cause
  { id: "billing-rethrow-this-render", shape: "billing", kind: "admit", condition: "trace-rethrow", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, DELIVERY_ONLY), "INVOICE_DELIVERY_FAILED"), `- render@${SVC}:23/caught/1`);
  } },
  { id: "etl-rethrow-write", shape: "etl", kind: "admit", condition: "trace-rethrow", run: (m, c) => {
    assert.equal(tr(planV5(m, c, ETL, WRITE_ONLY), "ETL_WRITE_FAILED"), "- writeBatch@src/write.js:1/caught/1");
  } },
  { id: "billing-throw-in-try-block", shape: "billing", kind: "refuse", condition: "trace-rethrow", run: (m, c) => {
    const files = svc('      await this.render(id);\n    } catch {\n      throw new BillingError("INVOICE_DELIVERY_FAILED");\n    }', '      await this.render(id);\n      throw new BillingError("INVOICE_DELIVERY_FAILED");\n    } catch {\n      return;\n    }');
    assert.equal(tr(planV5(m, c, files, DELIVERY_ONLY), "INVOICE_DELIVERY_FAILED"), "TRACE_NO_CONDITION");
  } },
  { id: "etl-throw-in-finally", shape: "etl", kind: "refuse", condition: "trace-rethrow", run: (m, c) => {
    const files = pipe("  } catch (err) {\n    throw new Error(`ETL_WRITE_FAILED:${err.message}`);\n  }", "  } finally {\n    throw new Error(\"ETL_WRITE_FAILED\");\n  }");
    assert.equal(tr(planV5(m, c, files, WRITE_ONLY), "ETL_WRITE_FAILED"), "TRACE_NO_CONDITION");
  } },
  // -- trace-caught: a caught-and-reported site (M195): the try block's failing call is the cause
  { id: "billing-logged-settle", shape: "billing", kind: "admit", condition: "trace-caught", run: (m, c) => {
    const p = planV5(m, c, BILLING, SETTLE_ONLY);
    assert.equal(tr(p, "INVOICE_SETTLE_FAILED"), `- deliver@${SVC}:27/caught/1`);
    assert.deepEqual(steps(p).slice(0, 2), [`edit-source ${SVC} deliver`, `edit-source ${SVC} settle`]);
  } },
  { id: "etl-logged-config", shape: "etl", kind: "admit", condition: "trace-caught", run: (m, c) => {
    const p = planV5(m, c, ETL, CONFIG_ONLY);
    assert.equal(tr(p, "ETL_CONFIG_FAILED"), "- loadConfig@src/config.js:2/caught/1");
    assert.equal(p.files.find((f) => f.path === "src/config.js")?.reason, "probable cause of ETL_CONFIG_FAILED (caught, hop 1)");
  } },
  { id: "etl-try-holds-only-library-calls", shape: "etl", kind: "refuse", condition: "trace-caught", run: (m, c) => {
    const files = etlWith([{ path: "src/schedule.js", content: rep(SCHEDULE, "    await loadConfig(process.env.ETL_CONFIG_PATH);", "    JSON.parse(String(process.env.ETL_CONFIG_PATH));") }]);
    assert.equal(tr(planV5(m, c, files, CONFIG_ONLY), "ETL_CONFIG_FAILED"), "TRACE_INDEPENDENT");
  } },
  { id: "billing-try-holds-only-a-sync-library-call", shape: "billing", kind: "refuse", condition: "trace-caught", run: (m, c) => {
    assert.equal(tr(planV5(m, c, svc("        await this.deliver(id);", "        JSON.parse(id);"), SETTLE_ONLY), "INVOICE_SETTLE_FAILED"), "TRACE_INDEPENDENT");
    // a pure in-repo helper next to an awaited library call: the helper cannot fail, so the cause is the library call
    const pure = svc("        await this.deliver(id);", "        await this.outbox.send(this.keyOf(id), \"x\");").map((f) => (f.path === SVC ? { ...f, content: rep(f.content, "  async settle(", "  private keyOf(id: string): string {\n    return `k:${id}`;\n  }\n  async settle(") } : f));
    assert.equal(tr(planV5(m, c, pure, SETTLE_ONLY), "INVOICE_SETTLE_FAILED"), "TRACE_UNRESOLVED");
  } },
  // -- trace-own-body: calls inside a nested callback of the try block are not the try's own calls
  { id: "billing-own-body-call", shape: "billing", kind: "admit", condition: "trace-own-body", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, SETTLE_ONLY), "INVOICE_SETTLE_FAILED"), `- deliver@${SVC}:27/caught/1`);
  } },
  { id: "etl-own-body-call", shape: "etl", kind: "admit", condition: "trace-own-body", run: (m, c) => {
    assert.equal(tr(planV5(m, c, ETL, CONFIG_ONLY), "ETL_CONFIG_FAILED"), "- loadConfig@src/config.js:2/caught/1");
  } },
  { id: "billing-producer-in-nested-callback", shape: "billing", kind: "refuse", condition: "trace-own-body", run: (m, c) => {
    assert.equal(tr(planV5(m, c, svc("        await this.deliver(id);", "        ids.forEach((x) => void this.deliver(x));"), SETTLE_ONLY), "INVOICE_SETTLE_FAILED"), "TRACE_INDEPENDENT");
  } },
  { id: "etl-producer-in-nested-callback", shape: "etl", kind: "refuse", condition: "trace-own-body", run: (m, c) => {
    const files = etlWith([{ path: "src/schedule.js", content: rep(SCHEDULE, "    await loadConfig(process.env.ETL_CONFIG_PATH);", "    [process.env.ETL_CONFIG_PATH].forEach((p) => loadConfig(p));") }]);
    assert.equal(tr(planV5(m, c, files, CONFIG_ONLY), "ETL_CONFIG_FAILED"), "TRACE_INDEPENDENT");
  } },
  // -- trace-can-fail: only an in-repo call that can fail (throws, rejects, builds an Error, awaits, delegates) counts
  { id: "billing-failing-render-counts", shape: "billing", kind: "admit", condition: "trace-can-fail", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, DELIVERY_ONLY), "INVOICE_DELIVERY_FAILED"), `- render@${SVC}:23/caught/1`);
  } },
  { id: "etl-failing-write-counts", shape: "etl", kind: "admit", condition: "trace-can-fail", run: (m, c) => {
    assert.equal(tr(planV5(m, c, ETL, WRITE_ONLY), "ETL_WRITE_FAILED"), "- writeBatch@src/write.js:1/caught/1");
  } },
  { id: "billing-pure-helper-in-try", shape: "billing", kind: "refuse", condition: "trace-can-fail", run: (m, c) => {
    const files = svc("      await this.render(id);\n    } catch {", "      const key = this.keyOf(id);\n      await this.outbox.send(key, \"x\");\n    } catch {", []).map((f) => (f.path === SVC ? { ...f, content: rep(f.content, "  async settle(", "  private keyOf(id: string): string {\n    return `k:${id}`;\n  }\n  async settle(") } : f));
    assert.equal(tr(planV5(m, c, files, DELIVERY_ONLY), "INVOICE_DELIVERY_FAILED"), "TRACE_UNRESOLVED");
  } },
  { id: "etl-pure-helper-in-try", shape: "etl", kind: "refuse", condition: "trace-can-fail", run: (m, c) => {
    const files = pipe("    await writeBatch(rows, sink);", "    const name = labelOf(rows);\n    await sink.put(name);").map((f) => (f.path === "src/pipeline.js" ? { ...f, content: f.content + "function labelOf(rows) {\n  return \"batch-\" + rows.length;\n}\n" } : f));
    assert.equal(tr(planV5(m, c, files, WRITE_ONLY), "ETL_WRITE_FAILED"), "TRACE_UNRESOLVED");
  } },
  // -- trace-unique: several producers is TRACE_AMBIGUOUS (no guess), library calls included
  { id: "billing-single-producer", shape: "billing", kind: "admit", condition: "trace-unique", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, PLAN_ONLY), "INVOICE_PLAN_MISSING"), `- ${PLAN_OF}`);
  } },
  { id: "etl-single-producer", shape: "etl", kind: "admit", condition: "trace-unique", run: (m, c) => {
    assert.equal(tr(planV5(m, c, ETL, EMPTY_ONLY), "ETL_BATCH_EMPTY"), `- ${READ_BATCH}, ${PARSE_ROWS}`);
  } },
  { id: "billing-two-producers-in-condition", shape: "billing", kind: "refuse", condition: "trace-unique", run: (m, c) => {
    const files = svc(IF_PLAN, '    const region = this.regionOf(id);\n    if (!plan || !region) throw new BillingError("INVOICE_PLAN_MISSING");').map((f) => (f.path === SVC ? { ...f, content: rep(f.content, "  async settle(", "  private regionOf(id: string): string {\n    return id.slice(0, 2);\n  }\n  async settle(") } : f));
    const p = planV5(m, c, files, PLAN_ONLY);
    assert.equal(tr(p, "INVOICE_PLAN_MISSING"), "TRACE_AMBIGUOUS");
    assert.deepEqual(steps(p), [`edit-source ${SVC} issue`, `edit-test ${B}/test/invoice-service.test.ts -`, "run-tests - -"]);
  } },
  { id: "etl-two-producers", shape: "etl", kind: "refuse", condition: "trace-unique", run: (m, c) => {
    const two = pipe("    await writeBatch(rows, sink);", "    await writeBatch(rows, sink);\n    await archiveBatch(rows);").map((f) => (f.path === "src/pipeline.js" ? { ...f, content: f.content + "async function archiveBatch(rows) {\n  if (!rows.length) throw new Error(\"none\");\n}\n" } : f));
    assert.equal(tr(planV5(m, c, two, WRITE_ONLY), "ETL_WRITE_FAILED"), "TRACE_AMBIGUOUS");
    // an in-repo producer next to a library call in the condition is ambiguous too
    const lib = pipe(IF_EMPTY, '  const meta = JSON.parse(text);\n  if (rows.length === 0 || !meta) throw new Error("ETL_BATCH_EMPTY");');
    assert.equal(tr(planV5(m, c, lib, EMPTY_ONLY), "ETL_BATCH_EMPTY"), "TRACE_AMBIGUOUS");
  } },
  // -- trace-same-package: a producer in another package (by relative path) is TRACE_CROSS_PACKAGE
  { id: "billing-same-package-producer", shape: "billing", kind: "admit", condition: "trace-same-package", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, TOTAL_ONLY), "INVOICE_TOTAL_INVALID"), `- ${PRICE_FOR}, ${LOOKUP}`);
  } },
  { id: "etl-same-package-producer", shape: "etl", kind: "admit", condition: "trace-same-package", run: (m, c) => {
    assert.equal(tr(planV5(m, c, ETL, EMPTY_ONLY), "ETL_BATCH_EMPTY"), `- ${READ_BATCH}, ${PARSE_ROWS}`);
  } },
  { id: "billing-relative-import-into-other-package", shape: "billing", kind: "refuse", condition: "trace-same-package", run: (m, c) => {
    const files = svc("    const total = priceFor(plan);", "    const total = rateFor(plan);").map((f) => (f.path === SVC ? { ...f, content: 'import { rateFor } from "../../shared/src/rates.ts";\n' + f.content } : f));
    const p = planV5(m, c, files, TOTAL_ONLY);
    assert.equal(tr(p, "INVOICE_TOTAL_INVALID"), "TRACE_CROSS_PACKAGE");
    assert.ok(!p.files.some((f) => f.path.startsWith("packages/shared/")), "never plans in another package");
  } },
  { id: "etl-delegate-into-nested-package", shape: "etl", kind: "refuse", condition: "trace-same-package", run: (m, c) => {
    const files = etlWith([{ path: "src/read.js", content: READ.replace(/parseRows/g, "splitCsv").replace('require("./parse")', 'require("../modules/csv/split")') }]);
    const p = planV5(m, c, files, EMPTY_ONLY);
    assert.equal(tr(p, "ETL_BATCH_EMPTY"), `TRACE_CROSS_PACKAGE ${READ_BATCH}`);
    assert.ok(!p.files.some((f) => f.path.startsWith("modules/")));
  } },
  // -- trace-workspace-name: a bare specifier naming a workspace package is another package, not a library
  { id: "billing-relative-import-in-workspace", shape: "billing", kind: "admit", condition: "trace-workspace-name", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, TOTAL_ONLY), "INVOICE_TOTAL_INVALID"), `- ${PRICE_FOR}, ${LOOKUP}`);
  } },
  { id: "etl-relative-require-with-nested-package", shape: "etl", kind: "admit", condition: "trace-workspace-name", run: (m, c) => {
    assert.equal(tr(planV5(m, c, ETL, WRITE_ONLY), "ETL_WRITE_FAILED"), "- writeBatch@src/write.js:1/caught/1");
  } },
  { id: "billing-import-of-workspace-package", shape: "billing", kind: "refuse", condition: "trace-workspace-name", run: (m, c) => {
    const files = svc("    const total = priceFor(plan);", "    const total = rateFor(plan);").map((f) => (f.path === SVC ? { ...f, content: 'import { rateFor } from "@b/shared";\n' + f.content } : f));
    assert.equal(tr(planV5(m, c, files, TOTAL_ONLY), "INVOICE_TOTAL_INVALID"), "TRACE_CROSS_PACKAGE");
  } },
  { id: "etl-require-of-nested-package", shape: "etl", kind: "refuse", condition: "trace-workspace-name", run: (m, c) => {
    const files = pipe("  const rows = readBatch(text);", "  const rows = splitCsv(text);").map((f) => (f.path === "src/pipeline.js" ? { ...f, content: 'const { splitCsv } = require("csv-lite");\n' + f.content } : f));
    assert.equal(tr(planV5(m, c, files, EMPTY_ONLY), "ETL_BATCH_EMPTY"), "TRACE_CROSS_PACKAGE");
  } },
  // -- trace-resolve-import: a named import or destructured require of a relative module, to its top-level function
  { id: "billing-esm-named-import", shape: "billing", kind: "admit", condition: "trace-resolve-import", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, TOTAL_ONLY), "INVOICE_TOTAL_INVALID"), `- ${PRICE_FOR}, ${LOOKUP}`);
  } },
  { id: "etl-destructured-require", shape: "etl", kind: "admit", condition: "trace-resolve-import", run: (m, c) => {
    assert.equal(tr(planV5(m, c, ETL, CONFIG_ONLY), "ETL_CONFIG_FAILED"), "- loadConfig@src/config.js:2/caught/1");
  } },
  { id: "billing-barrel-reexport-unresolved", shape: "billing", kind: "refuse", condition: "trace-resolve-import", run: (m, c) => {
    const files = svc('import { priceFor } from "./prices.ts";', 'import { priceFor } from "./lib/index.ts";', [{ path: `${B}/src/lib/index.ts`, content: 'export { priceFor } from "../prices.ts";\n' }]);
    assert.equal(tr(planV5(m, c, files, TOTAL_ONLY), "INVOICE_TOTAL_INVALID"), "TRACE_UNRESOLVED");
  } },
  { id: "etl-namespace-require-or-library", shape: "etl", kind: "refuse", condition: "trace-resolve-import", run: (m, c) => {
    const ns = pipe('const { readBatch } = require("./read");', 'const read = require("./read");').map((f) => (f.path === "src/pipeline.js" ? { ...f, content: rep(f.content, "readBatch(text)", "read.readBatch(text)") } : f));
    assert.equal(tr(planV5(m, c, ns, EMPTY_ONLY), "ETL_BATCH_EMPTY"), "TRACE_UNRESOLVED");
    const lib = pipe('const { readBatch } = require("./read");', 'const { readBatch } = require("row-reader");');
    assert.equal(tr(planV5(m, c, lib, EMPTY_ONLY), "ETL_BATCH_EMPTY"), "TRACE_UNRESOLVED");
  } },
  // -- trace-resolve-this (class style only): `this.m()` resolves to a method of the enclosing class
  { id: "billing-this-method", shape: "billing", kind: "admit", condition: "trace-resolve-this", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, PLAN_ONLY), "INVOICE_PLAN_MISSING"), `- ${PLAN_OF}`);
  } },
  { id: "billing-this-async-method", shape: "billing", kind: "admit", condition: "trace-resolve-this", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, DELIVERY_ONLY), "INVOICE_DELIVERY_FAILED"), `- render@${SVC}:23/caught/1`);
  } },
  { id: "billing-field-method-or-inherited", shape: "billing", kind: "refuse", condition: "trace-resolve-this", run: (m, c) => {
    assert.equal(tr(planV5(m, c, svc("    const plan = this.planOf(id);", "    const plan = this.customers.get(id);"), PLAN_ONLY), "INVOICE_PLAN_MISSING"), "TRACE_UNRESOLVED");
    const inherited = svc("export class InvoiceService {", "class Base {\n  planOf(id: string): string | null {\n    return id;\n  }\n}\nexport class InvoiceService extends Base {").map((f) => (f.path === SVC ? { ...f, content: rep(rep(f.content, "  private planOf(id: string): string | null {\n    const c = this.customers.get(id);\n    return c ? c.plan : null;\n  }\n", ""), "  ) {}", "  ) {\n    super();\n  }") } : f));
    assert.equal(tr(planV5(m, c, inherited, PLAN_ONLY), "INVOICE_PLAN_MISSING"), "TRACE_UNRESOLVED");
  } },
  // -- trace-delegate: from a producer, follow the one in-repo function every return hands back (hop 2)
  { id: "billing-delegate-hop-2", shape: "billing", kind: "admit", condition: "trace-delegate", run: (m, c) => {
    const p = planV5(m, c, BILLING, TOTAL_ONLY);
    assert.equal(tr(p, "INVOICE_TOTAL_INVALID"), `- ${PRICE_FOR}, ${LOOKUP}`);
    assert.deepEqual(steps(p).slice(0, 3), [`edit-source ${PR} priceFor`, `edit-source ${PR} lookupPrice`, `edit-source ${SVC} issue`]);
  } },
  { id: "etl-delegate-hop-2", shape: "etl", kind: "admit", condition: "trace-delegate", run: (m, c) => {
    const p = planV5(m, c, ETL, EMPTY_ONLY);
    assert.equal(p.files.find((f) => f.path === "src/parse.js")?.reason, "probable cause of ETL_BATCH_EMPTY (delegate, hop 2)");
  } },
  { id: "billing-two-delegates", shape: "billing", kind: "refuse", condition: "trace-delegate", run: (m, c) => {
    const files = billingWith([{ path: PR, content: rep(PRICES, "  return lookupPrice(readTable(), plan);", "  if (plan.startsWith(\"x-\")) return lookupLegacy(plan);\n  return lookupPrice(readTable(), plan);") + "function lookupLegacy(plan: string): number {\n  return plan.length;\n}\n" }]);
    assert.equal(tr(planV5(m, c, files, TOTAL_ONLY), "INVOICE_TOTAL_INVALID"), `TRACE_AMBIGUOUS ${PRICE_FOR}`);
  } },
  { id: "etl-two-delegates", shape: "etl", kind: "refuse", condition: "trace-delegate", run: (m, c) => {
    const files = etlWith([
      { path: "src/read.js", content: rep(rep(READ, "const { parseRows } = require(\"./parse\");", "const { parseRows, parseTabs } = require(\"./parse\");"), "  return parseRows(text);", "  if (text.includes(\"\\t\")) return parseTabs(text);\n  return parseRows(text);") },
      { path: "src/parse.js", content: rep(PARSE, "module.exports = { parseRows };", "function parseTabs(text) {\n  return text.split(\"\\n\").map((l) => l.split(\"\\t\"));\n}\nmodule.exports = { parseRows, parseTabs };") },
    ]);
    assert.equal(tr(planV5(m, c, files, EMPTY_ONLY), "ETL_BATCH_EMPTY"), `TRACE_AMBIGUOUS ${READ_BATCH}`);
  } },
  // -- trace-delegate-all: a producer delegates only when EVERY return hands back a call result
  { id: "billing-every-return-delegates", shape: "billing", kind: "admit", condition: "trace-delegate-all", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, TOTAL_ONLY), "INVOICE_TOTAL_INVALID"), `- ${PRICE_FOR}, ${LOOKUP}`);
  } },
  { id: "etl-every-return-delegates", shape: "etl", kind: "admit", condition: "trace-delegate-all", run: (m, c) => {
    assert.equal(tr(planV5(m, c, ETL, EMPTY_ONLY), "ETL_BATCH_EMPTY"), `- ${READ_BATCH}, ${PARSE_ROWS}`);
  } },
  { id: "billing-early-literal-return", shape: "billing", kind: "refuse", condition: "trace-delegate-all", run: (m, c) => {
    const files = billingWith([{ path: PR, content: rep(PRICES, "  return lookupPrice(readTable(), plan);", "  if (!plan) return 0;\n  return lookupPrice(readTable(), plan);") }]);
    assert.equal(tr(planV5(m, c, files, TOTAL_ONLY), "INVOICE_TOTAL_INVALID"), `- ${PRICE_FOR}`);
  } },
  { id: "etl-early-literal-return", shape: "etl", kind: "refuse", condition: "trace-delegate-all", run: (m, c) => {
    const files = etlWith([{ path: "src/read.js", content: rep(READ, "  return parseRows(text);", "  if (!text) return [];\n  return parseRows(text);") }]);
    assert.equal(tr(planV5(m, c, files, EMPTY_ONLY), "ETL_BATCH_EMPTY"), `- ${READ_BATCH}`);
  } },
  // -- trace-depth: at most MAX_TRACE_HOPS (2) causes; a further delegate is TRACE_DEPTH and is not planned
  { id: "billing-two-hops-is-within-depth", shape: "billing", kind: "admit", condition: "trace-depth", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, TOTAL_ONLY), "INVOICE_TOTAL_INVALID"), `- ${PRICE_FOR}, ${LOOKUP}`);
  } },
  { id: "etl-two-hops-is-within-depth", shape: "etl", kind: "admit", condition: "trace-depth", run: (m, c) => {
    assert.equal(tr(planV5(m, c, ETL, EMPTY_ONLY), "ETL_BATCH_EMPTY"), `- ${READ_BATCH}, ${PARSE_ROWS}`);
  } },
  { id: "billing-third-hop-not-planned", shape: "billing", kind: "refuse", condition: "trace-depth", run: (m, c) => {
    const files = billingWith([{ path: PR, content: rep(PRICES, "  const p = table.get(plan);\n  return p === undefined ? 0 : p;", "  return pick(table, plan);") + "function pick(table: Map<string, number>, plan: string): number {\n  return table.get(plan) ?? 0;\n}\n" }]);
    const p = planV5(m, c, files, TOTAL_ONLY);
    assert.equal(tr(p, "INVOICE_TOTAL_INVALID"), `TRACE_DEPTH ${PRICE_FOR}, ${LOOKUP}`);
    assert.ok(!p.steps.some((s) => s.symbol === "pick"));
  } },
  { id: "etl-third-hop-not-planned", shape: "etl", kind: "refuse", condition: "trace-depth", run: (m, c) => {
    const files = etlWith([{ path: "src/parse.js", content: rep(PARSE, "  return text.split(\"\\n\").filter(Boolean).map((l) => l.split(\",\"));", "  return splitLines(text);") + "function splitLines(text) {\n  return text.split(\"\\n\");\n}\n" }]);
    const p = planV5(m, c, files, EMPTY_ONLY);
    assert.equal(tr(p, "ETL_BATCH_EMPTY"), `TRACE_DEPTH ${READ_BATCH}, ${PARSE_ROWS}`);
    assert.ok(!p.steps.some((s) => s.symbol === "splitLines"));
  } },
  // -- trace-not-planned: a producer that is itself a diagnosed site is not added again (TRACE_ALREADY_PLANNED)
  { id: "billing-cause-not-a-site", shape: "billing", kind: "admit", condition: "trace-not-planned", run: (m, c) => {
    assert.equal(tr(planV5(m, c, BILLING, SETTLE_ONLY), "INVOICE_SETTLE_FAILED"), `- deliver@${SVC}:27/caught/1`);
  } },
  { id: "etl-cause-not-a-site", shape: "etl", kind: "admit", condition: "trace-not-planned", run: (m, c) => {
    assert.equal(tr(planV5(m, c, ETL, CONFIG_ONLY), "ETL_CONFIG_FAILED"), "- loadConfig@src/config.js:2/caught/1");
  } },
  { id: "billing-cause-is-a-reported-site", shape: "billing", kind: "refuse", condition: "trace-not-planned", run: (m, c) => {
    const p = planV5(m, c, BILLING, "The settle run fails with INVOICE_SETTLE_FAILED:c7 after INVOICE_DELIVERY_FAILED.");
    assert.equal(tr(p, "INVOICE_SETTLE_FAILED"), "TRACE_ALREADY_PLANNED");
    assert.equal(tr(p, "INVOICE_DELIVERY_FAILED"), `- render@${SVC}:23/caught/1`);
  } },
  { id: "etl-cause-is-a-thrown-site", shape: "etl", kind: "refuse", condition: "trace-not-planned", run: (m, c) => {
    const files = etlWith([{ path: "src/config.js", content: rep(CONFIG, "  const raw = await readFile(path, \"utf8\");", "  if (!path) throw new Error(\"ETL_CONFIG_UNREADABLE\");\n  const raw = await readFile(path, \"utf8\");") }]);
    const p = planV5(m, c, files, "The scheduler fails: ETL_CONFIG_FAILED, after ETL_CONFIG_UNREADABLE.");
    assert.equal(tr(p, "ETL_CONFIG_FAILED"), "TRACE_ALREADY_PLANNED");
    assert.equal(tr(p, "ETL_CONFIG_UNREADABLE"), "TRACE_INDEPENDENT");
  } },
  // -- trace-plan-cause: causes become ranked missing edit-source steps above the symptom; a shared cause once;
  //    a refused diagnosis has no trace and is still v4's plan exactly
  { id: "billing-cause-steps-ranked", shape: "billing", kind: "admit", condition: "trace-plan-cause", run: (m, c) => {
    const p = planV5(m, c, BILLING, TOTAL_ONLY);
    assert.deepEqual(steps(p), [`edit-source ${PR} priceFor`, `edit-source ${PR} lookupPrice`, `edit-source ${SVC} issue`, `edit-test ${B}/test/invoice-service.test.ts -`, "run-tests - -"]);
    assert.deepEqual(p.files.map((f) => `${f.role} ${f.path}`), [`source ${SVC}`, `source ${PR}`, `test ${B}/test/invoice-service.test.ts`]);
    assert.ok(p.diagnosis.notYet.includes("fix-at-probable-cause"));
    assert.equal(p.understanding.scope.sources, 2);
    allMissing(p);
  } },
  { id: "etl-cause-steps-ranked", shape: "etl", kind: "admit", condition: "trace-plan-cause", run: (m, c) => {
    const p = planV5(m, c, ETL, ETL_REQ);
    assert.deepEqual(steps(p), ["edit-source src/read.js readBatch", "edit-source src/parse.js parseRows", "edit-source src/write.js writeBatch", "edit-source src/pipeline.js run", "edit-source src/config.js loadConfig", "edit-source src/schedule.js tick", "edit-test test/pipeline.test.js -", "edit-test test/schedule.test.js -", "run-tests - -"]);
    assert.equal(p.tests.command, "npx vitest run test/pipeline.test.js test/schedule.test.js");
    allMissing(p);
  } },
  { id: "billing-shared-cause-stepped-once", shape: "billing", kind: "refuse", condition: "trace-plan-cause", run: (m, c) => {
    const files = svc(IF_PLAN, `${IF_PLAN}\n    if (plan === "legacy") throw new BillingError("INVOICE_PLAN_RETIRED");`);
    const p = planV5(m, c, files, "Invoices fail with INVOICE_PLAN_MISSING and INVOICE_PLAN_RETIRED.");
    assert.equal(tr(p, "INVOICE_PLAN_RETIRED"), `- ${PLAN_OF}`);
    assert.deepEqual(steps(p), [`edit-source ${SVC} planOf`, `edit-source ${SVC} issue`, `edit-test ${B}/test/invoice-service.test.ts -`, "run-tests - -"]);
  } },
  { id: "etl-shared-cause-stepped-once-and-refusal-is-v4", shape: "etl", kind: "refuse", condition: "trace-plan-cause", run: (m, c) => {
    const files = pipe(IF_EMPTY, `${IF_EMPTY}\n  if (rows.length > 1000) throw new Error("ETL_BATCH_TOO_LARGE");`);
    const p = planV5(m, c, files, "The import job fails with ETL_BATCH_EMPTY or ETL_BATCH_TOO_LARGE.");
    assert.deepEqual(steps(p).filter((s) => s.includes("readBatch")), ["edit-source src/read.js readBatch"]);
    const req = "Document ETL_BATCH_EMPTY in the import guide.";
    const r = planV5(m, c, ETL, req);
    assert.equal(r.diagnosis.refused, "NO_FAILURE_REPORT");
    assert.deepEqual(r.diagnosis.traces, []);
    const { planner: _a, diagnosis: _b, ...rest } = r;
    const { planner: _c, ...v4 } = planV4(c, ETL, req);
    assert.deepEqual(rest, v4);
  } },
];
