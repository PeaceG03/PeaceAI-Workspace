// M9: exact-substring memorization scan. Every window of SUBSTRING_MIN characters of a reference tree (core)
// is kept as a 52-bit rolling-hash key in a sorted array; a generated text hits when one of its windows
// matches a key AND the window really occurs in the reference text (hash collisions never count, never miss).
// Only hashes and the reference text stay in memory, on the machine that runs the check; nothing is printed.
export const SUBSTRING_MIN = 32;

const P1 = 2147483647, B1 = 257, P2 = 2147483629, B2 = 263;
const LOW = 2 ** 21;

export interface SubstringIndex { keys: Float64Array; texts: string[]; n: number }

function powMod(b: number, e: number, p: number): number {
  let r = 1;
  for (let i = 0; i < e; i += 1) r = (r * b) % p;
  return r;
}

/** Calls visit(key, start) for each window of n code units in text. */
function windows(text: string, n: number, visit: (key: number, start: number) => void): void {
  if (text.length < n) return;
  const r1 = powMod(B1, n - 1, P1), r2 = powMod(B2, n - 1, P2);
  let h1 = 0, h2 = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (i >= n) {
      const o = text.charCodeAt(i - n);
      h1 = (h1 - ((o * r1) % P1) + P1) % P1;
      h2 = (h2 - ((o * r2) % P2) + P2) % P2;
    }
    h1 = (h1 * B1 + c) % P1;
    h2 = (h2 * B2 + c) % P2;
    if (i >= n - 1) visit(h1 * LOW + (h2 % LOW), i - n + 1);
  }
}

export function buildSubstringIndex(texts: readonly string[], n = SUBSTRING_MIN): SubstringIndex {
  let total = 0;
  for (const t of texts) total += Math.max(0, t.length - n + 1);
  const keys = new Float64Array(total);
  let k = 0;
  for (const t of texts) windows(t, n, (key) => { keys[k++] = key; });
  keys.sort();
  return { keys, texts: [...texts], n };
}

function hasKey(keys: Float64Array, key: number): boolean {
  let lo = 0, hi = keys.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = keys[mid]!;
    if (v === key) return true;
    if (v < key) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

/** Number of maximal runs of generated text that copy >= n consecutive characters of the reference. */
export function countCoreSubstrings(generated: string, index: SubstringIndex): number {
  let runs = 0;
  let lastHit = -2;
  windows(generated, index.n, (key, start) => {
    if (!hasKey(index.keys, key)) return;
    const w = generated.slice(start, start + index.n);
    if (!index.texts.some((t) => t.includes(w))) return;
    if (start !== lastHit + 1) runs += 1;
    lastHit = start;
  });
  return runs;
}
