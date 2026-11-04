# M183: inherited members for repair-v2 localisation (batch 20)

Spec for the M183 block in `peaceai/lib/editpropose.ts` (`MAX_BASE_DEPTH`, `baseOf`, `ownerOf`) and its use in M182's
`memberSites` (the `super` access and the owner lookup). Tests: `m183-cases.ts` (run by `m183-inherit.test.ts`; the pure
cases are replayed against mutants by `m183-mutation.test.ts`). Builds on M182 (`repair-v2-m182.md`).

## Why

M182 follows `this.m()`, `this.g` and `C.m()` from a located class member, but only to a member DECLARED in that one
class. In class hierarchies the shared logic is in the base class by design: a subclass method calls `this.helper()`
that the base declares, reads a getter the base declares, calls `super.m()`, or calls a static the base declares through
its own name. All of those resolved to nothing under M182, so when the fault is in the base member (one call below the
entry), no candidate could ever touch it. A base member is shared by every subclass, so a fault there surfaces through
whichever subclass method the request names; that is the general reason (the M168 / M172 / M182 rule "the fault is often
one call below the entry", applied across the `extends` edge JavaScript itself resolves the call through).

Batch 19 deferred two items: this one and transitive member depth 2. This one was chosen because it adds a whole kind of
edge that today resolves to nothing (every inherited `this.m()` and every `super.m()`), while depth 2 lengthens an edge
kind already followed and grows the candidate queue for every class-shaped task; the general reasoning for depth 2 is
weaker (M168 / M172 stop at the same depth for functions) and it can be measured later.

What was looked at: `locate`, M182's `memberSites`, the batch 15-19 rejected lists, and JavaScript's member lookup rules.
No dev-split task, dev-task diagnosis, reference diff or PeaceSTOCKS code was used to choose, shape or test this; the
fixtures are synthetic (vehicles, shapes, a paged feed, and small near-miss classes).

## The mechanism (repair-v2 only: `locate` depth 2, inside M182)

For each access M182 already collects, the start class is the member's own class for `this`, the class named C for
`C.m` (a top-level class of the same file, as in M182), and, new, the class the own class extends for `super.m`. From
the start class, `ownerOf` walks up the `extends` chain and returns the first class that declares the name with the
access's static-ness; M182's filters (mc-static, mc-kind, mc-body, mc-known, mc-cap) then run on that class's members,
unchanged. Conditions, each a tagged guard line:

- `ih-extends`: only an `extends` clause is followed; `implements` (even of a class) is not inheritance.
- `ih-super`: `super.m` starts at the base, never at the own class (an override calling `super.m()` reaches the base's
  `m`, while `this.m()` beside it reaches the override).
- `ih-nearest`: the nearest declaring class wins, even when its declaration is not followable code (a data field or an
  override in a middle class shadows the base's method, exactly as at run time). Static and instance names are separate
  namespaces (a static `fee` does not shadow an inherited instance `fee()`).
- `ih-private`: a `#name` is lexically scoped to the class that declares it and is never looked up in a base (input code
  may be broken; following it would invent a call that cannot happen).
- `ih-depth`: at most MAX_BASE_DEPTH = 3 `extends` steps above the start class.

Not guards but structure: the base must be a plain identifier naming a top-level class declaration of the same file
(batch 21: or, by M185, an imported class resolved in its own file, see `repair-v2-m185.md`; a mixin call `extends mix(B)`, a property-access base `extends ns.B` and a class expression bound to a
const are not resolved); a cyclic chain (broken code) stops at the first repeated class. `mc-rebind` now also skips a
`super` inside a nested non-arrow function or class (an arrow keeps `super`).

The found members are M182 tier-4 sites: the same MAX_MEMBER_SITES = 4 cap (inherited sites count toward it; no new
cap), the same position after every other site, the same one level.

## Candidate order and box behavior on existing cases

Code where no located member reaches an inherited member gets exactly the same sites and queue as with M182. Where one
is reached, its site is appended after every earlier site (asserted for the three admits), so the earlier candidates
keep their order; as for M182, the MAX_CANDIDATES = 60 cap can push a late earlier-site candidate out of the first queue
(M178's rebuild can bring it back). repair-v1 and model-v1 never see tier-4 sites (behind `m173-guard:cs-v2-only`,
asserted). One M182 case changed its expectation: "an inherited member is not followed" now asserts the same-file base
member IS followed, and adds an imported-base case that is still not followed.

## Soundness note

- M183 only changes which class an access M182 already collects is resolved in; it adds no edit, template, edit class
  or gate. Every candidate at an inherited site is built by the existing templates from text in the file and must pass
  the loop's M175 gate (`editScopeProblem`) before it runs. EDIT_NEW_WORDS, the gate classes, the row checks, loop.ts
  and the attempt budget are untouched; no new lib file. Every proposal of all three admits is checked `in-body`, and
  the end-to-end PASS row records `editScope: "in-body"`.
- It cannot widen unsafely: the total reach is still bounded by MAX_MEMBER_SITES (4) and MAX_CANDIDATES; the walk is at
  most MAX_BASE_DEPTH steps and stops on a cycle; resolution follows JavaScript's own lookup order (nearest declaration
  wins, static and instance separate, private names not inherited), so a site is added only where the access would
  actually run that code given the same-file class graph. The case it can get wrong is dynamic dispatch to a further
  subclass that overrides the member (the same caveat M182 states), or a local binding that shadows a top-level class
  name used in `extends`; either costs attempts, not correctness, because a site cannot make a candidate pass: the
  team's tests (M173 report protocol) and the related-test rule decide.
- Read only in `prepare()` on the pinned commit without the team's tests, like every other locate step.

## Tests

- Three admits on unrelated shapes: VEHICLE (an instance method one `extends` step up called through `this`; the spare
  sign), SHAPE (a getter two steps up read through `this`; the perimeter operator), FEED (a static of the base called
  through the subclass's own name; the page sign). Each asserts the exact tier-4 sites, PASS within MAX_ATTEMPTS through
  the in-process attempt protocol, that the passing edit lies inside the inherited site and outside every earlier site,
  no repeated proposal, and every proposal in-body under the M175 gate (M182's `admit` helper).
- Order and v1: inherited sites last, earlier sites identical to the depth-1 prefix; repair-v1 locates none.
- super: `super.describe()` in a class that overrides `describe` reaches the base's, `this.describe()` the override; an
  arrow keeps `super`; an imported base is resolved in its own file (batch 21, M185; the case asserts it).
- Near misses per guard: `implements` vs `extends` (`ih-extends`), the override itself vs `super` (`ih-super`), a middle
  class's data field / override shadowing the base and a static name not shadowing an instance one (`ih-nearest`), a
  base's `#seed` from a subclass vs from its own class (`ih-private`), 3 steps admitted vs 4 refused and a cyclic chain
  (`ih-depth`). Limits: mixin and property-access bases, a member inside a located class, the shared MAX_MEMBER_SITES.
- End to end through the real loop (candidate uid M183_CAND, node:test tests, MAX_ATTEMPTS 20): VEHICLE is a valid PASS
  row with `editScope: "in-body"`; up to E2E_TRIES = 3 under shared-uid load, like m178 / m179 / m182.
- Mutation: each of the 5 tagged `m183-guard` lines deleted in turn fails an assertion (not a crash).

## Claims

None about dev tasks or readiness. CI dev runs use repair-v1 / model-v1 / rules-v1; this changes repair-v2 only, and box
runs never count. Readiness statuses are unchanged.
