# M177: statement-level edit classes for repair-v2

Spec for the two repair-v2 templates in `peaceai/lib/editpropose.ts` (`STMT_TEMPLATES`, `GUARD_GLOBALS`,
`MAX_COPY_GUARDS`, `guardShape`, `readNames`, `stmtMutationsIn`). Tests: `m177-cases.ts` (run by `m177-stmt.test.ts`;
the pure cases are replayed against mutants by `m177-mutation.test.ts`).

## Why

Every repair class so far edits inside one expression or swaps two existing pieces. Two of the most common repair
shapes in the general automated-program-repair literature are statement-level: deleting a statement (GenProg-style
delete) and inserting a statement that already exists elsewhere in the program ("plastic surgery": fix ingredients are
usually present in the same file). A missing input check that a sibling function already performs, and a stray side
effect or a spurious early exit, are general bug shapes a coding agent must be able to propose. PeaceAI's proposers
could produce neither.

What was looked at: the existing templates, the M175 gate and the general APR literature. No dev-split task, dev-task
diagnosis, reference diff or PeaceSTOCKS code was used to choose, shape or test these classes; the fixtures are general
synthetic shapes (a wallet, list statistics, a tag list, a capped sum).

## The classes (repair-v2 only, inside a located site)

1. `copy-guard`: a GUARD of another function in the same file is copied, as is, to the top of a function in the site
   that has a block body. A guard (`guardShape`, `m177-guard:cg-shape`) is an `if` with no `else` whose consequent is
   a `return` or `throw` (or a one-statement block of one), and an ingredient is a direct statement of a function's
   block body. Refused:
   - a guard that reads `this`, `super`, `arguments`, `await`, `yield`, or contains a function or class
     (`cg-ctx`: its meaning depends on the function it is in);
   - a target that is a constructor, a setter or a generator (`cg-target-kind`: an early return or throw at their top
     changes construction, assignment or iteration protocol);
   - a target that already has a statement with the same text (`cg-dup`; this also bars a function's own guard, and
     identical ingredients are copied once);
   - a guard reading a name that is not a parameter of the TARGET, a top-level declaration or import of the file, or
     one of `GUARD_GLOBALS` (`cg-bound`: a copied guard never reads a name that is unbound or bound to something else);
   - a guard reading a name declared anywhere in the target's body, nested functions included (`cg-shadow`:
     conservative, so no copied read can be captured by a local);
   - more than `MAX_COPY_GUARDS` = 6 copies per site (`cg-cap`).
2. `delete-statement`: one statement of a block with at least two statements (`ds-only`) is removed, only an
   expression statement or an `if` (`ds-kind`: never a declaration, so no binding disappears, never a return / throw /
   loop), only an `if` with no `else` (`ds-no-else`), and only when the statement before it is closed (ends in `;` or
   in a block; `ds-asi`), so automatic semicolon insertion cannot join its neighbours.

The classes only run for repair-v2 (`m177-guard:stmt-v2-only`); repair-v1, and so model-v1, are unchanged. CI's dev
workflow runs repair-v1, model-v1 and rules-v1, so this batch changes no CI dev row.

## Order and reach (honest limit)

`TEMPLATES_V2` = idioms, v1 templates, const-value, SStuB, then `copy-guard`, `delete-statement` LAST. Candidates are
sorted by template first, so every earlier candidate and its order are unchanged (m177 asserts every statement
candidate comes after every other one; m168, m173 and m176 pin the new order). The cost: a statement candidate is only
tried after every earlier candidate of the located sites, so with the attempt budget (at most MAX_ATTEMPTS = 20) and
the 60-candidate cap it is reached only on small or tightly located sites. Stated, not fixed.

## Soundness note

Every candidate is built from text already in the file: a copy inserts the exact text of an existing statement; a
deletion only removes text. `cg-bound` and `cg-shadow` make a copied guard read only names that mean in the target what
they can mean at module scope (or the target's own parameters); `cg-ctx` keeps out context-dependent reads. Independently
of that argument, the loop's M175 gate (`editScopeProblem`) re-classifies every candidate before anything runs; m177
checks every statement candidate on every admit fixture is `in-body`, shows the gate (not the proposer) refusing a copied
guard that raises a dangerous word's count (`dangerous:constructor`), and the end-to-end case checks the real loop's PASS
row records `editScope: "in-body"`. Residual: this is a structural bound, not a proof about behaviour; an inserted early
exit or a removed statement can change behaviour in any way those words allow, which is the point of a repair, and the
team's tests (graded by the M173 report protocol) decide. No validation was loosened: the gate, its policy table, its
pinned word lists (EDIT_NEW_WORDS included) and the row checks are unchanged.

## Tests

- Admits (two unrelated shapes per class, each fixed through the in-process oracle): copy-guard on free functions with
  a throw guard (a deposit that accepts a negative amount) and on list statistics with an early return (spread of an
  empty list); delete-statement on an expression statement (a stray truncation) and on an `if` in a loop body (a
  spurious early exit).
- A refused near miss for every guard (the refused shape beside an admitted one in the same file), the v2-only check,
  an order case, and the gate case above.
- End to end (candidate uid `M177_CAND`, no fallback; without one the case asserts the `CAND_UID_*` refusal): the real
  loop with repair-v2 fixes the wallet on attempt 4 (three earlier-template candidates first), a valid PASS row with
  `editScope: "in-body"`.
- Mutation (`m177-mutation.test.ts`): each of the 12 `m177-guard` lines deleted makes at least one pure case fail an
  assertion (no crash, no hang); plus a control and a tag-coverage test.

## Claims

No dev or held-out gain is claimed. Box runs never count. Whether these classes move any creditable count is for a CI
run that uses repair-v2, which does not exist today.
