// ATS readiness check — heuristic, resume-writing best practices applied to the
// raw resume text. Pure and client/server safe, computed at report render time.
// Upgraded with ats-resume-intelligence algorithms.

export interface AtsCheck {
  id: string;
  label: string;
  passed: boolean;
  tip: string; // shown when the check fails
}

export interface AtsReport {
  score: number; // 0-100, weighted
  checks: AtsCheck[];
  breakdown?: {
    keywordScore: number;
    experienceScore: number;
    formatScore: number;
  };
  verbSummary?: {
    execution: string[];
    technical: string[];
    leadership: string[];
    optimization: string[];
    totalUnique: number;
  };
}

export const ACTION_VERBS = {
  execution: [
    "built", "developed", "implemented", "deployed", "executed",
    "created", "delivered", "authored", "constructed", "launched",
  ],
  technical: [
    "engineered", "architected", "programmed", "refactored", "integrated",
    "trained", "fine-tuned", "debugged", "benchmarked", "migrated",
  ],
  leadership: [
    "led", "mentored", "spearheaded", "directed", "managed",
    "coordinated", "championed", "orchestrated", "coached",
  ],
  optimization: [
    "optimized", "improved", "automated", "streamlined", "accelerated",
    "scaled", "reduced", "maximized", "standardized", "boosted",
  ],
};

const ALL_ACTION_VERBS = [
  ...ACTION_VERBS.execution,
  ...ACTION_VERBS.technical,
  ...ACTION_VERBS.leadership,
  ...ACTION_VERBS.optimization,
  "analyzed", "analysed", "published",
];

export function categorizeActionVerbs(text: string) {
  const t = text.toLowerCase();
  const findMatches = (verbs: string[]) =>
    verbs.filter((v) => new RegExp(`\\b${v}\\b`, "i").test(t));

  const execution = findMatches(ACTION_VERBS.execution);
  const technical = findMatches(ACTION_VERBS.technical);
  const leadership = findMatches(ACTION_VERBS.leadership);
  const optimization = findMatches(ACTION_VERBS.optimization);

  const uniqueSet = new Set([...execution, ...technical, ...leadership, ...optimization]);
  return {
    execution,
    technical,
    leadership,
    optimization,
    totalUnique: uniqueSet.size,
  };
}

export function extractKeywordGap(resumeText: string, jobKeywords: string[]) {
  const t = resumeText.toLowerCase();
  const matched: string[] = [];
  const missing: string[] = [];

  for (const kw of jobKeywords) {
    const cleanKw = kw.trim().toLowerCase();
    if (!cleanKw) continue;
    const escaped = cleanKw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(t)) {
      matched.push(kw);
    } else {
      missing.push(kw);
    }
  }

  const matchRate = jobKeywords.length > 0 ? Math.round((matched.length / jobKeywords.length) * 100) : 100;
  return { matched, missing, matchRate };
}

export function calculateWeightedAtsScore(keywordScore: number, experienceScore: number, formatScore: number): number {
  // S_overall = 0.50 * S_keyword + 0.30 * S_experience + 0.20 * S_format
  const score = Math.round(0.50 * keywordScore + 0.30 * experienceScore + 0.20 * formatScore);
  return Math.min(100, Math.max(0, score));
}

export function analyzeAts(rawText: string, extractedSkillCount: number): AtsReport {
  const t = rawText.toLowerCase();
  const words = t.split(/\s+/).filter(Boolean).length;
  const verbCategories = categorizeActionVerbs(rawText);
  const verbHits = ALL_ACTION_VERBS.filter((v) => new RegExp(`\\b${v}\\b`).test(t)).length;

  const weighted: (AtsCheck & { weight: number; category: "format" | "experience" | "keyword" })[] = [
    {
      id: "length",
      label: "Adequate length",
      passed: words >= 120 && words <= 1500,
      tip:
        words < 120
          ? "The resume looks very short — aim for one full page with clear sections."
          : "Very long resumes dilute keywords — keep it to one or two pages.",
      weight: 15,
      category: "format",
    },
    {
      id: "contact",
      label: "Contact details present",
      passed: /[\w.+-]+@[\w-]+\.[\w.]+/.test(t) || /linkedin|github\.com\/|\+?\d[\d\s().-]{8,}\d/.test(t),
      tip: "Include an email, phone number, and a LinkedIn or GitHub link near the top.",
      weight: 10,
      category: "format",
    },
    {
      id: "skills_section",
      label: "Dedicated skills section",
      passed: /technical skills|skills\s*[:|\n]|key skills|core competencies|tools & technologies/.test(t),
      tip: "Add a clearly labeled 'Skills' section — scanners and recruiters look for it first.",
      weight: 15,
      category: "keyword",
    },
    {
      id: "education",
      label: "Education mentioned",
      passed: /education|b\.?\s?tech|b\.?\s?sc|bachelor|master|m\.?\s?sc|degree|university|college|cgpa|gpa/.test(t),
      tip: "List your degree, institution, and graduation year.",
      weight: 10,
      category: "experience",
    },
    {
      id: "projects",
      label: "Projects or experience",
      passed: /project|internship|intern\b|work experience|freelance|research|employment/.test(t),
      tip: "Add 2–3 projects or internships, each with a one-line impact statement.",
      weight: 15,
      category: "experience",
    },
    {
      id: "quantified",
      label: "Quantified achievements",
      passed: /\d+\s?%|\d+\s?\+|\b\d+k\b|\d+\s?x\b|\b\d{2,}\s?(users|rows|records|students|downloads|queries|ms|req\/s)/.test(t),
      tip: "Numbers stand out — for example '40k-row dataset' or 'improved latency by 35%'.",
      weight: 15,
      category: "experience",
    },
    {
      id: "verbs",
      label: "Strong action verbs",
      passed: verbHits >= 3 && verbCategories.totalUnique >= 2,
      tip: "Start bullets with diverse action verbs across technical (engineered), leadership (led), and optimization (streamlined).",
      weight: 10,
      category: "experience",
    },
    {
      id: "keywords",
      label: "Skill keyword richness",
      passed: extractedSkillCount >= 6,
      tip: "Name concrete tools and technologies (Python, Next.js, Docker, PyTorch) rather than soft phrases.",
      weight: 10,
      category: "keyword",
    },
  ];

  const total = weighted.reduce((a, c) => a + c.weight, 0);
  const earned = weighted.reduce((a, c) => a + (c.passed ? c.weight : 0), 0);

  const formatChecks = weighted.filter((c) => c.category === "format");
  const expChecks = weighted.filter((c) => c.category === "experience");
  const kwChecks = weighted.filter((c) => c.category === "keyword");

  const calcCatScore = (checks: typeof weighted) => {
    const tot = checks.reduce((a, c) => a + c.weight, 0);
    const earn = checks.reduce((a, c) => a + (c.passed ? c.weight : 0), 0);
    return tot > 0 ? Math.round((earn / tot) * 100) : 100;
  };

  return {
    score: Math.round((earned / total) * 100),
    checks: weighted.map(({ weight: _w, category: _cat, ...c }) => c),
    breakdown: {
      keywordScore: calcCatScore(kwChecks),
      experienceScore: calcCatScore(expChecks),
      formatScore: calcCatScore(formatChecks),
    },
    verbSummary: verbCategories,
  };
}
