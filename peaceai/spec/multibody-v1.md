# MULTI_LINE_BODY v1 (M32, for Auditor review; OFF by default)

A candidate may replace the whole body of ONE existing function. All six limits must hold, or the candidate is refused:

1. **One existing function, non-protected file.** Exactly one top-level `function` declaration's body differs. Every
   byte outside that body is identical. The file is on `EDITABLE_PATHS` for its repository and is not protected.
   No file is created, deleted or renamed.
2. **Size.** The new body is at most 20 lines (and at most 1,600 characters).
3. **No new reach.** The import block is unchanged. The new body names none of: `fs`, `net`, `http`, `https`, `process`,
   `child_process`, `require`, `import(...)`, `eval`, `Function`, `globalThis`, `global`, `window`, `Deno`, `Bun`,
   `fetch`, `env`, `WebAssembly`, `Reflect`, `Proxy`, `constructor`, `prototype`, `__proto__`. No `with`, `debugger`,
   `new.target` or `import.meta`.
4. **Behavior proof.** Its test passes with the edit and fails without it, and the "without" failures are ALL
   assertion failures (`assertionFailuresOnly`), never a crash, load error or timeout.
5. **Review.** Builder never self-approves or merges; Auditor reviews and Architect merges this rule and any
   approval of it.
6. **Off by default.** Only `PEACEAI_MULTIBODY=true` turns it on. This spec's sha256 is pinned in the tests, and
   the live proofs are in the PR.
