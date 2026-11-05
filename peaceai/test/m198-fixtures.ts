// M198 fixtures (Batch 34): small in-memory repositories written for plan-only-v5's symptom-to-cause trace. They share
// nothing with any training, task or Peace project repo (no Peace project code, fixture, request wording or reference
// diff, and no dev-task idiom). Two module styles:
//   BILLING: a pnpm + jest workspace, TypeScript ESM, a CLASS-BASED service. packages/billing/src/invoice-service.ts
//            throws INVOICE_PLAN_MISSING when `this.planOf(id)` gives no plan, INVOICE_TOTAL_INVALID when the imported
//            `priceFor` (which delegates to a same-file `lookupPrice`) gives no price, rethrows a failed `this.render`
//            as INVOICE_DELIVERY_FAILED, and logs INVOICE_SETTLE_FAILED through `this.logger.error` when
//            `this.deliver` fails. packages/shared is another workspace package (`@b/shared`).
//   ETL:     a flat npm + vitest package, CommonJS JavaScript, a FUNCTIONAL PIPELINE of const arrows and plain
//            functions wired with destructured `require`. src/pipeline.js throws ETL_BATCH_EMPTY when `readBatch`
//            (which delegates to `parseRows`) gives no rows, rethrows a failed `writeBatch` as ETL_WRITE_FAILED;
//            src/schedule.js logs ETL_CONFIG_FAILED when `loadConfig` fails. modules/csv is a nested package (`csv-lite`).
import type { IndexFile } from "../lib/symbols.ts";
import { LICENSE } from "./m153-fixtures.ts";

const json = (o: unknown) => JSON.stringify(o, null, 2) + "\n";
const lines = (...l: string[]) => [...l, ""].join("\n");

export const B = "packages/billing";
export const INVOICE = lines(
  'import { BillingError } from "./errors.ts";',
  'import { priceFor } from "./prices.ts";',
  "export interface Customer { id: string; plan: string | null }",
  "export class InvoiceService {",
  "  constructor(",
  "    private readonly customers: Map<string, Customer>,",
  "    private readonly outbox: { send(to: string, body: string): Promise<void> },",
  "    private readonly logger: { error(m: string): void },",
  "  ) {}",
  "  private planOf(id: string): string | null {",
  "    const c = this.customers.get(id);",
  "    return c ? c.plan : null;",
  "  }",
  "  issue(id: string): { id: string; total: number } {",
  "    const plan = this.planOf(id);",
  '    if (!plan) throw new BillingError("INVOICE_PLAN_MISSING");',
  "    const total = priceFor(plan);",
  "    if (total <= 0) {",
  "      throw new BillingError(`INVOICE_TOTAL_INVALID:${plan}`);",
  "    }",
  "    return { id, total };",
  "  }",
  "  private async render(id: string): Promise<void> {",
  "    const inv = this.issue(id);",
  "    await this.outbox.send(id, `total ${inv.total}`);",
  "  }",
  "  async deliver(id: string): Promise<void> {",
  "    try {",
  "      await this.render(id);",
  "    } catch {",
  '      throw new BillingError("INVOICE_DELIVERY_FAILED");',
  "    }",
  "  }",
  "  async settle(ids: string[]): Promise<void> {",
  "    for (const id of ids) {",
  "      try {",
  "        await this.deliver(id);",
  "      } catch {",
  "        this.logger.error(`INVOICE_SETTLE_FAILED:${id}`);",
  "      }",
  "    }",
  "  }",
  "}",
);
export const PRICES = lines(
  'import { readTable } from "./tables.ts";',
  "export function priceFor(plan: string): number {",
  "  return lookupPrice(readTable(), plan);",
  "}",
  "function lookupPrice(table: Map<string, number>, plan: string): number {",
  "  const p = table.get(plan);",
  "  return p === undefined ? 0 : p;",
  "}",
);
export const BILLING: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: json({ name: "billing-fixture", private: true, scripts: { test: "pnpm -r test" } }) },
  { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'\n" },
  { path: "pnpm-workspace.yaml", content: "packages:\n  - packages/*\n" },
  { path: `${B}/package.json`, content: json({ name: "@b/billing", scripts: { test: "jest" }, devDependencies: { jest: "29.0.0" } }) },
  { path: `${B}/src/errors.ts`, content: "export class BillingError extends Error {\n  constructor(code: string) {\n    super(code);\n  }\n}\n" },
  { path: `${B}/src/tables.ts`, content: 'export function readTable(): Map<string, number> {\n  return new Map([["basic", 9], ["pro", 29]]);\n}\n' },
  { path: `${B}/src/prices.ts`, content: PRICES },
  { path: `${B}/src/invoice-service.ts`, content: INVOICE },
  { path: `${B}/test/invoice-service.test.ts`, content: 'import { InvoiceService } from "../src/invoice-service.ts";\ntest("issue", () => { expect(typeof InvoiceService).toBe("function"); });\n' },
  { path: `${B}/test/prices.test.ts`, content: 'import { priceFor } from "../src/prices.ts";\ntest("price", () => { expect(priceFor("pro")).toBe(29); });\n' },
  { path: "packages/shared/package.json", content: json({ name: "@b/shared", scripts: { test: "jest" }, devDependencies: { jest: "29.0.0" } }) },
  { path: "packages/shared/src/rates.ts", content: 'export function rateFor(region: string): number {\n  if (!region) throw new Error("region");\n  return region === "eu" ? 0.2 : 0.1;\n}\n' },
  { path: "packages/shared/test/rates.test.ts", content: 'import { rateFor } from "../src/rates.ts";\ntest("rate", () => { expect(rateFor("eu")).toBe(0.2); });\n' },
];
export function billingWith(over: IndexFile[], drop: (p: string) => boolean = () => false): IndexFile[] {
  return [...BILLING.filter((f) => !drop(f.path) && !over.some((o) => o.path === f.path)), ...over];
}

export const PIPELINE = lines(
  "const { readBatch } = require(\"./read\");",
  "const { writeBatch } = require(\"./write\");",
  "const run = async (text, sink) => {",
  "  const rows = readBatch(text);",
  "  if (rows.length === 0) throw new Error(\"ETL_BATCH_EMPTY\");",
  "  try {",
  "    await writeBatch(rows, sink);",
  "  } catch (err) {",
  "    throw new Error(`ETL_WRITE_FAILED:${err.message}`);",
  "  }",
  "  return rows.length;",
  "};",
  "module.exports = { run };",
);
export const READ = lines(
  "const { parseRows } = require(\"./parse\");",
  "function readBatch(text) {",
  "  return parseRows(text);",
  "}",
  "module.exports = { readBatch };",
);
export const PARSE = lines(
  "function parseRows(text) {",
  "  return text.split(\"\\n\").filter(Boolean).map((l) => l.split(\",\"));",
  "}",
  "module.exports = { parseRows };",
);
export const SCHEDULE = lines(
  "const { loadConfig } = require(\"./config\");",
  "const tick = async (log) => {",
  "  try {",
  "    await loadConfig(process.env.ETL_CONFIG_PATH);",
  "  } catch (e) {",
  "    log.error(\"ETL_CONFIG_FAILED\", e);",
  "  }",
  "};",
  "module.exports = { tick };",
);
export const CONFIG = lines(
  "const { readFile } = require(\"node:fs/promises\");",
  "async function loadConfig(path) {",
  "  const raw = await readFile(path, \"utf8\");",
  "  return JSON.parse(raw);",
  "}",
  "module.exports = { loadConfig };",
);
export const ETL: IndexFile[] = [
  { path: "LICENSE", content: LICENSE },
  { path: "package.json", content: json({ name: "etl-fixture", type: "commonjs", scripts: { test: "vitest" }, devDependencies: { vitest: "1.0.0" } }) },
  { path: "package-lock.json", content: json({ name: "etl-fixture", lockfileVersion: 3, packages: {} }) },
  { path: "src/pipeline.js", content: PIPELINE },
  { path: "src/read.js", content: READ },
  { path: "src/parse.js", content: PARSE },
  { path: "src/write.js", content: "async function writeBatch(rows, sink) {\n  for (const r of rows) await sink.put(r);\n}\nmodule.exports = { writeBatch };\n" },
  { path: "src/schedule.js", content: SCHEDULE },
  { path: "src/config.js", content: CONFIG },
  { path: "test/pipeline.test.js", content: 'const { run } = require("../src/pipeline");\nconst { test, expect } = require("vitest");\ntest("run", () => { expect(typeof run).toBe("function"); });\n' },
  { path: "test/schedule.test.js", content: 'const { tick } = require("../src/schedule");\nconst { test, expect } = require("vitest");\ntest("tick", () => { expect(typeof tick).toBe("function"); });\n' },
  { path: "modules/csv/package.json", content: json({ name: "csv-lite", main: "split.js" }) },
  { path: "modules/csv/split.js", content: "function splitCsv(text) {\n  if (typeof text !== \"string\") throw new TypeError(\"text\");\n  return text.split(\"\\n\");\n}\nmodule.exports = { splitCsv };\n" },
];
export function etlWith(over: IndexFile[], drop: (p: string) => boolean = () => false): IndexFile[] {
  return [...ETL.filter((f) => !drop(f.path) && !over.some((o) => o.path === f.path)), ...over];
}

/** Requests written for these fixtures: failure reports in plain words plus the codes a log would show. */
export const BILLING_REQ = "The monthly invoice run fails. Logs show INVOICE_PLAN_MISSING, then INVOICE_TOTAL_INVALID:pro and INVOICE_SETTLE_FAILED:c7. A customer without a stored plan must be skipped and every plan must have a price. Add regression tests.";
export const ETL_REQ = "The nightly import job fails with ETL_BATCH_EMPTY, then ETL_WRITE_FAILED:timeout and ETL_CONFIG_FAILED. An empty input must be reported instead of crashing the job, and a failed write must be retried. Add regression tests.";
