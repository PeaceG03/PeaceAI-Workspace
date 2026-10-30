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

## G19+: "list the sizes too" and "use the list sizes" (public-derive-wire-sizes-v1)

Two more asks on the v2 task language (header naming an existing class method, a `Behavior:` paragraph in plain
words, `Examples:` bullets in the v2 data grammar, no code anywhere, v1's anti-copy guards), under their OWN spec
`public-derive-wire-sizes-v1` (params: the v2 vocabulary with `match: derived-unique-list-site-v1` and
`statements: derived-list-sizes-v1`; trigger: the method header form with the ask `list the sizes too` or
`use the list sizes`). The engine is `peaceai/lib/derive-wire-sizes.ts`; the closed templates and Job B's recognizers
are the G19+ block of `peaceai/lib/learned-edit-existing.ts`. public-derive-wire-v2 and public-derive-wire-rethrow-v1
keep their spec files, triggers and approved shas byte for byte; derive-wire-v2.ts and derive-wire.ts are unchanged.

- List the sizes too (`sizesListEdit`): the target must be a paging key listing (`pagingListOf`: async, returns
  `Promise<string[]>`, one `const L: string[] = []`, exactly one `L.push(...[...X.matchAll(/<T>([^<]+)<\/T>/gu)]
  .map((match) => DEC(match[1] ?? "")).filter(Boolean))` with DEC a module function, one `return L.sort()`, one
  `P_${status}` error, and a member of the one in-file interface the class implements). PeaceAI adds the sibling N
  right after it: the listing's own body (same requests, signing, retries and errors) with only the collect step and
  the sort replaced. Each element E gives `{ K: DEC(key), S: Number(size) }`, the size tag F read as 1 to 15 digits;
  an element without its size fails the call with `P_SIZE_MISSING` (never a silent 0); an element without a key is
  dropped (the key listing's own filter); the result is sorted by key. The interface gains `N?(..)`, OPTIONAL, so other
  implementers and fakes stay valid. N is the one new method every example calls; E, F, K and S are the one fit of the
  examples' pages (the first COUNT pages of the one response fake) and expected entries.
- Use the list sizes (`sizesUseEdit`): the target lists keys with `const KEYS = await R.L(literals)` and then reads
  every key whole only for its length (`(await R.G(item))?.byteLength ?? 0` in a for-of over KEYS). N is the one
  OPTIONAL member of R's declared interface (this module or one relative import) with L's parameters, typed
  `Promise<{ K: string; S: number }[]>`. When R has N, the keys and sizes come from that one call
  (`Number(sizeOf.get(item))`: the keys are N's own keys, so there is no fallback branch on that arm); without N the
  method is unchanged, read for read. No catch is added: a failing N fails the call (G26).
- No clause unpinned (Auditor #629): every clause the templates write must change some example's outcome when taken
  out, else `sizes_clause_unpinned` with the clause: `size-missing` (a rejecting example whose page holds an element
  without its size), `empty-key` (an answered example whose page holds an element without a key), `sort` (an
  answered example whose elements arrive out of key order), and for use `no-sized-listing` (an answered example
  without N whose L and G calls are both counted at least once).
- Other refusals by name: `sizes_calls_unpinned` (the page requests are not counted: a request per key would fit),
  `sizes_download` (the per-key read is allowed), `sizes_silent_zero` (a missing size would only fit as 0),
  `sizes_swallow` (a failing page or N answered with a result), `sizes_no_listing` (land list the sizes too first),
  `sizes_target`, `sizes_list_site`, `sizes_use_site`, `sizes_receiver`, `sizes_entry`, `sizes_exists`,
  `sizes_examples`, `sizes_fields`, `sizes_fake_ambiguous`, `sizes_pages_unpinned`, `sizes_unpinned`, `sizes_no_fit`,
  `sizes_ambiguous`, `sizes_search_too_large`, `sizes_shape`, `sizes_test_entry`, plus v2's parse and anti-copy
  refusals (`wire_task_truncated` at the 2000-character objective cut).
- Job B: `sizesListEditShape` / `sizesUseEditShape` read the holes off the graded file, rebuild the edit from the base
  and require it token for token; the hermetic walk runs after (list: the base has no such method, so every graded
  call must be N, else `sizes_test_entry`) or before and after (use), with the retry template's per-attempt timeout
  signal taken out. Nothing in either template reads, records or rethrows error text.

Front door (G19+): with the NL parse on, both asks are canonical text through their own named trigger
`LEARNED_CANONICAL.deriveWireSizes` (kind EXISTING_EDIT, M75); before EXISTING_EDIT is approved they are refused
RULE_NOT_APPROVED, and the rule itself still adds nothing until public-derive-wire-sizes-v1 is in approved.json.

On a retry request after rethrow-v1 (G19+, PeaceSTOCKS c617e63): the hermetic walk of "list the sizes too" takes the
per-attempt `AbortSignal.timeout(N)` out of every v2 retry template of the class, including one whose final
`throw error;` rethrow-v1 replaced with ONE `throw new Error(H(..), { cause: error });` (`sizesRetrySignalOf`: the
rethrow is put back to `throw error;` and the result must be the v2 template; nothing of the rethrow is read). Any
other final throw keeps the signal, and the walk refuses it (`edit_io_global`), as before.

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
