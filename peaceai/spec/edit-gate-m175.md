# M175: the general L0 edit-scope gate

Spec for the general edit-scope gate in `peaceai/lib/loop.ts` (`editScopeProblem`, `editClass`,
`editSourceClass`, `editScopeOf`, `EDIT_SCOPE_POLICY`, `EDIT_DANGEROUS`) and the row vocabulary in
`peaceai/lib/looprow.ts` (`EDIT_SCOPE`, `EDIT_SCOPE_CLASSES`, the optional `editScope` field).
Tests: `m175-cases.ts` (replayed by `m175-edit-gate.test.ts` and `m175-mutation.test.ts`),
`m175-policy.test.ts`, `m175-forge.test.ts`.

## Why

Auditor's binding condition (Nov 2): on vitest or jest, in-process candidate code can patch `expect`,
the runner's assertions, or the module system and make a real-looking pass. That is out of reach only
while a repair edit stays a bounded change to an existing source file. Before PeaceAI's edit scope
widens (multi-token edits, new imports or exports, edits to a test or config file), a general L0
edit-token gate has to land, with a forging test, or any PASS from a wider edit does not count.

M174 (batch 13) added an L0 gate for the load-repair mode only: `loadEditProblem` refuses any
load-repair proposal that is not one or more inserted `export ` keywords in an existing source file
(`loadEditShape`, `LOAD_EDIT_INFRA`). M175 generalises that one gate to EVERY proposer (repair-v1,
repair-v2 including the M174 load-export, model-v1) and EVERY attempt, as a single mechanism: the
normal-mode gate reuses `loadEditShape` (the `export ` shape) and `LOAD_EDIT_INFRA` (the infra file
class), so there is one source of truth, not a parallel framework. The load-repair path still calls
`loadEditProblem` (-> `PROPOSER_FAILED`, unchanged, so the M174 tests and guards are untouched); the
normal path calls `editScopeProblem` (-> `EDIT_SCOPE`, a new filtered code).

## Where it runs

In `runLoopTask`, for each attempt, on the copy reset to the pinned commit, right after the M174 load
gate and BEFORE the team's tests go back and before anything runs (`// m175-guard:scope-gate`). An
edit to a path outside the copy or to a team test file is left to `applyEdits`
(`EDIT_OUTSIDE_COPY` / `TEAM_TEST_EDIT`, so the M146 asserts are unchanged): `editScopeProblem`'s
`skip(path)` is true for exactly those. Every other edit must fall in a class the pinned policy admits
or the attempt is refused (`EDIT_SCOPE`) with no run.

## The classification (three axes)

`editClass(path, content, original)` returns an allowed class (`EDIT_SCOPE_CLASSES`) or a refusal reason.

1. File class, by path:
   - `test-file` — a test or generated file (`isTestPath` / `isGeneratedPath`), when it is not a team
     test (a team test is `applyEdits`'s `TEAM_TEST_EDIT`);
   - `lockfile` — `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`;
   - `runner-infra` — a runner config or setup file (`LOAD_EDIT_INFRA`: `*.config.[cm]?tsx?`,
     `vitest|vite|jest|mocha|ava|karma *.[cm]?tsx?`, `*setup*.[cm]?tsx?`);
   - `config` — anything that is not a TypeScript source (`.json`, `.yml`, `.js`, `.d.ts`,
     `package.json`, `tsconfig*.json`, a `jest.config.js`, ...);
   - `new-file` — a source path that does not exist at the pinned commit.
   All five are refusal reasons: today's proposers never produce them.

2. Top-level statement shape of a source edit (`editSourceClass`, only when both the original and the
   candidate parse; an edit whose candidate does not parse is `in-body` and admitted, because it cannot
   run or patch anything and fails safely at run time, which m173's broken-return case relies on):
   - `export-keyword` — exactly the M174 `export `-insertion shape (`loadEditShape`);
   - `top-level-count` — the number of top-level statements changed (a new import/export/statement);
   - `top-level-kind` — a top-level statement's `SyntaxKind` changed (gaining an `export` modifier does
     not change the kind, so it is allowed);
   - `adds-import` — a top-level `import` / `import =` / `export ... from` was added with no change of
     count or kind (an export-from re-export swapped in for a bare `export {}`).
   `top-level-count`, `top-level-kind` and `adds-import` are refusal reasons.

3. Identifier tokens (`EDIT_DANGEROUS`): a candidate that uses `globalThis`, `global`, `eval`,
   `Function`, `require`, `Reflect`, `Proxy`, `__proto__`, `expect`, `assert`, `vi` or `jest` more
   often than the original (a cheap word count over the whole text, comments and strings included: it
   can only make the gate stricter) is a multi-token global / module redefine (`dangerous:<token>`),
   a refusal reason.

An edit that is none of the above is `in-body`.

## The pinned policy

`EDIT_SCOPE_POLICY` (frozen, pinned by `m175-policy.test.ts`, m168-style):
- `edit` (every normal attempt): `export-keyword`, `in-body`;
- `load` (the M174 load-repair special case): `export-keyword`.
Widening it later (to admit a wider class once a proposer and a forging test for it land) is a reviewed
one-line change here that the pin test forces a reviewer to see.

## The row

A normal-mode PASS records the (widest, so `in-body` wins over `export-keyword`) scope class it ran
under in the optional `editScope` field (`EDIT_SCOPE_CLASSES`). It is optional, so rows written before
M175 and load-repair PASS rows (which never set it) still validate. `loopRowProblem` rejects an
`editScope` that is not a known class, or on a non-PASS row, or alongside `baselineLoad` (load mode).
So if the policy widens later and a wider-scope edit passes, its row carries a class not in today's set
and a reviewer (or a later audit rule) can see the PASS is from a wider scope and is not creditable
unless the policy that admitted it is the declared one.

## Soundness note

The gate is sound for its one job: nothing wider than `{export-keyword, in-body}` reaches a run, so the
in-process forge routes Auditor named cannot be taken by a proposer under this policy.

- Adding an import that patches `expect` (or any import) is a new top-level `import` statement, so the
  top-level statement count changes (`top-level-count`); an `export ... from` re-export swapped in with
  no count change is `adds-import`; a dynamic `require(...)`/`import(...)` added in a body raises the
  `require` word count (`dangerous:require`) and `eval`/`Function` are likewise caught. Refused.
- Editing a test file is `test-file` (a team test is `TEAM_TEST_EDIT` before the gate). Refused.
- Editing a runner config or setup file is `runner-infra`; `package.json` scripts, `tsconfig.json`, a
  `jest.config.js` are `config`; a lockfile is `lockfile`. Refused.
- A multi-token source edit that redefines a global is a new or changed top-level statement
  (`top-level-count` / `top-level-kind`) and/or raises a dangerous token's count
  (`dangerous:globalThis`, `dangerous:expect`, ...). Refused.

The gate is deliberately NOT a lexical token count. The repair templates (null-guard insertion,
nullish expansion, negated condition, the idiom and const templates, a combined two-span candidate)
produce multi-token in-body changes that are legitimate and must still run; a naive one-token rule
would refuse them and break the loop suite. The enforced scope is structural (the top-level statement
list is preserved, no new import, no new dangerous token), with the lexical `export `-shape reused from
M174 for the one keyword-insertion case. An unparsable candidate is admitted because it cannot execute;
it fails safely at run time rather than being refused, which keeps m173's broken-return case and m164's
trailing-comment case working.

The gate adds a refusal; it never admits anything that was refused before (it only narrows what runs),
so the neverzone sets (m59 / m119 / m132), the m96 import closure (no new lib file is added) and
`PROTECTED_DIGEST` (computed over the protected pattern names, not file contents) are unchanged.

## Notes added in implementation (batch 14)

- A runner config file (vitest.config.*, jest.config.*, .mocharc.*, etc.) matches the M174 `LOAD_EDIT_INFRA`
  regex first, so `editClass` returns `runner-infra`, not `config`; both are outside the pinned policy and are
  refused. Non-runner config (package.json, tsconfig, *.json / *.yml) returns `config`.
- `editSourceExt` admits TypeScript only (`.ts` / `.mts` / `.cts` / `.tsx`, never `.d.ts`). Every PeaceAI fixture
  and team repo under repair is TypeScript, so a `.js` edit is outside the source class current proposers produce
  and is refused as `config`. This is strictly narrower than the TS source path; it is never a loosening.
