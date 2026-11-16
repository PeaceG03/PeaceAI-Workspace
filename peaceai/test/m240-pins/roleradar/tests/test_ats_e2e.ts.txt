/**
 * test_ats_e2e.ts - End-to-end ATS resume intelligence testing suite.
 * Validates deterministic scoring, verb taxonomy classification, and keyword gap analysis.
 */

import { analyzeAts, extractKeywordGap, calculateWeightedAtsScore, categorizeActionVerbs } from "../src/lib/ats.ts";

const STRONG_RESUME = `
Jane Doe
Email: jane.doe@example.com | Phone: +1-555-0199 | GitHub: github.com/janedoe | LinkedIn: linkedin.com/in/janedoe

Technical Skills
Languages & Frameworks: TypeScript, Python, Next.js, React, Node.js, PostgreSQL, Docker, PyTorch
Cloud & Tools: AWS Lambda, Cloudflare Workers, Git, Kubernetes, Redis, Tailwind CSS

Work Experience
Senior Software Engineer - CloudScale Systems (2022 - Present)
- Architected and deployed microservices handling 50k requests/second with sub-40ms latency.
- Engineered automated data pipeline in Python and SQL reducing query times by 45%.
- Led a team of 6 engineers; mentored 3 juniors and spearheaded migration to Next.js 15.
- Optimized database indexing in PostgreSQL, slashing disk I/O costs by $12k/month.

Software Engineer - Innovatech Lab (2020 - 2022)
- Built real-time analytics dashboard in React and Tailwind CSS serving 100k daily active users.
- Automated CI/CD deployment pipelines using GitHub Actions, reducing release cycle by 35%.

Education
Bachelor of Science in Computer Science - University of California, Berkeley (2016 - 2020)
GPA: 3.85 / 4.0
`;

const WEAK_RESUME = `
John Smith
Student looking for a job.
I like computers and coding stuff.
Projects: Made a small website in HTML.
`;

function runTests() {
  console.log("=== RUNNING ATS RESUME INTELLIGENCE E2E TESTS ===");

  // 1. Strong resume assertion
  const strongResult = analyzeAts(STRONG_RESUME, 12);
  console.log(`Strong Resume Score: ${strongResult.score}/100`);
  console.log(`Breakdown:`, JSON.stringify(strongResult.breakdown));
  console.log(`Verb Summary:`, JSON.stringify(strongResult.verbSummary));

  if (strongResult.score < 80) {
    throw new Error(`Expected strong resume score >= 80, got ${strongResult.score}`);
  }
  if (!strongResult.verbSummary || strongResult.verbSummary.totalUnique < 4) {
    throw new Error("Expected at least 4 unique categorized action verbs in strong resume.");
  }

  // 2. Weak resume assertion
  const weakResult = analyzeAts(WEAK_RESUME, 1);
  console.log(`Weak Resume Score: ${weakResult.score}/100`);
  if (weakResult.score > 50) {
    throw new Error(`Expected weak resume score <= 50, got ${weakResult.score}`);
  }

  // 3. Keyword gap analysis test
  const targetJobKeywords = ["Python", "TypeScript", "PostgreSQL", "Docker", "Kubernetes", "GraphQL", "Rust"];
  const gap = extractKeywordGap(STRONG_RESUME, targetJobKeywords);
  console.log(`Target Job Keywords Match Rate: ${gap.matchRate}%`);
  console.log(`Matched Skills:`, gap.matched);
  console.log(`Missing Skills:`, gap.missing);

  if (!gap.matched.includes("Python") || !gap.matched.includes("TypeScript")) {
    throw new Error("Failed to match core technical keywords.");
  }
  if (!gap.missing.includes("GraphQL") || !gap.missing.includes("Rust")) {
    throw new Error("Failed to detect missing required keywords.");
  }

  // 4. Formula weighted score test
  const weighted = calculateWeightedAtsScore(90, 80, 85);
  if (weighted !== 86) {
    throw new Error(`Expected weighted score 86, got ${weighted}`);
  }

  console.log("=== ALL ATS E2E ASSERTIONS PASSED (100% OK) ===");
}

runTests();
