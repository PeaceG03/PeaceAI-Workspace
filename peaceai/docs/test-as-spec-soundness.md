# Test-as-spec and issue understanding

`verified_strict` means the candidate symbol and the fix symbol agreed on the recorded test's arguments and on at least one mutated input. The comparison includes the return value, the arguments after the call, and, when both sides throw, the error name and message. `NaN` matches `NaN`. `-0` does not match `0`, and `Infinity` does not match `-Infinity`.

It does not prove every input, and it does not prove the source text matches the fix. A result that is a function, a class instance, or another opaque value is `diff_unavailable`, not strict. A module that cannot be loaded on its own is `diff_unavailable`. A body that matches only the test's own arguments is `verified_test_only`.

The mutation set is finite and generic, capped at 50 inputs. A bug outside those inputs can still be called strict. The probe line carries a per-run nonce, so a hardcoded sentinel printed by the candidate is ignored. A candidate that reads the probe's spec file can still see that nonce. The solver tree does not contain the fix commit or the clone URL. The grader loads the fix in a separate tree after the solver returns.

Issue and commit wording is read inside Job A. `NOT_SUPPORTED`, `NO_FAMILY`, and `PARTIAL_PLAN` can now become a mapped plan and then candidates. Those candidates are still refused unless Job B's gate passes.

The sindresorhus/is guards copied into the tests exercise only this grader (`gradeBehavior`). They do not show that the solver generalizes.
