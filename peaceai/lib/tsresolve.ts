// Finds the `typescript` package for a PeaceAI CLI that may run from a checkout with no node_modules of its own
// (a git worktree, or a fresh checkout used from another directory). Node resolves a bare import from the importing
// file's folder upward, never from the working directory, so a worktree with no node_modules fails even when the
// main checkout of the same repository has one. Candidates, in order: the repo root this file is in, then the main
// worktree of the same repository (the folder holding the shared .git). Only a copy whose version equals the
// package.json pin is accepted, so a plan never depends on whichever typescript happens to be nearby.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

/** The repo root first, then the main worktree root (only when the shared git dir is a `.git` folder). */
export function typescriptRoots(root: string = REPO_ROOT): string[] {
  const roots = [resolve(root)];
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (basename(common) === ".git") roots.push(dirname(common));
  } catch { /* not a git checkout: the repo root is the only candidate */ }
  return [...new Set(roots)];
}

/** The pinned typescript entry file under `<candidate>/node_modules`, or null. Never walks above a candidate. */
export function typescriptEntry(root: string = REPO_ROOT): string | null {
  const pin = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { devDependencies?: Record<string, string> }).devDependencies?.typescript;
  if (!pin) return null;
  for (const r of typescriptRoots(root)) {
    const dir = join(r, "node_modules", "typescript");
    const pkg = join(dir, "package.json");
    if (!existsSync(pkg)) continue;
    if ((JSON.parse(readFileSync(pkg, "utf8")) as { version?: string }).version !== pin) continue;
    let entry: string;
    try { entry = nodeModule.createRequire(join(r, "package.json")).resolve("typescript"); } catch { continue; }
    if (entry.startsWith(dir + sep)) return entry;
  }
  return null;
}

/** Makes `import ... from "typescript"` load `entry` for every module imported after this call. Returns false when that
 * needs a redirect this Node lacks (module.registerHooks: Node 22.15+). No redirect when `entry` is the repo's own copy,
 * which Node already finds from the importing file. */
export function useTypescript(entry: string, root: string = REPO_ROOT): boolean {
  if (entry.startsWith(join(resolve(root), "node_modules", "typescript") + sep)) return true;
  const registerHooks = (nodeModule as { registerHooks?: (h: { resolve: (s: string, c: unknown, n: (s: string, c: unknown) => unknown) => unknown }) => unknown }).registerHooks;
  if (typeof registerHooks !== "function") return false;
  const url = pathToFileURL(entry).href;
  registerHooks({ resolve: (specifier, context, next) => (specifier === "typescript" ? { url, format: "commonjs", shortCircuit: true } : next(specifier, context)) });
  return true;
}
