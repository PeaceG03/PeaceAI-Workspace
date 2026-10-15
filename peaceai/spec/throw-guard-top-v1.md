# THROW_GUARD top placement v1 (`public-throw-guard-top-v1`; M47 proposal, OFF until approved)

Same rule as `public-throw-guard-v1` (one-line `if (<cond>) throw new Error("CODE");`, the v1 condition grammar,
a new test file, self-graded fail-before/pass-after) with ONE difference: the guard is inserted as the function's
FIRST statement, ahead of any leading `if (...) return` exits. v1 inserts it after them, which is why #166
(`eligibilityForBarCount`, all early returns) produced no eligible candidate.

- Task phrasing (distinct from v1, so a task never matches both): ``guard `fn` in `src/file.ts` at the top: throw CODE when COND``
  plus the v1 test bullets.
- Spec: `peaceai/rules/learned/public-throw-guard-top-v1.json`, NOT in approved.json, so admission refuses it
  (NOT_APPROVED) and it never runs. Approval is Peace's; Builder never posts /approve-rule.
- Engine change: `GUARD_VOCAB.placement` gains `function-top`; v1 (`function-entry`) is byte-for-byte unchanged in behaviour.

Evidence (`peaceai/rules/proposals/m47-guard-top-evidence.json`), AST scan of the #148 external manifest
(47,642 external licensed files read, sha256 verified): 588 functions start with a parameter guard (31 repos); 11 of
those (10 files, 7 repos) put the guard ahead of an early return, the exact shape this placement adds.
The evidence backs the guard's POSITION (first statement, ahead of early returns), not its form: the mined guards use
many conditions and error classes, while the form stays v1's (one line, `new Error("CODE")`, v1 condition grammar).

Live-proof plan (after approval only): (1) valid: retry `eligibilityForBarCount` (#166) with the "at the top" phrasing;
the candidate must put the guard first and count, full PeaceSTOCKS suite green; (2) bad: the same phrasing naming a
non-parameter in the condition must be refused with 0 candidates; (3) a v1-phrased task on the same function still
produces no eligible candidate (v1 unchanged). Actions run ids recorded on each issue.
