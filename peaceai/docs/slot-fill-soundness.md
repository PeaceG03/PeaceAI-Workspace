# Slot filling from the repository

The approved import, characterization, and typecheck-script rules already know the edit. Some requests name the job and not the slots. This filler supplies a slot only from the base tree, and only when one candidate remains. It does not add a rule and it does not copy a fix body.

## What is filled

- **Import.** The sentence asks to fix a typecheck failure (`fix`/`repair`/`resolve` … `typecheck`, or `typecheck failure`, or `TS5097`/`TS2307`) and does not ask to add `typecheck:name`. The repo's own `tsconfig.json` is type-checked. A candidate is a relative `TS5097` whose specifier ends in `.ts`/`.tsx`/`.mts`/`.cts`, or a relative `TS2307` with exactly one resolving extension, and the corrected specifier resolves to a file already in the tree. The new import statement changes only that specifier. A bare package that cannot be found is not a candidate. Zero or two or more candidates refuse.
- **Characterization.** The sentence says `characterization test` and contains the name of exactly one exported function (one file). The file slot is that module. Check bullets already in the sentence are kept. They are not invented. A name in two files, or two named exports, refuses. `export default function name` is not that export: the characterization import would be a named import, so a default export is refused.
- **Typecheck script.** The sentence names one `typecheck:name` / `tsconfig.name.json` pair and does not already say `excluding`, `checking only`, or `with checkJs`. A single-entry cue is the word `over`, the phrase `checking only`, or a `.ts` path. `read-only` is not a single-entry cue. With that cue, the file is the one non-test source whose stem equals `name` or whose stem tokens include `name`. Without that cue, a file is used only when its whole stem equals `name`; otherwise the exclude glob is the base `include` with `.test.ts` or `.spec.ts` substituted, and only a suffix that matches at least one file counts. Two suffixes, two files, or two modes refuse. `checkJs` is considered only when the sentence says `checkJs` or `javascript`.

## What this does not claim

- Row 6's only import diagnostic is in an existing `*.test.ts`. The import rule can rewrite it, and the scope gate then refuses `modifies an existing test file`. That row does not become a gate pass.
- Row 26's sentence names no exported function and has no check bullets. The filler refuses. The approved characterization rule would also refuse a header with no checks. That row does not become a gate pass.
- Rows 39 and 213 are the ones this wiring can hand to the existing typecheck-script rule: `lib` is not a whole file stem, tests use only `.test.ts`, and `over` plus the token `worker` names `src/read-worker.ts` alone. Whether the box run passes still depends on the parent checkout and the production gate.

## Guards

`slot-guard:one-import`, `slot-guard:one-export`, and `slot-guard:one-tsconfig` are the exact-one refusals. `slot-guard:resolves` drops a correction that does not resolve. `slot-guard:import-trigger` and `slot-guard:tsconfig-trigger` drop a line the approved trigger cannot parse. `slot-guard:single-entry` stops a one-entry request from also taking the library exclude. `slot-guard:cue-token` counts a cue that is the head of a code token (`typecheck` in `typecheck:lib`). `slot-guard:no-plugin` strips a tsconfig plugin list; a list that remains refuses the scan, because a plugin host is not this process. Deleting any of these changes the decision the guard was there to make.

Issue cleaning keeps a `*` that sits in a path glob (`src/**/*.ts`, bounded by `/` or `.`) and still drops Markdown emphasis (`**bold**`, `*word*`). An exclude glob the typecheck-script trigger allows contains `*`. Without that keep, the cleaned line no longer matches the trigger.
