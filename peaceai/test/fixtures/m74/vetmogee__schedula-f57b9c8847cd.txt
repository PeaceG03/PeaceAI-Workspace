/**
 * Utility functions for handling service durations
 * Durations are stored as Time in PostgreSQL, so we need to handle them
 * without timezone issues
 */

/**
 * Parse a duration Date object to minutes
 * Uses UTC methods to avoid timezone issues
 */
export function durationToMinutes(duration: Date): number {
  const d = new Date(duration);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Format a duration Date object to a readable string (e.g., "1h 30min")
 */
export function formatDuration(duration: Date): string {
  const minutes = durationToMinutes(duration);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${mins > 0 ? ` ${mins}min` : ""}`.trim();
}

/**
 * Format a duration Date object to HH:MM format for time inputs
 */
export function durationToTimeString(duration: Date): string {
  const d = new Date(duration);
  const hours = d.getUTCHours().toString().padStart(2, "0");
  const minutes = d.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Create a Date object from a time string (HH:MM format) for storage
 * Uses a fixed date (1970-01-01) and stores as UTC to avoid timezone issues
 */
export function timeStringToDuration(timeString: string): Date {
  // Parse time string like "01:30" and create a Date object
  // We use UTC to avoid timezone conversion issues
  const [hours, minutes] = timeString.split(":").map(Number);
  const date = new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
  return date;
}

