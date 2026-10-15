# IMPORT_EDIT v1 (M45 proposal; OFF by default, not in approved.json)

Change the module specifier of ONE existing top-level `import` in a non-protected `.ts` file. Refused unless all hold:

1. **One import, nothing else.** Same number of imports; exactly one import's text differs, and only in its specifier
   string. Imported names, `type` modifiers and every byte outside the import declarations are identical.
2. **Relative only, same module.** Old and new specifiers are both relative (`./` or `../`, `[\w./-]`, at most 200
   characters). The change keeps the module: an extension-only change (`./x` / `./x.ts` / `./x.js`) or a directory
   move that keeps the file name. A bare package name is never introduced or swapped (no new dependency).
3. **Resolves (Auditor #167 L4).** The new specifier, resolved from the file's own folder, stays inside the repo,
   climbs at most 3 leading `../`, names an existing repo file (exact, `.ts`, `.tsx`, `.mts`, `/index.ts`, or the `.ts`
   twin of a `.js` specifier) and that file is not on PROTECTED_SELF.
4. **Paths.** A plain relative `.ts`/`.mts` path, not `.d.ts`, not on PROTECTED_SELF; the file parses after the edit.
5. **Behavior proof.** The task's check (typecheck or test) fails before and passes after, through the normal grading.
6. **Off by default.** Only `PEACEAI_IMPORT_EDIT=true` turns the check on; the kind is not in RULE_KINDS until a
   separate, Auditor-reviewed wiring PR; approval is Peace's. Builder never posts /approve-rule.

Evidence: after the #167 review rules, 4 of 59 mined licensed external commits replay through the engine; below the 10-example bar, so this kind does not qualify yet (`peaceai/rules/proposals/m45-evidence.json`).

Live-proof plan (after approval only): one valid peace-task on PeaceSTOCKS (a `.ts`-extension import that breaks
`tsc`, as in builder-log entry 6) must yield a counted candidate; one bad task (swap to a bare package name) must be
refused with 0 candidates. Actions run ids recorded on each issue.
