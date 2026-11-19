# Capability batch 20

Based on `7d16bebc6f350b6ef543c8f037ea1096ee2a0b38`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `unjs/node-mock-http`, `unjs/image-meta`, or `unjs/uqr`. They are also not already a fixture, and they are not the libraries used in batches 1 through 19. The image-meta notice omits one email address and records the hash of that redacted text. The node-mock-http and uqr licenses have no email address, so the pinned hash is the text as written.

## Families

`ServerResponse#end` did not invoke a callback that arrived with no chunk, and a callback that arrived with a chunk ran before `finish`. `unjs/node-mock-http` at parent `ac5ac4d5f8af1420a9b7499223d88d5240831858` does that in `src/stream/writable.ts`. Commit `5280a8b3655f898dce0b06f0d97aed9c7e839cec` emits `finish` and then calls the callback once. The published `test/index.test.ts` fails on `["finish"]` where the check expects `["finish","callback"]`, and passes after the edit.

`imageMeta` accepted a width or height that is finite but not a safe integer, including `1e20` and a 20-digit PNM width. `unjs/image-meta` at parent `9a90ba2a96eaf82d2854e0c195fe0f768c765341` does that in `src/index.ts`. Commit `b605abfd1cea8a4105cc7961591c589b6cb41182` rejects a size that is not a safe integer. The published `test/index.test.ts` fails because those fixtures do not throw, and passes after the edit.

`renderSVG` wrote a color into an attribute without escaping it, so a color containing a quote and a tag broke out of the attribute. `unjs/uqr` at parent `73df32a20e6f3350d65ee850102acfdbea14904d` does that in `src/svg.ts`. Commit `44a822846aed2cdcf67997be355a882a820b117e` escapes `&`, `"`, `<`, and `>`. The published `test/index.test.ts` fails because the SVG still contains `<script>`, and passes after the edit.

## Soundness

The mutant for each family is that unmodified parent. The same published command fails in-process and inside the sandbox for the reason above, and the repair puts the parent file back to the fixed source. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for `fetchNodeRequestHandler`, `imageMeta`, and `renderSVG`. A check that renames `Writable`, `imageMeta`, or `renderSVG` is refused. The cap stays 20. No credit is claimed. Held-out repositories were not opened.
