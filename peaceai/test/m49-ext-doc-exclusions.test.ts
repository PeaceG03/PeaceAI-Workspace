// M49 (Architect (A), Auditor #251): the pretrain per-doc exclusion list drops exactly the listed content sha256s and
// fails closed on a malformed file or a bad sha.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXT_DOC_EXCLUSIONS_SCHEMA, parseDocExclusions } from "../lib/extcorpus.ts";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const root = resolve(import.meta.dirname, "../..");

test("listed sha256 is dropped; an unlisted neighbour (one byte different) is kept", () => {
  const listed = "export const a = 1;\n", neighbour = "export const a = 2;\n";
  const ex = parseDocExclusions({ schema: EXT_DOC_EXCLUSIONS_SCHEMA, excludedDocSha256: [sha(listed)] });
  assert.equal(ex.has(sha(listed)), true);
  assert.equal(ex.has(sha(neighbour)), false);
});

test("malformed exclusions file or a bad sha is refused (fail closed)", () => {
  const good = "a".repeat(64);
  for (const bad of [null, 7, "x", [], {}, { schema: "peaceai-ext-doc-exclusions:v2", excludedDocSha256: [good] }, { schema: EXT_DOC_EXCLUSIONS_SCHEMA },
    { schema: EXT_DOC_EXCLUSIONS_SCHEMA, excludedDocSha256: good }, { schema: EXT_DOC_EXCLUSIONS_SCHEMA, excludedDocSha256: [good, "A".repeat(64)] },
    { schema: EXT_DOC_EXCLUSIONS_SCHEMA, excludedDocSha256: ["a".repeat(63)] }, { schema: EXT_DOC_EXCLUSIONS_SCHEMA, excludedDocSha256: [good, 5] },
    { schema: EXT_DOC_EXCLUSIONS_SCHEMA, excludedDocSha256: [good + " "] }]) {
    assert.throws(() => parseDocExclusions(bad), /fail closed/, JSON.stringify(bad));
  }
});

test("committed list: 40 entries, all valid; ext-corpus.ts reads it only through parseDocExclusions, before dedup and repo-cap", () => {
  const ex = parseDocExclusions(JSON.parse(readFileSync(resolve(root, "peaceai/model/ext-doc-exclusions.json"), "utf8")));
  assert.equal(ex.size, 40);
  const src = readFileSync(resolve(root, "peaceai/bin/ext-corpus.ts"), "utf8");
  assert.match(src, /const excludedDocs = parseDocExclusions\(JSON\.parse\(readFileSync\(join\(model, "ext-doc-exclusions\.json"\)/);
  const at = (s: string) => { const i = src.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at('excludedDocs.has(sha256)) why = "core-proof"') < at('seen.has(sha256)) why = "duplicate"'));
  assert.ok(at('why = "core-proof"') < at('why = "repo-cap"'));
});
