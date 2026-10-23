/**
 * Every parser sees paths written by a different tool: Istanbul records absolute
 * runner paths, Clover records absolute paths from PHP's point of view, Cobertura
 * records paths relative to a `<sources>` entry, and lcov records whatever the
 * runner's cwd happened to be. A merge is keyed on the path, so two reports that
 * disagree about how to spell the same file merge into two files and the total is
 * silently wrong — with more files and a bigger denominator, which looks entirely
 * healthy.
 *
 * The result is always repo-relative and POSIX-separated, so a report produced on
 * a Windows runner and a diff produced by git agree on the key.
 *
 * The path arithmetic is done on strings rather than through `node:path` on
 * purpose: `node:path` resolves against the *host*, so a Windows path would be
 * read as a relative one when the same report is inspected on Linux — and this
 * module's whole job is to make that impossible.
 */
const DRIVE = /^[A-Za-z]:\//;

export interface PathOptions {
  root?: string;
  sourceRoots?: string[];
}

export function normalisePath(
  raw: string | undefined,
  { root = process.cwd(), sourceRoots = [] }: PathOptions = {}
): string {
  if (!raw) return '';

  const path = clean(raw);
  const base = clean(root);

  if (!isAbsolute(path)) {
    // Cobertura splits a path across `<sources>` and `filename`. Only a source
    // root that actually resolves inside the repository may be joined on: a
    // report generated in a container carries roots that do not exist here, and
    // joining one of those would produce a path that matches nothing.
    for (const sourceRoot of sourceRoots) {
      const joined = join(clean(sourceRoot), path);
      const relative = within(base, joined);
      if (relative !== null) return relative;
    }
    return path;
  }

  const relative = within(base, path);
  if (relative !== null) return relative;

  // An absolute path from another machine — a docker mount, or a report copied
  // in from another job. There is nothing to relativise against, but a usable
  // key beats dropping the file.
  return path.replace(DRIVE, '').replace(/^\/+/, '');
}

function clean(value: string): string {
  return String(value)
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || DRIVE.test(path);
}

function join(base: string, path: string): string {
  return base === '' ? path : `${base}/${path}`;
}

/** The path below `base`, or null when it is not below it at all. */
function within(base: string, path: string): string | null {
  if (base === '') return null;
  if (path === base) return '';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}
