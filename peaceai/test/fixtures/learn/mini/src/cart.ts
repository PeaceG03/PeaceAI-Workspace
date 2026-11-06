/** Adds one item to the running count. */
export function addItem(count: number): number {
  return count + 1;
}

/** Removes one item from the running count. */
export function removeItem(count: number): number {
  return count - 1;
}

/** Computes the cart total from a unit price. */
export function total(count: number, price: number): number {
  return count * price;
}
