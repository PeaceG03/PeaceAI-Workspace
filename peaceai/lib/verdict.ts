export type VerdictValue = "right" | "wrong" | "unsure";

export interface VerdictCommand {
  label: string | null; // null = "none"
  verdict: VerdictValue;
}

export type ParseResult = { ok: true; command: VerdictCommand } | { ok: false; error: string };

export const VERDICT_USAGE = "Usage: `/verdict <letter> right|wrong|unsure` or `/verdict none wrong|unsure`.";

/** Parses the first line of a comment. Only an exact command shape is accepted. */
export function parseVerdict(body: string): ParseResult {
  const first = (body.split(/\r?\n/)[0] ?? "").trim();
  if (!/^\/verdict\b/i.test(first)) return { ok: false, error: "not a verdict command" };
  const match = /^\/verdict\s+([A-Za-z]|none)\s+(right|wrong|unsure)\s*$/i.exec(first);
  if (!match) return { ok: false, error: "malformed" };
  const target = match[1]!.toLowerCase();
  const verdict = match[2]!.toLowerCase() as VerdictValue;
  if (target === "none") {
    if (verdict === "right") return { ok: false, error: "none can only be wrong or unsure" };
    return { ok: true, command: { label: null, verdict } };
  }
  return { ok: true, command: { label: target.toUpperCase(), verdict } };
}
