/**
 * Post-fusion dampening for Nucleus
 *
 * Ported from Ori-Mnemos (src/core/dampening.ts) and adapted for
 * line-based document search. Gravity dampening catches "cosine ghosts" —
 * high-scoring results that don't actually contain query terms.
 *
 * Ablation-validated in Drift pipeline (P@5 delta: -0.256)
 */

import { STOPWORDS } from "./stopwords.js";

// ── Types ────────────────────────────────────────────────────────────

/** Re-export LineResult as DampenableResult for API clarity */
import type { LineResult } from "./rrf.js";
export type DampenableResult = LineResult;

// ── Key term extraction (from Ori-Mnemos) ───────────────────────────

/**
 * Extract key terms from text, minus stopwords.
 * Ported from Ori-Mnemos extractKeyTerms.
 */
export function extractKeyTerms(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")   // replace ALL non-alphanumeric (incl hyphens) with space
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return new Set(words);
}

// ── Gravity Dampening (from Ori-Mnemos, adapted for line content) ───

/**
 * Gravity dampening: halve score for high-scoring results that have
 * zero query term overlap with the line content.
 *
 * Catches false positives where BM25/fuzzy scoring produces high
 * scores for lines that don't actually contain relevant terms.
 *
 * The threshold is adaptive: defaults to 30% of the max score in the
 * result set, so it works correctly regardless of score scale (raw BM25
 * scores, RRF fused scores, etc.).
 *
 * @param results - Search results to dampen
 * @param query - Original search query
 * @param threshold - Score threshold; only dampen above this. If not provided, uses 30% of max score.
 * @param penalty - Multiplier for dampened results (default 0.5)
 */
export function applyGravityDampening(
  results: DampenableResult[],
  query: string,
  threshold?: number,
  penalty: number = 0.5,
): DampenableResult[] {
  const queryTerms = extractKeyTerms(query);
  if (queryTerms.size === 0) return results;
  if (results.length === 0) return results;

  // Adaptive threshold: 30% of max score if not explicitly provided
  const effectiveThreshold = threshold ?? (Math.max(...results.map(r => r.score)) * 0.3);

  return results.map((result) => {
    if (result.score <= effectiveThreshold) return result;

    // Check term overlap against line content
    const lineTerms = extractKeyTerms(result.line);
    let hasOverlap = false;
    for (const term of queryTerms) {
      if (lineTerms.has(term)) {
        hasOverlap = true;
        break;
      }
    }

    if (!hasOverlap) {
      return { ...result, score: result.score * penalty };
    }
    return result;
  });
}
