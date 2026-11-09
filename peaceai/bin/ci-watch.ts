// Experimental. credit: false. One tick reads CI and may POST one webhook. No model call.
// The host cron runs `tick` once an hour. This program does not install that cron.
// Config is environment only, never argv: PEACEAI_CI_NOTIFY_URL, PEACEAI_CI_NOTIFY_KEY,
// PEACEAI_CI_WATCH_STATE. Optional PEACEAI_CI_WATCH_GITHUB_TOKEN (public reads work without it).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  addWatch, applyResult, assessWatch, CI_WATCH_SCHEMA, emptyState, eventBody, loadState, notifyConfigProblem,
  planNotify, postWebhook, saveState, workflowFile,
  type Assessment, type Watch, type WatchFile, type WatchWorkflow,
} from "../lib/ciwatch.ts";

export interface CliIo {
  fetchImpl: typeof fetch;
  now: () => number;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  read: (path: string) => string;
  write: (path: string, state: WatchFile) => void;
}

const defaultIo = (): CliIo => ({
  fetchImpl: globalThis.fetch,
  now: () => Date.now(),
  log: (line) => console.log(line),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  read: (path) => readFileSync(path, "utf8"),
  write: saveState,
});

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) return undefined;
  return v;
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv, io: CliIo = defaultIo()): Promise<number> {
  const url = env.PEACEAI_CI_NOTIFY_URL ?? "";
  const key = env.PEACEAI_CI_NOTIFY_KEY ?? "";
  const statePath = env.PEACEAI_CI_WATCH_STATE ?? "";
  const token = env.PEACEAI_CI_WATCH_GITHUB_TOKEN || undefined;
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

function readOrEmpty(path: string, io: CliIo): { ok: true; state: WatchFile } | { ok: false; code: "CORRUPT" } {
  let text: string;
  try { text = io.read(path); } catch { return { ok: true, state: emptyState() }; }
  return loadState(text);
}

function addCommand(argv: string[], statePath: string, io: CliIo): number {
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
  const watch: Watch = {
    repo, pr, workflows: names as WatchWorkflow[],
    createdAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + hours * 3_600_000).toISOString(),
    active: true, terminal: false, head: null, lastFingerprint: null, lastOverall: null,
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

async function tickCommand(statePath: string, url: string, key: string, token: string | undefined, io: CliIo): Promise<number> {
  let text: string;
  try { text = io.read(statePath); } catch {
    io.log("ci-watch: state missing");
    return 3;
  }
  const loaded = loadState(text);
  if (!loaded.ok) {
    io.log("ci-watch: corrupt");
    return 3;
  }
  let failed = false;
  const next: Watch[] = [];
  for (const watch of loaded.state.watches) {
    if (!watch.active) { next.push(watch); continue; }
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
      url, key, body: eventBody(watch, looked), fetchImpl: io.fetchImpl, sleep: io.sleep,
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
  const saved: WatchFile = { schema: CI_WATCH_SCHEMA, experimental: true, credit: false, watches: next };
  if (JSON.stringify(saved.watches) !== JSON.stringify(loaded.state.watches)) io.write(statePath, saved);
  return failed ? 4 : 0;
}

function showCommand(statePath: string, io: CliIo): number {
  let text: string;
  try { text = io.read(statePath); } catch {
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

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli(process.argv.slice(2), process.env).then((code) => process.exit(code));
}

export type { Assessment };
