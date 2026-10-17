# M80 TEST_CASE_EXISTING: characterization tests for existing code (v1, proposal-off-wired)

Peace approved building this skill (2026-10-17) from the batch-v4 gap note in `builder-log/gaps.md` ("TEST_CASE for
existing code (fix-free grading)"). It is its own learned rule, off until Peace posts `/approve-rule` for its spec hash;
Builder never approves. The dev path needs `PEACEAI_TEST_EXISTING` to be exactly `"true"`; Job A admits it only through
the hash-pinned approved list.

| rule | kind | engine | trigger |
|---|---|---|---|
| public-test-case-existing-v1 | TEST_EXISTING (shape TEST_CASE_EXISTING) | `peaceai/lib/learned-test-existing.ts` | `add a characterization test for NAME in src/FILE.ts[: TITLE]` |

## Why
ADD_TEST_CASE (public-test-case-v1) needs `Fix: <sha>`: it grades a test by reverting a fix commit, so it can only pin
behavior a commit just changed. Most untested PeaceSTOCKS helpers were never "fixed"; they need a test of what they do
today. This kind grades without a fix: the test must pass on today's code and fail when the function's body is a stub.

## Task grammar
```
add a characterization test for isTenMinRangeOutageError in src/tenmin-range-reply-dust.ts: outage message prefixes
- isTenMinRangeOutageError("MASSIVE_HTTP_503 upstream") is true
- isTenMinRangeOutageError("MASSIVE_NETWORK reset") is true
- isTenMinRangeOutageError("MASSIVE_HTTP_404") is false
```
Bullets are ADD_TEST_CASE's: `- CALL is LITERAL`, `- CALL equals [..]/{..}`, `- CALL throws CODE` (no `rejects with`;
1 to 8 bullets). Every check must start from NAME and call it with literal arguments (`test_check_refused` otherwise).
A `Fix:` line makes the task ADD_TEST_CASE's, so it is unparsed here (`task_unparsed`).

## The candidate
Exactly one NEW file `<dir>/<stem>.<slug(TITLE or "NAME characterization")>-<id7>.test.ts` next to the module, where
id7 is the first 7 hex of sha256("test-existing", file, NAME, bullets) (stable; never a real commit). It imports
`node:assert/strict` (default), `node:test` (default) and only NAME from the module (`.ts` suffix when the target's
tests use it), and holds one `test(TITLE, () => { ... })` of at most `maxLines` (40) lines. No source file is touched;
an existing path is refused (`new_test_path_exists` on disk, `test_refused` among the sources). generate.ts accepts
it only as one create of a test-pattern, source-pattern path absent from the base, with `selfGrade`, no `extra` and no
fix sha.

## Target analysis (named refusals)
Checked in this order on the module's current text:
1. plain path (`path_not_plain`); PeaceAI protected paths, test files and `.d.ts` -> `self_protected_path`;
   the target's own denied paths -> `denied_path`; a missing or test module -> `target_file_not_found`.
2. one top-level `function NAME` with a body (`test_target_not_found`; overloads or a const/arrow -> `test_target_signature`),
   exported by name, not default (`test_target_not_exported`).
3. `async`, generators, `Promise`/`AsyncIterable` returns -> `test_target_async`.
4. Signature: 0 to 4 plain identifier parameters, no rest/optional/default, every parameter and the return annotated
   `string | number | boolean`, optionally `readonly` and `[]` (each has a stub default) -> `test_target_signature`.
5. Purity, transitively: the body and every same-module function it reaches (at most 12 functions, 24 consts, else
   `test_target_too_large`), and every module `const` initializer it reads. A free name must be a local, a followed
   module function or const, an enum, or an allow-listed global (Number, String, Boolean, Array, Object.keys/values/
   entries/fromEntries/is/hasOwn, JSON, Math except random, Error types, RegExp, Map, Set, Date, BigInt, parseInt,
   parseFloat, isNaN, isFinite, encode/decodeURIComponent). Reasons, reported in this priority:
   - `test_target_async`: `await`, `yield`, `for await`, async or generator closures.
   - `test_target_io`: process, console, require, module, globalThis/global/window/document, fetch, XHR/WebSocket,
     timers, crypto, performance, storage, Deno/Bun, Worker, Atomics/SharedArrayBuffer, WebAssembly; a value import
     from a Node builtin (`node:*`, fs, path, os, child_process, ...); `import.meta`; dynamic `import()`.
   - `test_target_date_local`: `Date.now()`, `new Date()` with no argument, local-time reads (getHours/getDay/...,
     toLocale*, toDateString, toTimeString, toUTCString, toJSON, Date.parse, `new Date(y, m, ...)`) as in M74, and `Intl`.
   - `test_target_impure`: any value import from another module (repo or package); module `let`/`var`, classes,
     namespaces; a module const that is mutated anywhere in the module or whose initializer is a stateful (`g`/`y`)
     regex; assignment, `++`/`--`, `delete` or a mutating method (push, pop, shift, unshift, splice, sort, reverse,
     fill, copyWithin, set, add, delete, clear) on anything but a value created inside the function; Date setters;
     `this`, `super`, `arguments`, `eval`, `Function`, `with`, `Math.random`, other `Object.*`, `new` of anything but
     Error types/Map/Set/Array/RegExp/Date, tagged templates other than `String.raw`; any other global.
The analysis is conservative: a refused function may be pure, never the reverse within this grammar.

## Grading (Job B, `gradeExisting` in test-candidates.ts)
- The diff must be exactly one new test file; its only relative import is the module (in the base, in source scope,
  regular in-tree file); the test passes `gradedTestSourceProblem` (runner, strict assert and the module only; no
  files, env, processes, function reads/stringification, stub names) and imports and calls exactly one name; the target
  analysis is re-run on the real tree. Otherwise `not-test-only`.
- Never unconfined: Node < 22 is `not-confined`. Reads are narrowed to the test, the module, the module's relative
  import closure (`moduleReadClosure`: every relative import/re-export, type-only included, must resolve to exactly one
  regular in-tree `.ts` file; literal `import("./x")` calls and types join it; a non-literal dynamic import, require or
  import-equals fails closed: `module-imports-repo-files`), the `package.json` of each directory up to the tree root
  (module-type lookups) and node_modules.
- Pass 2 (today's code) plus two more confined runs must all pass (`real-not-stable` otherwise).
- Then NAME's body becomes the write-only type-default stub (`stubAll`, M23 round 3: no code, writes a note to the
  parent-only channel, returns "" / 0 / false / []). The failure is credited only when the parent saw the stub run and
  every failing test failed with ERR_ASSERTION (`stubFailureCredited`); else `stub-not-reached`. The module is
  restored in a `finally`.
- Verdict: `gradingVerdict(afterFix, passesWithStub, stubFails)` with `fixSha` = the task base and `stubbed: [NAME]`:
  COUNTS only for pass-today AND fail-with-stub; a test the stub also satisfies is `REJECTED_PASSES_BOTH`.
- No M7 repair; the same scope, leak, core-text and protected-digest gates as every candidate.

## Evidence
`peaceai/rules/proposals/m80-test-case-existing-evidence.json`: commits from example-only permissive repos (not in
ext-manifest 8458eac6 or ext-corpus.json, file sha checked) that change only test files and add calls to an existing
exported function of a sibling module that the analysis above accepts at the parent commit. The module text at the
parent is pinned as a fixture under `peaceai/test/fixtures/m80/`; the tests replay the analysis on every fixture.
Peace's public repos were checked first: no test-only commit there (every PeaceSTOCKS test landed with its source
change), and they are in the corpus manifest, so none would count.

## Live proofs (after approval, drafted in notes/batch-v4)
A: a real landing on an untested PeaceSTOCKS helper (e.g. isTenMinRangeOutageError). B: a refusal with its named reason.
