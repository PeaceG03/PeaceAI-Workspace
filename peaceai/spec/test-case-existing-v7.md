# TEST_CASE_EXISTING v7 (`public-test-case-existing-v7`, M97)

Third pick of the post-v4 census (notes `batch-v4/v10/NEXT-SKILL.md`): `Map` / `Set` signatures (4 on PeaceSTOCKS)
and `void` returns of assert-style validators (3). v7 is a NEW spec with its own hash; v1-v6 keep their hashes and
their accept sets (every v7 branch runs only with the v7 flag).

## Shape

Same trigger, output (one new test file next to the module, importing only the named function) and fix-free grading
as v6. Only `params.target` differs: `exported-pure-function-v7`.

- Superset: v7 first runs the v6 check. A target v6 accepts is `not_needed` under v7 (v6 answers it), so v7 never
  changes a v6 answer and loses nothing. Everything below applies only to targets v6 refuses.
- `Map` / `Set`: the global, unshadowed `Map<K, V>`, `ReadonlyMap<K, V>`, `Set<K>` and `ReadonlySet<K>`, anywhere a
  plain-data type may appear (parameters, return type, interface / alias members, nested collections). `K` must be
  `string`, `number` or a union of string / number literals; `V` must be plain data. `WeakMap`, `WeakSet`, object or
  function keys, raw `Map` without type arguments and shadowed `Map` / `Set` names stay refused (`test_target_signature`).
- `void`: a return type of exactly `void`. `asserts x`, `asserts x is T`, `never`, `Promise<void>` and `undefined`
  stay refused.
- Check grammar (args mode `plain-data-v7`, used only by v7): checks may pass and expect `new Map([[k, v], ...])` and
  `new Set([k, ...])` literals with string or number literal keys, unique keys, at most 32 entries, nesting depth at
  most 3, no spread, holes, type arguments or other constructor forms. Every call builds a fresh instance, so no
  check can share a Map between calls. Results compare with `node:assert/strict` `deepEqual`, which is insensitive
  to Map / Set insertion order. The new check line `is new Map(...)` / `is new Set(...)` parses for every spec, but
  only v7 accepts its value; the others refuse it as `test_refused`.
- Void Job A: every check of a void target must be `throws` or `is undefined`, with at least one `throws`
  (otherwise `test_check_refused`): the stub returns `({} as never)`, so a test without a `throws` would only be
  killed by that artifact, not by the function's behaviour.

## Hardening (v7 targets only)

The v6 Auditor lessons, extended to collections:

- Writes: no write deeper than one step into a fresh local value, mutator calls only on the fresh local root itself,
  and `Map.prototype` / `Set.prototype` mutators (`set`, `add`, `delete`, `clear`) on anything else (a parameter, a
  module const, a value read out of a parameter) are `test_target_impure`. So a target cannot mutate a Map or a Set
  of objects it was given. A mutator name is reachable only as that direct callee: `Map.prototype.clear.call(m)`,
  `const f = m.set`, `m["clear"]()`, `m[k]()` and `const { add } = s` are `test_target_impure` too.
- Module state: a followed module const whose initializer is a container (object, array, `new Map`, `new Set`, ...)
  may only be used in place (`.prop`, `[k]`, spread into an array, `for ... of`, `in`, `typeof`). Aliasing it,
  returning it, passing it as an argument, a shorthand property or an export specifier is `test_target_impure`, so
  the target can never hand out or retain a shared instance.
- Closure walk (at most 64 modules, the relative value and side-effect imports): a module importing the target module
  back is `test_target_impure`; any write, delete or `++` on a patchable built-in or `globalThis` (`Map.prototype.get = ...`,
  `Object.prototype.x = ...`, `Object.defineProperty(Map.prototype, ...)`, `Reflect.setPrototypeOf(...)`,
  `Object.assign(Set.prototype, ...)` and friends) anywhere in the closure is `test_target_impure`; a relative import
  that is not exactly one `.ts` module, `import x = require(...)` anywhere, and `require` / dynamic `import()` in
  load-time code are `test_target_io`. Load-time reach crosses modules: top-level statements, the functions they
  name, named imports into the declaring module (namespace / default imports mean the whole module), class static
  parts; lazy top-level classes and const functions are walked only when named. The usual CLI main guard
  (`if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { ... }`) is skipped.
  The host globals (`process`, `console`) are not patchable built-ins, so `process.exitCode = 1` in such a block is
  not a global patch; `process.env` and `process.argv` reads stay `test_target_io` as before.
- Defaults: the v4 rule (a default is analyzed like the body) applies unchanged; `= new Map()` is a fresh value per
  call.

## Grading

Job B re-checks the target under the v7 analysis only for a candidate whose operation id names
`public-test-case-existing-v7` (with v2-v6 set), then re-checks the graded test file itself (the test text alone is
not trusted): for a void target every reference to the function must be `assert.throws(() => fn(...), ...)` (at least
one) or `assert.equal(fn(...), undefined)`; every `new Map` / `new Set` in the test must be a check-grammar literal and
no other `Map`, `Set`, `WeakMap` or `WeakSet` value may appear. Otherwise the candidate is `UNGRADABLE`
(`not-test-only`). The candidate is graded with the v2 object-aware stub. Every other candidate is re-checked exactly
as before.

## Census gain

PeaceSTOCKS 0ab37c8 (main): v1 34, v2 78, v3 92, v4 105, v5 112, v6 122, v7 129 (+7, none lost). The 7:
groupedDailySymbolIndex, dollarVolumeBySecurity, storedByFetchFrom, compatibleStoredFetches (Map / Set);
requireMonth, assertObjectMetadata, assertCancelRunAccepted (void).

## Evidence

`peaceai/rules/proposals/m97-test-case-existing-v7-evidence.json`: see the record for the count, method and picks.
