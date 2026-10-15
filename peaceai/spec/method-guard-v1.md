# METHOD_GUARD v1 (M58 proposal; a NEW kind, OFF by default, not in approved.json)

ADD_THROW_GUARD v1 and its function-top placement are unchanged. METHOD_GUARD adds ONE guard as the FIRST statement
of a uniquely named exported function (engine: `peaceai/lib/method-guard.ts`), refused unless all hold:

1. **Form.** One-line `if (cond) throw new Error("CODE");` or block `if (cond) {` / `throw new Error("CODE");` / `}`;
   CODE is `[A-Z][A-Z0-9_]{2,63}` and new to the file; the quote style follows the file's existing errors.
2. **Condition.** v1's grammar (parameters, literals, property reads, comparisons, `!`, `&&`/`||`, `typeof`, the pure
   built-ins `Number.is*` and `Array.isArray`) plus at least one method call on a parameter-rooted receiver (a
   parameter or a property chain rooted at one; never optional chaining, computed access or a call result):
   `X.startsWith(a)`, `X.endsWith(a)`, `X.includes(a)`, `X.has(a)` with one literal or parameter argument;
   `X.getTime()`, `X.trim()` with no argument; and (from #149) `/re/.test(X)` where `/re/` is a regex literal of at
   most 80 characters with flags `i`/`u` only, no backreferences, lookarounds, named groups or quantified groups.
   At most 160 characters.
3. **Placement.** First statement of the function body (ahead of any early return), in a non-test `.ts`/`.mts` file;
   the file parses after the edit and the inserted statement is recognised as the guard.
4. **Behavior proof and off by default** as v1: the new test must pass with the guard and fail without it;
   `PEACEAI_METHOD_GUARD=true` only; not in RULE_KINDS until a separate, Auditor-reviewed wiring PR; approval is
   Peace's. Builder never posts /approve-rule.

Evidence (`peaceai/rules/proposals/m58-method-guard-evidence.json`), counted the way M47 counted function-top: an AST
scan of the pinned external corpus (`ext-manifest.jsonl`, sha256 verified, set C excluded, test/fixture/playground
and built-output paths skipped) for functions whose first statement is such a guard: 9 in 5 repos (all block form),
at or above the bar of 5. Note: as in v1, a call or property read on a caller-supplied object can run caller code.
