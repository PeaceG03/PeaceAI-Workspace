# Batch: concrete arguments, plain-object, characterization direct rule

No strict credit is claimed. `SPEC_ATTEMPT_CAP` is unchanged. `targets.json`, `gate.ts`, and `scope.ts` are unchanged. Held-out diffs were not read.

## Concrete arguments

`expectationsIn` keeps a call when every argument is a literal, a sentinel (`NaN`, `Infinity`, `undefined`, and the `Number` forms), or an array or object built only from those. `evalConcrete` evaluates the same values, with `Object.defineProperty`, so a missing-export scaffold and the behavior probe see them.

Soundness: the argument is copied from the test text. It is not executed. A spread, a call (`Symbol("foo")`), a bigint, a shorthand property, a `__proto__` key, and any other identifier are refused. An array or object is kept only when every element is itself one of these values. `{ __proto__: 1 }` is not replayed as `{}`.

Evidence, copied from the pinned files, none of them a practice-set or held-out repo:

- `vuejs/core` `packages/shared/__tests__/toDisplayString.spec.ts` at `cbd95955a5362b44060908f6e28ad447c3031b8a` (MIT): `expect(toDisplayString(NaN)).toBe('NaN')` and `expect(toDisplayString(undefined)).toBe('')`.
- `@antfu/utils` `src/is.test.ts` and `src/array.test.ts` at `91f8cf73bebddae8f7ebcac82e47c9bcba9805e2` (MIT): `expect(isPrimitive([])).toBe(false)`, `expect(isPrimitive({})).toBe(false)`, `expect(flattenArrayable([])).toEqual([])`, `expect(flattenArrayable([1, [1, 2]])).toEqual([1, 1, 2])`. `Symbol('foo')` and `1n` in the same file are not expectations.
- `honojs/hono` `src/utils/accept.test.ts` at `f6fbaf0299c48eea9e656e03e2ffe7ac755e8823` (MIT): `expect(parseAccept(undefined as any)).toEqual([])`.

## plain-object

repair-v2, after the earlier idioms. A function whose entire returned expression is the two-term chain `ref !== null && typeof ref === "object"` (either order) becomes that chain plus `&& !Array.isArray(ref)` only when a failing test says that function is false for an array literal. No failing spec, no candidate. A chain with any other term is not edited, so a check that already calls `Array.isArray`, or that compares `Object.getPrototypeOf`, is left alone.

Evidence:

- Refused: `vuejs/core` `packages/shared/src/general.ts` `isObject` at `cbd95955a5362b44060908f6e28ad447c3031b8a` (MIT). Arrays are objects there (`isPromise` uses `isObject`; `isPlainObject` is the excluding check). There is no failing spec.
- Admitted: a labeled synthetic `isPlainData` whose test expects `[]` to be false and `{ a: 1 }` to be true. The test fails on the pre-image and passes after `&& !Array.isArray(value)`.
- Refused, even with a spec that rejects arrays: `honojs/hono` `src/client/utils.ts` `isObject` at `f6fbaf0299c48eea9e656e03e2ffe7ac755e8823` (MIT), which already has `!Array.isArray`.
- Refused: `vueuse/vueuse` `packages/shared/utils/is.ts` `isObject` at `bed1dce149ce6760fec13d4798c047f51a563180` (MIT), which uses `toString`.
- Refused: `unjs/ohash` `src/serialize.ts` at `764b0a3203308956ef07597612af5ad59f36c791` (MIT), where the same two terms are one arm of a larger expression.

## Characterization direct rule

Builder-log row 235's logged asked line is `Peace's task PeaceAI-Workspace#423 (source: peace): add a characterization test for tenMinDailyIndexKey in src/tenmin-daily-liquid.ts`. Job A passes that line as the body and `builder-log seq 235` as the title. The direct rule matches that exact body: the prefix is removed only inside `characterizationReplay`, and the remainder is the canonical characterization line. When `PEACEAI_TEST_EXISTING` is set, Job A skips the source index and the synthesizer and still runs the learned rule. A normal Job A run leaves the flag unset, so the synthesizer still sees the sources. The budget is not raised. A `Please` prefix, and the same official prefix in front of a different canonical line, are not this path.

This was not re-measured on row 235. It is not claimed as a restored pass.
