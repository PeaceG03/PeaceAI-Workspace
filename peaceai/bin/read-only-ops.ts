// M73 READ_ONLY_OPS CLI. Usage: tsx peaceai/bin/read-only-ops.ts <op> <owner/repo> [key=value ...]
// Ops: run_status run=ID | failed_jobs run=ID | recent_runs [workflow=FILE.yml] [branch=B] [status=S] | check_runs sha=SHA
// Each op is one `gh api --method GET` call; every attempt is appended to PEACEAI_OPS_LOG (JSONL, default
// $TMPDIR/peaceai-read-only-ops.jsonl). Refused (exit 2) until peaceai/read-only-ops.json enables ops.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOp, type OpArgs } from "../lib/read-only-ops.ts";

const [op = "", repo = "", ...rest] = process.argv.slice(2);
const args: OpArgs = {};
for (const kv of rest) { const i = kv.indexOf("="); if (i <= 0) { console.error(`bad argument: ${kv.slice(0, 40)}`); process.exit(2); } args[kv.slice(0, i)] = kv.slice(i + 1); }
const logPath = process.env.PEACEAI_OPS_LOG || join(tmpdir(), "peaceai-read-only-ops.jsonl");
const get = async (path: string) => JSON.parse(execFileSync("gh", ["api", "--method", "GET", path], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }));
const r = await runOp(op, repo, args, get, (e) => { appendFileSync(logPath, JSON.stringify(e) + "\n"); console.error(`read-only-ops ${e.op} ok=${e.ok}${e.reason ? ` reason=${e.reason}` : ""} log=${logPath}`); });
if (!r.ok) process.exit(2);
console.log(JSON.stringify(r.data, null, 2));
