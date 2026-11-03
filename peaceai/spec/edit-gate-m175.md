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
   candidate parse; an edit whose candidate does not parse skips this axis, which m173's broken-return
   case relies on, but still goes through the lexical axes 3 and 4 below):
   - `export-keyword` — exactly the M174 `export `-insertion shape (`loadEditShape`);
   - `top-level-count` — the number of top-level statements changed (a new import/export/statement);
   - `top-level-kind` — a top-level statement's `SyntaxKind` changed (gaining an `export` modifier does
     not change the kind, so it is allowed);
   - `adds-import` — a top-level `import` / `import =` / `export ... from` was added with no change of
     count or kind (an export-from re-export swapped in for a bare `export {}`).
   `top-level-count`, `top-level-kind` and `adds-import` are refusal reasons.

3. Dangerous words (`EDIT_DANGEROUS`): a candidate that uses any of `globalThis`, `global`, `eval`,
   `Function`, `require`, `Reflect`, `Proxy`, `__proto__`, `expect`, `assert`, `vi`, `jest`,
   `constructor`, `prototype`, `getPrototypeOf`, `setPrototypeOf`, `getOwnPropertySymbols`,
   `getOwnPropertyNames`, `getOwnPropertyDescriptor`, `getOwnPropertyDescriptors`, `defineProperty`,
   `defineProperties`, `assign`, `Symbol`, `import`, `process`,
   `module`, `exports` or `arguments` more often than the original (a word count over the whole text,
   comments and strings included: it can only make the gate stricter) is refused (`dangerous:<word>`).

4. Vocabulary (`EDIT_NEW_WORDS`, added after the in-body forges below were found): every word
   (`[A-Za-z_$][\w$]*`: identifiers, keywords, and the words inside strings, templates and regexes) of the
   candidate's code must already be a word of the original's code, or one of the pinned template words
   `any as export false if in null object return toLowerCase toUpperCase true typeof undefined` (what the
   null-guard, nullish, typeof-null, case-flip, boolean and export templates write). Otherwise
   `new-word:<word>`, a refusal reason. When both texts parse, "code" means the parsed tokens, so a comment
   is neither vocabulary in the original (it cannot lend a forge its words) nor a new word in the candidate
   (it is inert); when either does not parse, both full texts are compared. An escaped identifier or
   string (`\u0063onstructor`, `"\x63"`) yields a new word (`u0063onstructor`, `x63`), so it is refused.

5. Writes (`global-write`, structural, only when both parse): the candidate may not make more writes
   (an assignment of any kind, `++` / `--`, `delete`) to a target whose root is not a name the file
   declares (a parameter, variable, function, class, enum, namespace or import) or `this`, than the
   original does. This is what refuses `Object.is = () => true` (vitest and jest `toBe` call
   `Object.is`) in a file that already says `Object.is`, where no other axis would.

Axes 3 and 4 are lexical and run on every candidate, parsable or not (a runner's transform such as
esbuild may accept text the TS parser rejects).

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

The gate is sound for its one job against the routes below: nothing wider than `{export-keyword, in-body}`
reaches a run, and an in-body edit can only rearrange the file's own vocabulary plus the pinned template words.

- Adding an import that patches `expect` (or any import) is a new top-level `import` statement, so the
  top-level statement count changes (`top-level-count`); an `export ... from` re-export swapped in with
  no count change is `adds-import`; a dynamic `import(...)` or `require(...)` added in a body raises
  the `import` / `require` count (`dangerous:import`, `dangerous:require`). Refused.
- Editing a test file is `test-file` (a team test is `TEAM_TEST_EDIT` before the gate). Refused.
- Editing a runner config or setup file is `runner-infra`; `package.json` scripts, `tsconfig.json`, a
  `jest.config.js` are `config`; a lockfile is `lockfile`. Refused.
- A multi-token source edit that redefines a global is a new or changed top-level statement
  (`top-level-count` / `top-level-kind`) and/or raises a dangerous word's count. Refused.
- IN-BODY forges (found while finishing this batch; both are now real-runner forging tests). Inside an
  existing function body, with the top-level statements unchanged and no import:
  (a) `([] as any).constructor.constructor("return this")()` reaches the global object,
  `Object.getOwnPropertySymbols(g).find((s) => String(s).includes("pect-gl"))` finds vitest's `expect`
  without naming any word the first version listed, and patching `Object.getPrototypeOf(e(0)).toBe`
  credits a pass on real vitest 4.1.10 (1 pass, 0 fail, exit 0);
  (b) in a file that already calls `Object.is`, `Object.is = () => true;` (every word already in the file)
  credits a pass the same way.
  The first version of this gate classed both `in-body` (admitted). Now (a) is `global-write`, and
  without its final write `dangerous:constructor`, and with the dangerous words renamed away
  `new-word:<word>`; (b) is `global-write`.

Residual (stated, not hidden): this is a structural and lexical bound, not a proof about behavior. An
in-body edit can still only (i) rearrange the original code's own words plus the pinned template words,
(ii) without adding a dangerous word, (iii) without a new write to anything rooted outside the file's own
declarations. A forge that needs none of those (for example, re-aiming a call to a mutating method the file
already makes, other than the listed ones, at a runner object reached with existing words) is not excluded by this gate in general. No current proposer writes free text: every candidate
comes from the fixed repair templates (model-v1 only ranks repair-v1's list), whose outputs are already
narrower than this bound, so the bound is never what decides a real proposal today. Widening the
proposers to free-form edits needs a new review of this note.

The gate is deliberately NOT a lexical token count. The repair templates (null-guard insertion,
nullish expansion, negated condition, the idiom and const templates, a combined two-span candidate)
produce multi-token in-body changes that are legitimate and must still run; a naive one-token rule
would refuse them and break the loop suite. The enforced scope is structural (the top-level statement
list is preserved, no new import, no new dangerous token), with the lexical `export `-shape reused from
M174 for the one keyword-insertion case. An unparsable candidate skips only the structural axis; the
dangerous-word and vocabulary axes still apply to it, which keeps m173's broken-return case and m164's
trailing-comment case working when they add no new word.

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
