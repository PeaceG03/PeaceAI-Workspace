# Self-loop practice set v1 (M220, batch 56)

Status: EXPERIMENTAL, NOT DEFAULT, NOT FOR CREDIT.
Code: `peaceai/lib/self-loop-practice.ts`. CLI: `peaceai/bin/self-loop-practice.ts`.
Results: `peaceai/self-tests/practice/m220-self-loop-practice-results.json`.
Builds on M219 self-loop-live. Shapes are generic fault classes on SAFE_HELPERS; they are not
modeled on held-out or public-dev task diffs.

## Shapes (8)

| id | kind | helper | notes |
|---|---|---|---|
| wrong-literal | wrong literal | dates.ts | slice end constant wrong |
| off-by-one | off-by-one | dates.ts | +1 on minutes total |
| swapped-args | swapped args | text.ts | count/word order reversed |
| wrong-operator | wrong operator | text.ts | singular uses === 0 |
| missing-return | missing return | dates.ts | no return after validate |
| wrong-branch | wrong branch | text.ts | empty-string branch inverted |
| wrong-string-transform | wrong string transform | text.ts | uppercases instead of ellipsis |
| oracle-absent | unfixable | dates.ts | contradictory asserts; no honest helper edit |

## Grading

Each shape is seeded on a slimmed scratch copy of `--head` (never the working tree), built with
`buildSelfLoopTask`, and run through `runSelfLoopLive` with **repair-v2** (not the M219 restore
cheat). Rows and the summary report set `credit: false`.

Failures on fixable shapes name a missing skill via `missingSkillFor` (locate/templates,
attempt exhaustion, pre-edit refusal). Do not tune templates just to make the set pass.

## Guards (m220-guard)

`ids`, `unfixable`, `kinds`.
