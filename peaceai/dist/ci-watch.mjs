#!/usr/bin/env node

// peaceai/bin/ci-watch.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { pathToFileURL } from "node:url";

// peaceai/lib/ciwatch.ts
import { createHash } from "node:crypto";
import { renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename, join } from "node:path";
var CI_WATCH_SCHEMA = "peaceai-ci-watch:v1";
var CI_WATCH_EVENT = "peaceai-ci-watch-event:v1";
var WATCH_WORKFLOWS = ["ci", "leak-check", "builder-log"];
var WORKFLOW_FILE = {
  ci: "ci.yml",
  "leak-check": "leak-check.yml",
  "builder-log": "builder-log.yml"
};
function workflowFile(name) {
  return WATCH_WORKFLOWS.includes(name) ? WORKFLOW_FILE[name] : null;
}
var HEX40 = /^[0-9a-f]{40}$/;
var REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function notifyConfigProblem(url, key) {
  if (!url || !key) return "missing";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "bad-url";
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) return "bad-url";
  return null;
}
function emptyState() {
  return { schema: CI_WATCH_SCHEMA, experimental: true, credit: false, watches: [] };
}
function isIso(s) {
  return typeof s === "string" && Number.isFinite(Date.parse(s));
}
function watchOk(w) {
  if (!w || typeof w !== "object") return false;
  const row = w;
  if (!REPO.test(row.repo) || !Number.isInteger(row.pr) || row.pr <= 0) return false;
  if (!Array.isArray(row.workflows) || row.workflows.length === 0) return false;
  if (new Set(row.workflows).size !== row.workflows.length) return false;
  if (!row.workflows.every((n) => WATCH_WORKFLOWS.includes(n))) return false;
  if (!isIso(row.createdAt) || !isIso(row.deadlineAt)) return false;
  if (typeof row.active !== "boolean" || typeof row.terminal !== "boolean") return false;
  if (row.head !== null && !HEX40.test(row.head)) return false;
  if (row.lastFingerprint !== null && typeof row.lastFingerprint !== "string") return false;
  if (row.active && row.terminal) return false;
  return true;
}
function loadState(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: "CORRUPT" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, code: "CORRUPT" };
  const doc = parsed;
  if (doc.schema !== CI_WATCH_SCHEMA || doc.experimental !== true || doc.credit !== false) return { ok: false, code: "CORRUPT" };
  if (!Array.isArray(doc.watches) || !doc.watches.every(watchOk)) return { ok: false, code: "CORRUPT" };
  const active = doc.watches.filter((w) => w.active).map((w) => `${w.repo}#${w.pr}`);
  if (new Set(active).size !== active.length) return { ok: false, code: "CORRUPT" };
  const all = doc.watches.map((w) => `${w.repo}#${w.pr}`);
  if (new Set(all).size !== all.length) return { ok: false, code: "CORRUPT" };
  return { ok: true, state: doc };
}
function saveState(path, state) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}
`, { mode: 384 });
  renameSync(tmp, path);
}
function addWatch(state, watch) {
  if (state.watches.some((w) => w.repo === watch.repo && w.pr === watch.pr)) return { ok: false, code: "ALREADY" };
  return { ok: true, state: { ...state, watches: [...state.watches, watch] } };
}
function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}
function conclusionOf(run) {
  if (!run) return "missing";
  if (run.status !== "completed") return "pending";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === "failure" || run.conclusion === "cancelled" || run.conclusion === "skipped") return run.conclusion;
  return "failure";
}
function latestOnHead(runs, head) {
  return runs.filter((r) => r.head_sha === head).sort((a, b) => b.id - a.id)[0];
}
function judge(pr, workflows, byName, nowMs, deadlineAt) {
  const workflowsOut = workflows.map((name) => {
    const run = latestOnHead(byName[name] ?? [], pr.headSha);
    const conclusion = conclusionOf(run);
    const settledRun = conclusion !== "missing" && conclusion !== "pending";
    const url = run && settledRun && REPO.test(pr.repo) ? `https://github.com/${pr.repo}/actions/runs/${run.id}` : null;
    return { name, conclusion, runId: run ? run.id : null, url };
  });
  const pastDeadline = nowMs >= Date.parse(deadlineAt);
  let overall;
  let settled = false;
  if (pr.merged) {
    overall = "merged";
    settled = true;
  } else if (pr.state === "closed") {
    overall = "closed";
    settled = true;
  } else if (pastDeadline) {
    overall = "deadline";
    settled = true;
  } else if (workflowsOut.some((w) => w.conclusion === "missing" || w.conclusion === "pending")) {
    overall = "pending";
    settled = false;
  } else if (workflowsOut.every((w) => w.conclusion === "success")) {
    overall = "green";
    settled = true;
  } else {
    overall = "failed";
    settled = true;
  }
  if (overall === "pending") settled = false;
  const fingerprint = sha256(JSON.stringify({
    head: pr.headSha,
    overall,
    pr: pr.state,
    merged: pr.merged,
    workflows: workflowsOut.map((w) => ({ name: w.name, conclusion: w.conclusion, runId: w.runId }))
  }));
  return { head: pr.headSha, prState: pr.state, merged: pr.merged, workflows: workflowsOut, settled, overall, fingerprint };
}
function planNotify(watch, assessment) {
  return watch.active && !watch.terminal && assessment.settled && assessment.fingerprint !== watch.lastFingerprint;
}
function applyResult(watch, assessment, notified) {
  if (!notified) return watch;
  const terminal = assessment.overall !== "pending";
  return {
    ...watch,
    head: assessment.head,
    lastFingerprint: assessment.fingerprint,
    lastOverall: assessment.overall,
    active: terminal ? false : watch.active,
    terminal
  };
}
function eventBody(watch, assessment) {
  return {
    schema: CI_WATCH_EVENT,
    experimental: true,
    credit: false,
    repo: watch.repo,
    pr: watch.pr,
    head: assessment.head,
    overall: assessment.overall,
    settled: assessment.settled,
    workflows: assessment.workflows,
    duplicateDeliveryPossible: true
  };
}
async function postWebhook(opts) {
  const problem = notifyConfigProblem(opts.url, opts.key);
  if (problem) return { ok: false, attempts: 0 };
  const limit = opts.attempts ?? 3;
  const payload = JSON.stringify(opts.body);
  for (let i = 1; i <= limit; i++) {
    try {
      const res = await opts.fetchImpl(opts.url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(1e4),
        headers: {
          Authorization: `Bearer ${opts.key}`,
          "Content-Type": "application/json",
          "User-Agent": "PeaceAI-ci-watch"
        },
        body: payload
      });
      if (res.status === 200) return { ok: true, attempts: i };
    } catch {
    }
    if (i < limit) await opts.sleep(250 * 2 ** (i - 1));
  }
  return { ok: false, attempts: limit };
}
function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "PeaceAI-ci-watch",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
async function githubGet(url, token, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { headers: githubHeaders(token), redirect: "error", signal: AbortSignal.timeout(1e4) });
  } catch {
    throw new Error("github request failed");
  }
  if (!res.ok) throw new Error(`github http ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error("github request failed");
  }
}
function parsePr(body) {
  if (!body || typeof body !== "object") return null;
  const row = body;
  if (row.state !== "open" && row.state !== "closed") return null;
  if (typeof row.merged !== "boolean") return null;
  if (!row.head || typeof row.head.sha !== "string" || !HEX40.test(row.head.sha)) return null;
  return { state: row.state, merged: row.merged, headSha: row.head.sha };
}
function parseRuns(body) {
  if (!body || typeof body !== "object") return null;
  const runs = body.workflow_runs;
  if (!Array.isArray(runs)) return null;
  const out = [];
  for (const run of runs) {
    if (!run || typeof run !== "object") return null;
    const row = run;
    if (!Number.isInteger(row.id) || typeof row.head_sha !== "string" || typeof row.status !== "string") return null;
    out.push({ id: row.id, head_sha: row.head_sha, status: row.status, conclusion: row.conclusion ?? null });
  }
  return out;
}
async function assessWatch(watch, token, fetchImpl, nowMs) {
  let prBody;
  try {
    prBody = await githubGet(prUrl(watch.repo, watch.pr), token, fetchImpl);
  } catch {
    return "github";
  }
  const pr = parsePr(prBody);
  if (!pr) return "github";
  const byName = {};
  for (const name of watch.workflows) {
    let body;
    try {
      body = await githubGet(runsUrl(watch.repo, name, pr.headSha), token, fetchImpl);
    } catch {
      return "github";
    }
    const runs = parseRuns(body);
    if (!runs) return "github";
    byName[name] = runs;
  }
  return judge({ ...pr, repo: watch.repo }, watch.workflows, byName, nowMs, watch.deadlineAt);
}
function prUrl(repo, pr) {
  return `https://api.github.com/repos/${repo}/pulls/${pr}`;
}
function runsUrl(repo, workflow, head) {
  const file = WORKFLOW_FILE[workflow];
  return `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?head_sha=${head}&per_page=20`;
}

// peaceai/bin/ci-watch.ts
var defaultIo = () => ({
  fetchImpl: globalThis.fetch,
  now: () => Date.now(),
  log: (line) => console.log(line),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  read: (path) => readFileSync2(path, "utf8"),
  write: saveState
});
function flag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return void 0;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) return void 0;
  return v;
}
async function runCli(argv, env, io = defaultIo()) {
  const url = env.PEACEAI_CI_NOTIFY_URL ?? "";
  const key = env.PEACEAI_CI_NOTIFY_KEY ?? "";
  const statePath = env.PEACEAI_CI_WATCH_STATE ?? "";
  const token = env.PEACEAI_CI_WATCH_GITHUB_TOKEN || void 0;
  if (!statePath || notifyConfigProblem(url, key)) {
    io.log("ci-watch: config missing");
    return 2;
  }
  const cmd = argv[0];
  if (cmd === "add") return addCommand(argv, statePath, io);
  if (cmd === "tick") return tickCommand(statePath, url, key, token, io);
  if (cmd === "show") return showCommand(statePath, io);
  io.log("ci-watch: usage add|tick|show");
  return 2;
}
function readOrEmpty(path, io) {
  let text;
  try {
    text = io.read(path);
  } catch {
    return { ok: true, state: emptyState() };
  }
  return loadState(text);
}
function addCommand(argv, statePath, io) {
  const repo = flag(argv, "--repo") ?? "";
  const pr = Number(flag(argv, "--pr"));
  const names = (flag(argv, "--workflows") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const hours = Number(flag(argv, "--hours") ?? "48");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !Number.isInteger(pr) || pr <= 0) {
    io.log("ci-watch: bad target");
    return 2;
  }
  if (!names.length || names.some((n) => !workflowFile(n)) || new Set(names).size !== names.length) {
    io.log("ci-watch: bad workflows");
    return 2;
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    io.log("ci-watch: bad deadline");
    return 2;
  }
  const loaded = readOrEmpty(statePath, io);
  if (!loaded.ok) {
    io.log("ci-watch: corrupt");
    return 3;
  }
  const now = io.now();
  const watch = {
    repo,
    pr,
    workflows: names,
    createdAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + hours * 36e5).toISOString(),
    active: true,
    terminal: false,
    head: null,
    lastFingerprint: null,
    lastOverall: null
  };
  const added = addWatch(loaded.state, watch);
  if (!added.ok) {
    io.log("ci-watch: already watched");
    return 2;
  }
  io.write(statePath, added.state);
  io.log(`ci-watch: watching ${repo}#${pr}`);
  return 0;
}
async function tickCommand(statePath, url, key, token, io) {
  let text;
  try {
    text = io.read(statePath);
  } catch {
    io.log("ci-watch: state missing");
    return 3;
  }
  const loaded = loadState(text);
  if (!loaded.ok) {
    io.log("ci-watch: corrupt");
    return 3;
  }
  let failed = false;
  const next = [];
  for (const watch of loaded.state.watches) {
    if (!watch.active) {
      next.push(watch);
      continue;
    }
    const looked = await assessWatch(watch, token, io.fetchImpl, io.now());
    if (looked === "github") {
      failed = true;
      io.log(`ci-watch: held ${watch.repo}#${watch.pr}`);
      next.push(watch);
      continue;
    }
    if (!planNotify(watch, looked)) {
      io.log(`ci-watch: ${looked.settled ? "unchanged" : "pending"} ${watch.repo}#${watch.pr}`);
      next.push(watch);
      continue;
    }
    const posted = await postWebhook({
      url,
      key,
      body: eventBody(watch, looked),
      fetchImpl: io.fetchImpl,
      sleep: io.sleep
    });
    if (!posted.ok) {
      failed = true;
      io.log(`ci-watch: notify failed ${watch.repo}#${watch.pr}`);
      next.push(watch);
      continue;
    }
    io.log(`ci-watch: notified ${watch.repo}#${watch.pr} ${looked.overall}`);
    next.push(applyResult(watch, looked, true));
  }
  const saved = { schema: CI_WATCH_SCHEMA, experimental: true, credit: false, watches: next };
  if (JSON.stringify(saved.watches) !== JSON.stringify(loaded.state.watches)) io.write(statePath, saved);
  return failed ? 4 : 0;
}
function showCommand(statePath, io) {
  let text;
  try {
    text = io.read(statePath);
  } catch {
    io.log("ci-watch: state missing");
    return 3;
  }
  const loaded = loadState(text);
  if (!loaded.ok) {
    io.log("ci-watch: corrupt");
    return 3;
  }
  if (!loaded.state.watches.length) io.log("ci-watch: no watches");
  for (const w of loaded.state.watches) io.log(`ci-watch: ${w.repo}#${w.pr} active=${w.active} overall=${w.lastOverall ?? "none"}`);
  return 0;
}
var isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
export {
  runCli
};
