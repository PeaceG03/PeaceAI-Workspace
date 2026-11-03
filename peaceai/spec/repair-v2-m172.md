# repair-v2, batch 11 (M172): localisation below the entry point and the undefined-keeps-key idiom

Status: implemented in `peaceai/lib/editpropose.ts` (`locate`, `resolveImport`, `idiomMutationsIn`), repair-v2 only
(`repairProposer({ v2: true })`); repair-v1 (and model-v1, which ranks repair-v1's candidates) is unchanged. Tests:
`peaceai/test/m172-batch11.test.ts` (cases in `m172-cases.ts`), `peaceai/test/m172-mutation.test.ts`. Diagnosed on
the public dev tasks only (batch 10 box probes); no hidden-set row, task or result was read.

**Correction (batch 11 fix, Auditor B3).** An earlier version of this spec (and of `m172-cases.ts`) said no dev-split
code was modeled and no upstream fix was copied. That was wrong for the undefined-keeps-key idiom: it was derived
after looking at the superstruct-coerce-undefined dev failure and its upstream fix (superstruct PR 1126), and its
output `v !== undefined || k in value` matches that fix token for token; one test fixture (`create` -> `check` ->
`coerceAll` over a value's keys) also mirrored that task's call chain. So:
- no superstruct-coerce-undefined result may be credited to batch 11 (its box PASS is not evidence; the honest box
  count for batch 11 is 4/12, not 5/12);
- the mirroring fixture is gone, replaced by unrelated shapes (below);
- the idiom stays, because it is a general rule, admitted on two shapes unrelated to superstruct (a patch loop with
  element access; a property sanitizer with loose `!=` in a block) plus a third behind an import (a form-title trim,
  property write, reversed `undefined !==`). It only ever adds writes of undefined to keys already `in` the object
  and, like every candidate, must pass the team's tests. If a later held-out task shows it never helps outside
  superstruct, it should be removed.
- From now on no shape or fix is taken from `/workspace/batch10/ref` (upstream reference diffs); those are diagnosis
  inputs at most and are not to be modeled.

## Diagnosis (public dev tasks, batch 10 box probes)

- remeda-zip-empty (NO_MORE_EDITS after 7): every candidate was in zipWith.ts. zip.ts hands its implementations to a
  dispatcher (`purry(zipImplementation, args, lazyImplementation)`): functions passed as call arguments were never
  located, only functions called by name. Localisation gap (the fix itself is also beyond the templates).
- superstruct-coerce-undefined: entry `create` -> `validate` (same file) -> `run`, imported from `./utils`. Same-file
  callees only were followed, so the faulty `run` was never a site. The fault is `if (v !== undefined) value[k] = v`,
  which skips writing a key that is present but coerced to undefined: a common idiom bug with no template.
- destr / neverthrow: the fixes need new syntax (a module-level regex) or a new API; no template rule reaches them.
  Not addressed here (synthesis gaps; recorded, not hacked).

## Change 1: localisation (repair-v2 only)

- A same-file top-level function passed as an argument of a call inside the entry point (`xs.map(f)`,
  `apply(f, ...)`) is located with the same-file callees, tier 1 (`m172-guard:ref-arg`). The entry's own name is
  excluded; a function first bound to a local is not followed.
- A function the entry point (tier 1) or one of its same-file callees (tier 2) calls by a named import from a
  relative module is located in that module (`m172-guard:imp-v2-only`): the specifier must be relative
  (`imp-relative`), must not climb above the repository root (`imp-inside`), resolves to an existing `.ts/.tsx/.mts/
  .cts` file (with `.js` -> `.ts` and `index.ts`), and that file must pass the same test / generated filters as any
  site (`imp-allowed`). Type-only imports are skipped, both `import type { f }` (`imp-type-only`) and
  `import { type f }` (`imp-type-only-name`). Only the imported top-level function itself is a site (one
  level; MAX_CALLEES and MAX_SITES unchanged).

## Change 2: the undefined-keeps-key idiom (repair-v2 only, tried after the four M168 idioms)

`if (v !== undefined) o[k] = v` (also `!=`, `undefined !== v`, a block with that one statement, `o.name = v`) ->
`if (v !== undefined || k in o) o[k] = v` (`"name" in o` for a property). Conditions: no else branch
(`uk-no-else`); the check is against `undefined` (`uk-undefined`); the assigned value is the checked variable
(`uk-same-value`); the key is an identifier or literal (`uk-key`, no call is duplicated); the object is a plain
reference (`uk-ref`, evaluating it twice has no side effect).

## Soundness

Nothing in the loop's checks changes: these only add candidate sites and candidate edits, every one of which is still
judged by the team's tests and the related-test rule (RELATED_FAIL) in the same isolation, so a wrong candidate costs
an attempt and cannot pass. The candidate budget (60), the attempt limit and every M152 / M168 guard are unchanged.
The idiom edit only adds writes of undefined to keys already `in` the object, so it cannot touch another key. Located
files are read through the same code-search tools and filters as every other site. repair-v1's sites and candidate
order are unchanged (asserted).

## Tests (m172-cases.ts)

Idiom: admitted on a patch loop with element access, and on a property write in a block with loose `!=`; near
misses: an else branch, a null check, another value, a computed call key, a non-ref target, a two-statement block,
`===`. ref-arg: admitted on a dispatcher and on an array callback; near misses: repair-v1, a function bound to a
local first. Imports: admitted on an extensionless helper module, on an aliased `.js` import from a subdirectory two
calls down (a form-title trim with the idiom fault), and on an entry in a subdirectory importing `../lib/paging.js`
inside a template literal (a comparison fault); near misses: repair-v1, a bare specifier, a path above the root, a
module under `__tests__/`, `import type { f }`, `import { type f }`. The mutation test deletes each m172 guard line
and needs a case to fail.
