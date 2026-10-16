# IMPORT_EDIT v2 (M56 proposal, M66 wired; a NEW kind, not in approved.json until Peace /approve-rule)

IMPORT_EDIT v1 is unchanged. v2 edits ONE existing top-level `import` in a non-protected `.ts`/`.mts`/`.tsx` file and
is refused unless all hold (engine: `peaceai/lib/import-edit-v2.ts`):

1. **One import, nothing else.** Same number of imports; exactly one import's text differs; every byte outside the
   import declarations is identical; the file parses before and after; no import attributes.
2. **Specifier.** Either unchanged (a plain relative path or a bare name), or the `node:` prefix of a Node builtin is
   toggled, or a v1-style relative change (extension-only or directory move keeping the file name) that resolves to an
   existing, non-protected repo file within 3 `../`; a directory move is refused while the old specifier still
   resolves (Auditor #226: it would switch to a different module). A bare package is never introduced or swapped, and relative and
   bare specifiers are never exchanged (no new dependency).
3. **Bindings.** The default and namespace bindings are kept. Named bindings may be added or removed, and a `type`
   modifier flipped, at most 5 changes in total. A removed binding may not be used in the file's code; an added one
   must be used in the code and may not already be bound, neither by an import nor by any declaration in the file
   (variable, parameter, destructuring, function, class, type, interface, enum, namespace, type parameter, catch
   variable), and may not shadow a global (`setTimeout`, `fetch`, `Buffer`, ...) (Auditor #226). Comments and strings do not count as uses (TypeScript
   scanner). Names are plain identifiers, never `__proto__`, `constructor`, `prototype`, `default`, `eval` or
   `arguments`. Side-effect imports never gain or lose a clause. Formatting- or order-only changes are refused.
4. **Behavior proof.** The task's check (typecheck or test) fails before and passes after, through the normal grading.
5. **Off by default.** The dev path needs `PEACEAI_IMPORT_EDIT_V2=true`. M66 wires kind `IMPORT_EDIT_V2`
   (`peaceai/rules/learned/public-import-edit-v2.json`) into RULE_KINDS; Job A runs it only when the hash-pinned approved
   list names its exact hash. Approval is Peace's. Builder never posts /approve-rule.
6. **Task phrase (M66).** `change import of SPECIFIER in FILE to: import ...` (the whole new import statement, one line).
   Every top-level import with that exact specifier is tried in turn: the new statement replaces it and the result is
   checked with rules 1-3. Exactly one of them must give a valid edit; none is a refusal with the v2 reason (one
   match) or `import_not_unique` (several), and more than one valid edit is `import_not_unique`.
   No new test file: Job B grades the candidate with the target's own checks.

Evidence (`peaceai/rules/proposals/m56-import-edit-v2-evidence.json`): 25 mined licensed external commits (22 single-line, 3 multi-line) from repos outside the training corpus (M60: 12 overlapping dropped) pass
on their real before/after files (blob-pinned fixtures), at or above the 10-example bar. Commits that add or remove a whole import line are refused by rule 1 (93 mined).
