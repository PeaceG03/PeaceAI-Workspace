# Test-line grammar: Date arguments (M35, proposal, off until approved)

Spec `public-test-case-dateargs-v1` is `public-test-case-v1` plus `args: "date-literal"`. It only runs for a task
where at least one check passes a `new Date("...")` argument. Otherwise the plain specs cover the task.

Allowed, in **call arguments only**, either directly or inside array and object literals:
- `new Date("<text>")` with exactly one plain string literal;
- the literal is at most 32 characters, uses only `[0-9A-Za-z:.+- ]` and has no escapes (the raw text equals the value);
- no template, no number or multi-argument `Date(...)`, no type arguments, and no other constructor.

Not allowed, and refused as before: a Date as an index, as a `new X(...)` argument, or as the expected value; any
other identifier; and object keys `__proto__`, `constructor` or `prototype` (objectArgsReason). Everything else is
unchanged: the checks `equal`, `deepEqual`, `throws` and `rejects`, the new-file placement, 40 lines, and
fail-before/pass-after grading.

Evidence (`peaceai/rules/evidence/public-test-case-dateargs-v1.json`): 11 distinct fitting assertion lines from
licensed external code. 8 are in d3/d3-array (ISC) and 3 in apollographql/apollo-client (MIT), each tagged with repo,
commit, license and file sha256 from the M36 provenance manifest. Peace's public tests have 25 Date-argument lines,
but only 1 passes the authorship filter and it does not fit, so 0 are counted. The examples come from only 2
repositories.

Approval: bulk-approval proposal. It is not in `approved.json`, so it stays off until Peace approves it.
