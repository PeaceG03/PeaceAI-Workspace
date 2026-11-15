# Batch: concrete arguments, plain-object, characterization direct rule

No strict credit is claimed. `SPEC_ATTEMPT_CAP` is unchanged. `targets.json`, `gate.ts`, and `scope.ts` are unchanged. Held-out diffs were not read.

## Concrete arguments

`expectationsIn` used to keep a call only when every argument was a primitive literal. Real tests pass `NaN`, `undefined`, `[]`, and `{}`. Those calls are now expectations, and `evalConcrete` evaluates the same sentinels so a missing-export scaffold and the behavior probe see them.

Soundness: the argument is copied from the test text. It is not executed. A spread, a call (`Symbol("foo")`), a bigint, and any other identifier are refused. An array or object is kept only when every element is itself one of these values.

Evidence, copied from the pinned files, none of them a practice-set or held-out repo:

- `vuejs/core` `packages/shared/__tests__/toDisplayString.spec.ts` at `cbd95955a5362b44060908f6e28ad447c3031b8a` (MIT): `expect(toDisplayString(NaN)).toBe('NaN')` and `expect(toDisplayString(undefined)).toBe('')`.
- `@antfu/utils` `src/is.test.ts` and `src/array.test.ts` at `91f8cf73bebddae8f7ebcac82e47c9bcba9805e2` (MIT): `expect(isPrimitive([])).toBe(false)`, `expect(isPrimitive({})).toBe(false)`, `expect(flattenArrayable([])).toEqual([])`, `expect(flattenArrayable([1, [1, 2]])).toEqual([1, 1, 2])`. `Symbol('foo')` and `1n` in the same file are not expectations.
- `honojs/hono` `src/utils/accept.test.ts` at `f6fbaf0299c48eea9e656e03e2ffe7ac755e8823` (MIT): `expect(parseAccept(undefined as any)).toEqual([])`.

## plain-object

repair-v2, after the earlier idioms. A function whose entire returned expression is the two-term chain `ref !== null && typeof ref === "object"` (either order) becomes that chain plus `&& !Array.isArray(ref)`. The candidate does not say arrays are never objects. The suite keeps it only when the tests agree. A chain with any other term is not edited, so a check that already calls `Array.isArray`, or that compares `Object.getPrototypeOf`, is left alone.

Evidence:

- Admitted: `vuejs/core` `packages/shared/src/general.ts` `isObject` at `cbd95955a5362b44060908f6e28ad447c3031b8a` (MIT).
- Refused: `honojs/hono` `src/client/utils.ts` `isObject` at `f6fbaf0299c48eea9e656e03e2ffe7ac755e8823` (MIT), which already has `!Array.isArray`.
- Refused: `vueuse/vueuse` `packages/shared/utils/is.ts` `isObject` at `bed1dce149ce6760fec13d4798c047f51a563180` (MIT), which uses `toString`.
- Refused: `unjs/ohash` `src/serialize.ts` at `764b0a3203308956ef07597612af5ad59f36c791` (MIT), where the same two terms are one arm of a larger expression.

## Characterization direct rule

Builder-log row 235 is `TEST_CASE_EXISTING` for `tenMinDailyIndexKey`. At `eb48587` it was `GENERATE_TIMEOUT` against the prior 85/166/25. The generate path for that row is the canonical characterization line. That line was already the learned rule's input, and the native synthesizer ran first inside the same 45 second budget. When `PEACEAI_TEST_EXISTING` is set, Job A now skips the source index and the synthesizer and still runs the learned rule. A normal Job A run leaves the flag unset, so the synthesizer still sees the sources. The budget is not raised. A sentence that merely contains the words is not this path.

This is a timing fix for that shape. It was not re-measured on the box, so it is not claimed as a restored pass.
