// Architect's revision of the nullish-default rule (Results #3): single read only, default kinds with
// evidence support (null had one example, dropped), trigger accepts only those kinds; proposal template
// wording for delegated approval.
import assert from "node:assert/strict";
import test from "node:test";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { APPROVAL_NOTE, MIN_KIND_SUPPORT, proposalBody, proposeRules } from "../lib/propose.ts";

const STATS = { shape: "NULLISH_DEFAULT", covered: null, hunks: 11, commits: 8, files: 7, examples: [], styles: { default: { array: 7, null: 1, string: 3 }, target: { member: 9, other: 2 } } } as never;
const proposal = () => proposeRules([STATS], "core", ["PeaceG03/PeaceAI"]).proposals[0]!;

test("v2 spec: id, kinds with >= 2 examples only (null dropped), single-read param, valid and hash-stable", () => {
  const p = proposal();
  assert.equal(MIN_KIND_SUPPORT, 2);
  assert.equal(p.spec.id, "core-add-nullish-default-v2");
  assert.deepEqual(p.spec.params, { kinds: ["array", "string"], reads: "single", target: "member" });
  assert.ok(validateSpec(p.spec));
  assert.equal(p.sha256, specHash(p.spec));
  assert.equal(proposal().sha256, p.sha256, "deterministic");
});

test("v2 trigger accepts only the allowed kinds ([] and string literals)", () => {
  const re = new RegExp(proposal().spec.trigger, "i");
  for (const ok of ["default `opts.items` to [] in `count`", 'default opts.name to "x" in label', "default opts.name to 'x' in label in src/a.ts"]) assert.ok(re.test(ok), ok);
  for (const no of ["default opts.items to null in count", "default opts.n to 0 in count", "default opts.on to true in count", "default opts.n to -1.5 in count"]) assert.ok(!re.test(no), no);
});

test("v2 engine: one read -> default added; the field read more than once in the function -> refused", () => {
  const spec = proposal().spec as RuleSpec;
  const one = "export function count(opts: { items?: string[] }): number {\n  const xs = opts.items;\n  return (xs ?? []).length;\n}\n";
  assert.match(applyRule(spec, "default `opts.items` to [] in `count`", [{ path: "src/c.ts", content: one }])!.content, /const xs = opts\.items \?\? \[\];/);
  const two = "export function count(opts: { items?: string[] }): number {\n  const xs = opts.items;\n  if (!opts.items) return 0;\n  return (xs ?? []).length;\n}\n";
  assert.equal(applyRule(spec, "default `opts.items` to [] in `count`", [{ path: "src/c.ts", content: two }]), null);
  const assignedThenRead = "export function reset(opts: { items?: string[] }): number {\n  opts.items = [];\n  const xs = opts.items;\n  return xs.length;\n}\n";
  assert.match(applyRule(spec, "default `opts.items` to [] in `reset`", [{ path: "src/c.ts", content: assignedThenRead }])!.content, /const xs = opts\.items \?\? \[\];/, "a write is not a read");
  assert.equal(applyRule(spec, "default `opts.items` to null in `count`", [{ path: "src/c.ts", content: one }]), null);
});

test("proposal template: delegated-approval wording and the accepted kinds in the phrasing", () => {
  const body = proposalBody(proposal(), [], ["x"]);
  assert.ok(body.includes(APPROVAL_NOTE));
  assert.equal(APPROVAL_NOTE, "Architect posts `/approve-rule` under Peace's delegation, with a note on what was checked.");
  assert.ok(!body.includes("Agents never post"));
  assert.match(body, /where VALUE is `\[\]` or a string literal/);
  assert.match(body, /Refused when `obj\.field` is read more than once/);
});
