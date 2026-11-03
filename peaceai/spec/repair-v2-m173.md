# repair-v2 M173 (batch 12): module-scope constant sites and the const-value template; M171 follow-ups

Code: peaceai/lib/editpropose.ts (repair-v2 only), peaceai/lib/loopdeps.ts (work dir cleanup),
peaceai/test/workflows.test.ts (userns file guard). Tests: m173-batch12.test.ts, m173-cases.ts,
m173-mutation.test.ts (+ m173-mutant-runner.ts), m173-followups.test.ts, workflows.test.ts (M173 tests).
repair-v1 (`repairProposer()`) and model-v1 (which ranks repair-v1's list) are unchanged: same sites, templates, order.

## What was looked at (honest statement)

Diagnosis only, for failure categories, of the remaining public dev-task failures after batch 11 (destr, remeda,
neverthrow, p-queue, valibot): the batch-11 box probe logs, shallow source clones of destr, remeda and neverthrow,
and the /workspace/batch10/ref diffs. Findings:

- destr: the fault is in a module-level regular expression constant read by the named function; repair-v2 never
  makes a site outside a function body, so no candidate can touch module scope. The real fix rewrites the regex.
- remeda: no single-token candidate improves on the 18/20 baseline; the fix needs a restructure.
- neverthrow: the whole jest suite fails to compile, every attempt scores 0/1 (no signal); the fix adds a feature.
- p-queue: ava with no lockfile; an ava runner would only move it to DEPS_NO_LOCKFILE, and the runner shim is being
  changed under #670, so no runner work in this batch.
- valibot: DEPS_PM_CONFIG refusal stays (correct).

The one general gap taken from this is a location gap: a module-scope constant read by a located function is never a
site. That gap was seen in destr. The edit added for it (an integer literal +/- 1) is NOT destr's fix (destr needs a
regex rewrite), and no regex template was added, because a regex template would mirror the destr and valibot fix
class. No fixture, template or idiom is modelled on any dev task or reference diff; every admitting fixture in
m173-cases.ts is an unrelated shape written for this test (a page-size constant, a grade-bounds table, a timeouts
object). No dev-task gain is expected or claimed; the box probe table is informational and backs no claim.

Not added, and why: no regex template (mirrors destr/valibot); no compile-diagnostic names as signal for jest
(the names are already in the request, and it would mean parsing runner output in the shim, which is in flux under
#670); no ava runner (shim in flux; would only change the refusal code); nothing built on the mocha shim's pass count.

## Mechanism 1: module-scope constant sites (locate, repair-v2 only)

After all existing sites are found (their order is unchanged), repair-v2 appends tier-3 sites for top-level const
declarations of the file. A declaration becomes a site only if every condition holds (guard tag in brackets):

- a `const` VariableStatement at the top level (cs-const), not `declare` (cs-declare);
- its initializer is not an arrow function, function expression or class expression (cs-not-fn);
- its name is read inside one of the located sites (cs-read), where a property name `x.NAME` is not a read
  (cs-ref-expr), and the site does not bind the same name itself (cs-shadow);
- at most MAX_CONST_SITES = 4 such sites (cs-cap); duplicates skipped;
- only when callee depth is 2, i.e. repair-v2 (cs-v2-only).

## Mechanism 2: the const-value template (repair-v2 only, ranked last)

For a const site, `constMutationsIn` proposes value +1 and value -1 for an integer literal that is

- a plain decimal integer of at most six digits, `/^(?:0|[1-9]\d{0,5})$/` (cv-int; 0.5, 0x10, 1e3, 1_000 and
  1234567 are refused), optionally negated;
- the whole initializer of a top-level const (cv-const), or a direct element of an array-literal initializer
  (cv-array), or the value of a property assignment of an object-literal initializer (cv-object);
- proposed only by repair-v2 (cv-v2-only). TEMPLATES_V2 = [...IDIOM_TEMPLATES, ...TEMPLATES, ...CONST_TEMPLATES],
  so every existing candidate keeps its rank and position; MAX_CANDIDATES still caps the list.

Near misses refused (m173-cases.ts): an unread const, a `let`, a `declare const`, an arrow-function const, a name used
only as a property, a shadowed name, the fifth const (cap), a local const, a nested literal, a call initializer, and
each non-decimal literal form above. Mutation: deleting each of the 13 `// m173-guard:` lines makes a case fail
(m173-mutation.test.ts, child runner, crash != pass).

## Soundness

Both mechanisms only add candidates; they never remove, reorder or rewrite an existing one, and they are off for
repair-v1 and model-v1 (pinned by m168-repair-v2 and m173-batch12: v1 TEMPLATES and CALLEE_DEPTH unchanged, v1 never
proposes const-value). A const-value candidate is one literal edit inside a declaration the located code reads; it is
graded by the same loop (tests run as the candidate uid, same acceptance rules), so a wrong candidate fails its run
like any other. Validation is not loosened anywhere. Limits: only integer literals; a constant read through an alias
or another module is not a site.

## M171 follow-ups (Auditor)

1. bin/loop.ts `proofs`: m173-followups.test.ts runs a copy of bin/loop.ts whose stage2CandUid succeeds and whose
   runIsolationProofs rejects; it must print exactly `refused PROOFS_CRASHED` and exit 1. The mutants exit-0,
   no-handler, silent-exit-1 and no-exit each fail that check. bin/loop.ts itself is unchanged.
2. userns guard: workflows.test.ts now also scans every tracked *.sh file and every tracked file a workflow names by
   path outside a YAML comment, plus the relative-import closure of named modules; none may name
   `unprivileged_userns` in code (comments dropped). Near misses: a script, a run module, a /proc write. Not seen: a
   file reached only through a glob or a bare/computed import, or a key built at run time; the workflow-side check and
   the in-wrapper isolation proofs still apply.
3. Work dir leak: openWorkDir calls trackWorkDir(dir) right after mktemp and before the chmod (a chmod throw now
   closes and returns null). trackWorkDir installs, once, an exit hook and SIGINT/SIGTERM/SIGHUP hooks that remove
   every open work dir; the signal hooks re-raise the same signal so the process still ends by it. close()
   unregisters. Tested in child processes (each signal, process.exit, an uncaught throw) with mutants (no hooks, no
   re-raise). SIGKILL cannot be caught and is not covered.
