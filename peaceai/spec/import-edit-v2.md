# IMPORT_EDIT v2 (M56 proposal; a NEW kind, OFF by default, not in approved.json)

IMPORT_EDIT v1 is unchanged. v2 edits ONE existing top-level `import` in a non-protected `.ts`/`.mts`/`.tsx` file and
is refused unless all hold (engine: `peaceai/lib/import-edit-v2.ts`):

1. **One import, nothing else.** Same number of imports; exactly one import's text differs; every byte outside the
   import declarations is identical; the file parses before and after; no import attributes.
2. **Specifier.** Either unchanged (a plain relative path or a bare name), or the `node:` prefix of a Node builtin is
   toggled, or a v1-style relative change (extension-only or directory move keeping the file name) that resolves to an
   existing, non-protected repo file within 3 `../`. A bare package is never introduced or swapped, and relative and
   bare specifiers are never exchanged (no new dependency).
3. **Bindings.** The default and namespace bindings are kept. Named bindings may be added or removed, and a `type`
   modifier flipped, at most 5 changes in total. A removed binding may not be used in the file's code; an added one
   must be used in the code and may not already be bound. Comments and strings do not count as uses (TypeScript
   scanner). Names are plain identifiers, never `__proto__`, `constructor`, `prototype`, `default`, `eval` or
   `arguments`. Side-effect imports never gain or lose a clause. Formatting- or order-only changes are refused.
4. **Behavior proof.** The task's check (typecheck or test) fails before and passes after, through the normal grading.
5. **Off by default.** Only `PEACEAI_IMPORT_EDIT_V2=true` turns it on; not in RULE_KINDS until a separate,
   Auditor-reviewed wiring PR; approval is Peace's. Builder never posts /approve-rule.

Evidence (`peaceai/rules/proposals/m56-import-edit-v2-evidence.json`): 25 mined licensed external commits (22 single-line, 3 multi-line) from repos outside the training corpus (M60: 12 overlapping dropped) pass
on their real before/after files (blob-pinned fixtures), at or above the 10-example bar. Commits that add or remove a whole import line are refused by rule 1 (93 mined).
