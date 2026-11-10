// M225: hourly CI watch. Mocks only. No network, no webhook, no credential.
// EXPERIMENTAL. credit is false.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli, type CliIo } from "../bin/ci-watch.ts";
import {
  addWatch, applyResult, emptyState, eventBody, judge, loadState, notifyConfigProblem, parsePr, parseRuns,
  planNotify, postWebhook, saveState,
  type GhPr, type GhRun, type Watch, type WatchFile,
} from "../lib/ciwatch.ts";

const HEAD = "9a19bab2a0d1d1e6b191e89bdc241c6ae8eea39c";
const OLD = "b778a82c9e533e44e08ac35912b112758e44998e";
const KEY = "sentinel-key-not-a-real-secret";
const URL = "https://notify.example/hook";
const NOW = Date.parse("2026-11-09T18:00:00Z");

function watch(over: Partial<Watch> = {}): Watch {
  return {
    repo: "PeaceG03/PeaceAI-Workspace", pr: 724, workflows: ["ci", "leak-check", "builder-log"],
    createdAt: "2026-11-09T18:00:00.000Z", deadlineAt: "2026-11-11T18:00:00.000Z",
    active: true, terminal: false, head: null, lastFingerprint: null, lastOverall: null, ...over,
  };
}
function pr(over: Partial<GhPr & { repo: string }> = {}): GhPr & { repo: string } {
  return { repo: "PeaceG03/PeaceAI-Workspace", state: "open", merged: false, headSha: HEAD, ...over };
}
function run(id: number, head: string, status: string, conclusion: string | null, attempt = 1): GhRun {
  return { id, head_sha: head, status, conclusion, run_attempt: attempt };
}
function judged(runs: Record<string, GhRun[]>, extra: Partial<GhPr & { repo: string }> = {}, now = NOW, deadline = "2026-11-11T18:00:00.000Z") {
  return judge(pr(extra), ["ci", "leak-check", "builder-log"], runs, now, deadline);
}
function all(head: string, status: string, conclusion: string | null, id = 10): Record<string, GhRun[]> {
  return { ci: [run(id, head, status, conclusion)], "leak-check": [run(id + 1, head, status, conclusion)], "builder-log": [run(id + 2, head, status, conclusion)] };
}

test("config fails closed and never accepts a non-https or credentialed URL", () => {
  assert.equal(notifyConfigProblem("", KEY), "missing");
  assert.equal(notifyConfigProblem(URL, ""), "missing");
  assert.equal(notifyConfigProblem("http://notify.example/hook", KEY), "bad-url");
  assert.equal(notifyConfigProblem("https://user:pass@example.com/hook", KEY), "bad-url");
  assert.equal(notifyConfigProblem(URL, KEY), null);
});

test("green requires every named workflow success on the exact head", () => {
  const green = judged(all(HEAD, "completed", "success"));
  assert.equal(green.overall, "green");
  assert.equal(green.settled, true);
  const pending = judged({ ...all(HEAD, "completed", "success"), "builder-log": [run(3, HEAD, "in_progress", null)] });
  assert.equal(pending.overall, "pending");
  assert.equal(pending.settled, false);
  const missing = judged({ ci: [run(1, HEAD, "completed", "success")], "leak-check": [], "builder-log": [run(2, HEAD, "completed", "success")] });
  assert.equal(missing.overall, "pending");
  assert.equal(missing.workflows.find((w) => w.name === "leak-check")!.conclusion, "missing");
  const stale = judged({
    ci: [run(1, OLD, "completed", "success"), run(9, HEAD, "completed", "failure")],
    "leak-check": [run(2, OLD, "completed", "failure"), run(10, HEAD, "completed", "success")],
    "builder-log": [run(11, HEAD, "completed", "success")],
  });
  assert.equal(stale.workflows.find((w) => w.name === "ci")!.conclusion, "failure");
  assert.equal(stale.overall, "failed");
  const skipped = judged(all(HEAD, "completed", "skipped"));
  assert.notEqual(skipped.overall, "green");
});

test("a newer in-progress run hides an older failure on the same head", () => {
  const mixed = judged({ ...all(HEAD, "completed", "success"), ci: [run(1, HEAD, "completed", "failure"), run(5, HEAD, "queued", null)] });
  assert.equal(mixed.workflows.find((w) => w.name === "ci")!.conclusion, "pending");
  assert.equal(mixed.overall, "pending");
});

test("closed, merged, and deadline settle once and are not green", () => {
  assert.equal(judged(all(HEAD, "in_progress", null), { state: "closed", merged: false }).overall, "closed");
  assert.equal(judged(all(HEAD, "in_progress", null), { state: "closed", merged: true }).overall, "merged");
  const late = judged(all(HEAD, "in_progress", null), {}, Date.parse("2026-11-12T00:00:00Z"));
  assert.equal(late.overall, "deadline");
  assert.equal(late.settled, true);
});

test("notify once per settled fingerprint, then stop; a new head can notify again", () => {
  const first = judged(all(HEAD, "completed", "failure"));
  const row = watch();
  assert.equal(planNotify(row, first), true);
  const saved = applyResult(row, first, true);
  assert.equal(saved.active, false);
  assert.equal(saved.terminal, true);
  assert.equal(planNotify(saved, first), false);
  const again = judged(all("a".repeat(40), "completed", "success"));
  assert.notEqual(again.fingerprint, first.fingerprint);
  assert.equal(planNotify(saved, again), false);
  const still = applyResult(row, judged({ ...all(HEAD, "completed", "success"), ci: [run(1, HEAD, "in_progress", null)] }), false);
  assert.equal(still.lastFingerprint, null);
});

test("corrupt state is refused and the file bytes stay", () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-watch-"));
  const path = join(dir, "state.json");
  const bad = "{not json";
  writeFileSync(path, bad);
  assert.equal(loadState(bad).ok, false);
  assert.equal(loadState(JSON.stringify({ ...emptyState(), credit: true })).ok, false);
  const dup = emptyState();
  dup.watches.push(watch(), watch());
  assert.equal(loadState(JSON.stringify(dup)).ok, false);
  assert.equal(readFileSync(path, "utf8"), bad);
  rmSync(dir, { recursive: true, force: true });
});

test("one record per target; a second add is refused", () => {
  const added = addWatch(emptyState(), watch());
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(addWatch(added.state, watch()).ok, false);
});

test("webhook retries a non-200, stops on 200, and drops errors that might carry the key", async () => {
  const body = eventBody(watch(), judged(all(HEAD, "completed", "success")));
  assert.equal(body.credit, false);
  assert.equal(body.duplicateDeliveryPossible, true);
  const seen: string[] = [];
  let n = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    seen.push(auth);
    n += 1;
    if (n < 2) return new Response("no", { status: 503 });
    return new Response("ok", { status: 200 });
  };
  const posted = await postWebhook({ url: URL, key: KEY, body, fetchImpl, sleep: async () => {} });
  assert.deepEqual(posted, { ok: true, attempts: 2 });
  assert.ok(seen.every((h) => h === `Bearer ${KEY}`));
  const boom: typeof fetch = async () => { throw new Error(`redirect leaked ${KEY}`); };
  const failed = await postWebhook({ url: URL, key: KEY, body, fetchImpl: boom, sleep: async () => {}, attempts: 2 });
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(failed).includes(KEY), false);
});

test("github failures use a fixed message", async () => {
  const { githubGet } = await import("../lib/ciwatch.ts");
  await assert.rejects(githubGet("https://api.github.com/repos/o/r/pulls/1", KEY, async () => { throw new Error(`token ${KEY}`); }), /github request failed/);
  await assert.rejects(githubGet("https://api.github.com/x", undefined, async () => new Response("no", { status: 404 })), /github http 404/);
});

function io(dir: string, fetchImpl: typeof fetch, lines: string[], now = NOW): CliIo {
  const path = join(dir, "state.json");
  return {
    fetchImpl, now: () => now, log: (line) => lines.push(line), sleep: async () => {},
    read: (p) => readFileSync(p, "utf8"),
    write: (p, state) => saveState(p, state as WatchFile),
  };
}

function env(dir: string): NodeJS.ProcessEnv {
  return { PEACEAI_CI_NOTIFY_URL: URL, PEACEAI_CI_NOTIFY_KEY: KEY, PEACEAI_CI_WATCH_STATE: join(dir, "state.json") };
}

test("cli refuses missing config, corrupt state, and a second watch", async () => {
  const lines: string[] = [];
  assert.equal(await runCli(["tick"], {}, { fetchImpl: fetch, now: () => NOW, log: (l) => lines.push(l), sleep: async () => {}, read: () => "", write: () => {} }), 2);
  assert.ok(lines.some((l) => l === "ci-watch: config missing"));
  assert.equal(lines.some((l) => l.includes(KEY) || l.includes(URL)), false);
  const dir = mkdtempSync(join(tmpdir(), "ci-watch-cli-"));
  const path = join(dir, "state.json");
  writeFileSync(path, "{");
  const logs: string[] = [];
  assert.equal(await runCli(["show"], env(dir), io(dir, fetch, logs)), 3);
  assert.equal(readFileSync(path, "utf8"), "{");
  rmSync(dir, { recursive: true, force: true });
});

test("tick notifies a settled failure once, ignores a stale head, and does not reset after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-watch-tick-"));
  const logs: string[] = [];
  const posts: unknown[] = [];
  const githubFetch: typeof fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/pulls/724")) return Response.json({ state: "open", merged: false, head: { sha: HEAD } });
    if (u.includes("ci.yml")) return Response.json({ workflow_runs: [run(1, OLD, "completed", "success"), run(8, HEAD, "completed", "failure")] });
    if (u.includes("leak-check.yml")) return Response.json({ workflow_runs: [run(9, HEAD, "completed", "success")] });
    if (u.includes("builder-log.yml")) return Response.json({ workflow_runs: [run(10, HEAD, "completed", "success")] });
    return new Response("missing", { status: 404 });
  };
  const realFetch: typeof fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://api.github.com/")) return githubFetch(url, init);
    posts.push(JSON.parse(String(init?.body)));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    assert.equal(auth, `Bearer ${KEY}`);
    assert.equal(JSON.stringify(init).includes("log"), true);
    return new Response("ok", { status: 200 });
  };
  assert.equal(await runCli(["add", "--repo", "PeaceG03/PeaceAI-Workspace", "--pr", "724", "--workflows", "ci,leak-check,builder-log", "--hours", "48"], env(dir), io(dir, realFetch, logs)), 0);
  assert.equal(await runCli(["add", "--repo", "PeaceG03/PeaceAI-Workspace", "--pr", "724", "--workflows", "ci,leak-check,builder-log", "--hours", "48"], env(dir), io(dir, realFetch, logs)), 2);
  logs.length = 0;
  assert.equal(await runCli(["tick"], env(dir), io(dir, realFetch, logs)), 0);
  assert.equal(posts.length, 1);
  const body = posts[0] as { credit: boolean; overall: string; head: string };
  assert.equal(body.credit, false);
  assert.equal(body.overall, "failed");
  assert.equal(body.head, HEAD);
  const after = loadState(readFileSync(join(dir, "state.json"), "utf8"));
  assert.equal(after.ok && after.state.watches[0]!.active, false);
  posts.length = 0;
  assert.equal(await runCli(["tick"], env(dir), io(dir, realFetch, logs)), 0);
  assert.equal(posts.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("a github error and a refused notify leave the previous fingerprint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-watch-hold-"));
  const logs: string[] = [];
  assert.equal(await runCli(["add", "--repo", "PeaceG03/PeaceAI-Workspace", "--pr", "724", "--workflows", "ci,leak-check,builder-log", "--hours", "48"], env(dir), io(dir, fetch, logs)), 0);
  const before = readFileSync(join(dir, "state.json"), "utf8");
  const down: typeof fetch = async () => { throw new Error("down"); };
  assert.equal(await runCli(["tick"], env(dir), io(dir, down, logs)), 4);
  assert.equal(readFileSync(join(dir, "state.json"), "utf8"), before);
  const refuse: typeof fetch = async (url) => {
    if (String(url).includes("api.github.com")) return Response.json(String(url).includes("/pulls/")
      ? { state: "open", merged: false, head: { sha: HEAD } }
      : { workflow_runs: [run(4, HEAD, "completed", "success")] });
    return new Response("no", { status: 500 });
  };
  assert.equal(await runCli(["tick"], env(dir), io(dir, refuse, logs)), 4);
  const held = loadState(readFileSync(join(dir, "state.json"), "utf8"));
  assert.equal(held.ok && held.state.watches[0]!.lastFingerprint, null);
  rmSync(dir, { recursive: true, force: true });
});

test("parsers reject a pull request or run list that is not the documented shape", () => {
  assert.equal(parsePr({ state: "open", merged: false, head: { sha: HEAD } })?.headSha, HEAD);
  assert.equal(parsePr({ state: "open", merged: false, head: { sha: "abc" } }), null);
  assert.equal(parseRuns({ workflow_runs: [run(1, HEAD, "completed", "success")] })?.[0]?.run_attempt, 1);
  assert.equal(parseRuns({ workflow_runs: [{ id: 1, head_sha: HEAD, status: "completed", conclusion: "success" }] })?.[0]?.run_attempt, 1);
  assert.equal(parseRuns({ workflow_runs: [{ id: "x" }] }), null);
  assert.equal(parseRuns({ workflow_runs: [{ id: 1, head_sha: HEAD, status: "completed", conclusion: "failure", run_attempt: 0 }] }), null);
  assert.equal(parseRuns({ workflow_runs: [{ id: 1, head_sha: HEAD, status: "completed", conclusion: "failure", run_attempt: "2" }] }), null);
});

test("rearm observes a new attempt and does not resend the stored failure", async () => {
  const seen = {
    ci: [run(8, HEAD, "completed", "failure", 1)],
    "leak-check": [run(9, HEAD, "completed", "success", 1)],
    "builder-log": [run(10, HEAD, "completed", "success", 1)],
  };
  const attempt1 = judged(seen);
  const attempt2 = judged({
    ci: [run(8, HEAD, "completed", "failure", 2)],
    "leak-check": [run(9, HEAD, "completed", "success", 2)],
    "builder-log": [run(10, HEAD, "completed", "success", 1)],
  });
  assert.equal(attempt1.workflows.every((w) => w.runAttempt === 1), true);
  assert.notEqual(attempt1.fingerprint, attempt1.legacyFingerprint);
  assert.equal(attempt2.legacyFingerprint, attempt1.legacyFingerprint);
  assert.notEqual(attempt2.fingerprint, attempt1.fingerprint);
  assert.equal(attempt2.workflows.find((w) => w.name === "ci")!.url, "https://github.com/PeaceG03/PeaceAI-Workspace/actions/runs/8/attempts/2");
  const stored = watch({ active: false, terminal: true, head: HEAD, lastFingerprint: attempt1.legacyFingerprint, lastOverall: "failed" });
  assert.equal(planNotify(stored, attempt1), false);
  assert.equal(planNotify({ ...stored, active: true, terminal: false }, attempt1), false);
  assert.equal(planNotify({ ...stored, active: true, terminal: false }, attempt2), true);

  const dir = mkdtempSync(join(tmpdir(), "ci-watch-rearm-"));
  const path = join(dir, "state.json");
  const state = emptyState();
  state.watches.push(stored);
  saveState(path, state);
  const before = readFileSync(path, "utf8");
  const logs: string[] = [];
  const posts: Array<{ overall: string; workflows: Array<{ name: string; runAttempt: number | null; url: string | null }> }> = [];
  let ci = [run(8, HEAD, "completed", "failure", 1)];
  let leak = [run(9, HEAD, "completed", "success", 1)];
  let blog = [run(10, HEAD, "completed", "success", 1)];
  let head = HEAD;
  const fetchImpl: typeof fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/pulls/724")) return Response.json({ state: "open", merged: false, head: { sha: head } });
    if (u.includes("ci.yml")) return Response.json({ workflow_runs: ci });
    if (u.includes("leak-check.yml")) return Response.json({ workflow_runs: leak });
    if (u.includes("builder-log.yml")) return Response.json({ workflow_runs: blog });
    posts.push(JSON.parse(String(init?.body)));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    assert.equal(auth, `Bearer ${KEY}`);
    return new Response("ok", { status: 200 });
  };
  const cli = io(dir, fetchImpl, logs);
  assert.equal(await runCli(["add", "--repo", "PeaceG03/PeaceAI-Workspace", "--pr", "724", "--workflows", "ci,leak-check,builder-log"], env(dir), cli), 2);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(await runCli(["rearm", "--repo", "PeaceG03/PeaceAI-Workspace", "--pr", "724"], env(dir), cli), 0);
  assert.equal(logs.some((l) => l.includes(KEY)), false);
  let saved = loadState(readFileSync(path, "utf8"));
  assert.equal(saved.ok && saved.state.watches.length, 1);
  assert.equal(saved.ok && saved.state.watches[0]!.active, true);
  assert.equal(saved.ok && saved.state.watches[0]!.terminal, false);
  assert.equal(saved.ok && saved.state.watches[0]!.lastFingerprint, attempt1.legacyFingerprint);
  assert.equal(saved.ok && saved.state.watches[0]!.deliveredFingerprints?.includes(attempt1.legacyFingerprint), true);
  assert.equal(await runCli(["rearm", "--repo", "PeaceG03/PeaceAI-Workspace", "--pr", "724"], env(dir), cli), 2);
  posts.length = 0;
  assert.equal(await runCli(["tick"], env(dir), cli), 0);
  assert.equal(posts.length, 0);
  saved = loadState(readFileSync(path, "utf8"));
  assert.equal(saved.ok && saved.state.watches[0]!.active, true);
  assert.equal(saved.ok && saved.state.watches[0]!.lastFingerprint, attempt1.fingerprint);
  ci = [run(8, HEAD, "in_progress", null, 2)];
  assert.equal(await runCli(["tick"], env(dir), cli), 0);
  assert.equal(posts.length, 0);
  const during = loadState(readFileSync(path, "utf8"));
  assert.equal(during.ok && during.state.watches[0]!.lastFingerprint, attempt1.fingerprint);
  ci = [run(8, HEAD, "completed", "failure", 2)];
  assert.equal(await runCli(["tick"], env(dir), cli), 0);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.overall, "failed");
  assert.equal(posts[0]!.workflows.find((w) => w.name === "ci")!.runAttempt, 2);
  assert.equal(posts[0]!.workflows.find((w) => w.name === "ci")!.url, "https://github.com/PeaceG03/PeaceAI-Workspace/actions/runs/8/attempts/2");
  saved = loadState(readFileSync(path, "utf8"));
  assert.equal(saved.ok && saved.state.watches[0]!.active, false);
  assert.equal(saved.ok && saved.state.watches[0]!.terminal, true);
  const sent = saved.ok ? saved.state.watches[0]!.lastFingerprint : null;
  posts.length = 0;
  assert.equal(await runCli(["tick"], env(dir), cli), 0);
  assert.equal(posts.length, 0);
  assert.equal(await runCli(["rearm", "--repo", "PeaceG03/PeaceAI-Workspace", "--pr", "724"], env(dir), cli), 0);
  assert.equal(await runCli(["tick"], env(dir), cli), 0);
  assert.equal(posts.length, 0);
  const nextHead = "b".repeat(40);
  head = nextHead;
  ci = [run(18, nextHead, "completed", "success", 1)];
  leak = [run(19, nextHead, "completed", "success", 1)];
  blog = [run(20, nextHead, "completed", "success", 1)];
  assert.equal(await runCli(["tick"], env(dir), cli), 0);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.overall, "green");
  saved = loadState(readFileSync(path, "utf8"));
  assert.equal(saved.ok && saved.state.watches[0]!.deliveredFingerprints?.includes(attempt1.legacyFingerprint), true);
  assert.equal(saved.ok && sent !== null && saved.state.watches[0]!.deliveredFingerprints?.includes(sent), true);
  assert.notEqual(saved.ok && saved.state.watches[0]!.lastFingerprint, attempt1.legacyFingerprint);
  rmSync(dir, { recursive: true });
});

test("rearm refuses a missing or corrupt file and a failed notify does not drop the baseline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-watch-rearm-hold-"));
  const path = join(dir, "state.json");
  const logs: string[] = [];
  assert.equal(await runCli(["rearm", "--repo", "PeaceG03/PeaceAI-Workspace", "--pr", "724"], env(dir), io(dir, fetch, logs)), 3);
  writeFileSync(path, "{");
  assert.equal(await runCli(["rearm", "--repo", "PeaceG03/PeaceAI-Workspace", "--pr", "724"], env(dir), io(dir, fetch, logs)), 3);
  assert.equal(readFileSync(path, "utf8"), "{");
  const failure = judged(all(HEAD, "completed", "failure"));
  const state = emptyState();
  state.watches.push(watch({ active: false, terminal: true, lastFingerprint: failure.legacyFingerprint, lastOverall: "failed", head: HEAD }));
  saveState(path, state);
  const cli = io(dir, async (url) => {
    const u = String(url);
    if (u.includes("api.github.com") && u.endsWith("/pulls/724")) return Response.json({ state: "open", merged: false, head: { sha: HEAD } });
    if (u.includes("api.github.com")) return Response.json({ workflow_runs: [run(8, HEAD, "completed", "success", 2)] });
    return new Response("no", { status: 500 });
  }, logs);
  assert.equal(await runCli(["rearm", "--repo", "PeaceG03/PeaceAI-Workspace", "--pr", "724"], env(dir), cli), 0);
  const armed = readFileSync(path, "utf8");
  assert.equal(await runCli(["tick"], env(dir), cli), 4);
  assert.equal(readFileSync(path, "utf8"), armed);
  assert.equal(logs.some((l) => l.includes(KEY)), false);
  rmSync(dir, { recursive: true });
});
