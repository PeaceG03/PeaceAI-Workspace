// M72 safe-zone helper (named in peaceai/lib/self-zone.ts SAFE_HELPERS). Pure UTC date helpers; imported only by
// peaceai/self-tests. PeaceAI may add functions here through the normal task flow once the self zone is enabled.
export function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function minutesOfUtcDay(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function utcMonthKey(day: string): string {
  const d = day.slice(0, 10);
  if (d.length !== 10) throw new Error("BAD_DAY");
  const month = d.slice(0, 7);
  return month;
}
