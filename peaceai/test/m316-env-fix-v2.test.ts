// M316 public-env-fix-v2: ENV_FIX int also accepts Number(X ?? "N") and Number(X) || D (one read only).
// Examples: peaceai/rules/evidence/public-env-fix-v2-examples.json (2 PeaceSTOCKS read sites + 8 external,
// license-pinned, one quoted line each). Each example line is wrapped in a tiny synthetic module and must build
// exactly one edit; refusals cover non-numeric/zero/fractional/out-of-range defaults and mixed reads. v1 is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyRule, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { helperName } from "../lib/env-fix.ts";

const dir = join(import.meta.dirname, "..", "rules");
const V2 = JSON.parse(readFileSync(join(dir, "learned", "public-env-fix-v2.json"), "utf8")) as RuleSpec;
const V1 = JSON.parse(readFileSync(join(dir, "learned", "public-env-fix-v1.json"), "utf8")) as RuleSpec;
const EV = JSON.parse(readFileSync(join(dir, "evidence", "public-env-fix-v2-examples.json"), "utf8"));
const run = (s: RuleSpec, task: string, content: string) => { const why: { reason?: string } = {}; const e = applyRule(s, task, [{ path: "src/a.ts", content }], undefined, undefined, why); return { e, r: why.reason }; };
const nameOf = (line: string) => /env(?:\.|\[["'])([A-Z][A-Z0-9_]+)/.exec(line)![1]!;
const task = (name: string, max = 21600000) => `make env \`${name}\` strict in \`src/a.ts\` as an integer 1..${max}`;
const wrap = (line: string) => `export function f(): unknown {\n${line.trim().replace(/[,;]?$/, ";")}\n  return 0;\n}\n`.replace(/^port: /m, "const port = ");

test("v2 spec validates; v1 spec still validates and keeps its hash-pinned params", () => {
  assert.ok(validateSpec(V2));
  assert.ok(validateSpec(V1));
  assert.equal((V2.params as Record<string, string>).int, "ternary-nullish-or");
  assert.equal("int" in (V1.params as Record<string, string>), false);
  assert.ok(!validateSpec({ ...V2, params: { ...(V2.params as object), int: "anything" } }));
});

test("evidence: at least 10 examples, Peace repos first, externals license-pinned", () => {
  assert.ok(EV.examples.length >= 10);
  assert.equal(EV.examples[0].repo, "PeaceG03/PeaceSTOCKS");
  for (const x of EV.examples.filter((x: { origin: string }) => x.origin === "external")) assert.match(x.licenseSha256, /^[0-9a-f]{64}$/);
});

for (const x of EV.examples as { repo: string; path: string; before: string; form: string }[])
  test(`example builds one edit (${x.form}): ${x.repo} ${x.path}`, () => {
    const name = nameOf(x.before);
    const { e, r } = run(V2, task(name), wrap(x.before));
    assert.ok(e, r);
    const h = helperName(name);
    assert.ok(e!.content.includes(`${h}(process.env.${name})`));
    assert.ok(!/Number\(process\.env\./.test(e!.content.split("\n/**")[0]!), "the read is replaced");
    assert.equal(e!.extra?.length, 1);
  });

test("the same examples are refused by v1 (v1 behaviour unchanged)", () => {
  for (const x of EV.examples as { before: string }[]) assert.equal(run(V1, task(nameOf(x.before)), wrap(x.before)).e, null);
});

test("helper keeps the default: Number(X ?? \"15000\") -> blank gives 15000", async () => {
  const { e } = run(V2, task("DELAY_MS", 600000), 'export const d = () => Number(process.env.DELAY_MS ?? "15000");\n');
  assert.match(e!.content, /if \(!s\) return 15000;/);
  const { e: e2 } = run(V2, task("BUDGET_MS"), "export const b = () => Number(process.env.BUDGET_MS) || 5 * 3_600_000;\n");
  assert.match(e2!.content, /if \(!s\) return 5 \* 3_600_000;/);
});

const bad: [string, string, string, number?][] = [
  ["non-numeric default (empty)", 'export const n = Number(process.env.FOO ?? "");\n', "env_fix_bad_default"],
  ["non-numeric default (word)", 'export const n = Number(process.env.FOO ?? "abc");\n', "env_fix_bad_default"],
  ["zero default (nullish)", 'export const n = Number(process.env.FOO ?? "0");\n', "env_fix_bad_default"],
  ["zero default (or)", "export const n = Number(process.env.FOO) || 0;\n", "env_fix_bad_default"],
  ["fractional default", "export const n = Number(process.env.FOO) || 0.7;\n", "env_fix_bad_default"],
  ["null default", "export const n = Number(process.env.FOO) || null;\n", "env_fix_bad_default"],
  ["call default", "export const n = Number(process.env.FOO) || Date.now();\n", "env_fix_bad_default"],
  ["numeric (not string) nullish default", "export const n = Number(process.env.FOO ?? 3);\n", "env_fix_bad_default"],
  ["default above MAX", 'export const n = Number(process.env.FOO ?? "99");\n', "env_fix_bad_default", 10],
  ["mixed reads: second raw read", 'export const n = Number(process.env.FOO ?? "3");\nexport const raw = process.env.FOO;\n', "env_fix_mixed_reads"],
  ["mixed reads: two shaped reads", "export const a = Number(process.env.FOO) || 3;\nexport const b = Number(process.env.FOO) || 4;\n", "env_fix_mixed_reads"],
  ["X || \"0\" inner fallback (TENMIN_CHAIN shape)", 'export const c = Number(process.env.FOO || "0") || 1;\n', "env_fix_mixed_reads"],
  ["no read", "export const n = 3;\n", "env_fix_read_not_found"],
];
for (const [name, content, code, max] of bad)
  test(`v2 refused (${code}): ${name}`, () => {
    const { e, r } = run(V2, task("FOO", max ?? 10), content);
    assert.equal(e, null); assert.equal(r, code);
  });

test("v2 still builds the v1 ternary shape and the flag shape", () => {
  assert.ok(run(V2, task("FOO", 10), "export const n = Number(process.env.FOO) > 0 ? Number(process.env.FOO) : 3;\n").e);
  assert.ok(run(V2, "make env `FOO` strict in `src/a.ts` as a flag", 'export const a = process.env.FOO === "1";\n').e);
});
