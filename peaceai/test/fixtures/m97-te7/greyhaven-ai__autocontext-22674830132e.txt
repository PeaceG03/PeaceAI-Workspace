export type CampaignStatus = "active" | "paused" | "completed" | "failed" | "canceled";

export interface CampaignBudget {
  maxMissions?: number;
  maxTotalSteps?: number;
  maxTotalCostUsd?: number;
}

export interface Campaign {
  id: string;
  name: string;
  goal: string;
  status: CampaignStatus;
  budget?: CampaignBudget;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface CampaignMissionEntry {
  campaignId: string;
  missionId: string;
  priority: number;
  dependsOn: string[];
  addedAt: string;
}

export interface CampaignProgress {
  totalMissions: number;
  completedMissions: number;
  failedMissions: number;
  activeMissions: number;
  totalSteps: number;
  percentComplete: number;
  allMissionsComplete: boolean;
}

export interface CampaignBudgetUsage {
  missionsUsed: number;
  maxMissions?: number;
  totalStepsUsed: number;
  maxTotalSteps?: number;
  exhausted: boolean;
}
