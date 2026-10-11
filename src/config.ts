// Small settings module: realistic targets for config-style edits.
export const LIMITS = {
  pageSize: 20,
  maxDepth: 4,
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

export const NYSE_HOLIDAYS_2024 = "2024-01-01,2024-01-15,2024-02-19,2024-03-29,2024-05-27,2024-06-19,2024-07-04,2024-09-02,2024-11-28,2024-12-25";

export const NYSE_HOLIDAYS_2025 = "2025-01-01,2025-01-09,2025-01-20,2025-02-17,2025-04-18,2025-05-26,2025-06-19,2025-07-04,2025-09-01,2025-11-27,2025-12-25";

export const NYSE_HOLIDAYS_2026 = "2026-01-01,2026-01-19,2026-02-16,2026-04-03,2026-05-25,2026-06-19,2026-07-03,2026-09-07,2026-11-26,2026-12-25";

export const NYSE_HOLIDAYS_2027 = "2027-01-01,2027-01-18,2027-02-15,2027-03-26,2027-05-31,2027-06-18,2027-07-05,2027-09-06,2027-11-25,2027-12-24";

export const NYSE_HOLIDAYS_2028 = "2028-01-17,2028-02-21,2028-04-14,2028-05-29,2028-06-19,2028-07-04,2028-09-04,2028-11-23,2028-12-25";

export const NYSE_EARLY_CLOSES = "2024-07-03,2024-11-29,2024-12-24,2025-07-03,2025-11-28,2025-12-24,2026-11-27,2026-12-24,2027-11-26,2028-07-03,2028-11-24";
