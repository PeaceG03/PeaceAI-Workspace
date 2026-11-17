# Adversarial families

`gte` and `pull` are the two specs at `24e7a7b8cb8035fae1ea2e7b507aab96698a38b9` that reduce to one arity, replay every recorded argument, and do not already match a body. The scaffold was checked against the published functions on symbols, boxed symbols, `valueOf` / `toString` objects, bigints, `null`, `undefined`, holes, `-0`, `NaN`, and prototype keys.

## gte

Both strings compare with `>=`. Every other pair uses `toNumber`, which returns `NaN` for a symbol or a boxed symbol instead of throwing, then the comparison is false. An object uses `valueOf`, then `toString`. `null` is `0`. `undefined` is `NaN`. `true` is `1` and `false` is `0`. `Number(1n)` is `1` here, so a bigint follows that conversion. `'10' >= '9'` is false. A string argument has to appear, so a number-only comparison stays the comparison family. `gte(3, 3)` is true, so this is not `gt`.

`gte-guard:fit` refuses a different boolean. `gte-guard:text` refuses a case with no string.

## pull

A value with no `length` is returned as itself, including `null`, `undefined`, a number, a boolean, and a plain object. An array is mutated. Values compare with `SameValueZero`, so `NaN` matches `NaN` and `-0` matches `0`. A hole stays a hole when the value at that index is kept, and a hole is removed when `undefined` is pulled. The recorded calls are the two nullish returns. The published spec reaches the mutation through `apply`, so the body reads `arguments` rather than only the second parameter. Pulling the string `'__proto__'` does not write `Object.prototype`.

`pul-guard:fit` refuses a value that is not returned as itself. `pul-guard:nullish` refuses a case that is missing `null` or `undefined`.

## zipObjectDeep

A path segment `__proto__`, `constructor`, or `prototype` aborts that write before the assignment. `['__proto__']` with an object value leaves the result's `[[Prototype]]` as `Object.prototype`. `['a.__proto__.b']` does not set `Object.prototype.b`. Parents created before the unsafe segment remain. Own-key equality does not see either of those, so the checks read `Object.getPrototypeOf` and `Object.prototype.b`.

## Admitted

`toss/es-toolkit` at `24e7a7b8cb8035fae1ea2e7b507aab96698a38b9` (MIT). The bytes are pinned in `peaceai/test/m251-pins.json`.

The two families are `gte` and `pull`. Each published test fails when the function throws and passes on the scaffold. A near-miss that agrees on a smaller question and disagrees with the published function is `verified_test_only`.

## Dropped

A scan of the pinned specs left these as the other single-arity cases with two or more replayable calls and no pending argument. None of them can take a body.

`deburr` stays out. The spec imports `./deburr` and `../compat/string/deburr`. Both stems are `deburr`, so one missing-module error selects both, and the compat alias has no reduced call.

`clone`, `cloneDeep`, and `deepFreeze` stay out. The reduced calls are primitives that return themselves, including `null` and `undefined`. The same return fits all three, and `return a` would not copy or freeze. `identity` already excludes those nullish calls.

`toCamelCaseKeys`, `toSnakeCaseKeys`, `toKebabCaseKeys`, `toPascalCaseKeys`, and `toConstantCaseKeys` stay out. The reduced calls are values whose keys do not change, so every converter fits, and the calls that change a key name a const.

`median` stays out. Every published call is also the mean.

`uniq` stays out. The spec builds a hole, and that replay is rejected.

`compact` stays out. The spec names `args`.

`escape` and `escapeRegExp` stay out. The concrete call is a string that does not change, so the literal and the string concatenation both fit.

`lte` stays the literal `true`. Every direct call expects `true`.

`isFinite`, `isNumber`, `toPath`, `size`, `flatten`, and the other predicate specs stay out. A boxed primitive, a `Set`, a `Map`, a symbol, or `arguments` is a reduced argument the sandbox cannot replay. A case whose recorded results are all equal stays the literal, so a one-call wrapper cannot be a second body.

`add`, `subtract`, `multiply`, `divide`, `without`, `fill`, `flatten` on the main entry, `windowed`, and `castArray` stay out. The calls use more than one arity. `repeat('abc', MAX_SAFE_INTEGER + 1)` also names a constant the sandbox cannot see.

A bare integer comparison still keeps the first form in its class. The attempt cap stays 20. `target.ts` was not edited. `capability-job.ts` was not edited.
