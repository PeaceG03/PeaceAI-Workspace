# Capability batch 7

Stacked on `c10113c5fbb64a659f52726d90c8dcbc7b39b11b`. No credit claim. Held-out diffs and reasons were not opened. The cap stays 20. `specgrade.ts`, `gate.ts`, `scope.ts`, and `capability-job.ts` were not edited. The self-change lane was not edited.

The libraries below were checked by name against the held-out list, the hidden set, the public exclusion list, the practice pairs, and the LM pair lists. None of those names is `formkit/tempo`, `toss/es-hangul`, or `preactjs/signals`. They are also not already a fixture. None of the three license texts contains an email address, so the pinned hash is the text as written.

## Counts

Builder-log on the merged batches is 88 pass / 163 fail / 25 unmeasured, of which 140 fails are self-change. Practice dev at the pre-repair head was test-as-spec 3/37/7 and text 0/40/7. Test-as-spec `VERIFIED_TEST_ONLY` is 14. Text `NO_EDIT` is 21 and `ADD_UNSPECIFIED` is 8. This batch does not claim those rows moved. The repairs are general shapes from three different authors, not a template copied from a dev pair. The core archive is not on this machine.

## Families

`parse` accepted a date whose separators or trailing characters were not in the format. `formkit/tempo` at parent `c42dff9b47e57abebb95dc0d228965e0d57beede` does that in `src/parse.ts`. Commit `1bef0677abc04b52648b0174d41d37b70087d704` compares literals after normalizing whitespace and case, and rejects trailing input, when every format part is kept. The published `src/__tests__/parse.spec.ts` fails before that edit and passes after. A file that is not `parseParts` is refused. MIT.

`binaryAssemble` composed a following digit or symbol into the previous syllable. `toss/es-hangul` at parent `79e7ef3d62842be05f77963abd6c3b5baa90fb1d` does that in `src/_internal/hangul.ts`. Commit `ea06e349cc06885bbf6c7f92fb047148719b8fd6` appends a character that is not a Hangul letter. The published `src/core/assemble/assemble.spec.ts` fails before and passes after. A join that is not `binaryAssemble` is refused. MIT. A Hangul letter still composes. A space still breaks the syllable, which is what the older cases check.

`createModel` dropped effects captured during a factory that throws, without disposing them, so an outer model could keep a nested effect that should have stopped. `preactjs/signals` at parent `500b7904ebd409471beba7e5ca923a0548ead9ba` does that in `packages/core/src/index.ts`. Commit `7528bce29fe457ae5bcff740cece8b703a651681` disposes those effects and then rethrows the factory error. The published `packages/core/test/signal.test.tsx` fails before and passes after. A catch that is not `createModel` is refused. MIT.

## Soundness

Each edit is one shape. Strict parsing is added only to `parseParts`, and only when the caller kept every part, so a filtered format can still ignore text it does not describe. A literal is compared after NFKC, case folding, and treating every whitespace character as a space, which is what the published suite checks. The Hangul edit appends only when the previous character is not a syllable or jamo, or the next character is not a jamo. The model edit disposes only the effects captured for the factory that threw, and a dispose error does not replace that error. Deleting the new line from the repaired file makes the published check fail, in-process and inside the sandbox, so that mutant is rejected. An `any` parameter that returns the recorded answer for every input is `verified_test_only` for each family. A review note that names no function, and `Add <name>` with no value, stay refusals.

## Dropped

`moment/luxon` duration formatting is JavaScript. `nanostores/nanostores` listener batching is JavaScript. `antfu/utils` `e279526d55f4` changes a `then` signature; the new check is `expectTypeOf` and does not fail at runtime. `pmndrs/jotai` `eb81bc40d8b9` needs React to run the published test. `vuejs/petite-vue` `1bbd4d1c00c6` checks custom delimiters from an HTML page. Libraries already named in the LM exclusion lists, and the libraries used in earlier batches, were not reused.
