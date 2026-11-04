# M184: barrel re-exports for repair-v2 localisation (batch 20)

Spec for the M184 block in `peaceai/lib/editpropose.ts` (`MAX_REEXPORT_HOPS`, `MAX_REEXPORT_SITES`, `exportsOwn`,
`reExportedFunction`), its call in M172's imported-callee step (`viaReExport` in `locate`) and the last lines of
`locate`. Tests: `m184-cases.ts` (run by `m184-barrel.test.ts`; the pure cases are replayed against mutants by
`m184-mutation.test.ts`). Independent of M183 (same batch, separate tags and tests).

## Why

M172 follows a function the entry point calls by a named relative import into the module the specifier resolves to,
but only when that module declares the function itself. The usual TypeScript layout puts a barrel in between: a folder
`index.ts` (or a `utils.ts`) that only re-exports (`export { f } from "./f"`, `export * from "./f"`), so callers write
`import { f } from "./utils"`. Then M172 resolves the import to the barrel, finds no function there, and adds nothing:
the function the entry calls, where the fault often is (the M168 / M172 rule "one call below the entry"), is never a
site, and no template can reach it. M184 follows the barrel's re-exports to the declaring file, as the module system
itself does. It adds reach on any repo that uses barrels, which is a layout choice independent of the code's domain.

What was looked at: `locate`, M172's import resolution and its spec, the batch 15-19 rejected lists, and the ES module
export rules. No dev-split task, dev-task diagnosis, reference diff or PeaceSTOCKS code was used to choose, shape or
test this; the fixtures are synthetic (a receipt formatter, a grid route, a card title, and small near-miss modules).
Other candidates considered and not taken this batch: depth-2 member callees (no stronger evidence than in batch 19),
namespace imports (`import * as u` then `u.f()`) and default imports (smaller share of layouts; same mechanism family,
can follow later with their own near misses).

## The mechanism (repair-v2 only: inside M172's imported callees, behind `m172-guard:imp-v2-only`)

When M172 resolves an imported name to an allowed module that does not declare a top-level function of that name,
`reExportedFunction` looks for the name among the module's re-exports, recursively:

1. A named re-export `export { name } from "./x"` or `export { impl as name } from "./x"` is followed (the alias is
   tracked: the next module is searched for `impl`).
2. Otherwise each `export * from "./x"` module is searched; the name is followed only when exactly one of them exports
   it.
3. In a module reached by a step, the function must be exported under that name (an export modifier, or a local
   `export { name }`).

Specifiers go through M172's `resolveImport` (relative only, inside the repo, `.ts` / `index.ts` resolution). Conditions,
each a tagged guard line:

- `rx-named-first`: an explicit named re-export is followed and wins over `export *` (ES: an explicit export shadows a
  star export of the same name).
- `rx-star-unique`: a name that two or more `export *` modules export is not followed (ES leaves it unexported).
- `rx-exported`: a reached module's non-exported function of the same name is not what is re-exported.
- `rx-type-only`: `export type { ... } from` and `export type * from` are skipped (no runtime value); a `type` element
  in a named list is skipped too.
- `rx-hops`: at most MAX_REEXPORT_HOPS = 3 re-export steps; a cycle stops at the first repeated module.
- `rx-allowed`: the declaring file must pass the same test / generated filters as any site (a function re-exported from
  `vendor/`, `dist/` or a test file is not located).
- `rx-known`: a function already inside an earlier site (named by the request, or already located) is not added again.
- `rx-cap`: at most MAX_REEXPORT_SITES = 4 barrel sites, in call order.

Not followed (stated reach limits, not fixes): non-relative specifiers (packages, path aliases), `export * as ns`,
default exports, a local `export { impl as name }` without `from`, namespace and default imports.

The found functions are tier-5 sites appended after every other site (after M173's const sites and M182 / M183's
member sites). They are not walked further.

## Candidate order and box behavior on existing cases

Code where no imported name resolves through a barrel gets exactly the same sites and queue as before. Where one
does, its site is appended after every earlier site, so earlier candidates keep their order (asserted on the three
admits, which also assert the earlier sites equal the depth-1 list prefix); as for M173 / M182, the MAX_CANDIDATES = 60
cap can push a late earlier-site candidate out of the first queue (M178's rebuild can bring it back). repair-v1 and
model-v1 never see tier-5 sites (M172's `imp-v2-only` returns first at depth 1, asserted).

## Soundness note

- M184 only adds sites, at the end; it writes nothing. Every candidate at a barrel site is built by the existing
  templates from text in that file and must pass the loop's M175 gate (`editScopeProblem`) before it runs.
  EDIT_NEW_WORDS, the gate classes, the row checks, loop.ts and the attempt budget are untouched; no new lib file, no
  new edit class. Every proposal of all three admits is checked `in-body`, and the end-to-end PASS row records
  `editScope: "in-body"`.
- It cannot widen unsafely: the resolution follows the ES export rules (explicit before star, ambiguous star dropped,
  exported names only, type-only skipped), so a site is a function the import binding actually refers to at run time
  given the repo's own relative modules; reach is bounded by MAX_REEXPORT_HOPS, a cycle stop, MAX_REEXPORT_SITES and
  MAX_CANDIDATES; files outside the repo, packages and test / generated files are never sites. A wrong resolution
  (for example a bundler alias the syntactic resolver cannot see) costs attempts, not correctness: a site cannot make a
  candidate pass, the team's tests (M173 report protocol) and the related-test rule decide.
- Read only in `prepare()` on the pinned commit without the team's tests, like every other locate step.

## Tests

- Three admits on unrelated layouts: RECEIPT (a folder index with named re-exports; the cents operator), ROUTE (a folder
  index with `export *` over two modules; the distance sign), CARD (a two-step barrel chain with an alias,
  `export { cut as clip }`; the comparison). Each asserts the exact tier-5 sites, PASS within MAX_ATTEMPTS through the
  in-process attempt protocol (a small CommonJS loader runs the fixture's modules), that the passing edit lies inside
  the barrel site and outside every earlier site, no repeated proposal, and every proposal in-body under the M175 gate.
- Order and v1; unchanged behavior on a direct import (M172's site, no tier-5) and on a non-relative barrel.
- Near misses per guard: named vs star (`rx-named-first`), two star exporters vs one (`rx-star-unique`), non-exported
  vs exported and the local export list (`rx-exported`), `export type *` vs `export *` (`rx-type-only`), 3 hops vs 4
  and a cyclic barrel (`rx-hops`), a vendored target vs a plain one (`rx-allowed`), the function named by the request
  (`rx-known`), five re-exported callees (`rx-cap`).
- End to end through the real loop (candidate uid M184_CAND, node:test tests, MAX_ATTEMPTS 20): RECEIPT is a valid
  PASS row with `editScope: "in-body"`; up to E2E_TRIES = 3 under shared-uid load, like m178 / m179 / m182 / m183.
- Mutation: each of the 8 tagged `m184-guard` lines deleted in turn fails an assertion (not a crash).

## Claims

None about dev tasks or readiness. CI dev runs use repair-v1 / model-v1 / rules-v1; this changes repair-v2 only, and box
runs never count. Readiness statuses are unchanged.
