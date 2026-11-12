// Mixed practice set. credit is false. The held-out hash and the training-exclusion check live here
// because the corpus and pair source lists are in files this change does not edit.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { keptLicense } from "../lib/practicemine.ts";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  exclusionHits,   cloneRootProblems, heldOutHash, heldOutWatchProblems, installArgv, isSourceFile, isTestFile, manifestProblems,
  pairFiles, pairProblems, parseRepoToken, practiceSandboxArgv, practiceWatchFiles, rootProblems, runInPracticeSandbox, sandboxHome, scrubEnv, testCommandFor, trainingSources, visibleNodeBin,
  type CorpusRoots, type PracticeManifest, type PracticePair, type PracticeRepo,
} from "../lib/practicemine.ts";
import { countBySplit, gradePracticeRow, replayDocument, targetIsScorable } from "../lib/practicereplay.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";

const repo = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const manifest = JSON.parse(read("practice/manifest.json")) as PracticeManifest;
const rootsFile = JSON.parse(read("practice/corpus-roots.json")) as CorpusRoots;

const repoOf = (over: Partial<PracticeRepo>): PracticeRepo => ({
  name: "example/lib", commit: "a".repeat(40), root: "b".repeat(40), license: "MIT", licenseFile: "LICENSE", split: "dev", upstreams: [], ...over,
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

test("third-party env is an allowlist, and the sandbox is bubblewrap with no unshare fallback", () => {
  const env = scrubEnv({ PATH: "/usr/bin", HOME: "/home/user", GH_TOKEN: "secret", GITHUB_TOKEN: "secret", AWS_SECRET_ACCESS_KEY: "secret", NPM_TOKEN: "secret", NODE_OPTIONS: "--require pwn" }, "/work");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/user");
  assert.equal(env.PWD, "/work");
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  const argv = practiceSandboxArgv("/work/pair");
  assert.ok(argv);
  assert.equal(argv[0], "bwrap");
  assert.ok(argv.includes("--ro-bind") && argv.includes("--unshare-net") && argv.includes("--unshare-pid"));
  assert.ok(argv.includes("--die-with-parent") && argv.includes("--new-session"));
  assert.equal(argv.includes("unshare"), false);
  assert.equal(practiceSandboxArgv("relative"), null);
});

test("the practice sandbox hides a fake home, refuses outside writes, and has no network", () => {
  const node = visibleNodeBin();
  assert.ok(node, "a node binary outside the covered paths");
  const realHome = mkdtempSync(join(tmpdir(), "practice-real-home-"));
  const work = mkdtempSync(join(tmpdir(), "practice-sbx-"));
  const outside = `/usr/practice-outside-${process.pid}`;
  try {
    mkdirSync(join(realHome, ".config"), { recursive: true });
    writeFileSync(join(realHome, ".config", "marker"), "SECRET-MARKER");
    const script = [
      "const fs = require('fs'); const http = require('http');",
      "const [home, outside] = process.argv.slice(1);",
      "let read = 'blocked';",
      "try { read = fs.readFileSync(home + '/.config/marker', 'utf8').trim(); } catch (e) { read = 'blocked'; }",
      "let wrote = 'blocked';",
      "try { fs.writeFileSync(outside, 'x'); wrote = 'wrote'; } catch (e) { wrote = 'blocked'; }",
      "try { fs.writeFileSync('/tmp/practice-host-leak', 'x'); } catch (e) {}",
      "const req = http.get('http://example.com', () => { console.log(JSON.stringify({ read, wrote, net: 'up', home: process.env.HOME })); });",
      "req.on('error', () => { console.log(JSON.stringify({ read, wrote, net: 'down', home: process.env.HOME })); });",
      "req.setTimeout(1500, () => { req.destroy(); });",
    ].join("\n");
    const ran = runInPracticeSandbox(work, [node, "-e", script, realHome, outside], 10_000, { capture: true });
    assert.equal(ran.unsafe, false);
    assert.equal(ran.code, 0, ran.stdout);
    const body = JSON.parse(ran.stdout.trim().split("\n").at(-1)!) as { read: string; wrote: string; net: string; home: string };
    assert.equal(body.read, "blocked");
    assert.equal(body.wrote, "blocked");
    assert.equal(body.net, "down");
    assert.equal(body.home, sandboxHome(work));
    assert.equal(existsSync("/tmp/practice-host-leak"), false);
  } finally {
    rmSync(realHome, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
});

test("a missing bwrap is UNSAFE_ENV", () => {
  const work = mkdtempSync(join(tmpdir(), "practice-nobwrap-"));
  try {
    const ran = runInPracticeSandbox(work, ["/bin/true"], 5_000, { bwrap: "bwrap-does-not-exist" });
    assert.equal(ran.unsafe, true);
    assert.equal(ran.code, null);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("the held-out hash changes when a pin changes, and the committed manifest matches", () => {
  const problems = manifestProblems(manifest);
  assert.deepEqual(problems, [], problems.join(","));
  assert.equal(manifest.credit, false);
  assert.equal(manifest.repos.filter((r) => r.split === "held-out").length >= 2, true);
  assert.equal(manifest.repos.find((r) => r.name === "PeaceG03/PeaceSTOCKS")?.split, "dev");
  assert.equal(manifest.repos.find((r) => r.name === "PeaceG03/PeaceSTOCKS")?.license, "owner");
  const ownerOnly = structuredClone(manifest);
  ownerOnly.repos.find((r) => r.name === "PeaceG03/PeaceSTOCKS")!.license = null;
  assert.equal(heldOutHash(ownerOnly.repos), manifest.heldOutHash, "an owner repo is outside the held-out hash");
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

test("the committed held-out repos and their upstreams are absent from corpus, learned rules, plans, specs, docs, and dev pairs", () => {
  const sources = trainingSources((path) => { try { return read(path); } catch { return null; } });
  assert.ok(!("error" in sources), "error" in sources ? sources.error : "");
  if ("error" in sources) return;
  assert.deepEqual(rootProblems(sources, rootsFile), []);
  const held = manifest.repos.filter((r) => r.split === "held-out").map((r) => ({ name: r.name, root: r.root, upstreams: r.upstreams ?? [] }));
  const hits = exclusionHits(held, sources, rootsFile.roots);
  assert.deepEqual(hits, []);
  const watched = heldOutWatchProblems(held, practiceWatchFiles(repo), rootsFile.roots);
  assert.deepEqual(watched, [], watched.join("\n"));
  const devInCorpus = sources.filter((s) => s.name === "PeaceG03/PeaceSTOCKS");
  assert.ok(devInCorpus.length > 0, "PeaceSTOCKS stays a corpus source; it is dev, not held out");
});

test("a GitHub URL is a repo, a malformed one is rejected, and a wrong clone root fails closed", () => {
  assert.deepEqual(parseRepoToken("https://github.com/axios/axios.git"), { name: "axios/axios" });
  assert.deepEqual(parseRepoToken("git@github.com:axios/axios.git"), { name: "axios/axios" });
  assert.ok("bad" in (parseRepoToken("https://github.com/") ?? {}));
  const mentioned = heldOutWatchProblems(
    [{ name: "someone/hidden", root: "a".repeat(40) }],
    [{ path: "peaceai/spec/note.md", text: "see https://github.com/someone/hidden/blob/main/src/a.ts" }],
    {},
  );
  assert.ok(mentioned.some((p) => p.includes("someone/hidden")));
  const bad = heldOutWatchProblems([], [{ path: "peaceai/model/sources.json", text: '{"name":"https://github.com/"}' }], {});
  assert.ok(bad.some((p) => p.startsWith("BAD_REPO_FORM")));
  const dev = heldOutWatchProblems(
    [{ name: "someone/hidden", root: "a".repeat(40) }],
    [{ path: "practice/pairs.jsonl", text: `${JSON.stringify({ split: "dev", repo: "someone/hidden" })}\n` }],
    {},
  );
  assert.ok(dev.some((p) => p.startsWith("HELD_OUT_MENTION")));
  assert.deepEqual(cloneRootProblems("a/b", "c".repeat(40), null), ["CLONE_UNVERIFIED:a/b"]);
  assert.deepEqual(cloneRootProblems("a/b", "c".repeat(40), { root: "d".repeat(40), upstream: null, upstreamRoot: null }), ["ROOT_MISMATCH:a/b"]);
  assert.ok(cloneRootProblems("a/b", "c".repeat(40), { root: "c".repeat(40), upstream: "other/up", upstreamRoot: null }).includes("UPSTREAM_ROOT_UNVERIFIED:a/b"));
});

test("a held-out repo whose upstream appears in docs fails the exclusion check", () => {
  const problems = heldOutWatchProblems(
    [{ name: "radashi-org/radashi", root: "a".repeat(40), upstreams: ["sodiray/radash"] }],
    [{ path: "docs/learn-steps-1-4-evidence.md", text: "PeaceAI learned on sodiray/radash.\n" }],
    {},
  );
  assert.ok(problems.some((p) => p.includes("docs/learn-steps-1-4-evidence.md") && p.includes("sodiray/radash")), problems.join("\n"));
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
  const owned = { ...pair, repo: "PeaceG03/PeaceSTOCKS", license: "owner" as const, split: "dev" as const };
  assert.deepEqual(pairProblems(owned), []);
  assert.ok(pairProblems({ ...pair, license: "owner" }).includes("pair_license"));
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

test("each practice repo has a scope, and a third-party target posts a patch instead of opening a PR", () => {
  const targets = loadTargets();
  const publicTask = new Set(["unjs/defu", "unjs/scule"]);
  const sample: Record<string, { source: string; test: string }> = {
    "sindresorhus/is": { source: "source/index.ts", test: "test/test.ts" },
    "gcanti/fp-ts": { source: "src/Option.ts", test: "test/Option.ts" },
    "unjs/listhen": { source: "src/index.ts", test: "test/index.test.ts" },
    "blakeembrey/change-case": { source: "packages/change-case/src/index.ts", test: "packages/change-case/src/index.spec.ts" },
    "gvergnaud/ts-pattern": { source: "src/match.ts", test: "tests/chainable.test.ts" },
  };
  for (const row of manifest.repos) {
    if (publicTask.has(row.name)) {
      assert.equal(targets.targets[row.name], undefined, row.name);
      assert.equal(targetIsScorable(row.name), false, row.name);
      continue;
    }
    const config = targets.targets[row.name];
    assert.ok(config, row.name);
    assert.equal(targetIsScorable(row.name), true, row.name);
    if (row.name === "PeaceG03/PeaceSTOCKS") continue;
    assert.equal(config.verdictRoute, "patch", row.name);
    assert.equal(config.writeEnvironment, null, row.name);
    assert.equal(config.selfZone, undefined, row.name);
    const scope = scopeOf(config);
    const paths = sample[row.name]!;
    assert.equal(scope.isSource(paths.source), true, paths.source);
    assert.equal(scope.isTest(paths.test), true, paths.test);
    assert.equal(scope.isDenied("test/fixtures/index.ts"), true, row.name);
    assert.equal(scope.isDenied("src/.env.ts"), true, row.name);
  }
});

test("PeaceG03 repos are recorded as owner, and any other repo still needs a permissive LICENSE", () => {
  const bad = manifestProblems({
    schema: "peaceai-practice-manifest:v1", credit: false, heldOutHash: "ab".repeat(32),
    repos: [repoOf({ name: "PeaceG03/PeaceSTOCKS", split: "dev", license: "owner", licenseFile: null }), repoOf({ name: "a/b", split: "held-out" }), repoOf({ name: "c/d", split: "held-out", commit: "e".repeat(40), root: "f".repeat(40) })],
  });
  assert.equal(bad.includes("peacestocks_not_dev"), false);
  assert.equal(bad.includes("repo_license:PeaceG03/PeaceSTOCKS"), false);
  assert.ok(bad.includes("heldout_hash_mismatch"));
  assert.ok(manifestProblems({
    schema: "peaceai-practice-manifest:v1", credit: false, heldOutHash: manifest.heldOutHash,
    repos: [...manifest.repos, repoOf({ name: "other/lib", license: "owner", licenseFile: null })],
  }).includes("repo_license:other/lib"));
});
