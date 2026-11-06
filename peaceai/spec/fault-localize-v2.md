# Fault localization v2 ranking + swapped operands (M222, batch 58)

Status: EXPERIMENTAL, NOT DEFAULT, NOT FOR CREDIT.
Extends `peaceai/lib/fault-localize.ts` (proposer still `fault-localize-v1`).

## Ranking (without raising MAX_ATTEMPTS)

1. Mine expected numbers/strings from the request and from `assert.equal` /
   `assert.strictEqual` second arguments in **helper-adjacent** tests only
   (`self-tests/helpers/**`, practice/heldout) - never repo-wide asserts (m222-guard:ev-scope).
2. Score each mutant by value distance to those expecteds (exact match strongly preferred).
3. Dedupe mutants that produce identical file contents (keep best score).
4. Sort ascending by score so the likely fix is attempted early (loop cap stays 20).

Practice seeding now places the failing self-test on the **broken commit** as well as
the reference merge, so expected literals are visible to the proposer via `files`.

## Swapped-operand operator (general)

- Binary expressions: swap left/right operands for any operator when texts differ (`a-b` vs `b-a`, concat, etc.).
- Left-associative `A + lit + B` chains rewrite to `B + lit + A`.
- Template literals with two `${}` spans: swap expressions; also try moving a leading
  letter-run from the first literal onto the second (covers `${word}s ${count}` -> `${count} ${word}s`).
- Two-param identifier usage swap skips `param === <number>` predicates.
- Multi-template: when a function has >=2 two-span templates, apply the same expr-swap
  (and letter-move) to all of them in one mutant (ternary both-branches).
- Drop additive drift: `(expr + 1|2)` / `(expr - 1|2)` -> `expr` (m222-guard:drop-add).

## Ellipsis / string-idiom gap

Still named, not closed here: turning `slice(...).toUpperCase()` into an ellipsis-truncate
idiom needs an idiom catalog beyond the closed string-method list.

## Guards (m222-guard)

`rank-num`, `rank-str`, `rank-dist`, `rank-drop`, `rank-len`, `dedupe`, `sort`, `ev-scope`, `ev-focus`, `drop-add`, `multi-tpl`, `scope-filter`.

## Held-out set 2

Sealed under `peaceai/self-tests/practice/heldout2/` before this work. Eval only at report time.
