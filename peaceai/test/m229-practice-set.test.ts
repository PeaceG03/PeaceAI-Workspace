// Mixed practice set. credit is false. The held-out hash and the training-exclusion check live here
// because the corpus and pair source lists are in files this change does not edit.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { keptLicense } from "../lib/practicemine.ts";
import {
  exclusionHits, heldOutHash, installArgv, isolationArgv, isSourceFile, isTestFile, manifestProblems,
  pairFiles, pairProblems, rootProblems, scrubEnv, testCommandFor, trainingSources,
  type CorpusRoots, type PracticeManifest, type PracticePair, type PracticeRepo,
} from "../lib/practicemine.ts";
import { countBySplit, gradePracticeRow, replayDocument, targetIsScorable } from "../lib/practicereplay.ts";

const repo = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const manifest = JSON.parse(read("practice/manifest.json")) as PracticeManifest;
const rootsFile = JSON.parse(read("practice/corpus-roots.json")) as CorpusRoots;

const repoOf = (over: Partial<PracticeRepo>): PracticeRepo => ({
  name: "example/lib", commit: "a".repeat(40), root: "b".repeat(40), license: "MIT", licenseFile: "LICENSE", split: "dev", ...over,
});

test("a root LICENSE is kept only when it is one permissive license", () => {
  assert.equal(keptLicense(null), null);
  assert.equal(keptLicense("GNU GENERAL PUBLIC LICENSE Version 3"), null);
  assert.equal(keptLicense("MIT License\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software. PROVIDED \"AS IS\""), "MIT");
  assert.equal(keptLicense("Apache License\n Version 2.0, January 2004\n http://www.apache.org/licenses/"), "Apache-2.0");
});

test("a candidate needs one test file and at least one non-test source", () => {
  assert.equal(isTestFile("src/a.test.ts"), true);
  assert.equal(isTestFile("test/a.ts"), true);
  assert.equal(isSourceFile("src/a.ts"), true);
  assert.equal(isSourceFile("src/a.test.ts"), false);
  assert.equal(isSourceFile("src/a.d.ts"), false);
  assert.deepEqual(pairFiles([{ status: "M", path: "src/a.ts" }, { status: "M", path: "src/a.test.ts" }]), { testFile: "src/a.test.ts", sources: ["src/a.ts"] });
  assert.equal(pairFiles([{ status: "M", path: "src/a.test.ts" }]), null);
  assert.equal(pairFiles([{ status: "M", path: "src/a.ts" }]), null);
  assert.equal(pairFiles([{ status: "D", path: "src/a.ts" }, { status: "M", path: "src/a.test.ts" }]), null);
  assert.equal(pairFiles([{ status: "M", path: "src/a.ts" }, { status: "M", path: "src/a.test.ts" }, { status: "A", path: "src/b.test.ts" }]), null);
});

test("the test command is an argv for one file, and install hooks are ignored", () => {
  assert.deepEqual(testCommandFor({ scripts: { test: "node --experimental-transform-types --test test/test.ts" } }, "test/test.ts"), ["node", "--experimental-transform-types", "--test", "test/test.ts"]);
  assert.deepEqual(testCommandFor({ devDependencies: { vitest: "^1" }, scripts: { test: "vitest run" } }, "test/a.test.ts"), ["./node_modules/.bin/vitest", "run", "test/a.test.ts"]);
  assert.equal(testCommandFor({ scripts: { test: "make test" } }, "test/a.test.ts"), null);
  assert.deepEqual(installArgv({ npm: true, pnpm: false, yarn: false }, true), ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
  assert.deepEqual(installArgv({ npm: false, pnpm: true, yarn: false }, true), ["pnpm", "install", "--ignore-scripts"]);
  assert.equal(installArgv({ npm: false, pnpm: false, yarn: false }, false), null);
});

test("third-party env is an allowlist, and network isolation is refused when unshare cannot build a net namespace", () => {
  const env = scrubEnv({ PATH: "/usr/bin", HOME: "/home/me", GH_TOKEN: "secret", GITHUB_TOKEN: "secret", AWS_SECRET_ACCESS_KEY: "secret", NPM_TOKEN: "secret", NODE_OPTIONS: "--require pwn" }, "/work");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/me");
  assert.equal(env.PWD, "/work");
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.deepEqual(isolationArgv(true, false), ["unshare", "-n", "--"]);
  assert.deepEqual(isolationArgv(false, true), ["unshare", "--user", "--map-root-user", "-n", "--"]);
  assert.equal(isolationArgv(false, false), null);
});

test("the held-out hash changes when a pin changes, and the committed manifest matches", () => {
  const problems = manifestProblems(manifest);
  assert.deepEqual(problems, [], problems.join(","));
  assert.equal(manifest.credit, false);
  assert.equal(manifest.repos.filter((r) => r.split === "held-out").length >= 2, true);
  assert.equal(manifest.repos.find((r) => r.name === "PeaceG03/PeaceSTOCKS")?.split, "dev");
  const moved = structuredClone(manifest);
  const held = moved.repos.find((r) => r.split === "held-out")!;
  held.commit = "c".repeat(40);
  assert.ok(manifestProblems(moved).includes("heldout_hash_mismatch"));
  moved.heldOutHash = heldOutHash(moved.repos);
  assert.equal(manifestProblems(moved).includes("heldout_hash_mismatch"), false);
  const dev = moved.repos.find((r) => r.split === "dev" && r.name !== "PeaceG03/PeaceSTOCKS")!;
  dev.commit = "d".repeat(40);
  assert.equal(heldOutHash(moved.repos), moved.heldOutHash, "a dev pin is not part of the held-out hash");
});

test("a held-out repo, or a fork with the same root, fails the training-exclusion check", () => {
  const sources = [
    { name: "PeaceG03/PeaceSTOCKS", file: "peaceai/model/sources.json", kind: "corpus" as const },
    { name: "axios/axios", file: "peaceai/model/ext-corpus.json", kind: "corpus" as const },
    { name: "colinhacks/zod", file: "peaceai/model/nl-pairs.json", kind: "pairs" as const },
  ];
  const rootMap = { "PeaceG03/PeaceSTOCKS": "1".repeat(40), "axios/axios": "2".repeat(40), "colinhacks/zod": "3".repeat(40) };
  assert.deepEqual(exclusionHits([{ name: "unjs/ufo", root: "9".repeat(40) }], sources, rootMap), []);
  const named = exclusionHits([{ name: "axios/axios", root: "9".repeat(40) }], sources, rootMap);
  assert.equal(named[0]?.why, "name");
  const forked = exclusionHits([{ name: "someone/axios-fork", root: "2".repeat(40) }], sources, rootMap);
  assert.equal(forked[0]?.why, "root");
  assert.equal(forked[0]?.source, "axios/axios");
  assert.equal(exclusionHits([{ name: "PeaceG03/PeaceSTOCKS", root: "1".repeat(40) }], sources, rootMap)[0]?.why, "name");
});

test("the committed held-out repos are absent from the corpus and pair source lists", () => {
  const sources = trainingSources((path) => { try { return read(path); } catch { return null; } });
  assert.ok(!("error" in sources), "error" in sources ? sources.error : "");
  if ("error" in sources) return;
  assert.deepEqual(rootProblems(sources, rootsFile), []);
  const held = manifest.repos.filter((r) => r.split === "held-out").map((r) => ({ name: r.name, root: r.root }));
  const hits = exclusionHits(held, sources, rootsFile.roots);
  assert.deepEqual(hits, []);
  const devInCorpus = sources.filter((s) => s.name === "PeaceG03/PeaceSTOCKS");
  assert.ok(devInCorpus.length > 0, "PeaceSTOCKS stays a corpus source; it is dev, not held out");
});

test("a verified pair records the fail-before and pass-after exits", () => {
  const pair: PracticePair = {
    schema: "peaceai-practice-pair:v1", credit: false, repo: "unjs/ufo", license: "MIT", split: "held-out",
    baseSha: "a".repeat(40), fixSha: "b".repeat(40), testFile: "test/a.test.ts", testCommand: ["node", "--test", "test/a.test.ts"],
    beforeExit: 1, afterExit: 0, files: ["src/a.ts", "test/a.test.ts"], subject: "Fix the parser",
  };
  assert.deepEqual(pairProblems(pair), []);
  const bad = { ...pair, beforeExit: 0 };
  assert.ok(pairProblems(bad).includes("pair_before"));
});

test("replay passes only on GATE PASS plus a failing-then-passing test, and an unknown repo is unmeasured", () => {
  const names = ["PeaceG03/PeaceSTOCKS", "PeaceG03/PeaceAI-Workspace"];
  assert.equal(targetIsScorable("PeaceG03/PeaceSTOCKS", names), true);
  assert.equal(targetIsScorable("unjs/ufo", names), false);
  assert.equal(gradePracticeRow({ scorable: false, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: 1, afterExit: 0 }).reason, "GATE_NO_TARGET");
  const pass = gradePracticeRow({ scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: 1, afterExit: 0 });
  assert.equal(pass.status, "pass");
  assert.equal(pass.gap, false);
  assert.equal(gradePracticeRow({ scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: false, beforeExit: 1, afterExit: 0 }).reason, "GATE_FAIL");
  assert.equal(gradePracticeRow({ scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: 1, afterExit: 1 }).status, "fail");
  const refused = gradePracticeRow({ scorable: true, core: "missing", job: { status: "fail", reason: "NO_CANDIDATE" }, gatePass: false, beforeExit: null, afterExit: null });
  assert.equal(refused.status, "unmeasured");
  assert.equal(refused.reason, "NO_CORE");
  const gap = gradePracticeRow({ scorable: true, core: "ok", job: { status: "fail", reason: "NO_CANDIDATE" }, gatePass: false, beforeExit: null, afterExit: null });
  assert.equal(gap.gap, true);
  assert.match(gap.reason, /NO_CANDIDATE/);
  const rows = [
    { repo: "unjs/ufo", split: "held-out" as const, fixSha: "b".repeat(40), status: "unmeasured" as const, reason: "GATE_NO_TARGET", gap: true },
    { repo: "sindresorhus/is", split: "dev" as const, fixSha: "c".repeat(40), status: "pass" as const, reason: "GATE_PASS_AND_TEST", gap: false },
  ];
  const doc = replayDocument(rows);
  assert.equal(doc.credit, false);
  assert.equal(doc.protectedFunction, "checkCandidateScope");
  assert.equal(doc.protectedFile, "peaceai/lib/scope.ts");
  assert.equal(doc.counts["held-out"].unmeasured, 1);
  assert.equal(doc.counts["held-out"].pass, 0);
  assert.equal(doc.counts.dev.pass, 1);
  assert.equal(JSON.stringify(doc).includes("diff"), false);
  const counts = countBySplit(rows);
  assert.equal(counts["held-out"].reasons.GATE_NO_TARGET, 1);
});

test("the real target list cannot score the held-out repos", () => {
  for (const row of manifest.repos) {
    if (row.name === "PeaceG03/PeaceSTOCKS") assert.equal(targetIsScorable(row.name), true);
    else assert.equal(targetIsScorable(row.name), false, row.name);
  }
});

test("a dev-only repo object still has to be licensed unless it is PeaceSTOCKS", () => {
  const bad = manifestProblems({
    schema: "peaceai-practice-manifest:v1", credit: false, heldOutHash: "ab".repeat(32),
    repos: [repoOf({ name: "PeaceG03/PeaceSTOCKS", split: "dev", license: null, licenseFile: null }), repoOf({ name: "a/b", split: "held-out" }), repoOf({ name: "c/d", split: "held-out", commit: "e".repeat(40), root: "f".repeat(40) })],
  });
  assert.equal(bad.includes("peacestocks_not_dev"), false);
  assert.ok(bad.includes("heldout_hash_mismatch"));
});
