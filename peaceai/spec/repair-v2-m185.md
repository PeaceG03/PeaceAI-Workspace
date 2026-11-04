# M185: imported base classes for repair-v2 localisation (batch 21)

Spec for the M185 block in `peaceai/lib/editpropose.ts` (`importedClass`, section "M185 imported base classes"), its
use in M183's `baseOf` / `ownerOf` and M182's `memberSites` (now walking classes with their own file, `ClassAt`), and
the class kind of M184's `reExportedDecl` (renamed from `reExportedFunction`). Tests: `m185-cases.ts` (run by
`m185-xbase.test.ts`; the pure cases are replayed against mutants by `m185-mutation.test.ts`).

## Why

M182 follows `this.m()` / `C.m()` to the class's own members, and M183 follows `extends B` to inherited members, but
only when B is declared in the same file. In TypeScript repos a base class almost always lives in its own module
(`import { Base } from "./base"`), so the member the located method calls, where the fault often is (one call below
the entry), is declared in another file and was never a site: no template could reach it. M185 resolves the `extends`
identifier through the file's relative imports, with the same resolver and barrel rules M172 / M184 use for functions,
and looks the member up in the base's own file. Like M183 it adds reach on any class-based code, independent of the
domain.

Ranking (categories only, from the latest dev box probe summaries): of the 8 non-passing practice tasks, the largest
category the bot can act on is ATTEMPT_LIMIT with all attempts TEST_FAIL after the tests were reached (2 tasks; tied
with TEST_NEEDS_SERVICE, 2, which needs an external database). In that category the loop ran but no candidate passed,
so the fault was either not at a located site or not reachable by a template; localisation reach (M185, M186)
addresses the first. Not addressed: TEST_NEEDS_SERVICE, DEPS_PM_CONFIG, TEST_RUNNER_UNSUPPORTED. No dev-split task's
fix, reference diff, diagnosis detail or PeaceSTOCKS code was looked at; fixtures are synthetic (an alarm clock, a
sprite hit box, a running log).

## The mechanism (repair-v2 only: behind `m173-guard:cs-v2-only`, like M182 / M183)

When M183 needs the base of a class (for `super.m()` or for a member not declared on the class) and the `extends`
identifier names no top-level class of the class's own file, `importedClass`:

1. looks the identifier up in the file's relative imports (M172's `relativeImports`: named, aliased, and since M186
   default imports; type-only imports bind nothing);
2. resolves the specifier with M172's `resolveImport` (relative, inside the repo, `.ts` / `index.ts`);
3. finds the exported class with `reExportedDecl(target, name, "class")`: declared and exported there, or reached
   through M184's barrel rules (named re-export first, unique `export *`, type-only skipped, hops capped), or the
   module's default export (M186) for a default import.

The base is then a class in its own file: its members, and its own `extends`, are resolved in that file (a same-named
class in the subclass's file is ignored). Conditions, each a tagged guard line:

- `xb-allowed` (new): the base's file must pass the same test / generated / vendored filters as any site.
- Reused, now also across files: `ih-extends` (only `extends`, never `implements`), `ih-super`, `ih-depth`
  (MAX_BASE_DEPTH = 3 `extends` steps, counted across files; a cycle stops at the first repeated class),
  `ih-nearest`, `ih-private`, `rx-exported`, `rx-hops`, `rx-type-only`, `rx-star-unique`, `rx-named-first`,
  `imp-type-only`, `imp-type-only-name`, `dx-not-named` (`export default class B` is not a named export B).

Not followed (stated limits): non-relative specifiers, namespace imports (`extends ns.B`), mixin calls, a static call
through an imported class (`B.m()` where B is imported; M182 follows only same-file classes), a member already inside an
earlier site (M182's `mc-known`).

The found members are M182 tier-4 sites with M182's MAX_MEMBER_SITES = 4 cap (no new cap) in the same position (after
every other tier-0..3 site, before M184's tier 5), one level, not walked further.

## Candidate order and box behavior on existing cases

Code whose classes extend only same-file bases (or nothing) gets exactly the same sites and queue as with M183. Where a
base is imported, the inherited member's site is appended in the tier-4 block, so earlier candidates keep their order
(asserted on the three admits against the depth-1 prefix); the MAX_CANDIDATES = 60 cap can push a late earlier-site
candidate out of the first queue (M178's rebuild can bring it back). repair-v1 / model-v1 never see tier-4 sites.

Intentionally changed expectations: the M182 case on an imported class now asserts the imported base's member IS a site
(`helper@2`; a static call through an imported class is still not followed), and the M183 `super` case asserts the
imported base's `describe` IS a site (`describe@2`).

## Soundness note

- M185 only adds sites; it writes nothing. Every candidate is built by the existing templates from text in the base's
  file and must pass the loop's M175 gate (`editScopeProblem`) before it runs; templates, EDIT_NEW_WORDS, gate classes,
  row checks, loop.ts and the attempt budget are untouched, and no new lib file or edit class is added. Every proposal
  of the three admits is checked in-body; the end-to-end PASS row records `editScope: "in-body"`.
- Resolution follows the module and class rules the runtime uses: the binding's exported value (exported names only,
  type-only skipped, explicit before star, ambiguous star dropped, default not named), then the nearest declaration
  up the chain in each class's own file; private names are never inherited. Reach is bounded by MAX_REEXPORT_HOPS,
  MAX_BASE_DEPTH, cycle stops, MAX_MEMBER_SITES and MAX_CANDIDATES. A wrong resolution (e.g. a bundler alias) costs
  attempts, not correctness: a site cannot make a candidate pass; the team's tests decide.
- Read only in `prepare()` on the pinned commit, like every other locate step.

## Tests

- Admits on three unrelated shapes (none PeaceSTOCKS): ALARM (a base imported by name; the start sign in
  `Clock.elapsed`), SPRITE (a base reached through an `export *` folder index; the width sign in a getter), RUNLOG (a
  default-imported base whose own base is in its file, two steps; the unit factor in a static method). Each asserts the
  exact tier-4 sites, PASS within MAX_ATTEMPTS through the in-process attempt protocol, the passing edit inside the new
  site and outside every earlier site, no repeated proposal, every proposal in-body.
- Order and v1; scope (the base's own `extends` resolves in its own file, `super` from the subclass).
- Near misses per condition: vendored / generated base vs plain (`xb-allowed`), non-exported vs exported class
  (`rx-exported`), `export default class` vs a named import (`dx-not-named`), `implements` vs `extends`
  (`ih-extends`), type-only vs value and alias imports (`imp-type-only*`), barrel rules for classes, 3 vs 4 hops
  (`rx-hops`), 3 vs 4 cross-file `extends` steps and a cross-file cycle (`ih-depth`), and the stated limits.
- End to end through the real loop (candidate uid M185_CAND): ALARM is a valid PASS row with `editScope: "in-body"`.
- Mutation: `xb-allowed` and the 11 reused guards listed in `m185-mutation.test.ts`, each deleted in turn, fail an
  assertion (not a crash) in the M185 cases.

## Claims

None about dev tasks or readiness. CI dev runs use repair-v1; this changes repair-v2 only, and box runs never count.
