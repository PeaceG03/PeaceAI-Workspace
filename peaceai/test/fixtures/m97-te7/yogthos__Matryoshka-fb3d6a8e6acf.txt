/**
 * Shared stopword set for search and dampening operations.
 * Ported from Ori-Mnemos (src/core/dampening.ts).
 *
 * Used by: BM25 tokenizer, gravity dampening extractKeyTerms
 */

export const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "both",
  "each", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "don", "now", "and", "but", "or", "if", "while", "about", "what",
  "which", "who", "whom", "this", "that", "these", "those", "am", "it",
  "its", "my", "your", "his", "her", "our", "their", "i", "me", "we",
  "you", "he", "she", "they", "them", "up",
]);
