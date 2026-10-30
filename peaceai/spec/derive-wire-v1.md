# derive-wire v1 (public-derive-wire-v1, GAPS G18)

Status: **proposal-off-wired**. Kind `EXISTING_EDIT`, shape `EXISTING_FUNCTION_EDIT`. It is not in `approved.json`, so
it needs Peace's `/approve-rule` on its proposal issue before Job A may use it. It earns no coverage credit: the team
picked it, and no mined upstream evidence qualifies it (`evidence.qualifies: false`).

Gap: a PeaceSTOCKS wiring task (for example "name the failing R2 request and keep its cause") needs an EXISTING function
to handle a failing call. M98 could only *place* code the issue supplied, and that path stays refused
(`edit_splice_disabled`, Auditor #489 hole 4). derive-wire v1 takes a task that has a behavior and data-only
examples, and PeaceAI picks the whole edit itself.

## Task shape

```
In the existing method `request` of class `Client` in `src/client.ts`, handle a failing call.

Behavior: <plain prose, no code>

Examples:
- fake fetchA = rejects("fetch failed", { cause: { code: "ECONNRESET" } })
- fake fetchB = rejects("socket hang up")
- fake fetchC = resolves("ok")
- expect new Client({ fetchImpl: fetchA }).get("x") rejects with "REQUEST_FAILED:GET:fetch failed:cause=ECONNRESET"
- expect new Client({ fetchImpl: fetchB }).put("y") rejects with "REQUEST_FAILED:PUT:socket hang up:cause="
- expect new Client({ fetchImpl: fetchC }).get("z") resolves to "ok"
- expect fetchA is called 1 time
```

- **Header (the trigger, `DERIVE_WIRE_TRIGGER`):** `in the existing function F in src/x.ts, handle a failing call.` or
  `in the existing method M of class C in src/x.ts, handle a failing call.`
- **`Behavior:`:** prose only. It runs through the DERIVE_FROM_BEHAVIOR prose guard (`behaviorCodeProblem`).
- **`Examples:`:** only `- fake` and `- expect` bullets in the M98 data grammar.
  - A failing fake may add failure fields as data, read in G21:
    `rejects("MSG", { code: "C", name: "N", cause: { code: "C", name: "N", message: "M" } })`.
  - The generated test builds them with a fixed `failure(o)` harness function: an `Error` with the message, the
    optional `cause`, and `code` / `name` set.
- **Anti-copy (fail closed, `wire_behavior_code`):**
  - The guard checks every line of the issue (`WIRE_CODE`: try / catch, `throw new`, `new Error`, `cause: error`,
    `instanceof`, `continue;`, `await`).
  - Every non-example line also passes `STRONG_CODE`.
  - The raw issue passes `rawIssueProblem` (fenced, indented or HTML-comment code).
  - A stray bullet that is neither fake nor expect is refused (`wire_examples`).

## What PeaceAI derives (`peaceai/lib/derive-wire.ts` `deriveWire`)

1. **Scenarios.** Each expect's call is resolved to the fakes it injects. The key is the object key, or the entry
   parameter's name. A literal argument reaches a private target through one hop: `get("x")` →
   `this.request("GET", …)` gives the target's `method` the value `"GET"`.
2. **The site.** It is the ONE own expression or return statement of the target that calls a failing fake's key and
   is not already inside a try. Refusals: `wire_site_none` / `wire_site_ambiguous`.
   - In an async target the call must settle inside the try. An un-awaited expression statement is refused
     (`wire_site_unawaited`). A returned call becomes `return await …`.
3. **Failing examples.** These are the scenarios whose injected fake fails on its FIRST outcome.
   - The fake must drive only that one example (`wire_fake_shared`, `wire_fake_ambiguous`).
   - At least one failing example is needed (`wire_no_failing_example`).
   - If every failing example just passes the original failure through, the task is `wire_not_needed`.
4. **The catch, from a closed set.** Every candidate is evaluated against every failing example.
   - `catch { continue; }`: only when the site is inside a loop of the target and every failing example settles
     normally.
   - `catch (error) { throw new Error(H(args), { cause: error }); }`, where:
     - H is an exported top-level function of the SAME module with 1-4 `string` parameters, `: string`, and a body
       that is a single `return` of a `+` chain of string literals and parameters (`wireHelper`, evaluated by
       `evalWireHelper`);
     - each argument is one of `WIRE_ARG_FORMS` (error.message, .name, .code, .cause.code, .cause.name,
       .cause.message, each read safely for a non-Error throw) or a `string` parameter of the target.
   - The search is helpers × pool^arity, at most `WIRE_MAX_CANDIDATES` (20000), else `wire_search_too_large`.
     Exactly one candidate must fit: otherwise `wire_no_fit` or `wire_ambiguous`.
5. **Layout.** The edit is built as one line for the M98 gate, then laid out one statement per line.

## Gates (no new trust)

- **Job A (`deriveWireDetail`).** The params must be the wire vocabulary (`isWireParams`; all or none, else
  `wire_params`). The derived edit goes through the M98 gate in wire mode (`gateWireEdit` → `gateSuppliedEdit(…,
  wire=true)`), which keeps:
  - path confinement;
  - the NEW grammar (a bare `continue` only where the site really is in a loop: `editStatement(…, wire)` /
    `siteInLoop`);
  - the hermetic walk;
  - the fake-test grammar.
- **The capability check.** It runs on the edit with its catch replaced by `throw error;` (`wireEditShape`), so the
  only things a wire edit adds beyond M98 are the try wrapper and the closed catch.
  - A catch outside the grammar (a raw message, an inline string, a new or imported helper) is not a wire edit.
    It is graded as an ordinary M98 edit and refused (the 2-argument `Error` is a new capability).
- **Job B.** `test-candidates.ts` is unchanged. Its `gradeExistingEditProblem` recognizes the same shape
  structurally (`wireEditShape`) and accepts the wire harness (failure fields) ONLY for a wire edit.
  - It then runs the generated test before and after (it must fail on the base and pass on the edit), plus the
    original suite. m137 runs this end to end.
- **Routing.** Through `applyRule` → `EXISTING_EDIT` → `isWireParams ? deriveWireDetail : existingEditDetail`.
  The M98 spec never reaches derive-wire, and still refuses every task.

## Auditor conditions

1. **No code in the issue, the guard stays on, and PeaceAI picks the inserted code:** see Anti-copy above. Every
   token of the try / catch comes from the closed set. The derived edit passes the target's existing tests plus the
   new fake test: Job B in m137, and the box dry run on PeaceSTOCKS below.
2. **The fake tests exercise behavior:**
   - *A non-retryable error is not retried:* the generated test asserts the failing fake `is called 1 time`.
   - *The per-day catch moves on without marking the failed day done:* m137 `storeDays` with the first save
     rejecting expects exactly the later days back and 3 save calls. The test fails on the base and passes on the
     edit, under Job B.
   - *Retries stop at the limit:* NOT in v1, because retry is scoped out (condition 3).
3. **Retry is scoped out of v1, honestly, not faked.**
   - A correct R2 retry must re-sign every attempt. `R2ObjectClient.request` signs once, before the fetch, so wrapping
     only the fetch would replay a stale signature.
   - It must also time out each attempt on its own (a timer or AbortSignal per attempt), sleep or back off between
     attempts (a clock), and retry only what `isRetryableR2Status(status)` or a network error allows.
   - Doing that means moving the signing into the loop, a non-hermetic timer and clock, and reading a Response
     status. That is a new statement grammar and a new capability set, not one wrap.
   - v1 therefore derives no retry. At a site outside a loop, a task that expects the failing fake to be called more
     than once, or whose failing fake fails and then answers while its example expects to settle normally (fail, then
     succeed), is refused by name (`wire_retry_not_in_v1`, m137).
4. **No coverage credit, team-picked only:** `evidence.qualifies: false`, it is not in `approved.json`, and it touches
   no credit, gate, stage2 or workflow code.

## What remains (not in v1)

- **Retry** (see condition 3): per-attempt signing and timeout, a bounded attempt count, a backoff clock, and only
  `isRetryableR2Status` / network errors. The fake tests must then show the limit is respected and a non-retryable
  status is tried once.
- **Helpers imported from another module, or a new helper.** Today the helper must already exist in the target
  module. The real wiring needs a v3 append first (the box dry run does exactly that).
- **Wrapping a declaration** (`const r = await f()`). It needs the binding hoisted, or the code that follows moved
  into the try.
- **A catch that returns a value**, logs, or records a failure entry (for example `reports.push({ … })`), and `finally`.
- **More than one site per task**, and a site whose failing fake also drives other examples.
- **The w02 `host.ts` wiring** (the scheduler host's failure line). That is a top-level script, not an exported
  function a fake test can drive.

## Byte identity

DERIVE_FROM_BEHAVIOR v1-v6 outputs over the health3 and scanner drafts are byte-identical before and after this change
(the box harness, run on two PeaceSTOCKS bases). The only change to `learned-derive.ts` is `export` on `STRONG_CODE`.

## G26: the continue form and scanner per-day wiring

The bare `catch { continue; }` above swallows every error (a `TypeError` included) and leaves no record. It is **not
allowed for scanner per-day / per-session wiring** (Auditor, Oct 29 2026): such wiring uses derive-wire v2's filtered,
recorded skip (`peaceai/spec/derive-wire-v2.md`), which re-throws every non-matching error and records each skipped
item. v1's behavior and output are unchanged.
