import { addItem, total } from "../src/cart.ts";

export function cartCoversAdd(): number {
  return total(addItem(1), 3);
}
