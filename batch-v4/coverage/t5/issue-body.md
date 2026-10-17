Target: PeaceG03/PeaceSTOCKS

add loop function `sampleVariance(values: readonly number[]): number` to `src/features.ts` with body:
if (values.length < 2) return 0;
let sum = 0;
for (const v of values) {
sum += v;
}
const mean = sum / values.length;
let sq = 0;
for (const v of values) {
sq += (v - mean) * (v - mean);
}
return sq / (values.length - 1);
- sampleVariance([2, 4, 6]) is 4
- sampleVariance([1, 3]) is 2
- sampleVariance([5]) is 0
- sampleVariance([]) is 0

(Builder pre-file, LOOP_FUNCTION, public-loop-function-v1): Peace's task (source: peace). sampleVolatility computes an n-1 variance inline with two reduces. This is a standalone, tested sampleVariance next to it (returns 0 under two values, matching how short series are treated as no signal). Production safety: additive only; one new exported pure function appended to src/features.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-loop-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/features.ts. Expected COUNTS.)
