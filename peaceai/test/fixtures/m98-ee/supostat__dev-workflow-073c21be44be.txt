import { detectContext } from "../lib/context.js";
import { collectEngramStats, type EngramStats } from "../lib/engram-stats.js";

function parseRunCount(args: string[]): number {
  const idx = args.indexOf("--runs");
  if (idx === -1 || idx >= args.length - 1) return 10;
  const value = Number(args[idx + 1]);
  if (!Number.isFinite(value) || value < 1) return 10;
  return Math.floor(value);
}

function formatDurationMs(ms: number | null): string {
  if (ms === null) return "?";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 > 0 ? `${s % 60}s` : ""}`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 > 0 ? `${m % 60}m` : ""}`;
}

function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}Z` : iso;
}

function renderJson(stats: EngramStats): void {
  console.log(JSON.stringify(stats, null, 2));
}

function renderPretty(stats: EngramStats): void {
  console.log(`\n📊 Engram Dashboard — last ${stats.scope.runCount} run${stats.scope.runCount === 1 ? "" : "s"}`);
  if (stats.scope.cutoffISO) {
    console.log(`   Window: since ${formatDate(stats.scope.cutoffISO)}`);
  }
  console.log("");

  // Live engram panel
  console.log("Engram daemon:");
  if (stats.live.health === null) {
    console.log("  ⚠ unavailable (daemon down or socket missing — local data still shown)");
  } else {
    const stale = stats.live.health.modelsStale ? " (models may be outdated)" : "";
    console.log(`  ✓ pending judgments: ${stats.live.health.pendingJudgments}${stale}`);
  }
  console.log("");

  // Methods
  const methods = Object.entries(stats.byMethod).sort(([a], [b]) => a.localeCompare(b));
  if (methods.length > 0) {
    console.log("Activity by method:");
    for (const [method, m] of methods) {
      const err = m.errors > 0 ? `, ${m.errors} errors` : "";
      console.log(`  ${method.padEnd(22)} ${m.count} calls${err}  (avg ${m.avgDurationMs}ms)`);
    }
    console.log("");
  } else {
    console.log("Activity by method: (no trace files found)");
    console.log("");
  }

  // Memory types
  const types = Object.entries(stats.byMemoryType).sort(([a], [b]) => a.localeCompare(b));
  if (types.length > 0) {
    console.log("Memory stores by type:");
    for (const [type, count] of types) {
      console.log(`  ${type.padEnd(16)} ${count}`);
    }
    console.log("");
  }

  // By step
  const steps = Object.entries(stats.byStep).sort(([a], [b]) => a.localeCompare(b));
  if (steps.length > 0) {
    console.log("By workflow step:");
    for (const [step, s] of steps) {
      console.log(`  ${step.padEnd(16)} ${String(s.search).padStart(3)} search   ${String(s.store).padStart(3)} store   ${String(s.judge).padStart(3)} judge`);
    }
    console.log("");
  }

  // Recent runs
  if (stats.recentRuns.length > 0) {
    console.log(`Recent runs (${stats.recentRuns.length}):`);
    for (const run of stats.recentRuns) {
      const traceMark = run.hasTrace ? "" : " (no trace)";
      const t = run.telemetry;
      const tele = t ? `  ${t.search}/${t.store}/${t.judge} s/st/j` : "";
      console.log(`  ${run.id}  ${run.workflowName.padEnd(8)}  ${run.status.padEnd(10)}  ${run.completedSteps}/${run.stepCount} steps  ${formatDurationMs(run.durationMs).padStart(7)}${tele}${traceMark}`);
    }
    console.log("");
  }

  // Live top memories
  if (stats.live.topMemories.length > 0) {
    console.log("Recent memories (top 5 from engram):");
    for (const memory of stats.live.topMemories) {
      const score = memory.score > 0 ? ` (${memory.score.toFixed(2)})` : "";
      const ctx = memory.context.length > 80 ? memory.context.slice(0, 80) + "…" : memory.context;
      console.log(`  [${memory.memory_type}]${score} ${ctx}`);
    }
    console.log("");
  }

  // Cross-run reuse
  if (stats.crossRunReuse.total > 0) {
    const cr = stats.crossRunReuse;
    console.log("Cross-run memory reuse:");
    console.log(`  ${cr.reused}/${cr.total} pattern/antipattern memories judged in different run (${cr.percent}%)`);
    console.log("");
  }

  // Per-step hit rate
  const hitRateEntries = Object.entries(stats.perStepHitRate).sort(([a], [b]) => a.localeCompare(b));
  if (hitRateEntries.length > 0) {
    console.log("Search hit rate by step:");
    for (const [step, h] of hitRateEntries) {
      console.log(`  ${step.padEnd(16)} ${String(h.nonEmpty).padStart(3)}/${String(h.searches).padEnd(3)} non-empty  (${h.percent}%)`);
    }
    console.log("");
  }

  // Missing step-complete (search→no judge)
  if (stats.missingStepComplete.count > 0) {
    console.log(`Missing feedback loop (search hits, no judge) — ${stats.missingStepComplete.count} (run, step) tuple${stats.missingStepComplete.count === 1 ? "" : "s"}:`);
    for (const entry of stats.missingStepComplete.affectedRuns) {
      console.log(`  ⚠ ${entry.runId}  step=${entry.step.padEnd(12)} ${entry.searches} search hit${entry.searches === 1 ? "" : "s"}, ${entry.judges} judge${entry.judges === 1 ? "" : "s"}`);
    }
    console.log("");
  }

  // Warnings
  if (stats.warnings.length > 0) {
    console.log("Warnings:");
    for (const w of stats.warnings) {
      console.log(`  ⚠ ${w.runId}: ${w.issue}`);
    }
    console.log("");
  }

  if (stats.recentRuns.length === 0) {
    console.log("No workflow runs found. Start one with /workflow:dev or `dev-workflow run dev \"task\"`.");
  }
}

export async function engramStats(args: string[]): Promise<void> {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  const runCount = parseRunCount(args);
  const jsonMode = args.includes("--json");

  const stats = await collectEngramStats(context.vaultPath, {
    runCount,
    projectName: context.projectName,
    branch: context.branch,
  });

  if (jsonMode) {
    renderJson(stats);
  } else {
    renderPretty(stats);
  }
}

// re-export type for tooling consumers
export type { RunSummary } from "../lib/engram-stats.js";
