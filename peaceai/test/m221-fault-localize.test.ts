// M221: failing-test-driven fault localization pins + mutant. EXPERIMENTAL, not for credit.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as F from "../lib/fault-localize.ts";
import { SAFE_HELPERS } from "../lib/self-zone.ts";

const libDir = join(import.meta.dirname, "../lib");
const specPath = join(import.meta.dirname, "../spec/fault-localize-v1.md");
const base = mkdtempSync(join(tmpdir(), "peaceai-m221-"));
after(() => rmSync(base, { recursive: true, force: true }));

test("M221 pins: SAFE_HELPERS-only locate; catalog kinds; ignores non-safe paths", () => {
  const files = [
    { path: "peaceai/self-tests/helpers/dates.ts", content: "export function utcDayKey(d: Date): string { return d.toISOString().slice(0, 7); }\n" },
    { path: "peaceai/lib/loop.ts", content: "export function utcDayKey(): string { return \"x\"; }\n" },
  ];
  const fns = F.locateSafeFns(files, "Fix utcDayKey so it returns YYYY-MM-DD.", []);
  assert.equal(fns.length, 1);
  assert.equal(fns[0]!.path, "peaceai/self-tests/helpers/dates.ts");
  assert.ok((SAFE_HELPERS as readonly string[]).includes(fns[0]!.path));
  const muts = F.mutateFunction(fns[0]!.path, files[0]!.content, fns[0]!);
  assert.ok(muts.some((m) => m.kind === "boundary"), "boundary mutates slice literal");
  assert.ok(!(F.STRING_METHOD_CATALOG as readonly string[]).includes("replace"));
});

test("M221 proposer: queue then NO_MORE_EDITS; empty -> NO_EDIT", () => {
  const empty = F.faultLocalizeProposer();
  const r0 = empty.next({
    request: "nothing relevant",
    repo: "PeaceG03/PeaceAI-Workspace",
    plan: { schema: "x", steps: [], canDo: [], cannotDo: [], notes: [] } as any,
    files: [{ path: "peaceai/self-tests/helpers/dates.ts", content: "export function utcDayKey(d: Date): string { return d.toISOString().slice(0, 10); }\n" }],
    context: [],
    attempt: 1,
    feedback: [],
  });
  assert.deepEqual(r0, { refuse: "NO_EDIT" });

  const p = F.faultLocalizeProposer();
  const files = [{ path: "peaceai/self-tests/helpers/dates.ts", content: "export function utcDayKey(d: Date): string { return d.toISOString().slice(0, 7); }\n" }];
  const input = {
    request: "Fix utcDayKey calendar day key length.",
    repo: "PeaceG03/PeaceAI-Workspace",
    plan: { schema: "x", steps: [], canDo: [], cannotDo: [], notes: [] } as any,
    files,
    context: [],
    attempt: 1,
    feedback: [],
  };
  const first = p.next(input);
  assert.ok("edits" in first);
  if ("edits" in first) assert.equal(first.edits[0]!.path, files[0]!.path);
});

test("M221 spec names failing-test-driven approach and held-out seal", () => {
  const spec = readFileSync(specPath, "utf8");
  assert.match(spec, /failing-test-driven|SAFE_HELPERS/);
  assert.match(spec, /operator swap|boundary|missing return/i);
  assert.match(spec, /held-out|heldout/i);
  assert.match(spec, /m221-guard/);
  assert.match(spec, /not special-case|general/i);
});

test("M221 argument-swap mutates two-param body usages", () => {
  const path = "peaceai/self-tests/helpers/text.ts";
  const content = "export function plural(count: number, word: string): string {\n  return count === 1 ? `${word} ${count}` : `${word}s ${count}`;\n}\n";
  const fns = F.locateSafeFns([{ path, content }], "Fix plural argument order.", []);
  assert.equal(fns.length, 1);
  const muts = F.mutateFunction(path, content, fns[0]!);
  assert.ok(muts.some((m) => m.kind === "argument-swap" && m.content.includes("${count} ${word}")), JSON.stringify(muts.map((m) => m.kind)));
});

const SRC = readFileSync(join(libDir, "fault-localize.ts"), "utf8");
const tsPath = createRequire(join(libDir, "fault-localize.ts")).resolve("typescript");
function rewrite(t: string): string {
  return t
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
}
const tagsOf = (t: string) => t.split("\n").flatMap((l) => {
  const m = /\/\/ m221-guard:([a-z0-9-]+)/.exec(l);
  return m ? [m[1]!] : [];
});
const drop = (text: string, tag: string) => {
  const ls = text.split("\n");
  const hit = (l: string) => new RegExp(`// m221-guard:${tag}(?![a-z0-9-])`).test(l);
  assert.equal(ls.filter(hit).length, 1, `one line holds ${tag}`);
  return ls.filter((l) => !hit(l)).join("\n");
};

test("M221 mutation: every m221-guard has a case; deleting it is caught", async () => {
  const tags = tagsOf(SRC);
  assert.deepEqual(tags.sort(), ["empty", "in-body", "locate", "safe-only"]);
  const dir = join(base, "mut");
  mkdirSync(dir, { recursive: true });
  const load = async (text: string) => {
    const f = join(dir, `m-${Math.random().toString(16).slice(2)}.ts`);
    writeFileSync(f, rewrite(text));
    return (await import(pathToFileURL(f).href)) as typeof F;
  };
  const control = await load(SRC);
  const files = [
    { path: "peaceai/self-tests/helpers/dates.ts", content: "export function utcDayKey(d: Date): string { return d.toISOString().slice(0, 7); }\n" },
    { path: "peaceai/lib/loop.ts", content: "export function utcDayKey(): string { return \"x\"; }\n" },
  ];
  assert.equal(control.locateSafeFns(files, "Fix utcDayKey.", []).length, 1);

  {
    const m = await load(drop(SRC, "safe-only"));
    assert.ok(m.locateSafeFns(files, "Fix utcDayKey.", []).length >= 2);
  }
  {
    const m = await load(drop(SRC, "locate"));
    // deleting the locate call line breaks faultCandidates - replace leaves syntax error unless the line is the call assignment
    // Our guard is on the call site: `const fns = locateSafeFns(...); // m221-guard:locate`
    // Deleting it means fns undefined -> throw; catch by expecting faultCandidates to throw or return []
    let threw = false;
    try { m.faultCandidates({ files, request: "Fix utcDayKey.", feedback: [] }); }
    catch { threw = true; }
    assert.ok(threw || m.faultCandidates({ files, request: "Fix utcDayKey.", feedback: [] }).length === 0);
  }
  {
    const m = await load(drop(SRC, "empty"));
    const p = m.faultLocalizeProposer();
    const r = p.next({
      request: "nothing",
      repo: "x/y",
      plan: { schema: "x", steps: [], canDo: [], cannotDo: [], notes: [] } as any,
      files: [{ path: "peaceai/self-tests/helpers/dates.ts", content: "export function utcDayKey(d: Date): string { return d.toISOString().slice(0, 10); }\n" }],
      context: [],
      attempt: 1,
      feedback: [],
    });
    // without empty refuse, falls through to NO_MORE_EDITS or edits
    assert.notDeepEqual(r, { refuse: "NO_EDIT" });
  }
  {
    const m = await load(drop(SRC, "in-body"));
    const path = "peaceai/self-tests/helpers/dates.ts";
    const content = "const OUTSIDE = 7;\nexport function utcDayKey(d: Date): string { return d.toISOString().slice(0, 7); }\n";
    const fns = m.locateSafeFns([{ path, content }], "Fix utcDayKey.", []);
    const muts = m.mutateFunction(path, content, fns[0]!);
    // without in-body guard, a mutation could target OUTSIDE literal 7
    assert.ok(muts.some((c) => c.content.includes("const OUTSIDE = 8") || c.content.includes("const OUTSIDE = 6")));
  }
});
