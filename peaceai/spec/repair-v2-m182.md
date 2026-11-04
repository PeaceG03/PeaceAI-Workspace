# M182: member callees for repair-v2 localisation (batch 19)

Spec for the M182 block in `peaceai/lib/editpropose.ts` (`MAX_MEMBER_SITES`, `memberSites` and its helpers, and the
last line of `locate`). Tests: `m182-cases.ts` (run by `m182-member.test.ts`; the pure cases are replayed against
mutants by `m182-mutation.test.ts`).

## Why

A repair edit can only land where `locate` put a site, so localisation is a ceiling on every template, the pair step
and M179's anchors. `locate` follows the request's named declarations one or two levels down, but only through calls
by a plain identifier to a same-file top-level function (M152 / M168), a function passed as an argument (M172) and a
relative named import (M172). Class code, the other half of the TypeScript in real repos, reaches its helpers through
`this.helper()`, getters (`this.total`) and static methods (`Cls.make()`), and none of those was followed: when a
located method's fault is one call below it in a member the request does not name, no candidate could ever touch it.
"The fault is often one call below the entry point" is the reason M168 / M172 exist for functions; M182 applies the
same rule to class members. It plausibly raises passes on unseen class-shaped tasks because it adds reach, not
another guess at the same sites.

What was looked at: `locate`, the M152 / M168 / M172 walks, the earlier batches' rejected lists, and general
TypeScript class layout. No dev-split task, dev-task diagnosis, reference diff or PeaceSTOCKS code was used to choose,
shape or test this; the fixtures are synthetic (a thermostat, an invoice, a grid, and small near-miss classes).

## The mechanism (repair-v2 only: `locate` depth 2)

For each located site that is a class member (method, accessor, constructor, or property declaration), its body is
walked once (one level; the new sites are not walked again):

1. `this.m(...)` / `this.#m(...)` (a call) and `this.g` (a read) resolve in the member's own class; `C.m(...)` /
   `C.g` resolve in C when C is a top-level class declaration of the same file. Only members DECLARED in that class
   are found (no other files; batch 20's M183 adds the same-file `extends` chain, see `repair-v2-m183.md`).
2. Conditions, each a tagged guard line:
   - `mc-class`: the located member belongs to a class (an object literal's method is skipped: its `this` depends on
     how it is called).
   - `mc-rebind`: `this` inside a nested non-arrow function or a nested class is another `this` and is not followed
     (arrows keep `this`).
   - `mc-static`: the member's static-ness matches the access (`this` in an instance member is the instance, in a
     static member the class; `C.m` is static).
   - `mc-kind`: a call resolves to a method or a property initialised with an arrow / function expression; a read
     without a call resolves only to a get accessor (a method reference or a data field is not code that runs there).
   - `mc-body`: the member has code (no abstract method, no overload signature).
   - `mc-known`: a member already inside a located site (named by the request, or inside a located class) or already
     added is skipped.
   - `mc-cap`: at most MAX_MEMBER_SITES = 4 member sites, in located-site order then source order of the accesses.
3. The member sites are tier 4 and come after every other site, including M173's const sites, so every earlier site
   and its number is unchanged; they add mutations at the end of each template group of the fixed order.

## Candidate order and box behavior on existing cases

Code where a located member reaches no unlocated member gets exactly the same sites and queue as before (no tier-4
site is added). Where one is added, its candidates come after the earlier sites' candidates within each template, so
the order of the earlier candidates relative to each other is unchanged; the MAX_CANDIDATES = 60 queue cap can push a
late earlier-site candidate out of the first queue (M178's rebuild can bring it back). The existing repair-v2 cases
(m168, m172, m173, m176, m177, m178, m179) pass unchanged in the focused runs and the full suite (PR body). repair-v1
and model-v1 never see tier-4 sites: M182 is appended after `m173-guard:cs-v2-only`, which returns first for depth 1
(asserted).

## Soundness note

- M182 only adds sites. It writes nothing: every candidate at a member site is built by the existing templates from
  text already in the file and must pass the loop's M175 gate (`editScopeProblem`) before it runs, like any other
  candidate. EDIT_NEW_WORDS, the gate classes, the row checks, loop.ts and the attempt budget are untouched; there is no
  new lib file. Every proposal of all three admits is checked `in-body`, and the end-to-end PASS row records
  `editScope: "in-body"`.
- A site cannot make a candidate pass: the team's tests (M173 report protocol) and the related-test rule decide. A
  wrongly resolved member (a name collision the syntactic resolution cannot see, e.g. a subclass overriding a member)
  costs attempts, not correctness.
- Resolution is syntactic and conservative: only `this` / same-file class names, only own declared members, no
  inheritance (until M183, same file only), no cross-file classes, no object-literal `this`. Each of these is a stated reach limit, not a fix.
- Bounded: one level, at most 4 extra sites, the same MAX_CANDIDATES cap; the read happens in `prepare()` on the pinned
  commit without the team's tests, like every other locate step.
- A getter that is also the target of an assignment (`this.g = v` with a get / set pair) is still followed as a read
  (the getter site is harmless extra reach); setters alone are never followed.

## Tests

- Three admits on unrelated shapes: THERMO (a private method `#target` called through `this`; the boost sign), INVOICE
  (getters `subtotal` and `tax` read through `this`; the tax operator), GRID (a static `Grid.index` called through the
  class's own name; the column sign). Each asserts the exact member sites, PASS within MAX_ATTEMPTS through the
  in-process attempt protocol, that the passing edit lies inside a member site and outside every earlier site (so
  nothing before M182 could produce it), no repeated proposal, and every proposal in-body under the M175 gate.
- Order: member sites last, earlier sites identical to the depth-1 list prefix; repair-v1 locates no member site.
- Resolution: a static call to another same-file class is followed; a static call through an imported class is not
  (batch 20: a member inherited from a same-file base is followed by M183; batch 21: a member of an imported base is
  followed by M185, and the case asserts it).
- Near misses per guard: object literal vs the same class (`mc-class`), function expression vs arrow (`mc-rebind`),
  instance vs static `norm` (`mc-static`), getter read vs method reference (`mc-kind`), abstract method and overload
  signatures vs the implementation (`mc-body`), named / inside a located class (`mc-known`), six helpers (`mc-cap`).
- End to end through the real loop (candidate uid M182_CAND, node:test tests, MAX_ATTEMPTS 20): THERMO is a valid PASS
  row with `editScope: "in-body"`; it may run up to E2E_TRIES = 3 times under shared-uid load, like m178 / m179.
- Mutation: each of the 7 tagged `m182-guard` lines deleted in turn fails an assertion (not a crash).

## Claims

None about dev tasks or readiness. CI dev runs use repair-v1 / model-v1 / rules-v1; this changes repair-v2 only, and
box runs never count. Readiness statuses are unchanged.

## Batch 19 item from Auditor's #680 review (M179)

`anchorFor` now also requires the anchor's failing test names to be a subset of the baseline's failing names
(`m179-guard:an-names`); see `repair-v2-m179.md`. Near miss and mutation tag added in m179-cases / m179-mutation.
