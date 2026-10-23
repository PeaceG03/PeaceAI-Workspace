export type LogStatusFilter = "all" | "success" | "failed"

export const STATUS_FILTER_OPTIONS: {
  value: LogStatusFilter
  label: string
}[] = [
  { value: "all", label: "All requests" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
]

export const NUMBER = new Intl.NumberFormat("en-US")

/**
 * The one definition of a successful request. `GET /v1/logs` classifies rows by
 * `status_code >= 200 && status_code < 300` and treats everything else as an
 * error, so a 3xx must not read as success anywhere in this screen.
 */
export const isSuccessStatus = (code: number) => code >= 200 && code < 300

export const LATENCY = (ms: number) => {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export const RELATIVE_TIME = (timestampMs: number) => {
  const diffSec = Math.floor((Date.now() - timestampMs) / 1000)
  if (diffSec < 5) return "just now"
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

export function formatTime(timestampMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestampMs))
}

export function formatCostUSD(cost: string | null | undefined): string | null {
  if (!cost) return null
  return cost.startsWith("$") ? cost : `$${cost}`
}

export function statusTone(
  code: number
): "success" | "warning" | "danger" | "neutral" {
  if (isSuccessStatus(code)) return "success"
  if (code >= 500) return "danger"
  // Anything the server files as a failed row stays visible as a warning, so a
  // 3xx cannot render in the same neutral tone as an unclassified status.
  if (code > 0) return "warning"
  return "neutral"
}
