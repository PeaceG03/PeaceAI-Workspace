// M72 safe-zone helper (named in peaceai/lib/self-zone.ts SAFE_HELPERS). Pure string helpers; imported only by
// peaceai/self-tests. PeaceAI may add functions here through the normal task flow once the self zone is enabled.
export function plural(count: number, word: string): string {
  return count === 1 ? `${count} ${word}` : `${count} ${word}s`;
}

export function truncate(text: string, max: number): string {
  if (max < 1) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
