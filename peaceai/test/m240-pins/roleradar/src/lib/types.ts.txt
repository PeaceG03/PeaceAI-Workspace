// Shared types for the resume -> job-role matching engine.
// These are plain data shapes so they can be used on both server and client.

/** A target role the resume is scored against. `required` holds canonical skill ids. */
export interface RoleInput {
  name: string;
  description: string;
  required: string[]; // canonical skill ids
  accent: string; // hex color used for UI accents
}

export type SkillStatus = "present" | "partial" | "missing";

/** Raw scoring outcome for one role, using canonical skill ids. */
export interface RoleMatchResult {
  roleName: string;
  present: string[];
  partial: string[];
  missing: string[];
  matchScore: number; // 0-100, formula: (present + 0.5 * partial) / required * 100
}

// ---------- Strict JSON report shape (mirrors the product spec) ----------

export interface RoleAnalysisJson {
  role_name: string;
  match_score: number;
  skills_present: string[]; // human-readable labels
  skills_partial: string[];
  skills_missing: string[];
  short_explanation: string;
}

export interface RecommendedRoleJson {
  role_name: string;
  match_score: number;
}

export interface RoadmapWeek {
  week: number;
  focus: string;
  details: string;
}

export interface AnalysisReport {
  overall_summary: string;
  role_analysis: RoleAnalysisJson[];
  recommended_roles: RecommendedRoleJson[];
  learning_roadmap: RoadmapWeek[];
  disclaimer: string;
}

/** Full persisted analysis row as returned by the API. */
export interface StoredAnalysis {
  id: string;
  created_at: string;
  resume_excerpt: string;
  extracted_skills: string[]; // labels for display
  target_role: string | null;
  top_role: string;
  top_score: number;
  result: AnalysisReport;
}

export interface AnalysisListItem {
  id: string;
  created_at: string;
  top_role: string;
  top_score: number;
  skill_count: number;
}
