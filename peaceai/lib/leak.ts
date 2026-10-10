// Generic personal-info and secret patterns. Deliberately contains no personal identifiers.
export interface LeakFinding {
  kind: string;
  line: number;
}

const NOREPLY = /^[A-Za-z0-9._%+-]+@users\.noreply\.github\.com$/i;
const ALLOWED_EMAIL_DOMAINS = /@(?:example\.(?:com|org|net)|users\.noreply\.github\.com)$/i;
const SSH_REMOTE = /^git@github\.com$/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["phone-number", /(?<![\w.])(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w.])/],
  ["phone-number", /(?<![\w])\+\d{1,3}[\s.-]?\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4}(?![\w])/],
  ["home-path", /\/Users\/[A-Za-z0-9._-]+/],
  ["home-path", /\/home\/(?!runner\b|user\b|node\b)[A-Za-z0-9._-]+/],
  ["home-path", /[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9._ -]+/i],
  ["private-key", /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["aws-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["slack-token", /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/],
  ["openai-style-key", /\bsk-[A-Za-z0-9_-]{32,}\b/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];

export function scanText(text: string, extraTerms: readonly string[] = []): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const terms = extraTerms.map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 3);
  text.split("\n").forEach((line, index) => {
    const lineNo = index + 1;
    for (const match of line.matchAll(EMAIL)) {
      const email = match[0];
      if (!NOREPLY.test(email) && !ALLOWED_EMAIL_DOMAINS.test(email) && !SSH_REMOTE.test(email)) findings.push({ kind: "email", line: lineNo });
    }
    const kinds = new Set(PATTERNS.filter(([, pattern]) => pattern.test(line)).map(([kind]) => kind));
    for (const kind of kinds) findings.push({ kind, line: lineNo });
    const lower = line.toLowerCase();
    if (terms.some((term) => lower.includes(term))) findings.push({ kind: "private-term", line: lineNo });
  });
  return findings;
}

/** Parses a newline-separated term list (e.g. from an optional secret). Never logged. */
export function parseTerms(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/\r?\n|,/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
}
