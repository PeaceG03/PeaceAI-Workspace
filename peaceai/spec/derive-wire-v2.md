# derive-wire v2 (public-derive-wire-v2, GAPS G18 / G26)

Stacked on derive-wire v1 (`peaceai/spec/derive-wire-v1.md`). v1 derives one try / catch wrap (a bare `continue;` or a
rethrow with the cause). v2 derives the two scanner wiring changes v1 cannot: a **bounded retry** of a failing request,
and a **filtered, recorded skip** of a failing item in a loop. Same task language (header, `Behavior:` paragraph in
plain words, `Examples:` bullets of fakes and expects, no code anywhere, v1's anti-copy guards unchanged), same
EXISTING_EDIT kind and Job B grading. Team-picked, `proposal-off-wired`, `qualifies: false`, not in `approved.json`:
it earns no coverage credit.

## G26: v1's continue form is not allowed for scanner per-day wiring

v1's `catch { continue; }` swallows every error (a `TypeError` from a bug included) and leaves no record, and m137 never
tests that a non-matching error escapes (Auditor, Oct 29 2026, on #600). **For scanner per-day / per-session wiring
(w02 and later) the v1 continue form is not allowed.** v2's skip form is always both:

- **filtered**: only an error whose closed read (message, name, code, cause.code, cause.name or cause.message) equals
  or starts with a word of the Behavior paragraph is skipped; every other error is re-thrown unchanged;
- **recorded**: the skipped item is pushed, with its error read, to an existing local list of the target (the list the
  run report or health check already returns), so a person or the health check can see it.

The examples must pin both: a run that skips an item and still processes a later one, with the record in its result
(`wire_skip_unpinned` otherwise), and a run whose non-matching error (for example `{ name: "TypeError" }`) rejects the
call (`wire_filter_unpinned` otherwise). v2 never emits a bare `continue` without the filter and the record. v1 itself is
unchanged (byte-identical outputs); its continue form simply must not be used for this wiring.

## Task shape

- Header (`DERIVE_WIRE_V2_TRIGGER`): `in the existing method M of class C in src/x.ts, retry a failing call.` or
  `in the existing function F in src/x.ts, record a failing call and go on.` (either target form for either ask).
- `Behavior:` plain words; numbers are written as words and digits (`times out after 30 seconds`,
  `base wait of 500 ms`); a filter word is written bare (`starts with R2_`), never quoted.
- `Examples:` v1's data grammar plus `- expect NAME is called with [a], [b]` (the recorded argument lists of a fake,
  data only). Up to 32 bullets in the v2 language (v1 and M98 keep 16).

## Retry (`retryEdit`, template)

The target's last statement is `return this.F(a[, init])`, with `F` injected through the class's config seam
(`constructor(config: I)`, `this.F = config.F ?? default`). The statements before it are re-run on every attempt, so
anything they compute from the clock (the signature) is computed afresh:

    for (let attempt = 0; ; attempt += 1) {
      <the statements before the return>
      let response;
      try {
        response = await this.F(a, { ...init, signal: AbortSignal.timeout(T) });
      } catch (error) {
        if (!A(attempt + 1)) throw error;
        await this.sleep(D(attempt, B));
        continue;
      }
      if (!S(response.status) || !A(attempt + 1)) return response;
      await this.sleep(D(attempt, B));
    }

- Each attempt has its own timeout signal; only a rejected call (network error, timeout) or a response whose status
  `S` accepts is retried; `A(failed tries)` bounds the tries; the wait is `D(attempt, B)` through `this.sleep`.
- `sleep?: (ms: number) => Promise<void>` is added to the config interface, field and constructor
  (`this.sleep = config.sleep ?? (ms => setTimeout promise)`) when the class has none, in the class's own pattern.
- `S`, `A`, `D`: exported pure numeric helpers of the repo's in-scope source (`numHelper`: one return of params,
  numbers, arithmetic, comparisons, `&&` / `||` / `!` and a ternary), imported with the repo's import style when in
  another module. `T` and `B` come from the prose (exactly one each, else `wire_retry_timeout_unstated` /
  `wire_retry_base_unstated`).
- The search simulates every (S, A, D) on each example's fake outcomes and keeps those that match every count
  (`F`, the sleep fake) and every `called with` of the sleep fake; exactly one must fit. Twin checks: the same program
  with no retry, with every response retried, and with no limit must each miss the examples (`wire_twin_fits`), so a
  no-op or always-retry program cannot pass.
- The examples must count `F`'s calls (`wire_retry_unpinned`). Counting the injected clock (`now is called N times`)
  shows each attempt is signed afresh; the m138 test also checks every attempt carries its own `AbortSignal`.

## Recorded skip (`recordEdit`, template)

One awaited statement (`await X;` or `const X[: T] = await CALL;`) directly in a `for (const item of P)` loop over a
parameter of an async target, the failing collaborator coming in through a parameter (`wire_no_seam` otherwise):

    let X[: T];
    try { X = await CALL; } catch (error) {
      if (!(READ === "word") / !(READ.startsWith("word"))) throw error;
      L.push(RECORD);
      continue;
    }

`L` is an existing `const L: string[] = []` or `const L: { k: string; .. }[] = []` of the target declared before the
loop; `RECORD` is one read, or an object of the loop item and reads. The rest of the loop body (the part that marks the
item done) is not run for a skipped item.

## Seam decision for w02 (src/host.ts)

`runScannerHost` builds its scanner itself (`new MarketsScanner(..)`), loops over a local list, and reads the
environment and the file system: there is no seam a data-only fake can use. v2 does not derive one: it refuses the host
task by name (`wire_no_seam`) and the task is split. First a separate task extracts the catch-up loop into a function
that takes the missed days, the scanner and the report list as parameters (a plain refactor, reviewed on its own);
then the recorded skip is derived on that function. m138 demonstrates the skip on such a function.

## Gates

- Job A: `deriveWireV2Detail` (parse, search, twins, template), then the generated test
  (`parseFakeTest(.., { wire: true, calledWith: true })`, v1's fake harness byte for byte), then Job B's own static
  check `gradeExistingEditProblem` on the derived tree.
- Job B: a retry edit spans imports, the seam and the method, so it is graded only when it is exactly the template
  rebuilt from the base (`retryEditShape`), with the hermetic walk before and after on the template with the timeout
  signal taken out (`setTimeout` lives only in the injected sleep default, which the walk skips when the test injects
  `sleep`). A skip edit is recognised by `recordEditShape` (rebuilt exactly; capability delta with the catch as
  `throw error;`). Then the usual Job B run: the new test fails before by assertions only and passes after.

## Limits

One site per task. No jitter, no Retry-After, no per-error-kind retry (every rejection counts as a network error); the
last failure is the original error. No new list, no logging call, no failures-in-a-row counter, no derived seam.
The issue must fit the 2000-character objective after cleaning (`MAX_OBJECTIVE_CHARS`); a longer one is refused as
`wire_task_truncated` rather than derived from the bullets that survived the cut. Markdown cleaning turns a trailing
underscore into a space, so a filter word is written without one (`starts with R2`, not `R2_`).

## G29: "handle a failing call" on a retried method (public-derive-wire-rethrow-v1)

A third ask on the same engine (`deriveRethrow` in `peaceai/lib/derive-wire-v2.ts`), under its OWN spec
`public-derive-wire-rethrow-v1` (params: the v2 vocabulary with `statements: derived-rethrow-at-retry-limit-v2`;
trigger: v1's header form with the ask `handle a failing call`). public-derive-wire-v2's spec, trigger and approved
sha stay byte for byte; v1 (unapproved) keeps its own trigger and never reaches this code.

- Site: the target must be a class method that is already the v2 retry template (`retryLoopOf`: the whole body is the
  loop, the catch is exactly `if (!A(attempt + 1)) throw error; await this.sleep(D(attempt, B)); continue;`). Anything
  else is `wire_rethrow_site` (retry it first). The template's final `throw error;` is the only thing that changes.
- Edit (`rethrowEdit`): that throw becomes v1's closed rethrow `throw new Error(H(args), { cause: error });`, inline
  when the line fits 120 characters, else v1's multi-line layout in a block. H is one exported string-line helper
  (`wireHelper`) of the in-scope source, imported with one new single-name import in the repo's import style when it
  lives in another module. args are closed reads of the caught error (name, code, cause.code, cause.name, and the G29-only
  network filter `message.network`: the error's message only when it is fetch's own `fetch failed` or the error is
  named `TimeoutError` / `AbortError`, else the error's name, so a URL-, key- or host-bearing message never reaches
  the new message; `RETHROW_ARG_FORMS`) or string parameters of the method (one hop through the entry the example calls).
  `message.network` is the only read of the error's message: the plain `message` read is not in the pool, because the
  template always wraps a network call whose message is uncontrolled text (Auditor #623: `wire_message_unfiltered`
  when only it would fit). The cause's message is never passed (Auditor #601: `wire_cause_message` when only it would
  fit); the cause's name only when no failing example's cause has a code (`wire_cause_name`).
- Examples: each one is simulated through the template as it stands (its S / A / D helpers, local or imported). Counts
  and sleep arguments must be what the template already does. A failing example's last try must end in a failure and
  the example must expect a rejection (an answer after every try failed is `wire_rethrow_swallow`: G26, a failure is
  never swallowed and no bare `continue` is ever written). At least one failing example pins the site fake's call
  count at the limit (`wire_rethrow_unpinned`) and at least one example ends in an answer, unchanged
  (`wire_rethrow_answer_unpinned`). If the original error already gives every expected message: `wire_not_needed`.
  Exactly one (H, args) fits, else `wire_no_fit` / `wire_ambiguous` / `wire_search_too_large`. With the plain message
  out of the pool, examples that fail only with network words fit the filter alone; an example whose message is not a
  network word (for w02r, one that carries the account URL and expects only the error's name) still pins the filter's
  else branch.
- Job B: `rethrowEditShape` reads the holes off the graded file, rebuilds the edit from the base with `rethrowEdit` and
  requires it token for token; the hermetic walk runs before and after with the template's timeout signal taken out.
  A graded rethrow that passes the cause's message (`wire_cause_message`) or the error's plain message
  (`wire_message_unfiltered`) is refused by name. All of v2's guards stay on (code anywhere in
  the issue, the 2000-character objective cut).

## G31: the recorded skip records no free text of the error (Auditor, Oct 30 2026, w02b)

PeaceSTOCKS is public, and a per-day catch-up loop catches more than the R2 errors `request()` already cleaned:
Massive, fetch and parse errors come through the same catch, and their messages can carry URLs or query strings. So
the **record** of a recorded skip is built only from the loop item and the closed reads that carry no free text of the
error: `name`, `code`, `cause.code`, `cause.name` (the RETHROW_ARG_IDS shape of G29, without its network filter, which
the record ask does not need). The plain message and the cause's message are refused by name, in both jobs:

- **Job A** (`deriveRecord`): the record search is unchanged; a fit whose record reads the message or the cause's
  message is dropped. When no fit is left, the refusal names the read: `wire_cause_message` (the cause's message),
  else `wire_message_unfiltered` (the plain message). It is never emitted and never falls back to a bare `continue`.
- **Job B** (`gradeExistingEditProblem` on the graded tree, run by `bin/test-candidates.ts` before any candidate code):
  a v2 recorded-skip edit (`recordEditShape`) whose record holds either read is refused with the same codes
  (`recordLeakReason`); test-candidates logs the fixed code (`grading: existing-edit static refusal <code>`) and grades
  the candidate `not-test-only`.

The check is an allow-list: a record value must be the loop item or a RETHROW_ARG_IDS id; any other read (one added to
the error reads later, say) is refused `wire_record_unfiltered`. The record search offers only the error reads, so
`message.network` (allowed, but not offered) is never derived as a record.

The **filter** is unchanged: it may read the message (`startsWith("R2")`), because it is a boolean that decides record
or rethrow and is never stored. G26 holds as before: what the filter does not match is re-thrown, and every skip is
recorded (the day stays in the record, now with the error's name, so the health check still sees it).

The v2 spec JSON and its approved sha (`e9e6d7e1...`, #613) are unchanged; this narrows what the record ask may emit.
An existing v2 record task whose examples record the message (m138's `SKIP`) is now refused `wire_message_unfiltered`;
the same task recording the error's name derives (m138's `SKIP_NAMED`). Neither PeaceSTOCKS transient classifier reads
this record: `isTransientHistoryError` (src/tenmin-history.ts) reads the ten-minute history loop's own caught message,
and `isTransientFailure` (src/tenmin-redispatch.ts) reads the ten-minute run outcome's reason.
