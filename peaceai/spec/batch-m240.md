# Batch: spec-gated depth cap, page cap, and strict flag

No strict credit is claimed. `SPEC_ATTEMPT_CAP` stays `min(MAX_ATTEMPTS, MAX_CANDIDATES)`, which is 20. `targets.json`, `gate.ts`, and `scope.ts` are unchanged. Held-out rows were not read.

A candidate is emitted only when the request text demands it. A file is edited only when its stem is written in that text and the source has the unbounded shape. No demand, no edit.

## Pre-registered rows

These builder-log dev rows are the ones this change is expected to hand to Job A as a new diff (a gate pass is a diff the production gate accepts, not a relabel):

- 217, depth cap. `depth < 512` and fail-closed, on the ancestor walk.
- 220, page cap. `1000 pages` and the named `*_CAP` codes, on the cursor loops whose file stem shares a code token.
- 218 and 219, strict flag. One env name, the `""/0/1` table, and "no longer", on reads that are exactly `=== "1"` or `!== "1"`.

Row 235 and the unjs/defu `GATE_NO_TARGET` rows are out of scope. The seeded rows `cb4ee0e` and `11ba0221` are not claimed. Rows whose issue is already a learned-rule header stay on that path.

## depth-cap

A single `while (true)` whose body calls `dirname` or reads `.parent`, and that already throws `new Error(param)` for one of its function's parameters, becomes a counted walk: `walkDepth < N`, then the same `throw new Error(param)`. `N` is the one `depth < N` in the spec.

Soundness: two such loops, a loop that does not walk, a loop that throws a fresh string, or a function that already names `walkDepth`, is not edited. The bound is not invented. The error code is the parameter the function already throws, not a new word from the row.

Evidence, none of it a practice-set or held-out repo:

- Refused: `paulmillr/readdirp` `index.ts` at `4.1.2` (MIT). The walk is `while (!this.destroyed && batch > 0)` and `depth <= this._maxDepth`. It is not `while (true)`.
- Refused: `isaacs/node-glob` `src/processor.ts` at `v11.0.0` (ISC). The loop condition is the pattern rest, not `true`.
- Admitted: a labeled synthetic `climb` whose spec says `depth < 4` and fail-closed. The test fails before the cap and passes after it. A cap of 3, or a missing final throw, fails that test.

## page-cap

A `while (name)` whose body assigns `name`, or a `do ... while (name)` whose next statement is a return and whose body has one `if (...) break`, is counted to `N` and then throws the one error code whose tokens match the file stem. A counter already compared with `>` / `>=` to something other than `0` or `1` is left alone. `N` is the one `N pages` in the spec.

Soundness: a loop that does not assign its condition, a `do` without exactly one bare break, two codes that match the same file, and a code that matches no stem are not edited. `pagesFetched > 0` is not a cap. `page >= LIMIT` is.

Evidence:

- Refused: `honojs/hono` `src/utils/url.ts` at `f6fbaf0299c48eea9e656e03e2ffe7ac755e8823` (MIT). `while (keyIndex !== -1)` is not a cursor name.
- Refused: `@octokit/plugin-paginate-rest` `src/iterator.ts` at `v11.4.2` (MIT). The next link is an iterator, not a `while` or `do` loop.
- Admitted: a labeled synthetic `drain` whose spec says `3 pages` and `DRAIN_PAGE_CAP`. The endless cursor fails before the cap and passes after it.

## strict-flag

Every read of the one env name in a named file is `=== "1"` or `!== "1"`. Each becomes a call to one appended helper: unset, `""`, and `"0"` are false, `"1"` is true, and anything else throws `NAME_INVALID`. A truthy read, a second env name, or a helper that is already in the file is not edited.

Soundness: the helper is the same fail-closed table the approved flag rule writes. It runs only when the spec has the `""/0/1` table, the word strict, and fail-closed, throw, or "no longer". The env name and the file come from that spec plus the reads, not from a fixed list.

Evidence:

- Refused: `vitejs/vite` `packages/vite/src/node/logger.ts` at `v6.0.0` (MIT). `process.env.CI` is truthy, not `=== "1"`.
- Admitted: a labeled synthetic `modeFlag` whose spec says `MODE_FLAG` is strict `""/0/1` and that `"true"` no longer counts. The pre-image treats `"true"` as off and does not throw. The helper throws.

The repair proposer tries one of these edits first when it was given the failing test text. The attempt cap is unchanged. Job A does not fall through to an unvalidated text repair when the sentence demands one of these edits and the sources do not have the shape.
