# Fault localization v1 (M221, batch 57)

Status: EXPERIMENTAL, NOT DEFAULT, NOT FOR CREDIT.
Code: `peaceai/lib/fault-localize.ts`. Proposer: `fault-localize-v1`.
Closes the M220 gap where repair-v2 returned `NO_EDIT` because locate/templates
missed SAFE_HELPERS fault sites. This module is **general**: it does not special-case
M220 or held-out shape ids.

## Approach

1. Tokenize the task request and failing-test names.
2. Locate `export function` declarations in `SAFE_HELPERS` whose names match those tokens.
3. Rank / mutate statements inside those function bodies with a **closed catalog**:
   - operator swap (compare / arithmetic)
   - argument / operand swap (binary and two-param usage swap)
   - boundary (+/- 1 on integer literals)
   - branch condition negation
   - missing return of a trailing computed value
   - string method substitution (`toUpperCase` / `toLowerCase` / `trim*`)
   - single-char string literal to `""`
4. Propose one candidate edit per attempt; the loop verifies with the team tests.

## Guards (m221-guard)

`safe-only`, `in-body`, `locate`, `empty`.

## Held-out

A sealed set under `peaceai/self-tests/practice/heldout/` was written **before** this
implementation. Eval loads it only at report time. Compare held-out pass rate to the
dev (M220) set; say plainly if held-out is much lower.
