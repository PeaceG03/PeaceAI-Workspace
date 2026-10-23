# Refile S1-S3 (#486-#488) as behavior-only: skill gap, NOT filed

Peace OK'd the refile on 2026-10-22 (6:28 PM MDT). Auditor failed #486-#488 on credit: the old bodies spelled out the
implementation and PeaceAI copied it. The drafts here (S1.md, S2.md, S3.md, made by mk.py, which lints them for code
operators, backslash-u escapes and control characters) state only purpose, name/signature/module and input-to-output
examples. They are NOT filed: they go to Auditor first, and no approved rule can take them today (below).

## Dry run (Job A only, counts only)
Workspace main 1e8448a (30 approved rules), PeaceSTOCKS 0ab37c8, kernel bundle /workspace/stress/kernel.cjs, core learned rules loaded.

| Task | NL parse | Learned rules | Kernel synthesizer | Candidates |
|---|---|---|---|---|
| S1 draft | unsure NOT_SUPPORTED | not reached | not reached | 0 |
| S2 draft | unsure NOT_SUPPORTED | not reached | not reached | 0 |
| S3 draft | unsure NO_FAMILY | not reached | not reached | 0 |
| S1 old body (control) | canonical | public-add-function-v2 matched | - | 1 |
| S1-S3, NL gate forced off (probe) | off | all task_unparsed | 2/14/12 calls, none materialized | 0 |
| S1-S3 with "add a helper" prefix (probe) | canonical | all task_unparsed | 2/14/12 calls, none materialized | 0 |

So the refusal is not a wording problem: every path refuses.

## Why (the gap)
Every approved code-writing rule takes the implementation from the issue text and only places it:
- ADD_FUNCTION (public-add-function-v1/v2): the trigger requires `returning <expr>`; the expression is copied in as the body.
- COMPLEX/LOOP/WHILE/DATE function rules: the trigger requires `with body:`; the issue supplies the block.
- REPLACE_EXPRESSION, throw/method guards: the issue supplies the new expression or the condition.
- ENV_FIX writes its own code, but only for one fixed shape (strict env flag/integer).
- The test rules (ADD_TEST_CASE, TEST_EXISTING) turn example bullets into tests, but they test existing code and write no implementation.
- The NL parser maps plain wording onto those same triggers only and refuses anything that is not one of them.
- The kernel synthesizer's edit families are fixed transformations; none builds a function body from examples.

Missing skill: DERIVE_FROM_BEHAVIOR (working name). Given a new pure function's name, typed signature (string/number/boolean),
module and a list of input-to-output examples plus plain-language behavior, PeaceAI writes the body itself and the new test
from the examples, graded self-fail-before-pass-after plus stub, like ADD_FUNCTION. What it needs, per task:
- S1 (number to boolean): find a membership rule over integer ranges/values (one value, one closed range) from labelled examples.
- S2 (two numbers to number): find an arithmetic formula from examples (product, power/square of a shifted parameter) plus a cap
  (minimum with a constant), and check it against every example.
- S3 (two strings to string): build a string from a fixed prefix and the parameters, with a branch on an empty parameter.
Approach that keeps the credit honest: a bounded, enumerative search over a small expression grammar (constants taken only from
the examples, parameters, comparisons, ranges, arithmetic, min/max, concatenation, one conditional on empty/zero), accepting the
smallest expression that matches every example and refusing on zero or more than one distinct smallest fit (ambiguous). Mined from
public commits like the other rules, Auditor-reviewed, and approved by Peace via /approve-rule before any of these are refiled.
