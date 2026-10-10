// Small settings module: realistic targets for config-style edits.
export const LIMITS = {
  pageSize: 20,
  maxDepth: 4,
  timeoutMs: 3000,
};

export const EXPORT_KINDS = ["csv", "html"];

export type Severity = "low" | "medium" | "high";

export type Profile = {
  readonly id: string;
  readonly displayName: string;
};

export function parseQuantity(raw: string): number {
  const amount = Number(raw);
  return Number.isInteger(amount) && amount > 0 ? amount : 1;
}

export function readProfile(json: string): Profile | null {
  const fields = JSON.parse(json) as Record<string, unknown>;
  if (typeof fields.id !== "string") return null;
  return { id: fields.id, displayName: typeof fields.displayName === "string" ? fields.displayName : fields.id };
}
