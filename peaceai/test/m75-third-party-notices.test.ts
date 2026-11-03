// M75: THIRD_PARTY_NOTICES lists every copied third-party fixture (repo-wide, since m26): its source repo, the exact
// commit it was copied from, and that project's license text at that commit. Peace's own fixtures
// (peaceai/test/fixtures/m67/peacestocks/) are not third-party and are not listed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { classifyLicense } from "../lib/lmcorpus.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const NOTICES = read("THIRD_PARTY_NOTICES");
const PERMISSIVE = /^(?:MIT|Apache-2\.0|BSD-[23]-Clause|ISC)$/;
const OWN = "peaceai/test/fixtures/m67/peacestocks/";
// Exempt (batch 11 fix, Auditor B1): pinned-install fixtures for the real-runner tests (m172-real-vitest, m172-real-mocha).
// They copy no third-party file: a package.json written in this repo and the package-lock.json npm generated from it
// (package names, versions, registry URLs and integrity hashes only; no code, no license text). The packages are
// installed into a temp dir at test time and never committed, so there is no copied work to attribute. The last test
// below holds them to exactly that shape, so the exemption cannot cover anything else.
const LOCK_ONLY = ["peaceai/test/fixtures/m172-real-mocha10/", "peaceai/test/fixtures/m172-real-vitest1/"];

type Group = { repo: string; license: string; file: string; sha: string; rows: { commit: string; path: string }[]; url: string; asWritten: string | null; text: string };
const groups: Group[] = NOTICES.split(`\n${"=".repeat(78)}\n`).slice(1).map((blk) => {
  const head = /^repo: (\S+)\nlicense: (\S+) \((\S+), sha256 of trimmed text ([0-9a-f]{64})\)\nfixtures \(commit path\):\n((?: {2}[0-9a-f]{40} \S+\n)+)license URL: (\S+)\n(?:as written: sha256 ([0-9a-f]{64}) \([^\n]*\)\n)?---- license text ----\n([\s\S]*?)\n(?:---- NOTICE \(NOTICE at the same commit\) ----\n[\s\S]*?\n)?---- end ----/.exec(blk);
  assert.ok(head, `unparsable block: ${blk.slice(0, 80)}`);
  const rows = head![5]!.trimEnd().split("\n").map((l) => { const [commit, path] = l.trim().split(" ") as [string, string]; return { commit, path }; });
  return { repo: head![1]!, license: head![2]!, file: head![3]!, sha: head![4]!, rows, url: head![6]!, asWritten: head![7] ?? null, text: head![8]! };
});
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [relative(root, p)]; });

test("every third-party fixture is listed exactly once; every listed path exists; Peace's own fixtures are not listed", () => {
  const fixtures = walk(resolve(root, "peaceai/test/fixtures")).filter((p) => !p.startsWith(OWN) && !LOCK_ONLY.some((d) => p.startsWith(d))).sort();
  const listed = groups.flatMap((g) => g.rows.map((r) => r.path)).sort();
  assert.deepEqual(listed, fixtures);
  assert.equal(new Set(listed).size, listed.length);
  for (const p of listed) assert.ok(existsSync(resolve(root, p)), p);
  assert.ok(!NOTICES.includes(OWN.replace(/\/$/, "") + "/w-"), "own fixtures not listed as third-party");
  assert.ok(fixtures.length >= 100);
});

test("each license text matches its pinned hash (or its as-written hash where an email was omitted), its URL is pinned, and classifies as the stated permissive license", () => {
  assert.equal(new Set(groups.map((g) => `${g.repo} ${g.sha}`)).size, groups.length);
  for (const g of groups) {
    assert.equal(createHash("sha256").update(g.text.trim()).digest("hex"), g.asWritten ?? g.sha, g.repo);
    assert.ok(g.rows.some((r) => g.url === `https://github.com/${g.repo}/blob/${r.commit}/${g.file}`), `${g.repo}: license URL pinned to a listed commit`);
    if (g.asWritten) { assert.match(g.text, /<email address omitted; see the license URL above>/, g.repo); assert.doesNotMatch(g.text, /@/, g.repo); }
    assert.match(g.license, PERMISSIVE, g.repo);
    assert.equal(classifyLicense(g.text), g.license, g.repo);
  }
  const apache = groups.filter((g) => g.license === "Apache-2.0");
  for (const g of apache) assert.ok(NOTICES.includes(`repo: ${g.repo}`) && /---- NOTICE \(NOTICE at the same commit\) ----\nIFCViewX/.test(NOTICES), `${g.repo}: Apache NOTICE carried`);
});

test("commits and license hashes agree with the evidence records that copied each fixture", () => {
  const byName = new Map<string, { repo: string; commit: string; licenseSha256?: string }[]>();
  const visit = (o: unknown): void => {
    if (Array.isArray(o)) { o.forEach(visit); return; }
    if (!o || typeof o !== "object") return;
    const r = o as Record<string, unknown>;
    if (typeof r.repo === "string" && typeof r.commit === "string")
      for (const [k, v] of Object.entries(r)) if (/ixture/.test(k) && typeof v === "string" && v) {
        const n = basename(v); byName.set(n, [...(byName.get(n) ?? []), { repo: r.repo, commit: r.commit, licenseSha256: typeof r.licenseSha256 === "string" ? r.licenseSha256 : undefined }]);
      }
    Object.values(r).forEach(visit);
  };
  const dir = resolve(root, "peaceai/rules/proposals");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) visit(JSON.parse(readFileSync(join(dir, f), "utf8")));
  const wj = read("peaceai/rules/proposals/public-workflow-job-v1.json");
  let fromEvidence = 0;
  for (const g of groups) for (const row of g.rows) {
    const ev = byName.get(basename(row.path));
    if (ev) {
      fromEvidence++;
      for (const e of ev) {
        assert.equal(e.repo, g.repo, row.path); assert.equal(e.commit, row.commit, row.path);
        if (e.licenseSha256) assert.equal(e.licenseSha256, g.sha, row.path);
      }
    } else {
      // m67 WORKFLOW_JOB fixtures: pinned by short commit in the proposal record, not in an evidence file.
      assert.match(row.path, /^peaceai\/test\/fixtures\/m67\/workflow-job\//, `${row.path} has no evidence record`);
      assert.ok(basename(row.path).startsWith(g.repo.replace("/", "__")), row.path);
      assert.ok(wj.includes(`${g.repo} ${row.commit.slice(0, 7)}`), `${row.path}: ${g.repo} ${row.commit.slice(0, 7)} in public-workflow-job-v1.json`);
    }
  }
  assert.ok(fromEvidence >= 100);
});

test("the lockfile-only fixtures are exempt only while they hold just a private package.json and its npm lockfile (registry URLs and integrity hashes, no code)", () => {
  for (const d of LOCK_ONLY) {
    assert.deepEqual(readdirSync(resolve(root, d)).sort(), ["package-lock.json", "package.json"], d);
    const pkg = JSON.parse(read(`${d}package.json`)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(pkg).filter((k) => !["name", "private", "type", "devDependencies"].includes(k)), [], `${d}package.json: only name / private / type / devDependencies`);
    assert.equal(pkg.private, true, d);
    assert.ok(!NOTICES.includes(d), `${d} is not listed as third-party`);
    const lock = JSON.parse(read(`${d}package-lock.json`)) as { lockfileVersion: number; packages: Record<string, Record<string, unknown>> };
    assert.equal(lock.lockfileVersion, 3, d);
    const entries = Object.entries(lock.packages).filter(([k]) => k !== "");
    assert.ok(entries.length > 0, d);
    for (const [k, e] of entries) {
      assert.match(k, /^node_modules\/(?:@[\w.-]+\/)?[\w.-]+(?:\/node_modules\/(?:@[\w.-]+\/)?[\w.-]+)*$/, `${d}: ${k}`);
      assert.match(String(e.resolved), /^https:\/\/registry\.npmjs\.org\/[^\s]+\.tgz$/, `${d}: ${k} resolved`);
      assert.match(String(e.integrity), /^sha512-[A-Za-z0-9+/]+=*$/, `${d}: ${k} integrity`);
    }
  }
});
