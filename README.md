# PeaceAI-Workspace

Public workspace where PeaceAI attempts small coding tasks on GitHub Actions, with no paid model.

## How a task runs

1. The owner opens an issue and adds the `peace-task` label. `peace-intake` (owner author, owner
   labeler, `PEACEAI_ENABLED == 'true'`) only adds `peaceai:queued` and starts a sweep.
2. `peace-task` is a serialized sweep (one run at a time). Each run takes the **oldest** open,
   owner-labeled task without a state label, marks it `peaceai:running`, processes it, then marks it
   `peaceai:done` or `peaceai:failed` and starts another sweep while tasks are waiting. A schedule
   (every 30 minutes) backs this up. GitHub may cancel a *pending* sweep when another is queued; no
   task is lost because tasks wait as labels, not as runs.
3. **Job A (generate)** confirms the issue is still open, owner-authored and running (remove the
   label or close the issue to cancel a task), clones the private kernel with a read-only key into the
   runner temp directory, builds only the Actions kernel (native synthesis, the edit families and the
   multi-step planner; the kernel guard fails the build if the bundle can reach any teacher or outside
   model), indexes the target's in-scope files (symbols and keywords, in memory), and generates up to five
   candidate diffs. The leak/scope gate must pass before upload; the kernel checkout is always deleted.
4. **Job B (test)** runs one matrix job per candidate on a fresh runner with read-only tools and no
   secrets. A candidate that fails type checking or tests first goes through the **test-and-fix loop**
   (M7, below). Then the final passes: the original suite alone (new test files removed), then the new
   tests alone. Candidate code runs only as the unprivileged `peaceai-cand` user (see *Tamper-proof
   results*).
   **Job B2 (re-gate)** clones the core read-only only when a candidate was repaired, runs the same
   leak/scope gate as Job A on each repaired diff, deletes the core, and publishes the final candidate set.
5. **Job C (record)** writes the task, every candidate diff, both test passes, the scores, eligibility
   and the blind ranking to the private Results repository, and commits it **before** anything is
   shown. If the task asks for tests, candidates without a new test are rejected before ranking.
   **Distinct edits (M4.1):** eligible candidates are grouped by their normalized non-test `src/` diff
   (`peaceai/lib/dedupe.ts`), so the same edit with and without a new test file is one edit. Each group
   presents one member: one with tests when the task asks for tests, otherwise the deterministic ranking's
   first. Group membership (`editGroups`, `editKey`, `duplicateOf`, `distinctEdits`) is recorded in
   `ranking.json`.
6. **Review** (requires Job C) posts one comment listing one candidate per distinct edit as A, B, C... in a
   random order, all formatted identically, with no scores, ranks or preferred candidate.

## Verdicts

Reply on the issue (owner only):

- `/verdict <letter> right`: that candidate is correct; it becomes your pick and a PR is opened for it.
  If an open PeaceAI PR already holds that candidate, no second PR is opened. If an open PeaceAI PR
  holds a different candidate, it is closed with a short comment and the new candidate's PR is opened.
- `/verdict <letter> wrong` naming your current pick (the standing `<letter> right`): withdraws your
  verdict, with the same `verdict-withdrawn` PR marking as below.
- Any other `/verdict <letter> wrong`: a label for that candidate (not a pick); your pick still counts.
- `/verdict none wrong`: no candidate is acceptable (a pick of "none"); any open PeaceAI PR for the issue is closed.
- `/verdict none unsure`, or `/verdict <letter> unsure` naming your current pick (the standing
  `<letter> right`): withdraws your verdict. Any open PeaceAI PR for the issue gets the
  `verdict-withdrawn` label and a "do not merge" comment; picking that candidate again removes it.
- Any other `/verdict <letter> unsure`: a label for that candidate only; your pick still counts.

Malformed commands get a short usage reply. Verdicts are appended to Results.

**Latest verdict wins.** Raw verdict rows are append-only; every reader goes through
`effectiveVerdict` (`peaceai/lib/records.ts` for rows, `peaceai/lib/store.ts` for an issue), applying
rows in time order (then comment id), using only the issue's latest attempt:

- `none unsure`, or `<letter> unsure` / `<letter> wrong` on the standing `right` pick, withdraws: the
  issue is excluded from training and agreement until the next decisive verdict (`A right`, `A unsure`
  = excluded; `A right`, `A wrong` = excluded; `A right`, `none unsure` = excluded; then `B right` counts B);
- any other `<letter> unsure` or `<letter> wrong` is a label only (`A right`, `C unsure` or `C wrong`
  = A still counted); `none wrong` is a decisive pick of "none";
- training uses the latest standing verdict (`latest`);
- agreement uses the latest standing decisive verdict, `<letter> right` or `none wrong` (`pick`).

Branches are `peace-task/issue-<n>-<candidate>-<hex>`, so an open PR never holds a candidate other
than the counted `right` pick.

**Agreement** compares the ranker's blind top pick with that pick. It counts only the latest attempt
per issue, only tasks with two or more **distinct** eligible edits, and excludes test tasks. A task
whose candidates all make the same edit counts as a single-candidate task (`singleEditTasks` in the summary).

**Held-out set**: a task is held out when the first 4 bytes of `sha256("peaceai-heldout:v1:<issue>")`,
read as a fraction, are below 0.2 (about 20%). Held-out tasks are recorded and reviewed like any
other but are never used for training; agreement is also reported for them separately.

**Task source**: `source:builder` marks a `peace-task` opened by the Builder agent. The label is read
when the task is picked and stored as `source` (`peace` | `builder`) in `task.json` and the summary.

**Test tasks**: an issue title starting with `[test]` marks the records as test; they are excluded
from training and agreement.

**Source corrections (add-only)**: Results task records are never edited or deleted. A record written with
the wrong `source` is corrected by adding a line to `peaceai/source-corrections.jsonl` (`issue`, `runId`,
`recorded: "peace"`, `source: "builder"`, `reason`); the readers (`taskEntry` for the summary, the ranker's
`toExample`) apply it through `peaceai/lib/sourcecorrections.ts`. A correction can only lower a record to
`builder`, never credit Peace. CI (builder-log job) checks the file is valid and that the base revision is a
byte prefix of the head. The first seven (M119 audit, #544) are #513-#516 and #540-#541.

## Test-and-fix loop (M7)

Inside Job B, for each candidate, within a budget (4 repair rounds, 5 minutes):

1. run `tsc --pretty false` and, when it type-checks, the original suite and the new tests with the TAP
   reporter, all as the sandbox user, output captured by the harness (`peaceai/bin/test-candidates.ts`);
2. parse the output into errors (`peaceai/lib/repair.ts`): TS code, file, position, the name, suggestion,
   type or literal it is about; failing assertions with expected vs actual; and sort them
   deterministically (tsc before tests, then kind, file, line);
3. map each error to the first applicable rule, at most one edit per file per round, and the harness
   writes it (the sandbox user cannot write the tree);
4. repeat until green, no rule applies, the same errors come back (no progress), an edit is refused, or
   the budget runs out (`peaceai/lib/repairloop.ts`).

Repair rules (PeaceAI's own, deterministic; no model of any kind):

| Rule | Error | Edit |
|---|---|---|
| `ADD_MISSING_IMPORT` | TS2304/TS2552 unknown name | import it from its single exported definition in the symbol index (`import type` for types) |
| `FIX_NAME_TYPO` | TS2552 with a suggestion | rename the token to the suggestion |
| `FIX_PROPERTY_TYPO` | TS2551, or TS2339 on a named type | rename to the suggestion, or to the single closest member of that type in the index |
| `FIX_IMPORT_NAME_TYPO` | TS2724 | rename the imported name to the suggestion |
| `ADD_FIELD_TO_TYPE` | TS2353 unknown literal property | add `name?: string/number/boolean` to the named type (style kept) |
| `ADD_MISSING_REQUIRED_PROPERTY` | TS2741 in a source literal | add the field with its type's default (`""`, `0`, `false`, `[]`, `null`, first literal) |
| `ADD_UNION_LITERAL` | TS2322/TS2345 literal not in a literal union | add the literal to the union |
| `ALIGN_ADDED_CONSTANT` | failing equality assertion | set an exported constant the candidate added to the literal the test expects |

Rules refuse when a name is ambiguous, the position does not hold that name, or types don't line up.

M7.1 guarantees:

- **Green is the exit code.** The loop stops green only on the harness-captured exit codes of `tsc` and
  the two test runs (`runCandidateCapture` → `Evaluation.typecheck/originalSuite/newTests`); the parsed
  text only chooses repairs. The recorded pass/fail always comes from the final passes, again by exit
  code, written by the harness. Tests that print `ok`/`# pass` and exit non-zero stay red.
- **Dedupe is on the final set.** Job C and the review read Job B2's output, so two candidates that
  become the same edit after repair are one distinct edit for the review, training and agreement.
- **Flags.** A re-gated repair that inserted a placeholder value (`ADD_MISSING_REQUIRED_PROPERTY`) gets
  one neutral line in the blind review: "Note: placeholder value added by repair." Each candidate in
  `ranking.json` carries `repaired: true|false`, and the ranker has a `repaired` feature
  (`features:v2`; a `features:v1` model is ignored until the next retrain).
**Existing tests are never edited** (a fix that would need one ends the loop). Only a loop that ends green
yields a repaired candidate; otherwise the candidate is tested exactly as generated. A repaired diff goes
through the scope and personal-info gates in Job B, then the core-text gate in Job B2, and is shown only if
both pass (its transformations gain `TEST_FIX_LOOP`); otherwise the candidate falls back to the diff as
generated and its round-0 results. Every round (errors, rules applied, status) is recorded in Results
under `repair/`. `PEACEAI_REPAIR=off` disables the loop.

## Learned edit types (M8)

PeaceAI mines repeating edit shapes from Builder's commits and proposes them as new edit rules. Peace
approves each rule; until then Job A refuses it.

**Mining** (`peaceai/lib/mine.ts`, `peaceai/lib/minegit.ts`, `peaceai/bin/mine-rules.ts`): for every
non-merge commit (at most 25 changed source files), each small `-U0` hunk (<= 12 added, <= 6 removed lines,
non-test `.ts/.tsx`) is matched against the post-image TypeScript AST. Additive shapes are the maximal nodes
wholly inside the added lines (enum member, switch case, object property, array item, union member, type
field, import, exported constant, guard clause, try/catch, log line, env option). Modification shapes compare
the before-lines: `E` becoming `E ?? literal` (NULLISH_DEFAULT), a parameter gaining a default, and a line
whose tokens are identical except one literal (LITERAL_CHANGE). Each shape gets hunks, distinct commits,
distinct files, three example commits and style counts. Shapes an edit family already covers are skipped.
A proposal needs >= 3 distinct commits in >= 2 files and a kind the rule engine can execute. Deterministic;
no model of any kind.

**Rules** (`peaceai/lib/learned.ts`): a JSON spec (`peaceai-learned-rule:v1`) with the kind, the learned
parameters (majority styles, allowed contexts and literal kinds), the trigger phrase and the frequency
counts, and no code. Its content hash is SHA-256 over canonical JSON (sorted keys). Kinds:

| Kind | Task phrasing |
|---|---|
| `SET_LITERAL` | ``set `NAME` to VALUE`` or ``set `NAME` in `src/file.ts` to VALUE`` (unique const or object property) |
| `ADD_SWITCH_CASE` | ``add case "label" returning VALUE to the switch in `fn` `` |
| `ADD_NULLISH_DEFAULT` | ``default `obj.field` to VALUE in `fn` `` |
| `ADD_THROW_GUARD` (M13) | ``guard `fn` in `src/file.ts`: throw CODE when CONDITION``, then bullets ``- CALL throws CODE`` (at least one) and optional ``- EXPR is VALUE`` / ``- EXPR equals [..]`` |
| `ADD_TEST_CASE` (M12) | ``add a test for `NAME` in `src/file.ts`: TITLE``, then bullets ``- EXPR is VALUE`` / ``- EXPR equals [..]`` / ``- EXPR throws CODE`` / ``- EXPR rejects with CODE`` and a line ``Fix: <40-hex commit>`` |

A rule produces one candidate only when the edit site is unique. Its candidate goes through the same scope
check, Job B tests, the M7 repair loop, Job B2 and the leak/core-text gates as every other candidate.

**Where they live.** Public rules (mined from PeaceSTOCKS and this repository) are in
`peaceai/rules/learned/`; their proposals are Workspace issues labelled `rule-proposal`, with links only,
after `peaceai/bin/proposal-gate.ts` (core text, core paths, personal info). Core-mined rules stay in core
(`packages/coding-kernel/learned-rules/`), and their proposals, which quote core hunks, are private
PeaceAI-Results issues.

**Approval.** `peaceai/rules/approved.json` (hash-pinned, CODEOWNERS) lists `id`, `sha256` and the approval
source (comment URL, id, issue, author PeaceG03, time; Results approvals also the attestation commit). Only
`.github/workflows/peace-approve-rule.yml` writes it:

- Workspace: Peace comments exactly `/approve-rule <sha256>` on the proposal issue. The workflow checks
  the author (PeaceG03, OWNER), the exact command, the issue label and marker, and that the spec file on
  `main` hashes to that value. It then commits only the list on a branch with a message citing the comment,
  opens a PR, runs the required checks and squash-merges.
- Results: the same comment on the private issue triggers the Results workflow (canonical copy in
  `peaceai/results-repo/`). It validates the comment against the spec in the issue and commits
  `rules/approvals/<sha256>.json` citing the comment. The hourly sync here reads those attestations
  (`results-read`), checks the core spec file hashes to them and proposes a list without landing it
  (`results-verify`, core key, read-only), then `results-land` re-reads every new entry's attestation
  from a fresh Results clone at its recorded commit (on Results main, field-for-field equal, commit
  message citing the comment; Workspace entries untouched) and fails closed before opening the PR. No core
  text leaves core or Results. Nothing ever pushes to `main`: the only push is a `peaceai-approve-rule/*`
  branch that changes only the list.

Architect posts `/approve-rule` under Peace's delegation, with a note on what was checked. Builder agents
never post it and no agent edits the list by hand. Agents push as PeaceG03, so identity cannot tell us apart;
traceability to the approval comment is the control. The required `tamper-proof` check runs
`peaceai/bin/check-approved-list.ts`: every Workspace entry must resolve to that exact comment and spec hash;
every core-sourced entry must carry a well-formed attestation reference (full Results commit sha, attestation
path for the pinned hash, Results issue and comment id matching the URL); an approval branch may change only
the list (one commit ahead of main), and any other branch may not change the list at all.

**Enforcement** (`peaceai/lib/approved.ts`, Job A in `peaceai/bin/generate.ts`): every spec is admitted
only if the list is present and valid, names its id, and pins its exact hash. Otherwise it is refused
(`NOT_APPROVED`, `HASH_CHANGED`, `SPEC_INVALID`, `LIST_MISSING`, `LIST_CORRUPT`) and produces no candidate.
Job A logs `learned rules=N approved=K candidates=C refused=...`.

### Test-writing edit type (M12)

`ADD_TEST_CASE` writes a new test, never an existing one. **Evidence** (`peaceai/lib/minetest.ts`): only
test files, only from the public PeaceSTOCKS scanner and this Workspace (the label must be on the allowlist
and the origin remote must be that public repository; Net, Net-Runner, Results and core are refused), only
Peace's noreply commits on main. Each new top-level `test()`/`it()` case is one `TEST_CASE` observation with
style facts only (runner/assert imports, check forms, error matcher, size, async, fail-closed, calendar).
**Template** (`peaceai/lib/learned-test.ts`): the spec pins the learned parameters (imports, allowed check
forms, `regex` error matcher, max lines from the majority size bucket, `placement: new-file`, `grading:
fail-before-pass-after`); the skeleton is fixed. Placeholders come only from the task text (title, check
expressions, error codes, fix commit) and the target code: the named file must export the symbol and every
name a check starts from; arguments and values must be literals (no other identifiers, operators, functions
or templates). The file is `<dir>/<stem>.<title-slug>-<fix7>.test.ts`, with the import style of the
target's own tests. Anything else: no candidate. **Grading** (Job B, `peaceai/bin/test-candidates.ts`): the
candidate carries `fixSha`. Before anything is reverted, `validateFix` (`peaceai/lib/results.ts`) requires a
full 40-hex sha of a commit in the target checkout, reachable from the target's `main` (not branch-only, not
from another repo) and from the task base, with a parent; a fix that touches `.github/`, workflows, hooks,
scripts, configs, lockfiles, env files or a denied path is refused. The new tests run on the fixed code (pass
2), then the harness reverses only the fix commit's non-test source files (its tests and docs are never
touched) in the same tree and runs them again as the sandbox user. Only pass-after and fail-before is
`COUNTS`; `REJECTED_PASSES_BOTH`, `REJECTED_FAILS_BOTH`, `REJECTED_FAILS_AFTER_FIX` and `UNGRADABLE` (not
test-only, fix invalid / not on main / not an ancestor / touches non-source, no source change, revert
failed) are rejected (`rejectReason: test-grading` or `new-tests`) and the grading is
recorded per candidate in `ranking.json` (`testGrading`). Learned tests get no M7 repair. Job B checks out
full history so a Workspace fix commit's parent exists. Unapproved, the trigger is refused by the task parser
(`RULE_NOT_APPROVED`) and by Job A (`NOT_APPROVED`). A learned candidate's `operationId` is
`learned:<id>@<spec sha256>`, and every job's summary check (`validateSummary`) accepts it only when that exact
id and hash are pinned in `peaceai/rules/approved.json`; `lm-fill:<model>` is accepted only for a verified
model id bound by the caller (none of the jobs binds one, so it is refused). `learned-test.ts` and
`minetest.ts` are in the protected self-change set.

### Test-append edit type (M14)

`public-test-case-append-v1` is the M12 `ADD_TEST_CASE` template with `placement: append`: the same task text
(trigger, bullets, `Fix:` line), but the new case is appended at the END of the target's own test file
(`<stem>.test.ts`) instead of a new file. Evidence: shape `TEST_CASE_APPEND` (a new case after every existing
statement of an existing test file; public PeaceSTOCKS + this Workspace only). The file must already import
`assert` (default, node:assert/strict), `test` (default, node:test) and every name the checks start from,
from the target module; a duplicate test name is refused. **Narrow exception to "existing tests are never
edited":** the scope gate (`checkCandidateScope(..., { testAppend })`) accepts a change to an existing test
file only when the candidate is a graded learned test (summary `fixSha`, passed by Job A, the gate and Job
B) AND the diff is a pure end-append (`DiffFile.appendOnly`: one hunk, nothing removed, no context after
the added lines). Every other candidate, and every other change to an existing test, is still refused.
**Grading:** pass 1 runs the appended file exactly as on the base. For before/after grading the harness
rewrites the file to the base file's import lines plus the appended lines only, so cases already in the
file (even ones the fix itself added) can never make a passes-both case count. An appended import is
refused. No M7 repair.


Shared-setup guard (Auditor, outside the engine in `lib/scope.ts`): the appended lines must be exactly one top-level `test("…", () => {…})` — no options argument, no `.skip/.only/.todo`, no `before/beforeEach/after/afterEach`, no `mock`, no nested test/describe, and no other top-level statement. `peaceai/lib/diff.ts` and `peaceai/bin/test-candidates.ts` are in the protected set.

### Throw-guard edit type (M13)

`ADD_THROW_GUARD` adds `if (CONDITION) throw new Error("CODE");` at the entry of a uniquely named exported
function (after any guards already there) and writes ONE new test file from the task's bullets. The kernel's
`ADD_GUARD_CLAUSE` only returns a literal. Evidence: shape `THROW_GUARD` (split out of `GUARD_CLAUSE` in
`peaceai/lib/mine.ts`), public PeaceSTOCKS and this Workspace only, style facts only. Params come from fixed
vocabularies (`peaceai/lib/learned-guard.ts`): braces none, Error, message code-only, one line,
function-entry, new-file test, grading self-fail-before-pass-after. The condition may use only the
function's parameters, literals, property reads, comparisons, `!`, `&&`/`||`, `typeof` and a few pure
built-ins, and must read at least one parameter (constant conditions such as `true` or `1 < 2` are
refused). Property reads and comparisons on a parameter can still run a getter or `valueOf` of the
caller's object. The code must be new to the file, the function a single exported implementation, and test calls
literal-only and tripping the same code. Issue cleaning strips `>`, so write `<`/`<=`. A damaged condition
is refused. Grading (Job B `gradeSelf`): `selfGrade: true` (only on a pinned `learned:` id). The new tests
must pass with the guard and fail with the candidate's source files reset to the task base. Only that is
`COUNTS`; anything else is rejected (`test-grading`). There is no M7 repair, and the file is protected.

### Stale-base re-apply and fresh regrade (M16)

`apply-verdict-patch.sh` (Builder, on the box): when the target head has moved past the task base, the chosen candidate is re-applied onto the current head with a plain `git am` (no 3-way, no conflict resolution; anything that does not apply cleanly is refused) and graded fresh there by `peaceai/lib/rebase.ts`: the original suite must pass, each new test the candidate adds must pass with it and fail with its non-test edit taken back out. The task-time grade is never carried forward. A refusal resets the worktree to where it started; a pass adds a `PeaceAI-Regrade:` trailer to the commit. Both files are in the protected set.

### Stale-base regrade through Job B (M18)

When the owner's `/verdict X right` picks a candidate whose task base is no longer the target's head, the verdict job does not build a patch on the old base. It posts a regrade request on the issue (the chosen diff, hash-pinned, plus its run, candidate and kind). Re-queuing the task (remove `peaceai:done`, re-add `peace-task`) makes Job A re-apply exactly that diff onto the current head with a plain `git apply` (refused, 0 candidates, if it does not apply cleanly, the learned rule is no longer approved, or the base is not stale). Sandboxed Job B grades it fresh there, and the Results task record of the new attempt carries `regradeOf` (old run, candidate, old base, diff hash). The old grade is never carried forward; the owner gives a new verdict on the new attempt.

### New-function edit type (M15)

`ADD_FUNCTION` (spec `peaceai/rules/learned/public-add-function-v1.json`, mined from public commits only: 8 added exported single-return functions in PeaceSTOCKS and this repo; core-mined specs of this kind are refused). Task form:

    add function `name(a: number, b: string): string` to `src/file.ts` returning EXPR
    - `name(1, "x")` is "1x"

It appends one `export function` at the end of an existing module (the name must not appear anywhere in it) and writes one new test file from the bullets. EXPR may use only the parameters, literals and a fixed set of pure operators, built-ins and string/array methods (see `peaceai/lib/learned-function.ts`); anything else, or an unused parameter set, is refused. Job B self-grades: the new test must pass with the function and fail on the task base. Off until Architect approves the spec; `learned-function.ts` is in the protected set. v1 does not create new modules; `public-add-function-v2` (M17, placement `end-of-module-or-new-module`, mined from 101 pure functions in 35 public commits that created modules) may: when the named `src/<dirs>/<name>.ts` does not exist and sits next to an existing non-test `.ts` file (lower-case, no new directory, no test/declaration path), the function becomes a new module holding only it, and Job B grades it by removing that module. For every ADD_FUNCTION candidate Job B also requires: each new test calls the function (import-only tests are refused) and fails with the function body stubbed to its type default (else `REJECTED_PASSES_WITH_STUB`). New modules must resolve inside the checkout with no symlinked path component; gate/approval names, prototype members and protected-looking module paths are refused. The stale-base regrade (M16) applies the same stub check and keeps a `peaceai-regrade:v1` record (old base, new head, fresh grade) as a commit trailer and under the clone's git dir.

## From-scratch language model (M9)

A small decoder-only transformer trained from scratch by PeaceAI's own numpy code (`peaceai/model/`):
forward, backward and AdamW are hand-written; the byte-level BPE tokenizer (4,096 tokens) is trained on
our own corpus. No pretrained model, tokenizer, weights or embeddings of any kind (CONSTITUTION section 12).
The only runtime dependency is numpy (array math), hash-pinned in `peaceai/model/requirements.txt`.

- **Size:** 6 layers, d_model 384, 6 heads, context 256, tied embeddings: 12,297,984 parameters.
- **Corpus** (`peaceai/bin/lm-corpus.ts`, `peaceai/model/sources.json`): Peace's repositories (PeaceAI core,
  PeaceSTOCKS, this repo) plus pinned permissive repositories whose LICENSE classifies as MIT, Apache-2.0,
  BSD-2/3-Clause or ISC (mixed or carve-out licenses refuse the whole source). Files under a nested LICENSE,
  with a non-permissive header, generated, minified, vendored or containing personal info are excluded. Every
  used file is recorded (source, commit, path, sha256, license, split) in `manifest.jsonl`, kept in Results.
- **Training** (`peaceai/model/train.py`): CPU only, seeded (PCG64), resumable from a checkpoint holding the
  weights, AdamW state and RNG state; held-out files (5%, by path hash) never train the model or tokenizer.
  Because the corpus contains core, training runs only on the Builder box, never on Actions; no public
  workflow trains, builds the corpus or runs the memorization check (a test enforces this).
- **Memorization check** (`peaceai/bin/lm-memcheck.ts`): greedy and sampled continuations of core, public
  and empty prompts, scanned with the core-text scanner (public corpus as baseline), an exact-substring scan
  (any run of 32+ characters of the generated text that occurs in core, no baseline exemption) and the
  personal-info scanner. A prompt line the model added fewer than 12 non-space characters to is the prompt's
  own text and is left out of the line scan. Any hit, fewer than 100 samples, an inference error or files changed during the check means FAIL.
  `memcheck.json` binds the PASS to the sha256 of `config.json`, `tokenizer.json` and `weights.npz`; the
  loaders (`peaceai/lib/lm.ts`, `peaceai/model/infer.py`) refuse any model without a matching PASS.
- **M39, core-free proof for external-corpus models:** `corefree_proof.py` and `manifestProvesNoCore` read the
  external manifest schema (ext-fetch: repo, commit, license, sha256, origin). Every field must be known (anything
  else fails closed), external repos need a permissive license and are never Peace's, and Peace's own repos are only
  the public owner repos with the owner license. The internal schema keeps its `visibility: public` check unchanged.
  A core file on the public-origin allowlist (exact path and bytes pin) is non-core only for a training file whose
  content sha256 is that pin; copies, whitespace variants or near-copies of it still flag. Empty or whitespace-only
  files (after normalisation) are ignored on both sides, with no wider byte threshold. The strict 32-character rule
  is unchanged for every model without a valid proof.
- **Set C v2 per byte (M39):** `eval_c.py` also reports `bytes_scored`, `loss_per_byte` and `bits_per_byte`;
  `--max-bytes N` scores the same UTF-8 byte slice for any tokenizer (`slice_sha256` proves it), so models compare.
- **Weights** live only in private PeaceAI-Results (`models/lm/<version>/`, fp16; `models/lm/latest.json`).
- **Shadow score** (`PEACEAI_LM_SHADOW`, off unless exactly `true`): Job C records the mean log-probability
  of each distinct edit's added lines as `ranking.lmShadow`. Never shown. `PEACEAI_RANKER=lm` makes it
  active only when the M3-style rule holds: at least 10 held-out decided tasks with an LM score and more
  top-pick agreement than the deterministic ranker (`peace-train` reports it as `metrics.lm`).
- **Gap fill** (`PEACEAI_LM_FILL`, off unless exactly `true`): a task that names a constant but not its
  value, e.g. "add an exported constant MAX_RETRIES of type number to src/config.ts", is a template with one
  hole. The `lm-fill` job lets the model choose among literals of that type already in the target (plus a
  neutral default); Job A accepts the choice only if it is one of its own options, and the candidate then
  goes through the same gate, scope, leak, sandboxed tests and repair loop. The model never writes free text
  into a diff and never uses or approves M8 learned rules.

## Results layout (private repository)

```
tasks/<issue>/<run id>/task.json        task text, test/held-out flags, tests-required flag
tasks/<issue>/<run id>/ranking.json     per-candidate tests, scores, eligibility, blind ranking, presentation
tasks/<issue>/<run id>/candidates/*.diff      the diff as shown (repaired when the loop repaired it)
tasks/<issue>/<run id>/repair/<id>.json       M7 repair rounds: errors, rules applied, stop reason, re-gate
tasks/<issue>/<run id>/repair/<id>.original.diff  the diff as generated, when a repair replaced it
tasks/<issue>/<run id>/verdicts/<comment id>.json
index.jsonl                             append-only log of task records and verdicts
summary.json                            derived: per-task entries, agreement, held-out agreement
```

Records are never rewritten; `summary.json` is recomputed from the records on each write.

## Shadow ranker (M3)

The deterministic ranking (original suite, then smallest diff, plus the tests-required rule) stays
authoritative. A CPU ranker is trained and recorded in **shadow** mode:

- **Features** (`features:v1`, `peaceai/lib/ranker/features.ts`): from Results records only (ranking,
  task text, candidate diffs): diff size and lines added/removed, files touched, new files, new tests,
  test cases and assertions added, test/typecheck results, edit kinds and task keywords (hashed into
  buckets so no vocabulary is in this repo), smallest-diff flags.
- **Model** (`peaceai/lib/ranker/model.ts`): pairwise logistic regression (linear RankNet), seeded SGD,
  standardized features, L2. Reproducible: same data and seed give the same bytes and version.
- **Training data**: latest attempt per issue, latest standing decisive verdict picking an eligible
  candidate, 2+ distinct eligible edits, not test, not held out, not withdrawn. Pairs: Peace's pick over
  each other distinct edit (duplicates of one edit never form a pair; shadow scoring ranks the same set). Both sources by default; `PEACEAI_TRAIN_SOURCES` (`peace,builder`) filters and
  `PEACEAI_SOURCE_WEIGHTS` (e.g. `builder=0.5`) weights; metrics are split by source.
- **`peace-train`** (dispatch, and after every recorded verdict except on `[test]` issues; Results key only) writes
  `models/<version>/metrics.json`, `model.json` (only when trained) and `models/latest.json` to Results.
  Fewer than 10 trainable tasks: "insufficient data", no model. Held-out top-pick agreement (model vs
  baseline, 2+ eligible only) below 5 tasks is also reported as "insufficient data".
- **Shadow scoring**: Job C loads the latest model, if any, and records `shadow` (order, top, scores)
  in `ranking.json` before the review. The review comment is unchanged. No model, nothing extra.
- **Promotion** (off): needs 30+ trainable tasks, 10+ held-out tasks and the model beating the baseline
  on held-out, and only then takes effect if Peace sets the repository variable `PEACEAI_RANKER=model`.
  The record then has `active: "model"` and `activeTop` from the model.

## Targets (M5)

A task's diffs apply to this Workspace by default. To work on another repository, add a
`target:<owner>/<repo>` label or a line `Target: <owner>/<repo>` in the issue body. Configured targets
live in `peaceai/targets.json`: today this Workspace and `PeaceG03/PeaceSTOCKS`.

- **Visibility is checked on every run** through the GitHub API (select, Job A, Job B, and again right
  before the review comment and before any target PR). Only a repository the API reports as public, under
  the same name, runs. A private repository, a failed or rate-limited check, or a forced failure (the
  test-only `force_visibility_fail` dispatch input) all count as private.
- **Private targets fail closed.** The task is marked `peaceai:failed` with a fixed message that names no
  file and quotes nothing; no job after `select` receives the issue, nothing of the target is cloned, and
  there are no diffs, logs, artifacts or branches for it. A private flow (Results or the target repo
  itself) can plug in at that point later; it is not built.
- **Public targets** are cloned anonymously over HTTPS (no token, no credential helper), outside the
  Workspace. Their diffs and the blind review live here like Workspace tasks; the review names the target.
- **Per-target scope.** Each target has its own source and test patterns and a deny list. For PeaceSTOCKS
  a candidate may only touch `src/**/*.ts`; workflows, `.env*`, `wrangler.toml`, fixtures, test helpers,
  entry points (`host.ts`, `scheduler.ts`, `backfill.ts`) and anything named secret, token, credential
  or production are refused. Existing tests, configs and lockfiles are never changed. The leak gate checks
  core text (with the target's own tree as the already-public baseline) and personal info for every target.
- **Tests per target.** Workspace runs its whole suite. PeaceSTOCKS is too large and partly
  environment-dependent for that, so its original suite is the existing tests related to the touched files
  (same stem, or importing the module, at most 4): each runs on the untouched base first, and a candidate
  fails if any test that passed on the base fails with the candidate. Type checking is always the whole
  project; new tests run alone in their own pass.
- **Verdict route per target (M6).** `verdictRoute` in `peaceai/targets.json` says what `/verdict X right`
  does. `pr` opens a PR and never merges it. This Workspace opens that PR in-repo. PeaceSTOCKS uses the
  same route: the `target-pr` job runs only in the main-only `peacestocks-write` environment (Peace's
  approval of that environment is the push OK), re-checks the target is public, refuses a chosen diff
  whose SHA-256 is not the one recorded from Results, refuses a stale base (regrade, same as the patch
  job), refuses `.github/workflows/**`, commits as the noreply identity on a `peace-task/issue-…` branch,
  and opens a PR into the default branch. It never merges and never pushes that branch name if it is
  `main`. Until `peacestocks-write` exists, a `pr` target falls back to the patch file below, so a missing
  token does not drop the verdict. `patch` (no write token anywhere) is that file: the `target-patch` job
  re-checks the target is public, applies the chosen candidate to an anonymous clone at the task's base,
  commits it as `PeaceG03 <301894882+PeaceG03@users.noreply.github.com>` (dated at the verdict), exports it
  with `git format-patch --full-index --no-stat --no-signature`, checks the patch's diff is byte-identical
  to the chosen diff in Results and carries no personal info, and posts it in a code block with its
  `patch-sha256` and `diff-sha256`. Anything off posts a reason instead of a patch. `wrong`/`unsure` post
  no patch.
- **Applying a patch (owner, from the Builder box):**
  `peaceai/bin/apply-verdict-patch.sh <issue> --worktree <clean PeaceSTOCKS clone>` takes the latest patch
  comment from `github-actions[bot]`, reads Results read-only through `gh` (latest attempt, verdicts, the
  effective pick's candidate diff), and refuses unless the patch hash matches the posted one, the posted
  diff hash matches Results, the patch's own diff hashes to the Results diff, the candidate is the
  effective pick of the latest attempt, the `From:` line is the noreply identity, and the worktree is a
  clean clone of the target. Then it runs `git am`. It never pushes; pushing is a separate manual step.
  `--check` verifies without applying.

Setup for PeaceSTOCKS PRs (owner): create a fine-grained personal access token with resource owner
`PeaceG03`, repository access *Only select repositories → PeaceSTOCKS*, permissions *Contents: Read and
write* and *Pull requests: Read and write* (Metadata read is implied), 90-day expiry. In this repository,
Settings → Environments → New environment `peacestocks-write`; Deployment branches and tags → *Selected
branches* → `main` only; add the secret `TARGET_PR_TOKEN`. Nothing is needed on PeaceSTOCKS itself, and its
workflows, variables and secrets are never touched.

## Tamper-proof results

A candidate's tests must not be able to write or forge their own result. On GitHub-hosted runners the
strongest practical boundary is a separate Unix user (containers would add the same uid split with
more moving parts and Docker-socket risk; a separate job would still need to run the code somewhere).
Job B creates `peaceai-cand` (system user, no home, no shell, no sudo) and the harness:

1. builds the candidate tree in `/tmp` owned by the runner user: readable, not writable, by `peaceai-cand`;
2. runs the type check and both test passes with `sudo -u peaceai-cand env -i ...` (no tokens, private
   `HOME`/`TMPDIR`), and takes pass/fail only from the exit code it captures;
3. kills every `peaceai-cand` process after each command, so nothing can linger and write later;
4. only then writes the result (temp file + rename) under the runner temp directory, which
   `peaceai-cand` cannot write, and a later step uploads it.

A different uid also cannot signal or trace the harness or read its `/proc` environment. The harness
refuses to run without the sandbox in CI (`PEACEAI_REQUIRE_SANDBOX`). `ci` runs
`peaceai/proof/tamper-proof.ts` on every PR: a malicious candidate breaks the code and forges its
result directly and through delayed background writers. Without the sandbox (control) the forgery
lands; with it the recorded result stays correct.

## Kill switch

Set the repository variable `PEACEAI_ENABLED` to anything other than `true`, then cancel any
in-progress `peace-task` run (`gh run cancel <id>` or the Actions page). Intake, the sweep and Job A
all check the variable; a cancelled run leaves its issue `peaceai:running`, which the next sweep marks
`peaceai:failed`. To cancel a single task instead, remove its `peace-task` label.

## Checks

- `leak-check` runs on every PR into `main`: personal info and secret patterns, commit identities,
  and scope rules for protected files. A core-text backstop runs on every push to `main` and weekly.
- Public-origin files: core's `docs/peaceai-public-origin.json` pins core files that are byte-identical to
  public PeaceSTOCKS files, each by exact path and sha256 (no wildcards). Every core-text index (the gates, the
  pre-push hook and the M9 memcheck's core index) skips a file only when its path is listed AND its bytes match
  the pin; changed content, another path, or a malformed allowlist means it is indexed as private again.
- `ci` runs the type check, the `src` tests, the tooling tests and the tamper-proof check.
- `peace-verdict` records `/verdict` comments (see above).
- `key-proof` (manual, owner only) proves each deploy key has exactly the access it should.
- **Local pre-push hook** (box clones): `peaceai/bin/install-pre-push.sh <core-dir>` (or
  `PEACEAI_CORE_DIR`) installs a git `pre-push` hook. Before any push it scans **every commit being
  pushed** (`peaceai/bin/prepush-scan.ts`): each added or modified file for core text against the local
  core checkout and for personal info and secrets, plus noreply commit identities and clean messages. Any
  hit, or a missing core checkout, blocks the push. Output is short shas, paths and kinds only.
  `install-pre-push.sh --template <core-dir>` also puts the hook in the git template, so every new clone
  on the box gets it; the template copy acts only on pushes to `PeaceG03/PeaceAI-Workspace`.

## Writing tasks

The native edits are narrow. Phrasings that work today, for example:

- `Add a helper that will normalize a title by trimming surrounding whitespace in src/text.ts, with focused tests.`
- `Rename symbol slugify to toSlug in src/text.ts`

Small structural edits (M4). Use the phrase shape exactly; names must already exist (except a new
constant), and values are literals: a quoted string, a number, `true`, `false` or `null`.
`src/config.ts` has a target for each.

| Edit | Phrase shape | Example |
|---|---|---|
| Object property | add property `<key>` with value `<literal>` to object `<NAME>` | `Add property timeoutMs with value 3000 to object LIMITS` |
| Guard clause | add a guard to `<fn>` that returns `<literal>` when `<param>` is `<condition>` | `Add a guard to parseQuantity that returns 0 when raw is empty` |
| Array item | add `<literal>` to the array `<NAME>` | `Add "pdf" to the array EXPORT_KINDS` |
| Exported constant | add an exported constant `<NAME>` with value `<literal>` to `<file>` | `Add an exported constant MAX_PAGES with value 50 to src/config.ts` |
| Try/catch | wrap the body of `<fn>` in try/catch that returns `<literal>` on error | `Wrap the body of readProfile in try/catch that returns null on error` |
| Union member | add `<"literal">` to the union type `<Type>` | `Add "critical" to the union type Severity` |
| Type field | add [an optional] field `<name>` of type `<T>` to type `<Type>` | `Add an optional field email of type string to type Profile` |

Guard conditions: empty, blank, null, undefined, missing, negative, zero, not finite, NaN. The
parameter's declared type must fit the condition, and the function's return type must accept the
value. Every edit refuses to run when its target is ambiguous, already has the change, or the types
don't line up. Add `, with focused tests.` to ask for a test; without it PeaceAI tries both.
Identifier underscores (`MAX_PAGES`) are kept in task text; only Markdown emphasis is stripped.

### Multi-step tasks (M6)

Write the task as numbered steps, one per line, each in an edit phrase above. The steps run in order as
one plan (`DevelopmentPlanGraph` + `CrossLayerPlanExecutor` in the Actions kernel): each step is
synthesized against the files as the earlier steps left them, so a later step can use what an earlier
one added, in another file. A step that only says `add a test` asks for focused tests on the step before
it. If any step cannot run, the plan yields no candidate (a partial chain is never offered). The plan's
combined diff is one candidate and goes through the same scope, leak and test gates as any other.

```
Step 1: add an optional field locale of type string to type Profile
Step 2: add property locale with value "en" to object GUEST
Step 3: add a test
```

`1.` / `2)` numbering also works. Steps must be numbered 1..n in order; 2 to 6 edit steps. A typed object
(`const GUEST: Profile = {...}`) only takes a new property when its type already declares the field with a
type that accepts the value, which is exactly what step 1 provides.

### How targets are found (M6)

Every Job A builds a symbol and keyword index of the target's in-scope files: exported and local symbols
with definitions and references, file-to-symbol and import maps, and a BM25 keyword index. It resolves
`function X`, `type Y`, `object Z`, `interface W`, a bare identifier with one definition, a named file,
and "the config" (the shallowest `config`/`settings`/`defaults` file); ambiguous names resolve to nothing.
Resolved files, the files related to them, and keyword hits get priority in the bounded source set and as
edit owners. The index lives only in Job A's memory (logs show counts), and is built only after the
visibility re-check, so a private target fails closed before any indexing.

## Plain-language tasks (M10)

Job A parses the task wording before anything else (`peaceai/lib/nlparse.ts`, called from `generate.ts`):

- **Canonical wording** (any phrasing in "Writing tasks" above) passes through unchanged.
- **Plain wording** goes through a deterministic slot grammar per edit family, which pulls out names, literals and paths. A small from-scratch naive Bayes classifier then picks between families (`peaceai/nl/model.json`, masked word uni/bigrams, no pretrained anything). The result is rendered into the canonical phrase, or into a `Step N:` plan for listed steps or sentences joined by "then". That plan then goes through the scope check, gate, sandboxed tests, repair loop and blind review like any other task.
- **Fail closed.** The parser returns `unsure` instead of guessing in any of these cases: no grammar matches; the classifier can't separate two families; the classifier says the request isn't a supported edit; a learned rule isn't approved; one step of a plan doesn't parse; the plan has more than 6 steps; or the plan would name anything (an identifier, value or path) that isn't in the task text. Job A then produces no candidates. The issue gets a fixed comment from `nl-refusal.ts` with the reason code and the supported phrasings. The only inputs to that comment are two enums, it never contains task text, and it is leak-scanned.
- **Training:** `peaceai/bin/nl-train.ts [extra.jsonl ...]` reads the committed public set (`peaceai/nl/data/builder-train.jsonl`) plus the phrasing list. Extra labeled files are task texts and commit subjects kept on the box, and they add counts only for features the public set already has. So `model.json` holds no word that isn't already public. `peaceai/bin/nl-eval.ts` reports held-out accuracy (`peaceai/nl/data/builder-heldout.jsonl`; set `NL_ISSUES=` to also run on real task issues), printing counts only.
- **Kill switch:** set the variable `PEACEAI_NL_PARSE=off` to use the task text unchanged, as before M10.

## Self-change sandbox (M11)

PeaceAI may propose a change to its own code, but it never edits the live PeaceAI in place, and new or changed code never runs on the Builder box or any local machine.

- **propose** (`peaceai/bin/self-change.ts`, logic in `peaceai/lib/selfpropose.ts`) runs only in an ephemeral GitHub-hosted Actions job of a private repo (Results or core). The job is started manually or by a proposal, and its environment holds no credential variables. There is no box or local mode: anywhere else it refuses (`PRIVATE_ACTIONS_ONLY`). It refuses the public Workspace runners and timers, and the minute budget is 15 by default, 30 at most. It makes a **fresh clone** at the base commit, checks the diff against the protected set, applies the change, and runs the **live version's existing test suite**: the base commit's `peaceai/test/*.test.ts`, restored from the base. Any new tests under `peaceai/self-tests/` run too. It writes a record for private Results and a bundle of the exact tested commit.
- **Protected set** (`peaceai/lib/selfchange.ts`): workflows and approval workflows, hooks, dependency and build config, the rule list, the live tests, the gate, leak, scope, approval and scan tools, the model and its memcheck, and the self-change code and records. It is enforced by path (both sides of a rename or copy; symlinks, mode changes, deletes, copies and binaries are refused) and by content (added lines that name those paths, credentials, approval commands, gate functions or dynamic code loading).
- **decide:** promotion needs, on the promotion PR:
  - a clean check, the live suite passing against the candidate, and new tests passing;
  - Auditor's `/auditor-pass <id> <sha>` comment, then Architect's `/promote-self-change <id> <sha>` comment, both traced by comment id and URL;
  - both SHAs equal to the PR's current head, which must be the tested candidate commit.
  Any new push therefore needs a fresh proposal run, a fresh pass and a fresh promote. Labels count for nothing, and the tool never posts either comment. Promotion is then a normal PR through the required checks; Builder stays the coder.
- **rollback:** one step. It creates a new branch that reverts the promotion merge and checks that every touched path is back to its pre-promotion content.

## Layout

- `src/`: the code tasks change, with its tests.
- `peaceai/`: workflow tooling (generation driver, gate, test runner, ranking, scans) and its tests.
