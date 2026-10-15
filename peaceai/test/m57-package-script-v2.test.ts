// M57: PACKAGE_SCRIPT v2 proposal (a new kind; v1 unchanged). Real-file evidence replay, acceptance and refusals.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readManifestBytes } from "../lib/manifestparts.ts";
import test from "node:test";
import { packageScriptV2Enabled, packageScriptV2Problem } from "../lib/package-script-v2.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const EV = JSON.parse(read("peaceai/rules/proposals/m57-package-script-v2-evidence.json"));
const REC = JSON.parse(read("peaceai/rules/proposals/public-package-script-v2.json"));
const FIX = "peaceai/test/fixtures/m57/";
const gitBlob = (b: Buffer) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest("hex");
const WF = ["run: pnpm run lint", "run: npm test"];
const pkg = (scripts: Record<string, string>, deps: Record<string, string> = { vitest: "^3", "npm-run-all": "^4", tsc: "^5" }) => JSON.stringify({ name: "x", scripts, devDependencies: deps }, null, 2) + "\n";
const BASE = { build: "tsc -p .", lint: "eslint .", "docs-build": "vitepress build docs", test: "vitest run" };
const add = (k: string, v: string, at = 1) => { const e = Object.entries(BASE); e.splice(at, 0, [k, v]); return pkg(Object.fromEntries(e)); };
const P = (after: string, before = pkg(BASE), wf: string[] = WF) => packageScriptV2Problem("package.json", before, after, wf);
let refusals = 0;
const refuse = (r: string | null, msg: string) => { assert.notEqual(r, null, msg); refusals++; };

test("off by default; not approved; v1 untouched", () => {
  assert.equal(packageScriptV2Enabled({}), false);
  assert.equal(packageScriptV2Enabled({ PEACEAI_PACKAGE_SCRIPT_V2: "yes" }), false);
  assert.equal(packageScriptV2Enabled({ PEACEAI_PACKAGE_SCRIPT_V2: "true" }), true);
  assert.ok(!read("peaceai/rules/approved.json").includes("public-package-script-v2"));
  assert.match(REC.status, /^proposal-off/);
  assert.ok(!read("peaceai/lib/learned.ts").includes("package-script-v2"));
});

test("evidence: licensed external, none from set C, replays on the REAL files (blob-pinned fixtures)", () => {
  const setc = new Set((JSON.parse(read("peaceai/model/heldout-c.json")).sets.C as { repo: string }[]).map((r) => r.repo));
  const lic = new Map([...JSON.parse(read("peaceai/model/ext-corpus.json")).repos, ...JSON.parse(read("peaceai/rules/proposals/m45-example-repos.json")).repos].map((r: { name: string; licenseSha256: string }) => [r.name, r.licenseSha256]));
  assert.deepEqual(readdirSync(join(root, FIX)).filter((n) => !/\.(before|after)\.txt$/.test(n)), [], "fixtures hold only before/after files (no LICENSE text; license pinned by sha256 in the repo records)");
  for (const x of EV.examples as { repo: string; commit: string; name: string; licenseSha256: string; origin: string; beforeFixture: string; afterFixture: string; beforeBlob: string; afterBlob: string; workflowRuns: string[] }[]) {
    assert.ok(!setc.has(x.repo)); assert.equal(x.origin, "external"); assert.match(x.commit, /^[0-9a-f]{40}$/);
    assert.equal(x.licenseSha256, lic.get(x.repo));
    const f = (n: string, blob: string) => { const b = readFileSync(join(root, FIX + n)); assert.ok(b.length <= 65536); assert.equal(gitBlob(b), blob, n); return b.toString("utf8"); };
    assert.ok(x.workflowRuns.length > 0);
    assert.equal(packageScriptV2Problem("package.json", f(x.beforeFixture, x.beforeBlob), f(x.afterFixture, x.afterBlob), x.workflowRuns.map((n) => `run: npm run ${n}`)), null, `${x.repo} ${x.name}`);
  }
  assert.equal(REC.evidence.examples, EV.examples.length);
  assert.equal(REC.evidence.qualifies, EV.examples.length >= EV.bar);
});

test("PACKAGE_SCRIPT v2 accepts mid-object insertion, aliases of existing scripts, local tools and run-s", () => {
  assert.equal(P(add("format", "prettier --write .", 2)), null, "v1 command, inserted mid-object");
  assert.equal(P(add("format", "prettier --write .", 0)), null, "inserted first");
  assert.equal(P(add("docs", "pnpm run docs-build")), null);
  assert.equal(P(add("docs", "yarn docs-build")), null);
  assert.equal(P(add("test:unit", "pnpm vitest run src")), null);
  assert.equal(P(add("check", "pnpm exec tsc --noEmit")), null);
  assert.equal(P(add("all", "run-s build docs-build")), null);
});

test("PACKAGE_SCRIPT v2 refuses everything else", () => {
  const cases: [string, string][] = [
    [add("x", "npx vitest run"), "npx"],
    [add("x", "pnpm dlx vitest"), "dlx"],
    [add("x", "pnpm add left-pad"), "install"],
    [add("x", "pnpm install"), "install 2"],
    [add("x", "yarn add left-pad"), "install 3"],
    [add("x", "pnpm run nope"), "alias of a missing script"],
    [add("x", "pnpm nope"), "pnpm of a missing script/tool"],
    [add("x", "pnpm run install"), "alias of a builtin"],
    [add("x", "pnpm jest --ci"), "tool not declared"],
    [add("x", "pnpm vitest --reporter=./evil.js"), "disallowed flag through pnpm"],
    [add("x", "pnpm exec node x.js"), "exec of node"],
    [add("x", "node scripts/x.js"), "node"],
    [add("x", "tsx scripts/x.ts"), "tsx"],
    [add("x", "cargo build"), "cargo"],
    [add("x", "make test"), "make"],
    [add("x", "cross-env A=1 vitest run"), "cross-env"],
    [add("x", "A=1 vitest run"), "env assignment"],
    [add("x", "pnpm build && pnpm lint"), "&& chaining"],
    [add("x", "vitest run || true"), "|| chaining"],
    [add("x", "vitest run; rm -rf ."), "; chaining"],
    [add("x", "vitest run | tee out"), "pipe"],
    [add("x", "vitest run > out"), "redirect"],
    [add("x", 'prettier --write "src/**"'), "quotes"],
    [add("x", "echo $HOME"), "dollar"],
    [add("x", "npm run build -- --watch"), "-- pass-through"],
    [add("x", "run-s build nope"), "run-s missing script"],
    [add("x", "run-s"), "run-s with no names"],
    [add("lint", "eslint ."), "existing name added again"],
    [add("ci", "vitest run"), "fresh name the workflow runs? (lint is run; ci is not) -> accepted below"],
  ];
  cases.pop();
  for (const [after, msg] of cases) refuse(P(after), msg);
  refuse(P(add("typecheck", "tsc --noEmit"), pkg(BASE), ["run: pnpm run typecheck"]), "a workflow runs this script name");
  refuse(P(add("x", "vitest run"), pkg(BASE), []), "no workflows read");
  refuse(P(pkg({ ...BASE, x: "run-s build" }, { vitest: "^3" }), pkg(BASE, { vitest: "^3" })), "run-s without npm-run-all");
  refuse(P(add("postbuild", "vitest run")), "post hook of an existing script");
  refuse(P(add("prepare", "vitest run")), "lifecycle");
  refuse(P(add("install", "vitest run")), "lifecycle 2");
  refuse(P(add("exec", "vitest run")), "builtin name");
  refuse(P(add("vitest", "vitest run")), "tool name");
  refuse(P(add("Bad_Name", "vitest run")), "name pattern");
  refuse(P(add("__proto__", "vitest run")), "proto name");
  const e = Object.entries(BASE); refuse(P(pkg(Object.fromEntries([...e.reverse(), ["x", "vitest run"]]))), "existing scripts reordered");
  refuse(P(pkg({ ...BASE, lint: "eslint --fix .", x: "vitest run" })), "changes an existing script");
  refuse(P(pkg({ ...BASE, x: "vitest run", y: "vitest run" })), "two scripts");
  refuse(P(pkg({ build: BASE.build, lint: BASE.lint, test: BASE.test, x: "vitest run" })), "removes a script");
  refuse(P(JSON.stringify({ name: "y", scripts: { ...BASE, x: "vitest run" }, devDependencies: { vitest: "^3", "npm-run-all": "^4", tsc: "^5" } }, null, 2) + "\n"), "other key changed");
  refuse(P(add("x", "vitest run").replace(/\n$/, "")), "trailing newline changed");
  refuse(P(add("x", "vitest run").replace('"x": "vitest run"', '"x":"vitest run"')), "formatting");
  refuse(P(add("x", "vitest run"), pkg(BASE).replace(/ {2}/g, "\t")), "before not standard formatting");
  refuse(packageScriptV2Problem("sub/package.json", pkg(BASE), add("x", "vitest run"), WF), "not root package.json");
  refuse(P("{", pkg(BASE)), "not JSON");
  assert.equal(refusals, REFUSALS_STATED);
});
const REFUSALS_STATED = 48;

test("engine, spec and this test are protected; spec pinned", () => {
  for (const p of ["peaceai/lib/package-script-v2.ts", "peaceai/spec/package-script-v2.md", "peaceai/test/m57-package-script-v2.test.ts", "peaceai/rules/proposals/m57-package-script-v2-evidence.json", "peaceai/test/fixtures/m57/unjs__nitro-de4b7b1ba3e6.before.txt"])
    assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  assert.equal(createHash("sha256").update(read("peaceai/spec/package-script-v2.md")).digest("hex"), SPEC_SHA);
});
const SPEC_SHA = "a990bba3db7ea0d45fc51610d6fd6de7a103358b9f8ccad2ba54c5ed99529163";

test("no overlap: no example repo is in the training corpus list or manifest (Architect M60)", () => {
  const corpus = new Set<string>((JSON.parse(read("peaceai/model/ext-corpus.json")).repos as { name: string }[]).map((r) => r.name));
  for (const l of readManifestBytes(join(root, "peaceai/model"), "ext-manifest").toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l).repo; if (r) corpus.add(r); }
  const ex = JSON.parse(read("peaceai/rules/proposals/m57-package-script-v2-evidence.json")).examples as { repo: string }[];
  for (const x of ex) assert.ok(!corpus.has(x.repo), `${x.repo} is in the training corpus`);
});
