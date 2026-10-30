// M147 (general-agent roadmap step 4): English-to-code training pairs. Licence near-misses (GPL, Blue Oak, mixed,
// missing, wrong pin) refuse; the exclusion file is required and enforced (missing, empty, malformed, a config repo
// listed, any case, name-only entries); pair text is scrubbed of URLs, emails, mentions and secrets; the committed
// manifest is sha256s and counts only; and a mutation check shows the case table catches a broken filter.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import * as real from "../lib/nlpairs.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { pathLeakKinds } from "../lib/extcorpus.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const H = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const tsx = join(repo, "node_modules", ".bin", "tsx");
const CFG = JSON.parse(read("peaceai/model/nl-pairs.json"));
const SETC = JSON.parse(read("peaceai/model/heldout-c.json")).sets.C.map((e: { repo: string }) => e.repo);
const RETRAIN = JSON.parse(read("peaceai/model/lm-retrain.json"));

const MIT = `MIT License\n\nCopyright (c) Example\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n`;
const GPL = `GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n\nEveryone is permitted to copy and distribute verbatim copies of this license document. This program is free software: you can redistribute it under the terms of the GNU General Public License.\n`;
const LGPL = `GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1, February 1999\n` + MIT;
const BLUEOAK = `# Blue Oak Model License\n\nVersion 1.0.0\n\nAll contributors license you to do everything with this software.\n`;
const MIT_PLUS_GPL = MIT + `\nSome files in vendor/ are under the GNU General Public License; see each file.\n`;
const APACHE = `Apache License, Version 2.0, January 2004\n<url>\n\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION\n`;

type Mod = typeof real;
/** The filter case table. Returns the names of failing cases (empty = all pass). Used on the real module and on mutants. */
function runCases(m: Mod): string[] {
  const fails: string[] = [];
  const ok = (name: string, cond: () => boolean) => { try { if (!cond()) fails.push(name); } catch { fails.push(name); } };
  const pin = (t: string, spdx: string) => ({ spdx: spdx as "MIT", licenseSha256: H(t) });
  // licence near-misses
  ok("lic-mit-ok", () => m.licenseProblem(Buffer.from(MIT), pin(MIT, "MIT")) === null);
  ok("lic-apache-ok", () => m.licenseProblem(Buffer.from(APACHE), pin(APACHE, "Apache-2.0")) === null);
  ok("lic-gpl", () => m.licenseProblem(Buffer.from(GPL), pin(GPL, "MIT")) === "license_not_permissive");
  ok("lic-lgpl-with-mit-text", () => m.licenseProblem(Buffer.from(LGPL), pin(LGPL, "MIT")) === "license_not_permissive");
  ok("lic-mit-plus-gpl-files", () => m.licenseProblem(Buffer.from(MIT_PLUS_GPL), pin(MIT_PLUS_GPL, "MIT")) === "license_not_permissive");
  ok("lic-blueoak", () => m.licenseProblem(Buffer.from(BLUEOAK), pin(BLUEOAK, "MIT")) === "license_not_permissive");
  ok("lic-missing", () => m.licenseProblem(null, pin(MIT, "MIT")) === "license_missing");
  ok("lic-empty-file", () => m.licenseProblem(Buffer.from(""), pin("", "MIT")) === "license_not_permissive");
  ok("lic-spdx-mismatch", () => m.licenseProblem(Buffer.from(APACHE), pin(APACHE, "MIT")) === "license_spdx_mismatch");
  ok("lic-sha-mismatch", () => m.licenseProblem(Buffer.from(MIT + " "), pin(MIT, "MIT")) === "license_sha_mismatch");
  // exclusions
  const ex = m.parseExclusions(Buffer.from("# hidden half\nSomeOwner/Hidden-Repo\n*/fixture-name\n"));
  ok("ex-missing", () => (m.parseExclusions(null) as { code: string }).code === "exclusions_missing");
  ok("ex-empty", () => (m.parseExclusions(Buffer.from("# only a comment\n\n")) as { code: string }).code === "exclusions_empty");
  ok("ex-bad-line", () => (m.parseExclusions(Buffer.from("owner/repo\nhttps://x/y\n")) as { code: string }).code === "exclusions_bad_line");
  ok("ex-sha", () => "repos" in ex && ex.fileSha256 === H("# hidden half\nSomeOwner/Hidden-Repo\n*/fixture-name\n") && ex.fileEntries === 2);
  ok("ex-file-repo-any-case", () => "repos" in ex && m.isExcludedRepo("someowner/hidden-repo", ex) && m.isExcludedRepo("SOMEOWNER/HIDDEN-REPO", ex));
  ok("ex-name-only", () => "repos" in ex && m.isExcludedRepo("anyone/Fixture-Name", ex) && !m.isExcludedRepo("anyone/fixture-name2", ex));
  ok("ex-builtin-task-repo", () => "repos" in ex && m.isExcludedRepo("Unjs/Defu", ex) && m.isExcludedRepo("toss/es-toolkit", ex) && m.isExcludedRepo("unjs/ufo", ex));
  ok("ex-builtin-fixture-names", () => "repos" in ex && m.isExcludedRepo("mesqueeb/is-what", ex) && m.isExcludedRepo("dsherret/code-block-writer", ex) && m.isExcludedRepo("fork/is-what", ex));
  ok("ex-not-excluded", () => "repos" in ex && !m.isExcludedRepo("honojs/hono", ex) && !m.isExcludedRepo("unjs/defu-like", ex));
  ok("ex-mention", () => "repos" in ex && m.mentionsExcluded("port of <github>/UNJS/defu merge", ex) && m.mentionsExcluded("copied from someone/is-what", ex) && !m.mentionsExcluded("uses defu() here", ex));
  // hash lines (synthetic names only): sha256 of the lowercased owner/repo; the hex may be any case
  const SYN = "SynthOwner/Synth-Repo", SYNH = H(SYN.toLowerCase());
  const hx = m.parseExclusions(Buffer.from(`# hashes\nsha256:${SYNH.toUpperCase()}\nsha256:${H("synth-b/other-lib")}\nplain-owner/plain-repo\n`));
  ok("ex-hash-parse", () => "hashes" in hx && hx.hashes.size === 2 && hx.fileEntries === 3 && hx.hashes.has(SYNH));
  ok("ex-hash-repo-any-case", () => "hashes" in hx && m.isExcludedRepo("synthowner/synth-repo", hx) && m.isExcludedRepo("SYNTHOWNER/SYNTH-REPO", hx) && m.isExcludedRepo("Synth-B/Other-Lib", hx));
  ok("ex-hash-name-lines-still-work", () => "hashes" in hx && m.isExcludedRepo("Plain-Owner/plain-repo", hx) && m.isExcludedRepo("unjs/defu", hx));
  ok("ex-hash-near-miss", () => "hashes" in hx && !m.isExcludedRepo("synthowner/synth-repo2", hx) && !m.isExcludedRepo("other/synth-repo", hx) && !m.isExcludedRepo("synthowner/synth-rep", hx));
  const bad = (t: string) => (m.parseExclusions(Buffer.from(t)) as { code?: string }).code === "exclusions_bad_line";
  ok("ex-hash-malformed", () => bad(`sha256:${SYNH.slice(1)}\n`) && bad(`sha256:${SYNH}0\n`) && bad(`sha256:${"g".repeat(64)}\n`) && bad("sha256:\n") && bad(`sha256: ${SYNH}\n`) && bad(`sha256:${SYNH}:x\n`));
  ok("ex-bare-hex-refused", () => bad(`${SYNH}\n`));
  // forks and mirrors
  const md = (fork: boolean, parent: string | null, source: string | null) => ({ fork, parent, source });
  ok("fork-parent-hash", () => "hashes" in hx && m.forkHits([md(true, "SYNTHOWNER/synth-repo", "root/clean-lib")], hx) === 1);
  ok("fork-source-hash", () => "hashes" in hx && m.forkHits([md(true, "mid/clean-fork", "synthowner/Synth-Repo")], hx) === 1);
  ok("fork-parent-name", () => "hashes" in hx && m.forkHits([md(true, "plain-owner/plain-repo", "plain-owner/plain-repo"), md(true, "x/y", "unjs/defu")], hx) === 2);
  ok("fork-no-parent-fails-closed", () => "hashes" in hx && m.forkHits([md(true, null, null)], hx) === 1);
  ok("fork-clean-kept", () => "hashes" in hx && m.forkHits([md(false, null, null), md(true, "synthowner/synth-repo2", "root/clean-lib")], hx) === 0);
  // pair text naming a hash-listed repo
  const nh = (t: string) => "hashes" in hx && m.namesHashedRepo(t, hx);
  ok("text-hash-url", () => nh("ported from https://github.com/SynthOwner/Synth-Repo/pull/12 last week") && nh("see <github.com/synthowner/synth-repo>"));
  ok("text-hash-bare", () => nh("Port of synthowner/synth-repo's parser.") && nh("(SynthOwner/Synth-Repo)"));
  ok("text-hash-scope", () => nh(`import x from "@synthowner/synth-repo";`) && nh("bump @Synth-B/other-lib to 2.0"));
  ok("text-hash-git-remote", () => nh("git" + "@github.com:SynthOwner/Synth-Repo.git") && nh("https://github.com/synthowner/synth-repo.git"));
  ok("text-hash-in-diff", () => nh("+// adapted from synthowner/synth-repo (MIT)\n+export const a = 1\n"));
  ok("text-hash-near-miss-kept", () => !nh("synthowner/synth-repo-two and other/synth-repo") && !nh("uses synth-repo() and synthowner") && !nh("synthowner/synth-repository") && !nh("src/a.ts b/c.ts"));
  ok("text-hash-empty-list", () => !m.namesHashedRepo("synthowner/synth-repo", { hashes: new Set() }));
  ok("text-tokens", () => { const t = m.repoTokens("a https://github.com/O/R/x @s/n git" + "@h.com:p/q.git"); return t.has("o/r") && t.has("r/x") && t.has("s/n") && t.has("p/q") && t.has("p/q.git"); });
  // scrubbing
  ok("scrub-url", () => m.scrubEnglish("Fixes the bug, see https://example.org/issues/1?a=b and www.foo.dev/x")?.includes("http") === false && !/www\./.test(m.scrubEnglish("see www.foo.dev/x") ?? "www."));
  ok("scrub-md-link", () => m.scrubEnglish("Read [the docs](https://x.dev/a) first please") === "Read the docs first please");
  ok("scrub-email", () => m.scrubEnglish("Reported by jane.doe@" + "corp.io on the list") === "Reported by <email> on the list");
  ok("scrub-mention", () => m.scrubEnglish("Thanks @some-user for the report, cc @other") === "Thanks @user for the report, cc @user");
  ok("scrub-keeps-scoped-pkg", () => m.scrubEnglish("Bump @types/node and fix it")!.includes("@types/node"));
  ok("scrub-trailers", () => m.scrubEnglish("fix: x\n\nSigned-off-by: A B <a@" + "b.cd>\nCo-authored-by: C <c@" + "d.ef>") === "fix: x");
  ok("scrub-template", () => m.scrubEnglish("<!-- Please describe -->\nAdds a retry option\n- [x] tests added") === "Adds a retry option");
  ok("scrub-image", () => m.scrubEnglish("Before ![shot](https://i.img/a.png) after") === "Before  after");
  ok("scrub-token-drops", () => m.scrubEnglish(`use token ghp_${"a".repeat(36)} here`) === null);
  ok("scrub-phone-drops", () => m.scrubEnglish("call me at (303) 555-" + "0199 today") === null);
  ok("scrub-homepath-drops", () => m.scrubEnglish("fails in /Use" + "rs/jane/project/src") === null);
  ok("secret-hex", () => m.hasSecret(`const apiKey = "${"ab12".repeat(9)}"`));
  ok("secret-aws", () => m.hasSecret("key AKIA" + "ABCDEFGHIJKLMNOP x"));
  ok("secret-none", () => !m.hasSecret("const token = getToken()"));
  ok("code-url", () => m.scrubCode("// see https://example.com/spec#x\nconst a = 1\n") === "// see <url>\nconst a = 1\n");
  ok("code-secret-drops", () => m.scrubCode(`const s = "-----BEGIN RSA PRIVATE${" "}KEY-----"`) === null);
  ok("code-email-drops", () => m.scrubCode("// author: jane@" + "corp.io") === null);
  // diff files and config
  ok("diff-not-code", () => m.diffFileProblem({ path: "README.md", status: "", patch: "+x" }) === "not_code" && m.diffFileProblem({ path: "src/a.d.ts", status: "", patch: "+x" }) === "not_code");
  ok("diff-dist", () => m.diffFileProblem({ path: "dist/index.js", status: "", patch: "+x" }) === "generated_path");
  ok("diff-code-ok", () => m.diffFileProblem({ path: "src/a.ts", status: "", patch: "+export const a = 1\n" }) === null);
  ok("diff-secret", () => m.diffFileProblem({ path: "src/a.ts", status: "", patch: `+const secret = "${"0f".repeat(20)}"\n` }) === "file_secret");
  const good = JSON.parse(JSON.stringify(CFG));
  const probs = (f: (c: any) => void) => { const c = JSON.parse(JSON.stringify(good)); f(c); return m.configProblems(c, SETC, RETRAIN.replay.trainMaxBytes); };
  ok("cfg-ok", () => probs(() => {}).length === 0);
  ok("cfg-gpl", () => probs((c) => { c.repos[0].spdx = "GPL-3.0-only"; }).includes("repo_license_not_allowed"));
  ok("cfg-no-license-pin", () => probs((c) => { delete c.repos[0].licenseSha256; }).includes("repo_license_pin"));
  ok("cfg-set-c", () => probs((c) => { c.repos[0].name = "Axios/axios"; }).includes("repo_set_c"));
  ok("cfg-peaceg03", () => probs((c) => { c.repos[0].name = "PeaceG03/PeaceSTOCKS"; }).includes("repo_owner_peaceg03"));
  ok("cfg-task-repo", () => probs((c) => { c.repos[0].name = "unjs/destr"; }).includes("repo_builtin_excluded"));
  ok("cfg-fixture-name", () => probs((c) => { c.repos[0].name = "x/code-block-writer"; }).includes("repo_builtin_excluded"));
  ok("cfg-over-budget", () => probs((c) => { c.caps.maxBytes = RETRAIN.replay.trainMaxBytes + 1; }).includes("caps_over_budget"));
  ok("cfg-kinds-over-total", () => probs((c) => { c.caps.perKindBytes.pr = c.caps.maxBytes; }).includes("caps_kinds_over_total"));
  // caps
  const cand = (kind: "pr" | "commit" | "jsdoc", repo: string, ref: string, n: number) => ({ kind, repo, sha: "0".repeat(40), ref, path: "a.ts", english: "e", code: "c", text: "x".repeat(n) });
  ok("caps-share", () => { const s = m.selectCapped([cand("pr", "a/a", "1", 60), cand("pr", "a/a", "2", 60), cand("pr", "b/b", "3", 60)], ["a/a", "b/b"], { maxBytes: 1000, perKindBytes: { pr: 200, commit: 1, jsdoc: 1 } }, "s"); return s.kept.length === 2 && s.dropped.cap_repo_kind === 1; });
  ok("caps-total", () => { const s = m.selectCapped([cand("pr", "a/a", "1", 90), cand("commit", "a/a", "2", 90)], ["a/a"], { maxBytes: 100, perKindBytes: { pr: 100, commit: 100, jsdoc: 1 } }, "s"); return s.kept.length === 1 && s.dropped.cap_total === 1; });
  // M8 gh causes: fixed codes, never the stderr text
  ok("gh-rate", () => m.ghCause("gh: API rate limit exceeded for user (HTTP 403)").code === "gh_rate_limited" && m.ghCause("API rate limit exceeded").rateLimited);
  ok("gh-status", () => m.ghCause("gh: Not Found (HTTP 404)").code === "gh_http_404");
  ok("gh-other", () => m.ghCause("something odd").code === "gh_failed");
  // jsdoc pairs
  ok("jsdoc-pair", () => { const f = m.jsdocFunctions("a.ts", `/** Adds two numbers and returns their sum value. */\nexport function add(a: number, b: number): number {\n  const sum = a + b;\n  return Number.isFinite(sum) ? sum : 0;\n}\nfunction undocumented() { return 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9; }\n`, 30, 4000); return f.length === 1 && f[0]!.name === "add" && f[0]!.prompt.endsWith("number ") && f[0]!.body.startsWith("{"); });
  ok("jsdoc-short-doc", () => m.jsdocFunctions("a.ts", `/** Adds. */\nfunction add(a: number, b: number) {\n  const s = a + b;\n  return s + 0 + 0 + 0;\n}\n`, 30, 4000).length === 0);
  return fails;
}

test("m147: the filter case table passes on the real module", () => {
  assert.deepEqual(runCases(real), []);
});

test("m147: mutation check: each broken filter fails at least one case", async () => {
  const src = read("peaceai/lib/nlpairs.ts");
  const lib = pathToFileURL(join(repo, "peaceai", "lib")).href;
  const tsUrl = pathToFileURL(createRequire(import.meta.url).resolve("typescript")).href;
  const fixed = src.replace(/from "\.\/([\w.-]+)"/g, (_, f) => `from "${lib}/${f}"`).replace(`from "typescript"`, `from "${tsUrl}"`);
  const mutants: [string, string, string][] = [
    ["licence sha not checked", `if (sha256(text) !== r.licenseSha256) return "license_sha_mismatch";`, ``],
    ["missing licence accepted", `if (text === null) return "license_missing";`, `if (text === null) return null;`],
    ["licence class not checked", `if (s === null) return "license_not_permissive";`, ``],
    ["missing exclusion file accepted", `if (buf === null) return { code: "exclusions_missing" };`, `if (buf === null) buf = Buffer.from("x/y\\n");`],
    ["empty exclusion file accepted", `if (n === 0) return { code: "exclusions_empty" };`, ``],
    ["case-sensitive exclusion", `const r = repo.toLowerCase();`, `const r = repo;`],
    ["name-only exclusion ignored", `return ex.repos.has(r) || ex.names.has(r.split("/")[1] ?? "");`, `return ex.repos.has(r);`],
    ["mentions not checked", `for (const r of ex.repos) if (t.includes(r)) return true;`, ``],
    ["URLs kept", `t = t.replace(/\\b(?:https?|ftp|wss?):\\/\\/[^\\s<>()"'\`]+/gi, "<url>")`, `t = t`],
    ["emails kept", `t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g, "<email>");`, ``],
    ["mentions kept", `"$1@user");`, `"$1@" + "$2");`],
    ["leak scan skipped", `if (scanText(t).length > 0 || hasSecret(t)) return null;`, ``],
    ["hex secret skipped", `if (HEX_SECRET.test(text)) return true;`, ``],
    ["code leak skipped", `if (hasSecret(t) || scanText(t).length > 0) return null;`, ``],
    ["non-code diff kept", `if (!CODE_FILE.test(f.path) || f.path.endsWith(".d.ts")) return "not_code";`, ``],
    ["set C repo allowed", `p.push("repo_set_c");`, `void 0;`],
    ["budget not checked", `if (k.maxBytes > replayMaxBytes) p.push("caps_over_budget");`, ``],
    ["licence allow-list not checked", `if (!(ALLOWED_SPDX as readonly string[]).includes(r.spdx)) p.push("repo_license_not_allowed");`, ``],
    ["builtin exclusion not checked", `p.push("repo_builtin_excluded");`, `void 0;`],
    ["repo-kind share not capped", `if ((used.get(k) ?? 0) + b > share)`, `if (false)`],
    ["gh rate limit not detected", `const rateLimited = /rate limit/i.test(stderr);`, `const rateLimited = false;`],
    ["hash line shape not checked", `const h = /^sha256:([0-9a-fA-F]{64})$/.exec(l);`, `const h = /^sha256:(.*)$/.exec(l);`],
    ["hash lines ignored", `hashes.add(h[1]!.toLowerCase()); n++; continue;`, `n++; continue;`],
    ["hash hex case kept", `hashes.add(h[1]!.toLowerCase());`, `hashes.add(h[1]!);`],
    ["repo hash not checked", `if (ex.hashes.has(sha256(r))) return true;`, ``],
    ["repo hash case-sensitive", `const r = repo.toLowerCase();\n  if (ex.hashes.has(sha256(r)))`, `const r = repo.toLowerCase();\n  if (ex.hashes.has(sha256(repo)))`],
    ["fork without parent accepted", `if (m.fork && !m.parent && !m.source) { n++; continue; }`, ``],
    ["fork parent not checked", `if (m.parent && isExcludedRepo(m.parent, ex)) { n++; continue; }`, ``],
    ["fork source not checked", `if (m.source && isExcludedRepo(m.source, ex)) { n++; continue; }`, ``],
    ["text hash not checked", `for (const tok of repoTokens(text)) if (ex.hashes.has(sha256(tok))) return true;`, ``],
    ["token cleanup skipped", `.map((s) => s.slice(s.lastIndexOf(":") + 1).replace(/^@+/, "").replace(/\\.+$/, ""))`, ``],
    [".git suffix kept", `if (b.endsWith(".git")) out.add(\`\${a}/\${b.slice(0, -4)}\`);`, ``],
  ];
  // every guard tagged m147-guard:<name> in the lib has a mutant on its line
  const tagged = src.split("\n").filter((l) => /\/\/ m147-guard:[\w-]+/.test(l));
  assert.ok(tagged.length >= 7);
  for (const l of tagged) assert.ok(mutants.some(([, from]) => from.split("\n").some((f) => f.trim() && l.includes(f.trim()))), `untested guard: ${/m147-guard:([\w-]+)/.exec(l)![1]}`);
  const dir = mkdtempSync(join(tmpdir(), "m147-mut-"));
  try {
    for (const [name, from, to] of mutants) {
      assert.ok(fixed.includes(from), `mutant site not found: ${name}`);
      const f = join(dir, `${H(name).slice(0, 12)}.ts`);
      writeFileSync(f, fixed.replace(from, to));
      const mod = (await import(pathToFileURL(f).href)) as Mod;
      assert.ok(runCases(mod).length > 0, `mutant survived: ${name}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("m147: the committed config pins only permissive TypeScript repos, none excluded, none in set C", () => {
  assert.deepEqual(real.configProblems(CFG, SETC, RETRAIN.replay.trainMaxBytes), []);
  const pub = real.parseExclusions(readFileSync(join(repo, "peaceai/model/nl-pairs-exclusions-public.txt")));
  assert.ok("repos" in pub);
  for (const r of CFG.repos) assert.equal(real.isExcludedRepo(r.name, pub), false, "config repo is excluded");
  // the public file lists every built-in exclusion (so the committed manifest's exclusion sha covers them)
  for (const r of real.BUILTIN_EXCLUDED_REPOS) assert.ok(pub.repos.has(r.toLowerCase()));
  for (const n of real.BUILTIN_EXCLUDED_NAMES) assert.ok(pub.names.has(n));
  assert.equal(real.BUILTIN_EXCLUDED_REPOS.length, 13);
  // the combined file: the public file verbatim, then sha256 lines only (no hidden name is ever committed)
  const pubTxt = read("peaceai/model/nl-pairs-exclusions-public.txt"), comb = read("peaceai/model/nl-pairs-exclusions-hidden-hashes.txt");
  assert.ok(comb.startsWith(pubTxt));
  const extra = comb.slice(pubTxt.length).split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  assert.equal(extra.length, 15); for (const l of extra) assert.match(l, /^sha256:[0-9a-f]{64}$/);
  const cx = real.parseExclusions(Buffer.from(comb));
  assert.ok("hashes" in cx && cx.hashes.size === 15);
  for (const r of CFG.repos) assert.equal(real.isExcludedRepo(r.name, cx), false, "config repo is excluded");
  assert.ok(CFG.caps.maxBytes <= RETRAIN.replay.trainMaxBytes);
});

test("m147: the build refuses without the exclusion file, with a bad one, and when it lists a config repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "m147-cli-"));
  try {
    const run = (...a: string[]) => spawnSync(tsx, [join(repo, "peaceai/bin/nl-pairs.ts"), ...a], { cwd: repo, encoding: "utf8" });
    const base = ["--src", join(dir, "src"), "--out", join(dir, "out")];
    let r = run(...base);
    assert.equal(r.status, 1); assert.match(r.stdout, /^nl-pairs refused: exclusions_missing$/m);
    r = run("--exclusions", join(dir, "nope.txt"), ...base);
    assert.equal(r.status, 1); assert.match(r.stdout, /exclusions_missing/);
    writeFileSync(join(dir, "empty.txt"), "# nothing\n");
    r = run("--exclusions", join(dir, "empty.txt"), ...base);
    assert.equal(r.status, 1); assert.match(r.stdout, /exclusions_empty/);
    writeFileSync(join(dir, "bad.txt"), "not a repo line\n");
    r = run("--exclusions", join(dir, "bad.txt"), ...base);
    assert.equal(r.status, 1); assert.match(r.stdout, /exclusions_bad_line/);
    writeFileSync(join(dir, "hit.txt"), `some/other\n${CFG.repos[1].name.toUpperCase()}\n`);
    r = run("--exclusions", join(dir, "hit.txt"), ...base);
    assert.equal(r.status, 1); assert.match(r.stdout, /^nl-pairs refused: config_repo_excluded count=1$/m);
    assert.ok(!r.stdout.includes(CFG.repos[1].name), "the hit is never named");
    const hh = H(CFG.repos[3].name.toLowerCase());
    writeFileSync(join(dir, "hit3.txt"), `some/other\nsha256:${hh.toUpperCase()}\n`);
    r = run("--exclusions", join(dir, "hit3.txt"), ...base);
    assert.equal(r.status, 1); assert.match(r.stdout, /^nl-pairs refused: config_repo_excluded count=1$/m);
    assert.ok(!r.stdout.toLowerCase().includes(CFG.repos[3].name.toLowerCase()) && !r.stdout.toLowerCase().includes(hh), "the hash hit is never named");
    writeFileSync(join(dir, "bad2.txt"), `some/other\nsha256:${hh.slice(2)}\n`);
    r = run("--exclusions", join(dir, "bad2.txt"), ...base);
    assert.equal(r.status, 1); assert.match(r.stdout, /^nl-pairs refused: exclusions_bad_line$/m);
    writeFileSync(join(dir, "hit2.txt"), `*/${CFG.repos[2].name.split("/")[1]}\n`);
    r = run("--exclusions", join(dir, "hit2.txt"), ...base);
    assert.equal(r.status, 1); assert.match(r.stdout, /config_repo_excluded count=1/);
    const w = spawnSync("bash", [join(repo, "peaceai/bin/nl-pairs-corpus.sh"), join(dir, "w"), join(dir, "items.json")], { cwd: repo, encoding: "utf8" });
    assert.equal(w.status, 1); assert.match(w.stdout, /nl-pairs-corpus refused: usage/);
    const w2 = spawnSync("bash", [join(repo, "peaceai/bin/nl-pairs-corpus.sh"), join(dir, "w"), join(dir, "items.json"), join(dir, "nope.txt")], { cwd: repo, encoding: "utf8" });
    assert.equal(w2.status, 1); assert.match(w2.stdout, /exclusions_missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("m147: the committed manifest is sha256s only, built with the combined public + hidden-hash exclusion file, and matches the summary", () => {
  const lines = readManifestBytes(join(repo, "peaceai/model"), "nl-pairs-manifest").toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const [head, ...ents] = lines;
  const S = JSON.parse(read("peaceai/model/nl-pairs-summary.json"));
  assert.equal(head.schema, real.NL_MANIFEST_SCHEMA);
  assert.equal(head.configSha256, H(readFileSync(join(repo, "peaceai/model/nl-pairs.json"))));
  assert.equal(head.exclusionsSha256, H(readFileSync(join(repo, "peaceai/model/nl-pairs-exclusions-hidden-hashes.txt"))));
  assert.equal(S.exclusionsSha256, head.exclusionsSha256);
  assert.equal(S.build.exclusionFileHashes, 15); assert.equal(S.build.repoMetaCalls, CFG.repos.length);
  assert.equal(head.entries, ents.length); assert.equal(S.pairs, ents.length);
  const names = new Map(CFG.repos.map((r: { name: string; spdx: string }) => [r.name, r.spdx]));
  const keys = ["doc", "kind", "split", "repo", "sha", "ref", "path", "license", "textSha256", "bytes", "englishSha256", "codeSha256"];
  for (const e of ents) {
    assert.deepEqual(Object.keys(e), keys);
    assert.equal(names.get(e.repo), e.license);
    assert.ok((real.NL_KINDS as readonly string[]).includes(e.kind) && ["train", "heldout"].includes(e.split));
    assert.match(e.sha, /^[0-9a-f]{40}$/); assert.match(e.textSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(pathLeakKinds(e.path), []);
    assert.ok(!/https?:|@/.test(e.ref + e.path));
  }
  assert.equal(new Set(ents.map((e) => e.textSha256)).size, ents.length, "no duplicate text");
  for (const k of real.NL_KINDS) { assert.equal(S.byKind[k].pairs, ents.filter((e) => e.kind === k).length); assert.ok(S.byKind[k].pairs > 0); }
  assert.equal(S.bytes, ents.reduce((s, e) => s + e.bytes, 0));
  assert.ok(S.bytes <= CFG.caps.maxBytes);
  assert.equal(S.evalDedup.recheckOverlapDocs, 0);
  assert.equal(S.manifestSha256, JSON.parse(read("peaceai/model/nl-pairs-manifest/index.json")).combinedSha256);
});
