import type { AnalyticsBinUnit } from "../shared/types";

const countFormat = new Intl.NumberFormat(undefined);
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export function formatCount(value: number): string {
  return countFormat.format(Math.round(value));
}

export function formatCompact(value: number): string {
  return compactFormat.format(value);
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "–";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Percentages for shares: tiny but nonzero values stay visible instead of rounding to 0%. */
export function formatShare(value: number): string {
  if (value > 0 && value < 0.001) return "<0.1%";
  if (value < 1 && value > 0.99) return formatPercent(value, 1);
  return formatPercent(value, value < 0.01 ? 1 : 0);
}

export function formatSignedChange(current: number, previous: number): { direction: -1 | 0 | 1; text: string } {
  if (previous === 0) return { direction: current > 0 ? 1 : 0, text: current > 0 ? "new activity" : "no change" };
  const change = (current - previous) / previous;
  const rounded = Math.round(change * 100);
  if (rounded === 0) return { direction: 0, text: "no change" };
  return { direction: rounded > 0 ? 1 : -1, text: `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%` };
}

export function formatPointChange(current: number, previous: number): { direction: -1 | 0 | 1; text: string } {
  const points = Math.round((current - previous) * 1000) / 10;
  if (points === 0) return { direction: 0, text: "no change" };
  return { direction: points > 0 ? 1 : -1, text: `${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(1)} pts` };
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const weekdayDate = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const monthYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

export function formatDate(seconds: number): string {
  return longDate.format(new Date(seconds * 1000));
}

/** Short axis label for a bin. Monthly axes show the year at January. */
export function formatBinAxisLabel(start: number, unit: AnalyticsBinUnit): string {
  const date = new Date(start * 1000);
  return unit === "month" ? String(date.getFullYear()) : shortDate.format(date);
}

export function formatBinTitle(start: number, unit: AnalyticsBinUnit): string {
  const date = new Date(start * 1000);
  if (unit === "day") return weekdayDate.format(date);
  if (unit === "week") return `Week of ${longDate.format(date)}`;
  return monthYear.format(date);
}

/** Indexes of bins that get an axis label: Januaries for monthly axes, evenly spaced otherwise. */
export function binAxisTicks(bins: readonly number[], unit: AnalyticsBinUnit, plotWidth: number, minGap = 80): number[] {
  if (bins.length === 0) return [];
  if (unit === "month") {
    const januaries = bins.flatMap((start, index) => (new Date(start * 1000).getMonth() === 0 ? [index] : []));
    const every = Math.max(1, Math.ceil(januaries.length / Math.max(1, Math.floor(plotWidth / 48))));
    return januaries.filter((_, index) => index % every === 0);
  }
  const every = Math.max(1, Math.ceil(bins.length / Math.max(2, Math.floor(plotWidth / minGap))));
  const ticks: number[] = [];
  for (let index = 0; index < bins.length; index += every) ticks.push(index);
  return ticks;
}

/** Rounds an axis maximum up to 1, 2, 2.5, or 5 times a power of ten. */
export function niceScale(maximum: number, ticks = 4): { max: number; step: number } {
  if (!(maximum > 0)) return { max: 1, step: 0.25 };
  const raw = maximum / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
  return { max: Math.ceil(maximum / step - 1e-9) * step, step };
}

export function splitPath(path: string): { folder: string; name: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? { folder: "", name: path } : { folder: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}
