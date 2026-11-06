import { rate } from "../src/tax.ts";

export function taxCoversRate(): number {
  return rate(100);
}
