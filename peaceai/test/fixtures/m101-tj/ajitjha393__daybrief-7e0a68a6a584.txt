import type { Vote } from './types.js'

export const DAY_MS = 86_400_000

export function ageDays(ts: number | null, now: number = Date.now()): number | null {
  if (ts === null) return null
  return Math.max(0, Math.round(((now - ts) * 10) / DAY_MS) / 10)
}

export function ms(iso: string | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/**
 * ADO reviewer votes: 10 approved, 5 approved-with-suggestions,
 * 0 none, -5 waiting on author, -10 rejected.
 */
export function adoVote(vote: number): Vote {
  if (vote >= 10) return 'approved'
  if (vote >= 5) return 'suggested'
  if (vote <= -10) return 'rejected'
  if (vote <= -5) return 'waiting'
  return 'none'
}

export function pullKey(repo: string, id: number): string {
  return `${repo}!${id}`
}

/** Case-insensitive identity match (emails, usernames). */
export function isPerson(identity: string | null, candidate: string | null): boolean {
  if (!identity || !candidate) return false
  return identity.toLowerCase() === candidate.toLowerCase()
}
