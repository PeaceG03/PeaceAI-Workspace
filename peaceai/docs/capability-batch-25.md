# Capability batch 25

Based on `4aaff542952dafb8ccd63564cf08b0d97ade75ae`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `tinylibs/tinyspy`, `SuperchupuDev/tinyglobby`, or `unjs/magicast`. They are also not already a fixture, and they are not the libraries used in batches 1 through 24. `unjs/pkg-types` was evaluated and dropped: its published suite needs a confbox JSONC trailing-comma default this tree does not pin. `unjs/consola` box-width fixes were evaluated and dropped: they ship no published test. `tinylibs/tinyrainbow` was evaluated and dropped: the new case needs Playwright. Each notice omits email addresses when the license text contains them and records the hash of that redacted text. A license with no email keeps the hash of the text as written.

## Families

`spyOn` only read an own-property descriptor, so an inherited getter/setter on a parent class was missed and assigning through the spy threw. `tinylibs/tinyspy` at parent `f42d54522dc94b2102558172ab7c0766f1d65110` does that in `src/spyOn.ts`. Commit `0684083fc217e18d21ea404b3461bde52b60fdb3` walks the prototype chain. The published `test/class.test.ts` fails the inherited-accessor cases, and passes after the edit.

`getOptions` spread options over defaults, so an explicit `undefined` cleared a truthy default, and `cwd` was captured at import time. `SuperchupuDev/tinyglobby` at parent `577920259c91f5603fab3dbfa599a83bbb14a27a` does that in `src/index.ts`. Commit `a37f27a670fa8c94f5108dbd2a90307e14cab077` keeps undefined keys on the defaults and resolves `cwd` at call time. The published `test/index.test.ts` fails those cases, and passes after the edit.

Proxied `push`/`unshift` forwarded only their first argument, and `splice` without a `deleteCount` deleted nothing. `unjs/magicast` at parent `e90ac46fd96d308c856542be04d15020e2696d38` does that in `src/proxy/array.ts`. Commit `abea2cfd2a01821f84067962000471b787543c85` accepts variadic values and open-ended splice. The published `test/array.test.ts` fails those cases, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `spyOn`, `glob`, and `proxifyArrayElements`. A check that renames `spyOn`, `glob`, or `proxifyArrayElements` is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
