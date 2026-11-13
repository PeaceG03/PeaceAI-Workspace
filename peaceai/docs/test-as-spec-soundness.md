# Test-as-spec and issue understanding

`verified_strict` means the candidate symbol and the fix symbol agreed on the recorded test's arguments and on at least one mutated input. The comparison includes the return value, the arguments after the call, and, when both sides throw, the error name and message. `NaN` matches `NaN`. `-0` does not match `0`, and `Infinity` does not match `-Infinity`.

It does not prove every input, and it does not prove the source text matches the fix. A result that is a function, a class instance, or another opaque value is `diff_unavailable`, not strict. A module that cannot be loaded on its own is `diff_unavailable`. A body that matches only the test's own arguments is `verified_test_only`.

The mutation set is finite and generic, capped at 50 inputs. A bug outside those inputs can still be called strict. The probe line carries a per-run nonce, so a hardcoded sentinel printed by the candidate is ignored. A candidate that reads the probe's spec file can still see that nonce. The solver tree does not contain the fix commit or the clone URL. The grader loads the fix in a separate tree after the solver returns.

Issue and commit wording is read inside Job A. `NOT_SUPPORTED`, `NO_FAMILY`, and `PARTIAL_PLAN` can now become a mapped plan and then candidates. Those candidates are still refused unless Job B's gate passes.

The sindresorhus/is guards copied into the tests exercise only this grader (`gradeBehavior`). They do not show that the solver generalizes.

An integer comparison scaffold may treat `a > n` and `a >= n+1` as one predicate, and `a < n` and `a <= n-1` as one predicate, only when every example argument is an integer and both bounds are safe integers. `n+1` and `n-1` are not used once they leave that range, including at `Number.MAX_SAFE_INTEGER`. Equality is not folded into a greater-than class. Strict credit is grader-guarded: when every numeric example is an integer, the grader also tries non-integer mutations (`x±0.5`, `x±0.25`, and `0.5`). `a > 0` is therefore not strict against `a >= 1` or against `a >= 0.5`. The scaffold collapse does not by itself earn strict credit.
