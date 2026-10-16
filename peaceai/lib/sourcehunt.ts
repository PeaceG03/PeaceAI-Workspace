// M49 source hunt (Architect): where else do the provenance strings occur? Pure helpers; counts only, never text.
/** Generated or derived files: build output, generated code, lockfiles, snapshots, fixtures/data, minified files. */
export const DERIVED_PATH = /(^|\/)(dist|build|out|generated|coverage|fixtures?|__snapshots__|data)\/|\.(generated|gen|min)\.[a-z]+$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.snap$/i;
export const isDerivedPath = (p: string) => DERIVED_PATH.test(p);
export const countContaining = (s: string, texts: readonly string[]) => texts.filter((t) => t.includes(s)).length;
/** A public repo name safe to log: owner/name, letters, digits, . _ - only. */
export const safeRepoName = (r: string) => /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(r);
