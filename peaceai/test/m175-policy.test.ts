// M175 policy pin (m168-style): the general edit-scope gate's pinned policy and its vocabulary. Widening the policy
// (to admit a wider scope once a proposer and a forging test for it land) is a one-line change in loop.ts that a
// reviewer has to see, because this test pins the exact value. Spec: peaceai/spec/edit-gate-m175.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDIT_SCOPE_POLICY, EDIT_DANGEROUS, EDIT_NEW_WORDS, EDIT_EXPORT_SHAPE, LOAD_DIAG_CAPS } from "../lib/loop.ts";
import { EDIT_SCOPE_CLASSES } from "../lib/looprow.ts";

test("M175 policy: EDIT_SCOPE_POLICY is pinned (edit: export-keyword + in-body; load: export-keyword only)", () => {
  assert.deepEqual(EDIT_SCOPE_POLICY, { edit: ["export-keyword", "in-body"], load: ["export-keyword"] });
  // frozen, so a run cannot widen it in process
  assert.ok(Object.isFrozen(EDIT_SCOPE_POLICY) && Object.isFrozen(EDIT_SCOPE_POLICY.edit) && Object.isFrozen(EDIT_SCOPE_POLICY.load));
  // every policy entry is a known class
  for (const m of ["edit", "load"] as const) for (const c of EDIT_SCOPE_POLICY[m]) assert.ok((EDIT_SCOPE_CLASSES as readonly string[]).includes(c), `${c} is a known class`);
});

test("M175 policy: the admitted classes, the dangerous-word set and the allowed new words are pinned", () => {
  assert.deepEqual([...EDIT_SCOPE_CLASSES], ["export-keyword", "in-body"]);
  assert.deepEqual([...EDIT_DANGEROUS], ["globalThis", "global", "eval", "Function", "require", "Reflect", "Proxy", "__proto__", "expect", "assert", "vi", "jest",
    "constructor", "prototype", "getPrototypeOf", "setPrototypeOf", "getOwnPropertySymbols", "getOwnPropertyNames", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "defineProperty",
    "defineProperties", "assign", "Symbol", "import", "process", "module", "exports", "arguments"]);
  assert.deepEqual([...EDIT_NEW_WORDS], ["any", "as", "export", "false", "if", "in", "null", "object", "return", "toLowerCase", "toUpperCase", "true", "typeof", "undefined"]);
  // no allowed new word is a dangerous word
  for (const w of EDIT_NEW_WORDS) assert.ok(!EDIT_DANGEROUS.includes(w), w);
});

test("M175 policy: the export-keyword shape and the diagnostics compile bounds are pinned (one source of truth for both gates)", () => {
  assert.deepEqual(EDIT_EXPORT_SHAPE, { inserts: 1, token: "export ", kinds: ["ClassDeclaration", "EnumDeclaration", "FunctionDeclaration", "InterfaceDeclaration", "TypeAliasDeclaration", "VariableStatement"] });
  assert.ok(Object.isFrozen(EDIT_EXPORT_SHAPE) && Object.isFrozen(EDIT_EXPORT_SHAPE.kinds));
  assert.deepEqual(LOAD_DIAG_CAPS, { files: 400, bytes: 4 * 1024 * 1024, ms: 20_000 });
  assert.ok(Object.isFrozen(LOAD_DIAG_CAPS));
});
