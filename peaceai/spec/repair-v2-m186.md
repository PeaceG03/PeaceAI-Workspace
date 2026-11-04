# M186: default exports for repair-v2 localisation (batch 21)

Spec for the M186 block in `peaceai/lib/editpropose.ts` (`defaultDecl`, section "M186 default exports"), the default
import binding in M172's `relativeImports`, the `"default"` branch and the `dx-star` stop in M184's `reExportedDecl`,
and the `dx-not-named` line in `exportsOwn`. Tests: `m186-cases.ts` (run by `m186-default.test.ts`; the pure cases are
replayed against mutants by `m186-mutation.test.ts`). Independent of M185 except that M185 uses it for default-imported
base classes.

## Why

M172 / M184 follow a function the entry point calls through a named import (and barrels). A default import
(`import tip from "./tip"`) or a barrel's `export { default as lerp } from "./lerp"` bound nothing, so the function
behind a module's default export, one call below the entry, was never a site. Default exports are a common
one-function-per-file layout. M186 resolves the default export as the module system does.

Ranking: same category as M185 (ATTEMPT_LIMIT / TEST_FAIL after tests were reached, 2 of the 8 non-passing practice
tasks; categories only, see `repair-v2-m185.md`). Fixtures are synthetic (a bill tip, a slider interpolation, a zoom
factor).

## The mechanism (repair-v2 only)

- `relativeImports` binds a default import's local name to `{ name: "default" }` (type-only imports still bind nothing).
- `reExportedDecl(mod, "default")` asks `defaultDecl(mod)` for the module's default export: `export default function`
  (named or anonymous), `export default <identifier>` naming a top-level function, `export default <arrow / function
  expression>`, or a local `export { f as default }`. Named re-exports `export { default } from` /
  `export { default as x } from` / `export { x as default } from` are followed with M184's rules.
- The site is named after the declaration (`tip`), or `default` for an anonymous one.

Conditions, each a tagged guard line:

- `dx-not-named`: `export default function f` exports the default, not the name `f` (`exportsOwn`).
- `dx-star`: `export *` never re-exports a default.
- `dx-equals`: `export = f` (CommonJS interop, meaning depends on compiler flags) is not followed (conservative).
- `dx-type-only`: `export type { f as default }` exports no value.
- `dx-unique`: a module with two default claims (broken code) follows neither.
- Reused: `rx-known` (a function already inside an earlier site is not added), `rx-named-first`, and every M184 rule.
  repair-v1 is kept out by two independent guards (`imp-v2-only`, `cs-v2-only`); deleting either alone changes
  nothing, so neither is in the M186 mutation list (both are covered by their own batches' mutation tests).

Not followed (stated limits): a default that is a class (not a function site), a call result (`export default make()`),
an imported binding re-exported as default (`import f from ...; export default f`), non-relative specifiers.

Sites are M184 tier-5 sites under M184's MAX_REEXPORT_SITES cap, appended after every other site.

## Candidate order and box behavior on existing cases

Code without default imports gets exactly the same sites and queue as with M184, with one deliberate change in M184:
a barrel's `export { f } from "./f"` where `./f` has only `export default function f` is no longer followed
(`dx-not-named`; at run time that name is undefined). Default-export sites are appended, so earlier candidates keep
their order (asserted on the three admits against the depth-1 prefix).

## Soundness note

- Only sites are added; no new edit, template, gate or lib file. Every proposal of the three admits is checked in-body
  under the M175 gate; the end-to-end PASS row records `editScope: "in-body"`.
- The resolution follows the ES rules (one default per module, not a named export, not star-exported, type-only has no
  value); `export =` is refused rather than guessed. Reach is bounded by M184's hops / cycle / site caps and
  MAX_CANDIDATES. A wrong resolution costs attempts, not correctness.

## Tests

- Admits on three unrelated shapes: BILL (`export default tip;`; the rate operator), SLIDER (a barrel's
  `export { default as lerp }` over an anonymous default arrow; the step sign), ZOOM (a local `export { scale as
  default }` imported as `grow`; the factor operator). Same assertions as M184's admits.
- Order and v1; forms (each default form, and a named import of `default`).
- Near misses, one per guard: `dx-not-named`, `dx-star`, `dx-equals`, `dx-type-only`, `dx-unique`; and the limits.
- End to end through the real loop (candidate uid M186_CAND): BILL is a valid PASS row with `editScope: "in-body"`.
- Mutation: the 5 `m186-guard` lines plus `rx-known` and `rx-named-first`, each deleted in turn, fail an assertion.

## Claims

None about dev tasks or readiness. repair-v2 only; box runs never count.
