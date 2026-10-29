import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { appendOnly, COVERAGE_NONE_SEQS, LOG_PATH, makeGitShaResolver, makeGithubShaResolver, parseClones, peaceAiShaLandings, validateCoverageNoneSeqs, validateLog, verifyPeaceAiShas, type Entry } from "./check.ts";

const ok = {
  seq: 1, date: "2026-10-13", time: "01:05", asked: "Fix the typecheck failure", changed: "PeaceSTOCKS@369f6ea",
  why: "tsc failed on main", skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "Builder",
};
const line = (o: object) => JSON.stringify(o) + "\n";

test("the committed log is valid", () => {
  assert.deepEqual(validateLog(readFileSync(LOG_PATH, "utf8")), []);
});

test("a valid entry passes; missing skills need the matching mark", () => {
  assert.deepEqual(validateLog(line(ok)), []);
  assert.deepEqual(validateLog(line({ ...ok, skill: "WORKFLOW_JOB", mark: "missing skill WORKFLOW_JOB" })), []);
  assert.ok(validateLog(line({ ...ok, skill: "WORKFLOW_JOB" })).some((e) => /mark must be/.test(e)));
  assert.ok(validateLog(line({ ...ok, mark: "missing skill THROW_GUARD" })).some((e) => /mark must be/.test(e)));
});

test("schema refusals", () => {
  const bad: [object, RegExp][] = [
    [{ ...ok, seq: 2 }, /seq must be 1/],
    [{ ...ok, extra: 1 }, /keys must be exactly/],
    [{ ...ok, skill: "ANYTHING" }, /unknown skill/],
    [{ ...ok, changed: "main" }, /changed must be/],
    [{ ...ok, changed: "OtherRepo@369f6ea" }, /changed must be/],
    [{ ...ok, time: "25:00" }, /bad time/],
    [{ ...ok, by: "PeaceAI", skill: "WORKFLOW_JOB", mark: "missing skill WORKFLOW_JOB" }, /approved skill/],
    [{ ...ok, why: "x ghp_" + "a".repeat(30) }, /secret-shaped/],
    [{ ...ok, why: "touched PeaceSTOCKS-Net code" }, /private Net/],
  ];
  for (const [o, re] of bad) assert.ok(validateLog(line(o)).some((e) => re.test(e)), String(re));
  assert.ok(validateLog("{not json}\n").some((e) => /not JSON/.test(e)));
  assert.ok(validateLog(JSON.stringify(ok, null, 1) + "\n").length > 0);
  assert.ok(validateLog(JSON.stringify(ok)).some((e) => /newline/.test(e)));
});

test("append-only: appending passes; editing, removing or reordering fails", () => {
  const a = line(ok);
  const b = line({ ...ok, seq: 2 });
  assert.deepEqual(appendOnly("", a), []);
  assert.deepEqual(appendOnly(a, a + b), []);
  assert.deepEqual(appendOnly(a + b, a + b), []);
  assert.match(appendOnly(a + b, a)[0] ?? "", /line 2 was modified or removed/);
  assert.match(appendOnly(a, line({ ...ok, why: "rewritten reason" }))[0] ?? "", /line 1/);
  assert.match(appendOnly(a + b, b + a)[0] ?? "", /line 1/);
});

test("skills approved later: missing before the landing time, approved (and PeaceAI-able) from it on", () => {
  for (const [skill, date, before, after] of [["WORKFLOW_STEP", "2026-10-13", "22:40", "22:41"], ["CHECK_OBJECT_LITERAL_ARGS", "2026-10-13", "21:29", "21:30"]] as const) {
    assert.deepEqual(validateLog(line({ ...ok, date, time: before, skill, mark: `missing skill ${skill}` })), [], `${skill} before`);
    assert.ok(validateLog(line({ ...ok, date, time: before, skill, mark: "PeaceAI-able today" })).some((e) => /mark must be/.test(e)));
    assert.ok(validateLog(line({ ...ok, date, time: before, skill, mark: `missing skill ${skill}`, by: "PeaceAI" })).some((e) => /approved skill/.test(e)), "PeaceAI cannot use it before landing");
    assert.deepEqual(validateLog(line({ ...ok, date, time: after, skill, mark: "PeaceAI-able today", by: "PeaceAI" })), [], `${skill} after`);
    assert.deepEqual(validateLog(line({ ...ok, date: "2026-10-14", time: "00:01", skill, mark: "PeaceAI-able today" })), [], "next day");
    assert.ok(validateLog(line({ ...ok, date, time: after, skill, mark: `missing skill ${skill}` })).some((e) => /mark must be/.test(e)));
  }
  assert.ok(validateLog(line({ ...ok, skill: "toString", mark: "missing skill toString" })).some((e) => /unknown skill/.test(e)), "no prototype keys");
});


test("verifyPeaceAiShas: injectable resolver; made-up sha fails closed", async () => {
  const entries = [
    {
      seq: 1, date: "2026-10-13", time: "01:00", asked: "fixture asked text here",
      changed: "PeaceSTOCKS@0e1b354", why: "fixture why text here",
      skill: "TEST_CASE", mark: "PeaceAI-able today", by: "PeaceAI",
    },
    {
      seq: 2, date: "2026-10-13", time: "01:01", asked: "fixture asked text here",
      changed: "PeaceSTOCKS@deadbee", why: "fixture why text here",
      skill: "TEST_CASE", mark: "PeaceAI-able today", by: "PeaceAI",
    },
    {
      seq: 3, date: "2026-10-13", time: "01:02", asked: "fixture asked text here",
      changed: "PeaceSTOCKS@0e1b354", why: "builder also logged the same sha",
      skill: "TEST_CASE", mark: "PeaceAI-able today", by: "Builder",
    },
  ] as Entry[];
  assert.deepEqual(
    peaceAiShaLandings(entries).map((h) => [h.seq, h.label, h.sha]),
    [[1, "PeaceSTOCKS", "0e1b354"], [2, "PeaceSTOCKS", "deadbee"]],
    "Builder landings ignored; PeaceAI shas deduped by first seq",
  );
  const ok = await verifyPeaceAiShas(entries, async (_repo, sha) => sha === "0e1b354");
  assert.deepEqual(ok, ["seq 2: PeaceSTOCKS@deadbee does not exist"]);
  const boom = await verifyPeaceAiShas(entries, async () => { throw new Error("network"); });
  assert.ok(boom.some((e) => /lookup failed \(fail closed\)/.test(e)));
});

test("verify-shas: lookup errors name the HTTP status; 403/429 stops further calls; still fails closed", async () => {
  const entries = [1, 2, 3, 4].map((seq) => ({
    seq, date: "2026-10-13", time: `01:0${seq}`, asked: "fixture asked text here",
    changed: `PeaceSTOCKS@${"abcdef"}${seq}, PeaceAI-Workspace@${"abcdef"}${seq}`, why: "fixture why text here",
    skill: "TEST_CASE", mark: "PeaceAI-able today", by: "PeaceAI",
  })) as Entry[];
  entries.push({ ...entries[0]!, seq: 5, time: "01:05" });
  type Reply = { status: number; headers?: Record<string, string> };
  const stub = (replies: (n: number) => Reply) => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      const r = replies(urls.length);
      const h = new Headers(r.headers ?? {});
      return { status: r.status, headers: h } as Response;
    }) as unknown as typeof fetch;
    return { urls, resolver: makeGithubShaResolver("t", f) };
  };
  // 8 distinct repo@sha (seq 5 repeats seq 1): deduped, so 8 calls when all pass.
  const all = stub(() => ({ status: 200 }));
  assert.deepEqual(await verifyPeaceAiShas(entries, all.resolver), []);
  assert.equal(all.urls.length, 8, "identical repo@sha looked up once");
  // Primary rate limit on the 3rd call: one cause line, one stop line, no more calls.
  const reset = 1793293612;
  const rl = stub((n) => (n < 3 ? { status: 200 } : { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } }));
  const errs = await verifyPeaceAiShas(entries, rl.resolver);
  assert.equal(rl.urls.length, 3, "stops after the rate-limit response");
  assert.equal(errs.length, 2, errs.join("\n"));
  assert.match(errs[0]!, /^seq 2: PeaceSTOCKS@abcdef2 lookup failed \(fail closed\): HTTP 403 x-ratelimit-remaining 0 x-ratelimit-reset 2026-10-29T\d\d:\d\d:\d\d\.000Z \(rate limited\)$/);
  assert.match(errs[1]!, /^lookups stopped after HTTP 403 .*\(rate limited\): 5 more repo@sha landings not verified \(fail closed\)$/);
  // Secondary limit (429 + retry-after) also stops; a plain 403 (no limit headers) stops but is not called a rate limit.
  const sec = stub(() => ({ status: 429, headers: { "retry-after": "60" } }));
  const secErrs = await verifyPeaceAiShas(entries, sec.resolver);
  assert.equal(sec.urls.length, 1);
  assert.match(secErrs[0]!, /HTTP 429 retry-after 60 \(rate limited\)$/);
  const denied = await verifyPeaceAiShas(entries, stub(() => ({ status: 403 })).resolver);
  assert.match(denied[0]!, /lookup failed \(fail closed\): HTTP 403$/);
  assert.equal(denied.length, 2);
  // A 500 names its status, is not a stop: every landing is still tried and each fails closed.
  const five = stub(() => ({ status: 500 }));
  const fiveErrs = await verifyPeaceAiShas(entries, five.resolver);
  assert.equal(five.urls.length, 8);
  assert.equal(fiveErrs.length, 8);
  assert.ok(fiveErrs.every((e) => /lookup failed \(fail closed\): HTTP 500$/.test(e)));
  // A thrown network error keeps its message and fails closed.
  const net = await verifyPeaceAiShas(entries, async () => { throw new Error("fetch failed"); });
  assert.equal(net.length, 8);
  assert.match(net[0]!, /lookup failed \(fail closed\): fetch failed$/);
});

test("optional coverage:none is accepted; other coverage values and key orders are refused", () => {
  assert.deepEqual(validateLog(line({ ...ok, coverage: "none" })), []);
  assert.ok(validateLog(line({ ...ok, coverage: "all" })).some((e) => /coverage must be "none"/.test(e)));
  const shuffled = { coverage: "none", ...ok };
  assert.ok(validateLog(line(shuffled)).some((e) => /keys must be exactly/.test(e)), "coverage must be trailing");
});

test("COVERAGE_NONE_SEQS allowlist is backed on the committed log", () => {
  const text = readFileSync(LOG_PATH, "utf8");
  assert.deepEqual(validateLog(text), []);
  assert.deepEqual([...COVERAGE_NONE_SEQS].sort((a, b) => a - b), [28, 30, 31, 35, 59, 60, 85, 86, 87, 97, 99, 101]);
  const entries = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
  assert.deepEqual(validateCoverageNoneSeqs(entries), []);
  assert.ok(validateCoverageNoneSeqs(entries, new Set([99999])).some((e) => /no builder-log seq 99999/.test(e)));
});

test("PeaceAI proof wording without coverage:none fails unless grandfathered; with the field it passes", () => {
  const base = {
    ...ok,
    by: "PeaceAI" as const,
    skill: "THROW_GUARD",
    mark: "PeaceAI-able today",
    asked: "Record THROW_GUARD live proof for a blank id",
    why: "tenmin-mode-sim passed on the landed sha",
  };
  assert.ok(
    validateLog(line(base)).some((e) => /proof wording requires coverage:"none"/.test(e)),
    "wording without field must fail",
  );
  assert.deepEqual(validateLog(line({ ...base, coverage: "none" })), [], "field satisfies the wording rule");
  assert.ok(
    validateLog(line({ ...base, asked: "Peace's task #1 (source: peace): proof A2 landing", why: "landed ok enough" })).some((e) =>
      /proof wording requires coverage:"none"/.test(e),
    ),
    "proof A wording also requires the field",
  );
  assert.ok(
    validateLog(line({ ...base, asked: "Peace's task #1 (source: peace): mechanism only", why: "behavior-neutral, no coverage credit" })).some((e) =>
      /proof wording requires coverage:"none"/.test(e),
    ),
    "no coverage wording also requires the field",
  );
});

// ---- --verify-shas with local clones (#590 follow-up: no GitHub API calls) ----

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function repoWithCommit(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "blog-git-"));
  git(dir, "init", "-q");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", "a.txt");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "c");
  return { dir, sha: git(dir, "rev-parse", "HEAD") };
}
const fabricate = (sha: string) => (sha[0] === "0" ? "1" : "0") + sha.slice(1, 7);

test("git resolver: a real commit passes; a fabricated sha or a non-commit fails; a missing or unreadable clone fails closed", async () => {
  const { dir, sha } = repoWithCommit();
  try {
    const r = makeGitShaResolver({ "PeaceG03/PeaceSTOCKS": dir });
    assert.equal(await r("PeaceG03/PeaceSTOCKS", sha.slice(0, 7)), true);
    assert.equal(await r("PeaceG03/PeaceSTOCKS", sha), true);
    const fake = fabricate(sha);
    assert.equal(await r("PeaceG03/PeaceSTOCKS", fake), false);
    // A blob id exists as an object but is not a commit: not a landing.
    assert.equal(await r("PeaceG03/PeaceSTOCKS", git(dir, "rev-parse", "HEAD:a.txt")), false);
    // The resolver plugs into the same verifier: a fabricated landing is an error.
    const e = (changed: string) => ({ ...ok, changed, by: "PeaceAI" }) as Entry;
    assert.deepEqual(await verifyPeaceAiShas([e(`PeaceSTOCKS@${sha.slice(0, 7)}`)], r), []);
    assert.deepEqual(await verifyPeaceAiShas([e(`PeaceSTOCKS@${fake}`)], r), [`seq 1: PeaceSTOCKS@${fake} does not exist`]);
    // No clone for the repo, or a directory that is not a git clone: lookup error -> fail closed.
    const noClone = await verifyPeaceAiShas([e("PeaceAI-Workspace@abcdef1")], r);
    assert.equal(noClone.length, 1);
    assert.match(noClone[0]!, /lookup failed \(fail closed\): no local clone for PeaceG03\/PeaceAI-Workspace/);
    const empty = mkdtempSync(join(tmpdir(), "blog-empty-"));
    try {
      const bad = await verifyPeaceAiShas([e(`PeaceSTOCKS@${sha.slice(0, 7)}`)], makeGitShaResolver({ "PeaceG03/PeaceSTOCKS": empty }));
      assert.match(bad[0] ?? "", /lookup failed \(fail closed\): clone for PeaceG03\/PeaceSTOCKS is not readable/);
    } finally { rmSync(empty, { recursive: true, force: true }); }
    // A malformed sha never reaches git as an option.
    assert.throws(() => r("PeaceG03/PeaceSTOCKS", "--all"), /malformed sha/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check.ts --verify-shas --clone: CLI passes a real landing and fails a fabricated one with no token and no gh", () => {
  const { dir: stocks, sha } = repoWithCommit();
  const ws = mkdtempSync(join(tmpdir(), "blog-ws-"));
  try {
    mkdirSync(join(ws, "builder-log"));
    const row = (changed: string) => line({ ...ok, changed, by: "PeaceAI" });
    const run = () => spawnSync(resolve(import.meta.dirname, "../node_modules/.bin/tsx"), [resolve(import.meta.dirname, "check.ts"), "--verify-shas", "--clone", `PeaceG03/PeaceSTOCKS=${stocks}`], {
      cwd: ws, encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "", GH_TOKEN: "", PATH: "/usr/bin:/bin" },
    });
    writeFileSync(join(ws, "builder-log/tasks.jsonl"), row(`PeaceSTOCKS@${sha.slice(0, 7)}`));
    const good = run();
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /repo@sha verified \(local clones, no API calls\)/);
    const fake = fabricate(sha);
    writeFileSync(join(ws, "builder-log/tasks.jsonl"), row(`PeaceSTOCKS@${fake}`));
    const bad = run();
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, new RegExp(`seq 1: PeaceSTOCKS@${fake} does not exist`));
  } finally {
    rmSync(stocks, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  }
});

test("parseClones reads repeated --clone owner/repo=DIR pairs", () => {
  assert.deepEqual(parseClones(["--verify-shas", "--clone", "PeaceG03/PeaceSTOCKS=/s", "--clone", "PeaceG03/PeaceAI-Workspace=/w", "--clone"]), { "PeaceG03/PeaceSTOCKS": "/s", "PeaceG03/PeaceAI-Workspace": "/w" });
});

test("workflow: the builder-log job verifies shas in local clones with no token", () => {
  const wf = readFileSync(resolve(import.meta.dirname, "../.github/workflows/builder-log.yml"), "utf8");
  const step = wf.slice(wf.indexOf("- name: PeaceAI repo@sha landings exist"), wf.indexOf("- name: PeaceAI landings trace"));
  assert.match(step, /check\.ts --verify-shas --clone "PeaceG03\/PeaceSTOCKS=\$RUNNER_TEMP\/stocks"/);
  assert.ok(!/TOKEN/.test(step), "no token in the verify step");
  assert.ok(wf.indexOf("Clone PeaceSTOCKS anonymously") < wf.indexOf("- name: PeaceAI repo@sha landings exist"), "clone before verify");
});
