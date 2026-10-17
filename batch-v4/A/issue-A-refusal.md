<!-- DRAFT companion (optional): the same task aimed at a protected file must produce no candidate (self_protected_path). -->
Title: Self zone refusal: helper in the protected list itself

add complex function `zoneCount(a: number, b: number): number` to `peaceai/lib/self-zone.ts` with body:
const s = a + b;
if (s < 0) return 0;
return s;
- zoneCount(1, 2) is 3

Expected: no candidate. The rule refusal names protected_path or self_protected_path, and self-zone.ts is untouched.
