# M190: failing test names for vitest and jest runs

Spec for the M190 changes in `peaceai/lib/loopdeps.ts` (the shim's `failedNames` and the jest / vitest reporters'
`failedNames` field), `peaceai/lib/selfpropose.ts` (`RunSink`, the optional sink of `guardedRun` / `isolatedRun`) and
`peaceai/lib/loop.ts` (`shimFailedNames`, `jsonFailing`, and their use in `runTests`). Tests: `m190-cases.ts` (run by
`m190-names.test.ts`; the pure cases are replayed against mutants of all three files by `m190-mutation.test.ts`).

## Why

The loop runs node:test per named test, so its feedback carries the failing test names. vitest and jest run whole
files through the shim, which printed counts only, so every attempt's `failing` was `[]`. The repair proposer's
evidence rules that compare names (M178 siteEvidence, M179 anchorFor) were vacuous for those runners: an edit that
swapped which tests fail looked exactly like an edit the tests never noticed. The practice-set probe showed both
remaining ATTEMPT_LIMIT tasks run under vitest with `failing: []` on all 20 attempts. Ranking used failure categories
and per-attempt reasons only; no task fix or reference diff was opened.

## The mechanism

1. Reporters. The jest and vitest reporters (already nonce-checked on fd 3) now build the failed test names
   themselves from the runner's results: jest `[...ancestorTitles, title]`, vitest the suite path (file tasks add no
   segment), joined by " > ". Any `failedNames` field in other report text is ignored: the shim takes only the field
   the reporter wrote under the nonce.
2. Shim. `done()` always prints `# failed-names <hex of JSON | ->` immediately before `# pass` / `# fail`. Names are
   printed only when the run is real (`synth === 0`), the shim added no failure of its own (`fail` still equals the
   runner's own failed count), the list has exactly one name per failed test and at most 100 names; each is cut to
   200 characters with non-printable characters replaced by `?`. Otherwise `-`.
3. Reader (`shimFailedNames`). The names line must be the line directly before the LAST `# pass` line, valid hex,
   JSON array of at most 100 strings of at most 200 printable characters. Anything else is `null`.
4. Use (`jsonFailing`). In `runTests`, only for vitest / jest under isolation: names are dropped (`[]`) on a synthetic
   result, leftovers, tampering, or when their count differs from the run's fail count. Otherwise sorted names.
5. Localisation is unchanged: `prepare` still receives `failing: []` for JSON runners (names locate only node:test
   tests); the baseline names go to the proposer separately as `baseFailing`.

## Soundness note

- Names cannot be forged by code under test. The shim writes its own names line last, right before the counts it
  already owns; the reader requires that adjacency on the LAST `# pass` line, so a printed fake line earlier in stdout
  is never read. Names come only from the nonce-checked reporter channel.
- Names never widen what counts as a pass. They feed only proposer ordering evidence; pass/fail is still the counts.
- Names never reach public rows (fixed keys, filtered codes only) nor RawRun / stage-2 records; they live in the
  in-process feedback.
- Any doubt (synthetic result, mismatch, cap, tamper, leftovers) gives `[]`, which is exactly the pre-M190 behavior.
- mocha and ava are unchanged (`-`).
- Residual: an attempt whose names are unknown while the baseline names are known makes the M179 an-names check as
  vacuous as before M190 (no new risk).

## Guards (each a single line tagged `// m190-guard:<id>`, each with a refused near miss and a mutation test)

shim-real, shim-count, shim-printable, jest-names, vitest-names (loopdeps.ts); pn-adjacent, pn-cap, pn-shape,
jf-synth, jf-clean, jf-count (loop.ts).
