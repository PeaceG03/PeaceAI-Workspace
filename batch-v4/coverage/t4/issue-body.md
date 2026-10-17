Target: PeaceG03/PeaceSTOCKS

add loop function `sumOf(values: readonly number[]): number` to `src/num-utils.ts` with body:
let total = 0;
for (const v of values) {
total += v;
}
return total;
- sumOf([1, 2, 3]) is 6
- sumOf([]) is 0
- sumOf([0.5, -2]) is -1.5

(Builder pre-file, LOOP_FUNCTION, public-loop-function-v1): Peace's task (source: peace). Sums are written as ad-hoc `reduce((sum, v) => sum + v, 0)` in storage, reader, intraday and features. A small tested helper in the shared numeric module. Production safety: additive only; one new exported pure function appended to src/num-utils.ts, no existing code or caller changes, so the running scanner chain is unchanged. A box dry-run on PeaceSTOCKS bf284ed built exactly one candidate (public-loop-function-v1); the new test passes with the function and fails at the base; suite 544/544, all 4 typechecks ok. Disjoint file: no other task in this batch touches src/num-utils.ts. Expected COUNTS.)
