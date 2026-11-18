# Capability batch 15

Based on `520cc2dab110b5e9959dd0d5dde4f077c0c6f42c`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `unjs/std-env`, `unjs/rou3`, or `unjs/c12`. They are also not already a fixture, and they are not the libraries used in batches 1 through 14. Each notice omits one email address and records the hash of that redacted text.

## Counts

Builder-log on the merged batches is 88 pass / 163 fail / 25 unmeasured, of which 140 fails are self-change. Practice dev at the pre-repair head was test-as-spec 3/37/7 and text 0/40/7. Test-as-spec `VERIFIED_TEST_ONLY` is 14. Text `NO_EDIT` is 21 and `ADD_UNSPECIFIED` is 8. This batch does not claim those rows moved. The repairs are three different shapes, not a template copied from a dev pair. The core archive is not on this machine.

## Families

`detectAgent` treated `TERM_PROGRAM=kiro` as an agent even when a person was at a TTY. `unjs/std-env` at parent `c5b59ac81465a539111821325306ce92038cabb0` does that in `src/agents.ts`. Commit `09d5e7805fc9507480ed8914cd21a469a5f70028` matches kiro only when stdout is not a TTY. The published `test/agents.test.ts` fails before that edit and passes after. A check that is not `detectAgent` is refused. MIT. A TTY gate. The published test imports vitest, so the sandbox supplies that runner. The library has no other dependency.

`findOverlappingRoutes` collapsed every route that shared one data reference, so two registrations of the same object were reported once. `unjs/rou3` at parent `68fc0173a9f4148988db83fb820e906c805a2ab2` does that in `src/operations/overlap.ts`. Commit `a560d1652f347647216afc78dbc5a88f4c3616b8` reports one match per registration identity. The published `test/overlap.test.ts` fails before and passes after. A check that is not `routesOverlap` is refused. MIT. A registration dedupe. The published test imports vitest, so the sandbox supplies that runner. The library has no other dependency.

`interpolate` read a value back after it had already been expanded, so an escaped `\${VAR}` became the referenced value when another key pointed at it, and the result depended on key order. `unjs/c12` at parent `88c39bac64803d63c435c4c8a24193fa92bf6b53` does that in `src/dotenv.ts`. Commit `f4bc78672c51ebd12a09d4e8d905b7dc97cf03c8` resolves references from the raw values and reuses a key's final value. The published `test/dotenv.test.ts` fails before and passes after. A check that is not `setupDotenv` is refused. MIT. A raw-value interpolation. The published test imports vitest, so the sandbox supplies that runner. Loading the package entry also loads `pathe`, `defu`, `exsolve`, `rc9`, and `perfect-debounce`, so the sandbox supplies those dependencies. The dotenv source and the published test are unchanged.

## Soundness

Each edit is one shape. An agent env var other than kiro's `TERM_PROGRAM` is still detected, and kiro with no TTY is still an agent. Two tree entries from one optional route are still one match; two routes that share a data object are both reported. A normal `${VAR}` reference still expands, and an escaped literal stays literal in either key order. Deleting the new TTY `if` makes the published check fail the one kiro-with-a-TTY assertion, in-process and inside the sandbox, and that file is not repaired. The old dotenv source fails the same `REF` value as the parent, and the repair restores `resolvedValues`. Dropping the registration `continue` fails the overlap length check and is not repaired. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `detectAgent`, `routesOverlap`, and `setupDotenv`. A review note that names no function, and `Add <name>` with no value, stay refusals.

## Dropped

A fourth clean family was not found. `unjs/theme-colors` `fa6bb1f` has no license file at that commit. `unjs/h3` `48d650b` loads several packages, including a router already used in this batch. A fetch client's published test imports a package that is already on an exclusion list. Libraries already named in the LM exclusion lists, and the libraries used in batches 1 through 14, were not reused.
