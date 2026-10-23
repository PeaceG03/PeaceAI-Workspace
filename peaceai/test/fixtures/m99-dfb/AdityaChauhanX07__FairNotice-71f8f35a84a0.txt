import type {
  ConfidenceFactor,
  ConfidenceLevel,
  ConfidenceReport,
  DocumentAnalysis,
  DocumentExtraction,
  ExtractionSender,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Confidence scoring engine                                          */
/* ------------------------------------------------------------------ */

/** Pluralising suffix helper. */
const s = (n: number): string => (n === 1 ? "" : "s");

/** Count how many of the sender's identity fields are missing. */
function countSenderNulls(sender: ExtractionSender): number {
  return [sender.name, sender.role, sender.organization].filter(
    (value) => value === null || value === undefined || value === ""
  ).length;
}

/**
 * Score how much the user should trust this analysis. Starts at 100 and
 * deducts for signals of incompleteness (unmatched claims, out-of-coverage
 * jurisdiction, missing sender details, …). Findings that actually help the
 * user — like potentially-invalid claims — cost only a little and are surfaced
 * as *positive* factors.
 *
 * Returns the level, the raw score, the per-factor breakdown, and the
 * disclaimers appropriate to the resulting confidence level.
 */
export function calculateConfidence(
  analysis: DocumentAnalysis,
  extraction: DocumentExtraction,
  jurisdiction: string
): ConfidenceReport {
  const factors: ConfidenceFactor[] = [];
  let score = 100;

  const claims = analysis.claim_analysis ?? [];

  // — Claims that found no supporting statute (largest single penalty). —
  const unmatched = claims.filter(
    (c) => (c.relevant_statutes?.length ?? 0) === 0
  );
  if (unmatched.length > 0) {
    score -= 15 * unmatched.length;
    factors.push({
      factor: "Unmatched claims",
      status: "negative",
      detail: `${unmatched.length} claim${s(unmatched.length)} could not be matched to any statute in our database.`,
    });
  } else if (claims.length > 0) {
    factors.push({
      factor: "Statute coverage",
      status: "positive",
      detail: "Every claim was grounded in at least one real statute.",
    });
  }

  // — Claims the model flagged as needing a closer look. —
  const review = claims.filter((c) => c.legal_status === "requires_review");
  if (review.length > 0) {
    score -= 10 * review.length;
    factors.push({
      factor: "Claims needing review",
      status: "warning",
      detail: `${review.length} claim${s(review.length)} ${review.length === 1 ? "needs" : "need"} a closer look before you rely on the analysis.`,
    });
  }

  // — Potentially-invalid claims: a small cost, but good news for the user. —
  const potentiallyInvalid = claims.filter(
    (c) => c.legal_status === "potentially_invalid"
  );
  if (potentiallyInvalid.length > 0) {
    score -= 5 * potentiallyInvalid.length;
    factors.push({
      factor: "Potential defects found",
      status: "positive",
      detail: `We identified ${potentiallyInvalid.length} potential defect${s(potentiallyInvalid.length)} in the document that may work in your favor.`,
    });
  }

  // — Jurisdiction coverage. Our statute store is California-focused. —
  const isCalifornia = jurisdiction.trim().toLowerCase() === "california";
  if (!isCalifornia) {
    score -= 25;
    factors.push({
      factor: "Jurisdiction coverage",
      status: "negative",
      detail: `Our statute database has deepest coverage for California; analysis for ${jurisdiction || "this jurisdiction"} may be incomplete.`,
    });
  } else {
    factors.push({
      factor: "Jurisdiction coverage",
      status: "positive",
      detail: "California has our deepest statute coverage.",
    });
  }

  // — A recommended professional referral signals genuine complexity. —
  if (analysis.referral_needed) {
    score -= 15;
    factors.push({
      factor: "Professional referral recommended",
      status: "warning",
      detail:
        "This matter is involved enough that a licensed attorney should review it.",
    });
  }

  // — An unusually high number of red flags. —
  const redFlags = analysis.red_flags?.length ?? 0;
  if (redFlags > 3) {
    score -= 10;
    factors.push({
      factor: "Numerous red flags",
      status: "warning",
      detail: `${redFlags} potential issues were flagged — a high count that warrants careful attention.`,
    });
  }

  // — Missing sender identity weakens what we can verify. —
  const senderNulls = countSenderNulls(extraction.sender);
  if (senderNulls > 2) {
    score -= 10;
    factors.push({
      factor: "Incomplete sender details",
      status: "warning",
      detail:
        "Key details about who issued this document are missing, which limits verification.",
    });
  }

  // Clamp to the 0-100 range and map to a level.
  score = Math.max(0, Math.min(100, score));
  const overall: ConfidenceLevel =
    score >= 80 ? "high" : score >= 50 ? "medium" : "low";

  // Disclaimers escalate with the confidence level.
  const disclaimers: string[] = [
    "This tool provides legal information, not legal advice.",
  ];
  if (overall === "medium") {
    disclaimers.push(
      "Some aspects of this document could not be fully verified against our statute database."
    );
  }
  if (overall === "low") {
    disclaimers.push(
      "This analysis has significant gaps. We strongly recommend consulting a licensed attorney before taking any action."
    );
  }
  if (!isCalifornia) {
    disclaimers.push(
      `Our statute database has deepest coverage for California. Analysis for ${jurisdiction || "your jurisdiction"} may be incomplete.`
    );
  }

  return { overall, overallScore: score, factors, disclaimers };
}
