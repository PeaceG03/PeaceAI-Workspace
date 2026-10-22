import { randomUUID } from "node:crypto";
import type { MissionStatus } from "./types.js";
import type {
  Campaign,
  CampaignBudgetUsage,
  CampaignMissionEntry,
  CampaignProgress,
  CampaignStatus,
} from "./campaign-contracts.js";

export interface CampaignMissionSnapshot {
  status: MissionStatus;
  stepCount: number;
}

export function generateCampaignId(): string {
  return `campaign-${randomUUID().slice(0, 8)}`;
}

export function isTerminalCampaignStatus(status: CampaignStatus): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

export function assertLifecycleTransitionAllowed(
  current: CampaignStatus,
  next: CampaignStatus,
): void {
  if (next === "paused" && current !== "active") {
    throw new Error(`Cannot pause campaign in status: ${current}`);
  }
  if (next === "active" && current !== "paused") {
    throw new Error(`Cannot resume campaign in status: ${current}`);
  }
  if (next === "canceled" && current !== "active" && current !== "paused") {
    throw new Error(`Cannot cancel campaign in status: ${current}`);
  }
}

export function missionCountsAsFailure(status: MissionStatus): boolean {
  return status === "failed" || status === "verifier_failed" || status === "budget_exhausted";
}

export function missionCountsAsActive(status: MissionStatus): boolean {
  return status === "active" || status === "paused" || status === "blocked";
}

export function buildCampaignProgress(
  entries: CampaignMissionEntry[],
  snapshots: CampaignMissionSnapshot[],
): CampaignProgress {
  let completed = 0;
  let failed = 0;
  let active = 0;
  let totalSteps = 0;

  for (const snapshot of snapshots) {
    if (snapshot.status === "completed") {
      completed++;
    } else if (missionCountsAsFailure(snapshot.status)) {
      failed++;
    } else if (missionCountsAsActive(snapshot.status)) {
      active++;
    }
    totalSteps += snapshot.stepCount;
  }

  const total = entries.length;
  return {
    totalMissions: total,
    completedMissions: completed,
    failedMissions: failed,
    activeMissions: active,
    totalSteps,
    percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
    allMissionsComplete: total > 0 && completed === total,
  };
}

export function buildCampaignBudgetUsage(
  campaign: Campaign,
  entries: CampaignMissionEntry[],
  totalSteps: number,
): CampaignBudgetUsage {
  const maxMissions = campaign.budget?.maxMissions;
  const maxTotalSteps = campaign.budget?.maxTotalSteps;
  const exhausted =
    (maxMissions != null && entries.length >= maxMissions) ||
    (maxTotalSteps != null && totalSteps >= maxTotalSteps);

  return {
    missionsUsed: entries.length,
    maxMissions,
    totalStepsUsed: totalSteps,
    maxTotalSteps,
    exhausted,
  };
}

export function deriveReconciledCampaignStatus(
  campaign: Campaign,
  entries: CampaignMissionEntry[],
  snapshots: CampaignMissionSnapshot[],
): CampaignStatus {
  if (campaign.status === "canceled") {
    return campaign.status;
  }

  let completed = 0;
  let failed = 0;
  for (const snapshot of snapshots) {
    if (snapshot.status === "completed") {
      completed++;
    } else if (missionCountsAsFailure(snapshot.status)) {
      failed++;
    }
  }

  const total = entries.length;
  if (total > 0 && completed === total) {
    return "completed";
  }
  if (failed > 0) {
    return "failed";
  }
  if (campaign.status === "paused") {
    return "paused";
  }
  return "active";
}
