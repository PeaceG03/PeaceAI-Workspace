// Small configuration module: realistic targets for config-style edits.
export const DEFAULTS = {
  retries: 3,
  timeoutMs: 5000,
};

export const SUPPORTED_FORMATS = ["json", "text"];

export type LogLevel = "debug" | "info" | "warn";

export type Settings = {
  readonly name: string;
  readonly retries: number;
};

export function parseCount(input: string): number {
  const value = Number.parseInt(input, 10);
  return Number.isNaN(value) ? 0 : value;
}

export function parseSettings(raw: string): Settings | null {
  const data = JSON.parse(raw) as Partial<Settings>;
  return { name: String(data.name ?? ""), retries: Number(data.retries ?? DEFAULTS.retries) };
}
