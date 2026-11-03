# M176: SStuB edit classes for repair-v2

Spec for the four repair-v2 templates in `peaceai/lib/editpropose.ts` (`SSTUB_TEMPLATES`, `simpleOperand`,
`NON_COMMUTATIVE`, `ownBindings`, `changeIdentifier`, `sstubMutationsIn`). Tests: `m176-cases.ts` (run by
`m176-sstub.test.ts`; the pure cases are replayed against mutants by `m176-mutation.test.ts`).

## Why

After operator and literal changes (already covered by repair-v1's templates), the most common one-line bug classes
in the simple-stupid-bug literature (mutation-testing operators and the "SStuB" classes mined from bug-fix commits)
are: statements in the wrong order, arguments in the wrong order, operands in the wrong order, and the wrong variable
used. PeaceAI's proposers could produce none of them. Three of the four are multi-token edits (a span is rearranged),
which is exactly the kind of edit whose PASS only counts with the M175 edit-scope gate in place (Auditor's binding
condition), so this batch is stacked on #674.

What was looked at: the existing templates and the M175 gate. No dev-split task, dev-task diagnosis, reference diff or
PeaceSTOCKS code was used to choose, shape or test these classes; the fixtures are general synthetic shapes
(a meter, a record log, a clamp, an hours check, an elapsed time, an expiry check, an area, initials).

## The classes (repair-v2 only, inside a located site)

1. `swap-statements`: two ADJACENT statements of a block, BOTH expression statements, BOTH ending in `;`, trade places.
   Never a declaration (moving one changes what is in scope or hits the TDZ), never a return / throw / control
   statement (`m176-guard:ss-expr`). The `;` condition (`m176-guard:ss-semi`) keeps automatic semicolon insertion from
   joining or splitting the moved statements.
2. `swap-args`: two ADJACENT arguments of a call or `new`, both side-effect-free (`simpleOperand`: an identifier,
   `this`, a non-optional property chain of those, or a numeric / string / no-substitution template / true / false /
   null literal), trade places (`m176-guard:sa-simple`). A call, a spread, an object or any other argument is never
   moved, so evaluation order, side effects and argument count are unchanged; only which slot gets which value.
3. `swap-operands`: the operands of a NON-commutative operator (`NON_COMMUTATIVE`: `-` `/` `%` `**` `<` `<=` `>`
   `>=`; `m176-guard:so-op`) trade places when both are side-effect-free (`m176-guard:so-simple`). `+` (also string
   concatenation), `*`, equality and logical operators are left out: swapping them is a no-op or is already covered.
4. `change-identifier`: inside a function (not inside a nested function, which its own visit handles;
   `m176-guard:ci-inner`), a READ of one of the function's own bindings (an identifier parameter, or an identifier
   declarator of a variable statement directly in its block body) is replaced by another own binding that is usable
   there: a parameter always, a local only after its declaration statement ends (`m176-guard:ci-before`: never before
   its declaration, never in its own initializer). Not a read, so never replaced: a declared or property name
   or a shorthand property (`{ a }` would rename the key; its name node, so also `ci-decl`), an assignment target (`ci-write`),
   a `++` / `--` operand (`ci-incdec`), a callee (`ci-callee`), a name in a type (`ci-type`; erased, no runtime change).
   Known and harmless (batch 16 note): the replacement can be a name shadowed at the use site by an inner block's binding of the same name (it then reads that inner binding); such a candidate is only ever a wrong guess, the M175 gate and the team's tests decide it.

The classes only run for repair-v2 (`m176-guard:sstub-v2-only`); repair-v1, and so model-v1 (which reranks
repair-v1's list), are unchanged. CI's dev workflow runs repair-v1, model-v1 and rules-v1, so this batch changes no
CI dev row.

## Order and reach (honest limit)

`TEMPLATES_V2` = idioms, v1 templates, const-value, then the SStuB classes (swap-statements, swap-args, swap-operands,
change-identifier). Candidates are sorted by template first, so every earlier v2 candidate and its order are
unchanged (m176 asserts no earlier template's candidate comes after an SStuB one; MAX_CANDIDATES = 60 still caps the
queue). The cost: an SStuB candidate is only tried after every earlier candidate of the located sites, so with the
attempt budget (at most MAX_ATTEMPTS = 20) it is reached only on small or tightly located sites. That is stated, not
fixed: interleaving would change the box behavior of the existing classes and needs its own measurement.

## Soundness note

Every SStuB candidate is built from text already in the file: a swap moves two existing spans and keeps whatever lies
between them; a substitution writes an existing binding name over another. So a candidate never adds a word, a
dangerous word, an import, a top-level statement or a write target rooted outside the file. Independently of that
argument, the loop's M175 gate (`editScopeProblem`, before the team's tests go back and before anything runs)
re-classifies every candidate; m176 checks that every SStuB candidate on every admit fixture is `in-body` under that
gate, and the end-to-end case checks the real loop's PASS row records `editScope: "in-body"`. Residual: like M175's,
this is a structural bound, not a proof about behavior; a rearrangement of existing words can still change behavior
in any way those words allow, which is the point of a repair, and the team's tests (graded by the M173 report
protocol) decide. No validation was loosened: the gate, its policy table, its pinned word lists and the row checks
are unchanged.

## Tests

- Admits (two unrelated shapes per class, each fixed through the in-process oracle): swap-statements on a class method
  and on a function with an object parameter; swap-args on a same-file callee and on a literal/reference pair;
  swap-operands on arithmetic and on a comparison; change-identifier on a parameter and on a function-top local.
- A refused near miss for every guard (the refused shape beside an admitted one in the same file).
- Gate check: every SStuB candidate on the admit fixtures is `in-body` under the M175 gate.
- End to end (candidate uid `M176_CAND`, no fallback; without one the case asserts the `CAND_UID_*` refusal): the
  real loop with repair-v2 fixes a backwards subtraction on the second attempt (arithmetic first, then swap-operands),
  a valid PASS row with `editScope: "in-body"`.
- Mutation (`m176-mutation.test.ts`): each of the 13 `m176-guard` lines deleted makes at least one pure case fail an
  assertion (no crash, no hang); plus a control and a tag-coverage test.
- Pins updated: m168 and m173 assert the new `TEMPLATES_V2` order.

## Claims

No dev or held-out gain is claimed. Box runs never count. The batch adds edit classes; whether they move any
creditable count is for a CI run that uses repair-v2, which does not exist today.
